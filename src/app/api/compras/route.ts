import { NextRequest, NextResponse } from "next/server";
import { enlazarConCaja } from "@/lib/caja/enlace-movimientos";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listCompras,
  insertComprasConImpacto,
  type CompraItemInput,
} from "@/lib/compras/server/compras-pg";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/compras — lista via PG directo.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    // ?numero_control=... → cabecera + líneas de UNA compra (para modo edición).
    const numeroControl = (new URL(request.url).searchParams.get("numero_control") ?? "").trim();
    if (numeroControl) {
      const { data, error } = await ctx.supabase
        .from("compras")
        .select("*")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("numero_control", numeroControl)
        .order("created_at", { ascending: true });
      if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) return NextResponse.json(errorResponse("Compra no encontrada."), { status: 404 });
      const h = rows[0];
      return NextResponse.json(successResponse({
        compra: {
          numero_control: numeroControl,
          proveedor_id: h.proveedor_id ?? "",
          proveedor_nombre: h.proveedor_nombre ?? "",
          moneda: h.moneda ?? "PYG",
          tipo_cambio: h.tipo_cambio ?? 1,
          tipo_pago: h.tipo_pago ?? "contado",
          plazo_dias: h.plazo_dias ?? null,
          nro_timbrado: h.nro_timbrado ?? "",
          numero_factura: h.numero_factura ?? "",
          fecha_factura: h.fecha_factura ?? null,
          metodo_pago: h.metodo_pago ?? null,
          estado: h.estado ?? "registrada",
        },
        items: rows.map((r) => ({
          producto_id: r.producto_id ?? "",
          producto_nombre: r.producto_nombre ?? "",
          cantidad: r.cantidad ?? 0,
          costo_unitario: r.costo_unitario ?? 0,
          costo_unitario_original: r.costo_unitario_original ?? r.costo_unitario ?? 0,
          iva_tipo: r.iva_tipo ?? "10",
          subtotal: r.subtotal ?? 0,
          monto_iva: r.monto_iva ?? 0,
          total: r.total ?? 0,
          precio_venta: r.precio_venta ?? 0,
          margen_venta: r.margen_venta ?? null,
        })),
      }));
    }

    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const rows = await listCompras(schema, ctx.auth.empresa_id, exigirSucursal(ctx.auth.sucursal_id));
    return NextResponse.json(successResponse({ compras: rows }));
  } catch (err) {
    console.error("[/api/compras GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las compras."), { status: 500 });
  }
}

/**
 * Costo unitario en guaraníes, recalculado en el servidor (punto 1.5).
 *
 * POR QUÉ NO SE CONFÍA EN EL QUE MANDA EL NAVEGADOR
 *   La pantalla hace la conversión y envía los tres valores por separado:
 *   el costo en la moneda original, el tipo de cambio y el resultado. Si esos
 *   tres llegan inconsistentes — un estado viejo de React, una pestaña abierta
 *   desde ayer, alguien llamando la API a mano — el costo guardado es
 *   cualquiera, y de ahí sale el costo promedio ponderado del producto.
 *
 *   Un costo mal grabado no se nota: no rompe nada, solo deja mal valuado el
 *   inventario y mal calculada la ganancia de todas las ventas siguientes. Por
 *   eso la multiplicación se rehace acá y el valor del cliente se descarta.
 *
 * En guaraníes el "original" ya es el costo final: el tipo de cambio es 1.
 */
function costoEnGuaranies(
  costoOriginal: number,
  moneda: "PYG" | "USD",
  tipoCambio: number
): number {
  if (!Number.isFinite(costoOriginal) || costoOriginal <= 0) return 0;
  if (moneda !== "USD") return costoOriginal;
  const tc = Number.isFinite(tipoCambio) && tipoCambio > 0 ? tipoCambio : 1;
  return costoOriginal * tc;
}

/**
 * PUT /api/compras — EDICIÓN COMPLETA de una compra (cabecera + líneas). Borra las
 * filas del numero_control y reinserta con el MISMO número. NO recalcula costos de
 * productos (edición administrativa; evita drift del costo_promedio).
 */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const numeroControl = String(body.numero_control ?? "").trim();
    if (!numeroControl) return NextResponse.json(errorResponse("Falta numero_control."), { status: 400 });
    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (rawItems.length === 0) return NextResponse.json(errorResponse("La compra no tiene productos."), { status: 400 });

    // Preservar campos de las filas actuales (comprobante, fecha, created_by).
    const { data: prev } = await ctx.supabase
      .from("compras")
      .select("fecha, created_by, usuario_nombre, sucursal_id, comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type")
      .eq("empresa_id", empresaId)
      .eq("numero_control", numeroControl)
      .limit(1)
      .maybeSingle();

    const moneda = body.moneda === "USD" ? "USD" : "PYG";
    const tipoCambio = moneda === "USD" ? Number(body.tipo_cambio) || 1 : 1;
    const tipoPago = body.tipo_pago === "credito" ? "credito" : "contado";
    const plazoDias = tipoPago === "credito" && body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
      ? parseInt(String(body.plazo_dias), 10) || null : null;
    const nroTimbrado = String(body.nro_timbrado ?? "").trim().toUpperCase() || null;
    const numeroFactura = body.numero_factura != null && String(body.numero_factura).trim() !== "" ? String(body.numero_factura).trim() : null;
    const fechaFactura = typeof body.fecha_factura === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha_factura) ? body.fecha_factura : null;
    const metodoPago = body.metodo_pago === "efectivo" || body.metodo_pago === "transferencia" || body.metodo_pago === "tarjeta" ? body.metodo_pago : null;
    const estado = body.estado === "anulada" ? "anulada" : "registrada";
    const proveedorId = body.proveedor_id != null && String(body.proveedor_id).trim() !== "" ? String(body.proveedor_id) : null;
    const proveedorNombre = String(body.proveedor_nombre ?? "").trim() || null;

    const rows = rawItems.map((it) => ({
      empresa_id: empresaId,
      sucursal_id: (prev?.sucursal_id as string) ?? sucursalId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      producto_id: it.producto_id != null && String(it.producto_id).trim() !== "" ? String(it.producto_id) : null,
      producto_nombre: String(it.producto_nombre ?? ""),
      cantidad: Number(it.cantidad) || 0,
      moneda,
      tipo_cambio: tipoCambio,
      costo_unitario_original: Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
      // Recalculado acá, no el que vino del navegador: ver costoEnGuaranies.
      costo_unitario: costoEnGuaranies(
        Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
        moneda, tipoCambio
      ),
      iva_tipo: ["exenta", "5", "10"].includes(String(it.iva_tipo)) ? String(it.iva_tipo) : "10",
      subtotal: Number(it.subtotal) || 0,
      monto_iva: Number(it.monto_iva) || 0,
      total: Number(it.total) || 0,
      precio_venta: Number(it.precio_venta) || 0,
      precio_venta_usd: it.precio_venta_usd != null ? Number(it.precio_venta_usd) || null : null,
      margen_venta: it.margen_venta != null ? Number(it.margen_venta) : null,
      tipo_pago: tipoPago,
      plazo_dias: plazoDias,
      nro_timbrado: nroTimbrado,
      numero_factura: numeroFactura,
      numero_control: numeroControl,
      estado,
      fecha: (prev?.fecha as string) ?? new Date().toISOString(),
      fecha_factura: fechaFactura,
      metodo_pago: metodoPago,
      comprobante_url: prev?.comprobante_url ?? null,
      comprobante_storage_path: prev?.comprobante_storage_path ?? null,
      comprobante_nombre: prev?.comprobante_nombre ?? null,
      comprobante_mime_type: prev?.comprobante_mime_type ?? null,
      created_by: (prev?.created_by as string) ?? ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: (prev?.usuario_nombre as string) ?? ctx.auth.user?.email ?? null,
    }));

    const del = await ctx.supabase.from("compras").delete().eq("empresa_id", empresaId).eq("numero_control", numeroControl);
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 500 });
    const ins = await ctx.supabase.from("compras").insert(rows);
    if (ins.error) return NextResponse.json(errorResponse(ins.error.message), { status: 500 });
    return NextResponse.json(successResponse({ numero_control: numeroControl }));
  } catch (err) {
    console.error("[/api/compras PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo editar la compra."), { status: 500 });
  }
}

/**
 * POST /api/compras — crea compra + movimiento ENTRADA + actualiza producto.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";

    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    if (!req("nro_timbrado"))
      return NextResponse.json(errorResponse("Falta el N° de timbrado."), { status: 400 });

    const ivaOk = (v: unknown) => (["exenta", "0", "5", "10"].includes(String(v)) ? (String(v) === "0" ? "exenta" : String(v)) : "10");

    // Compat: si no viene items[], envolver el body viejo (compra simple) en una línea.
    const rawItems: Record<string, unknown>[] = Array.isArray(body.items)
      ? (body.items as Record<string, unknown>[])
      : [body];

    if (rawItems.length === 0)
      return NextResponse.json(errorResponse("La compra no tiene productos."), { status: 400 });

    // fecha_factura: acepta 'YYYY-MM-DD' del form; ignora cualquier otro formato.
    const fechaFacturaRaw = body.fecha_factura;
    const fechaFactura =
      typeof fechaFacturaRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fechaFacturaRaw)
        ? fechaFacturaRaw
        : null;
    const metodoPagoRaw = body.metodo_pago;
    const metodoPago =
      metodoPagoRaw === "efectivo" || metodoPagoRaw === "transferencia" || metodoPagoRaw === "tarjeta"
        ? metodoPagoRaw
        : null;

    // ── Condición de pago del proveedor (punto 6.2) ──────────────────────────
    // El plazo en días vive en el proveedor. Si la compra es a crédito y nadie
    // escribió el plazo, se usa el del proveedor.
    //
    // POR QUÉ NO ALCANZA CON PONERLO EN EL FORMULARIO
    //   El vencimiento de una factura se calcula como fecha_factura + plazo_dias
    //   (ver /api/pagos/proveedores-estado-cuenta). Una compra a crédito sin
    //   plazo no vence nunca: no aparece como vencida, no entra en el flujo de
    //   caja y se paga cuando el proveedor llama. El plazo del proveedor es el
    //   dato que evita que un olvido del mostrador borre la deuda del radar.
    const tipoPagoPost = body.tipo_pago === "credito" ? "credito" : "contado";
    let plazoDiasPost =
      body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
        ? parseInt(String(body.plazo_dias), 10) || null
        : null;
    if (tipoPagoPost === "credito" && plazoDiasPost == null) {
      const pv = await ctx.supabase
        .from("proveedores")
        .select("plazo_pago_dias")
        .eq("empresa_id", empresaId)
        .eq("id", String(body.proveedor_id))
        .maybeSingle();
      // Si la consulta falla no se corta la compra: queda sin plazo, como antes.
      const dias = pv.data ? Number((pv.data as Record<string, unknown>).plazo_pago_dias) : NaN;
      if (Number.isFinite(dias) && dias > 0) plazoDiasPost = Math.trunc(dias);
    }

    const header = {
      proveedor_id: String(body.proveedor_id),
      proveedor_nombre: String(body.proveedor_nombre ?? ""),
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      tipo_pago: tipoPagoPost,
      plazo_dias: plazoDiasPost,
      nro_timbrado: String(body.nro_timbrado).trim().toUpperCase(),
      numero_factura: body.numero_factura != null && String(body.numero_factura).trim() !== "" ? String(body.numero_factura).trim() : null,
      fecha_factura: fechaFactura,
      metodo_pago: metodoPago,
      comprobante_url: body.comprobante_url != null && String(body.comprobante_url).trim() !== "" ? String(body.comprobante_url) : null,
      comprobante_storage_path: body.comprobante_storage_path != null && String(body.comprobante_storage_path).trim() !== "" ? String(body.comprobante_storage_path) : null,
      comprobante_nombre: body.comprobante_nombre != null && String(body.comprobante_nombre).trim() !== "" ? String(body.comprobante_nombre) : null,
      comprobante_mime_type: body.comprobante_mime_type != null && String(body.comprobante_mime_type).trim() !== "" ? String(body.comprobante_mime_type) : null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
      // Depósito destino de la compra (opcional). Si no viene, cada línea intenta
      // caer al ubicacion_principal_id del producto.
      ubicacion_id: typeof body.ubicacion_id === "string" && body.ubicacion_id.trim() !== "" ? body.ubicacion_id.trim() : null,
    };

    // La compra NO pide lote ni crea lotes (Roldán e Hijos): es solo registro/control
    // y no impacta inventario. El lote/vencimiento se carga aparte, desde el
    // detalle del producto. Por eso el map queda vacío (no se valida ni crea lote).
    const controlaLoteMap = new Map<string, boolean>();

    // Info de lote por línea (mismo orden que items) para insertarlos luego.
    type LoteInfo = { numero: string; fecha_vencimiento: string; cantidad: number } | null;
    const loteInfos: LoteInfo[] = [];

    const items: CompraItemInput[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const label = `Producto ${i + 1}`;
      if (it.producto_id == null || String(it.producto_id).trim() === "")
        return NextResponse.json(errorResponse(`${label}: falta el producto.`), { status: 400 });
      if (!(Number(it.cantidad) > 0))
        return NextResponse.json(errorResponse(`${label}: la cantidad debe ser mayor a 0.`), { status: 400 });
      if (!(Number(it.costo_unitario) > 0))
        return NextResponse.json(errorResponse(`${label}: el costo unitario debe ser mayor a 0.`), { status: 400 });
      // El precio de venta NO es obligatorio: para materia prima / insumos no vendibles
      // puede venir vacío o en 0. Solo rechazamos valores negativos.
      if (it.precio_venta != null && Number(it.precio_venta) < 0)
        return NextResponse.json(errorResponse(`${label}: el precio de venta no puede ser negativo.`), { status: 400 });

      const pid = String(it.producto_id);
      const cantidad = Number(it.cantidad) || 0;
      if (controlaLoteMap.get(pid) === true) {
        const loteNumero = typeof it.lote_numero === "string" ? it.lote_numero.trim() : "";
        const loteFecha =
          typeof it.lote_fecha_vencimiento === "string" ? it.lote_fecha_vencimiento : "";
        if (!loteNumero) {
          return NextResponse.json(
            errorResponse(`${label}: este producto controla lote — falta el número de lote.`),
            { status: 400 }
          );
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(loteFecha)) {
          return NextResponse.json(
            errorResponse(`${label}: falta la fecha de vencimiento del lote (YYYY-MM-DD).`),
            { status: 400 }
          );
        }
        loteInfos.push({ numero: loteNumero, fecha_vencimiento: loteFecha, cantidad });
      } else {
        loteInfos.push(null);
      }

      items.push({
        producto_id: pid,
        producto_nombre: String(it.producto_nombre ?? ""),
        cantidad,
        costo_unitario_original: Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
        // Recalculado acá, no el que vino del navegador: ver costoEnGuaranies.
        costo_unitario: costoEnGuaranies(
          Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
          body.moneda === "USD" ? "USD" : "PYG",
          Number(body.tipo_cambio) || 1
        ),
        iva_tipo: ivaOk(it.iva_tipo),
        subtotal: Number(it.subtotal) || 0,
        monto_iva: Number(it.monto_iva) || 0,
        total: Number(it.total) || 0,
        precio_venta: Number(it.precio_venta) || 0,
        precio_venta_usd: it.precio_venta_usd != null ? Number(it.precio_venta_usd) || null : null,
        margen_venta: it.margen_venta != null ? Number(it.margen_venta) : null,
      });
    }

    try {
      const out = await insertComprasConImpacto(schema, empresaId, exigirSucursal(ctx.auth.sucursal_id), header, items);

      // Crear filas en producto_lotes para las líneas cuyo producto controla lote.
      // Best-effort: si falla la creación de un lote, no rompemos la compra
      // (ya se registró) — se acumula en warning junto al de movimientos.
      const loteWarnings: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const info = loteInfos[i];
        if (!info) continue;
        const it = items[i];
        // Alineación best-effort: out.compras suele venir en el orden de items.
        // Si por alguna razón no viniera, dejamos compra_id = null (el trigger
        // igual permite null; no perdemos la referencia al lote).
        const compraId =
          Array.isArray(out.compras) && out.compras[i] && (out.compras[i] as { id?: string }).id
            ? String((out.compras[i] as { id: string }).id)
            : null;
        const insLote = await ctx.supabase.from("producto_lotes").insert({
          empresa_id: empresaId,
          producto_id: it.producto_id,
          numero_lote: info.numero,
          fecha_vencimiento: info.fecha_vencimiento,
          cantidad: info.cantidad,
          cantidad_original: info.cantidad,
          compra_id: compraId,
          activo: true,
        });
        if (insLote.error) {
          console.error("[/api/compras POST] insert lote", insLote.error.message, {
            producto_id: it.producto_id,
            numero_lote: info.numero,
          });
          // Un duplicado (mismo producto + mismo numero_lote) NO revienta la compra.
          if (/duplicate key|unique|23505/i.test(insLote.error.message ?? "")) {
            loteWarnings.push(
              `Lote "${info.numero}" ya existente para el producto (no se creó otra fila).`
            );
          } else {
            loteWarnings.push(
              `No se pudo registrar el lote "${info.numero}" (compra ya guardada).`
            );
          }
        }
      }

      const warning =
        [out.movimiento_warning, ...loteWarnings].filter(Boolean).join(" · ") || null;

      return NextResponse.json(successResponse({
        numero_control: out.numero_control,
        compras: out.compras,
        compra: out.compras[0] ?? null, // compat con clientes single
        warning,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      const detail = (e as { detail?: string })?.detail;
      console.error("[/api/compras POST]", { schema, empresaId, msg, code, detail });
      if (code === "23503") {
        return NextResponse.json(
          errorResponse("Proveedor o producto inválido. Verificá los datos seleccionados."),
          { status: 400 }
        );
      }
      if (code === "23505") {
        return NextResponse.json(
          errorResponse("Conflicto al generar el número de control. Reintentá."),
          { status: 409 }
        );
      }
      return NextResponse.json(
        errorResponse("No se pudo guardar la compra. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/compras POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la compra."), { status: 500 });
  }
}

/**
 * PATCH /api/compras — edita la CABECERA + estado de una compra (todas las líneas
 * del numero_control). Solo campos de cabecera; no toca productos/montos.
 * Body: { numero_control, proveedor_id?, proveedor_nombre?, nro_timbrado?,
 *         fecha_factura?, tipo_pago?, metodo_pago?, plazo_dias?, estado? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const numeroControl = String(body.numero_control ?? "").trim();
    if (!numeroControl) return NextResponse.json(errorResponse("Falta numero_control."), { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.proveedor_id !== undefined && String(body.proveedor_id).trim() !== "")
      patch.proveedor_id = String(body.proveedor_id);
    if (body.proveedor_nombre !== undefined)
      patch.proveedor_nombre = String(body.proveedor_nombre ?? "").trim().toUpperCase() || null;
    if (body.nro_timbrado !== undefined)
      patch.nro_timbrado = String(body.nro_timbrado ?? "").trim().toUpperCase() || null;
    if (body.fecha_factura !== undefined) {
      const f = String(body.fecha_factura ?? "");
      patch.fecha_factura = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
    }
    if (body.tipo_pago !== undefined)
      patch.tipo_pago = body.tipo_pago === "credito" ? "credito" : "contado";
    if (body.metodo_pago !== undefined) {
      patch.metodo_pago =
        body.metodo_pago === "efectivo" || body.metodo_pago === "transferencia" || body.metodo_pago === "tarjeta"
          ? body.metodo_pago : null;
    }
    if (body.plazo_dias !== undefined) {
      const n = parseInt(String(body.plazo_dias), 10);
      patch.plazo_dias = Number.isFinite(n) && n > 0 ? n : null;
    }
    if (body.estado !== undefined)
      patch.estado = body.estado === "anulada" ? "anulada" : body.estado === "pagada" ? "pagada" : "registrada";
    // Datos del pago al proveedor (registrar pago desde "Por Pagar").
    if (body.fecha_pago !== undefined) {
      const f = String(body.fecha_pago ?? "");
      patch.fecha_pago = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
    }
    if (body.referencia_pago !== undefined)
      patch.referencia_pago = String(body.referencia_pago ?? "").trim() || null;

    if (Object.keys(patch).length === 0)
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });

    // Si este PATCH es el que marca la compra como pagada, hay que saber el
    // total ANTES de escribirlo: después ya no se distingue de una compra que
    // vino pagada de antes.
    const marcaPagada = patch.estado === "pagada";
    let totalCompra = 0;
    let proveedor = "";
    if (marcaPagada) {
      const prev = await ctx.supabase
        .from("compras")
        .select("total, estado, proveedor_nombre")
        .eq("empresa_id", empresaId)
        .eq("numero_control", numeroControl);
      const filas = (prev.data ?? []) as Array<Record<string, unknown>>;
      // Una compra son varias filas (una por ítem): el total es la suma.
      totalCompra = filas.reduce((a, f) => a + (Number(f.total) || 0), 0);
      proveedor = String(filas[0]?.proveedor_nombre ?? "");
      // Si ya estaba pagada, no se vuelve a descontar de la caja.
      if (filas.some((f) => String(f.estado) === "pagada")) totalCompra = 0;
    }

    const { error } = await ctx.supabase
      .from("compras")
      .update(patch)
      .eq("empresa_id", empresaId)
      .eq("numero_control", numeroControl);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });

    // El pago al proveedor sale de la caja abierta. Antes no salía de ningún
    // lado: la compra quedaba pagada y el arqueo del turno seguía esperando
    // una plata que ya no estaba.
    let cajaMovimientoId: string | null = null;
    if (marcaPagada && totalCompra > 0) {
      cajaMovimientoId = await enlazarConCaja(ctx.supabase, {
        empresaId,
        sucursalId: ctx.auth.sucursal_id ?? null,
        tipo: "egreso",
        concepto: `Pago a proveedor${proveedor ? ` · ${proveedor}` : ""} · compra ${numeroControl}`,
        monto: totalCompra,
        medioPago: patch.metodo_pago ?? body.metodo_pago ?? "efectivo",
        observacion: typeof patch.referencia_pago === "string" ? patch.referencia_pago : null,
        usuarioId: ctx.auth.user?.id ?? null,
        usuarioEmail: ctx.auth.user?.email ?? null,
      });
    }

    return NextResponse.json(successResponse({ ok: true, caja_movimiento_id: cajaMovimientoId }));
  } catch (err) {
    console.error("[/api/compras PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la compra."), { status: 500 });
  }
}
