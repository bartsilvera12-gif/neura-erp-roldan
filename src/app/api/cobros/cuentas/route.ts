import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

const CXC_COLS =
  "id, cliente_id, venta_id, numero_venta, fecha_emision, fecha_vencimiento, moneda, total, saldo, estado, created_at";

// Mapeo del toggle a los valores permitidos de `ventas.origen`.
const ORIGENES_NUTRICION = ["normal", "MANUAL", "presupuesto"] as const;
const ORIGENES_CONSIGNATARIA = ["consignacion"] as const;

/**
 * GET /api/cobros/cuentas — cuentas por cobrar + resumen.
 * Filtros:
 *   ?cliente_id=
 *   ?estado=pendiente|parcial|pagado|anulado
 *   ?filtro=vencidas|por_vencer
 *   ?origen=nutricion|consignataria  → filtra por ventas.origen (join manual)
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;
    const clienteId = sp.get("cliente_id");
    const estado = sp.get("estado");
    const filtro = sp.get("filtro"); // vencidas | por_vencer
    const origenRaw = sp.get("origen");
    const origen: "nutricion" | "consignataria" | null =
      origenRaw === "nutricion" || origenRaw === "consignataria" ? origenRaw : null;
    const hoy = new Date().toISOString().slice(0, 10);

    let q = ctx.supabase
      .from("cuentas_por_cobrar")
      .select(CXC_COLS)
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id))
      .order("fecha_vencimiento", { ascending: true, nullsFirst: false })
      .limit(1000);
    if (clienteId) q = q.eq("cliente_id", clienteId);
    if (estado) q = q.eq("estado", estado);
    if (filtro === "vencidas") q = q.in("estado", ["pendiente", "parcial"]).lt("fecha_vencimiento", hoy);
    if (filtro === "por_vencer") q = q.in("estado", ["pendiente", "parcial"]).gte("fecha_vencimiento", hoy);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let rows = (data ?? []) as Record<string, unknown>[];

    // ── Filtro por origen (join manual con ventas). ─────────────────────────
    // Si viene ?origen=, cargamos ventas.origen para los venta_id referenciados
    // y filtramos client-side. Es menos elegante que un join, pero funciona con
    // el schema tenant sin depender de FKs declaradas en supabase-js.
    if (origen) {
      const ventaIds = [
        ...new Set(rows.map((r) => (r.venta_id ? String(r.venta_id) : "")).filter(Boolean)),
      ];
      const permitidos =
        origen === "nutricion"
          ? (ORIGENES_NUTRICION as readonly string[])
          : (ORIGENES_CONSIGNATARIA as readonly string[]);
      const ventasOrigen = new Map<string, string>();
      if (ventaIds.length) {
        const vq = await ctx.supabase
          .from("ventas")
          .select("id, origen")
          .eq("empresa_id", empresaId)
          .in("id", ventaIds);
        for (const v of (vq.data ?? []) as Array<{ id: string; origen: string | null }>) {
          // Si venta.origen es null lo tratamos como 'normal' (retro-compat con
          // ventas viejas anteriores a la migración de la columna origen).
          ventasOrigen.set(String(v.id), String(v.origen ?? "normal"));
        }
      }
      rows = rows.filter((r) => {
        const vid = r.venta_id ? String(r.venta_id) : "";
        if (!vid) {
          // CxC sin venta_id → solo la mostramos en Nutrición (default).
          return origen === "nutricion";
        }
        const org = ventasOrigen.get(vid) ?? "normal";
        return permitidos.includes(org);
      });
    }

    // Nombres de clientes.
    const clienteIds = [...new Set(rows.map((r) => String(r.cliente_id)).filter(Boolean))];
    const nombreById = new Map<string, string>();
    if (clienteIds.length) {
      const cq = await ctx.supabase
        .from("clientes")
        .select("id, empresa, nombre_contacto, nombre")
        .eq("empresa_id", empresaId)
        .in("id", clienteIds);
      for (const c of (cq.data ?? []) as Record<string, unknown>[]) {
        const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        nombreById.set(String(c.id), s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente");
      }
    }

    const cuentas = rows.map((r) => {
      const venc = r.fecha_vencimiento ? String(r.fecha_vencimiento).slice(0, 10) : null;
      const vencida = (r.estado === "pendiente" || r.estado === "parcial") && venc != null && venc < hoy;
      return {
        ...r,
        total: Number(r.total) || 0,
        saldo: Number(r.saldo) || 0,
        cliente_nombre: nombreById.get(String(r.cliente_id)) ?? "Cliente",
        vencida,
      };
    });

    // Resumen general: todas las CxC DE LA SUCURSAL (no solo las filtradas por estado).
    // Cuando hay filtro por origen, hay que restringir el resumen al mismo subset
    // para que los KPIs concuerden con la vista.
    let resumenRows: Array<{ saldo: unknown; estado: unknown; fecha_vencimiento: unknown; venta_id?: unknown }> = [];
    const allQ = await ctx.supabase
      .from("cuentas_por_cobrar")
      .select("saldo, estado, fecha_vencimiento, venta_id")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id));
    resumenRows = (allQ.data ?? []) as typeof resumenRows;

    if (origen) {
      const permitidos =
        origen === "nutricion"
          ? (ORIGENES_NUTRICION as readonly string[])
          : (ORIGENES_CONSIGNATARIA as readonly string[]);
      const ventaIdsRes = [
        ...new Set(resumenRows.map((r) => (r.venta_id ? String(r.venta_id) : "")).filter(Boolean)),
      ];
      const ventasOrigenRes = new Map<string, string>();
      if (ventaIdsRes.length) {
        const vq = await ctx.supabase
          .from("ventas")
          .select("id, origen")
          .eq("empresa_id", empresaId)
          .in("id", ventaIdsRes);
        for (const v of (vq.data ?? []) as Array<{ id: string; origen: string | null }>) {
          ventasOrigenRes.set(String(v.id), String(v.origen ?? "normal"));
        }
      }
      resumenRows = resumenRows.filter((r) => {
        const vid = r.venta_id ? String(r.venta_id) : "";
        if (!vid) return origen === "nutricion";
        const org = ventasOrigenRes.get(vid) ?? "normal";
        return permitidos.includes(org);
      });
    }

    let totalPendiente = 0;
    let totalVencido = 0;
    let parciales = 0;
    for (const r of resumenRows) {
      const saldo = Number(r.saldo) || 0;
      if (r.estado === "pendiente" || r.estado === "parcial") {
        totalPendiente += saldo;
        const venc = r.fecha_vencimiento ? String(r.fecha_vencimiento).slice(0, 10) : null;
        if (venc != null && venc < hoy) totalVencido += saldo;
      }
      if (r.estado === "parcial") parciales += 1;
    }

    // Cobrado del mes en curso (sin filtro por origen — cobros no tienen origen
    // propio; si se quisiera, habría que joinear vía cuenta_por_cobrar → venta).
    const inicioMes = `${hoy.slice(0, 7)}-01`;
    const cobMesQ = await ctx.supabase
      .from("cobros_clientes")
      .select("monto, fecha_pago")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id))
      .gte("fecha_pago", inicioMes);
    let cobradoMes = 0;
    for (const r of (cobMesQ.data ?? []) as Record<string, unknown>[]) cobradoMes += Number(r.monto) || 0;

    // Historial de cobros recientes (para la pestaña de cobros registrados).
    const histQ = await ctx.supabase
      .from("cobros_clientes")
      .select("id, cliente_id, venta_id, cuenta_por_cobrar_id, fecha_pago, monto, metodo_pago, referencia, usuario_nombre")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id))
      .order("fecha_pago", { ascending: false })
      .limit(500);
    let histRows = (histQ.data ?? []) as Record<string, unknown>[];

    // Aplicar filtro de origen también al historial de cobros.
    if (origen) {
      const permitidos =
        origen === "nutricion"
          ? (ORIGENES_NUTRICION as readonly string[])
          : (ORIGENES_CONSIGNATARIA as readonly string[]);
      const ventaIdsHist = [
        ...new Set(histRows.map((r) => (r.venta_id ? String(r.venta_id) : "")).filter(Boolean)),
      ];
      const ventasOrigenHist = new Map<string, string>();
      if (ventaIdsHist.length) {
        const vq = await ctx.supabase
          .from("ventas")
          .select("id, origen")
          .eq("empresa_id", empresaId)
          .in("id", ventaIdsHist);
        for (const v of (vq.data ?? []) as Array<{ id: string; origen: string | null }>) {
          ventasOrigenHist.set(String(v.id), String(v.origen ?? "normal"));
        }
      }
      histRows = histRows.filter((r) => {
        const vid = r.venta_id ? String(r.venta_id) : "";
        if (!vid) return origen === "nutricion";
        const org = ventasOrigenHist.get(vid) ?? "normal";
        return permitidos.includes(org);
      });
    }

    // Nombres de clientes que aún no estén en el mapa.
    const faltanIds = [
      ...new Set(
        histRows.map((r) => String(r.cliente_id)).filter((idc) => idc && !nombreById.has(idc))
      ),
    ];
    if (faltanIds.length) {
      const cq2 = await ctx.supabase
        .from("clientes")
        .select("id, empresa, nombre_contacto, nombre")
        .eq("empresa_id", empresaId)
        .in("id", faltanIds);
      for (const c of (cq2.data ?? []) as Record<string, unknown>[]) {
        const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        nombreById.set(String(c.id), s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente");
      }
    }
    // numero_venta por cuenta_por_cobrar_id (de las cuentas ya cargadas).
    const ventaByCuenta = new Map<string, string>();
    for (const r of rows) ventaByCuenta.set(String(r.id), String(r.numero_venta ?? ""));
    const cobros = histRows.map((r) => ({
      id: String(r.id),
      cliente_id: r.cliente_id ? String(r.cliente_id) : null,
      cliente_nombre: nombreById.get(String(r.cliente_id)) ?? "Cliente",
      numero_venta: ventaByCuenta.get(String(r.cuenta_por_cobrar_id)) || null,
      fecha_pago: r.fecha_pago ?? null,
      monto: Number(r.monto) || 0,
      metodo_pago: r.metodo_pago ?? "efectivo",
      referencia: r.referencia ?? null,
      usuario_nombre: r.usuario_nombre ?? null,
    }));

    return NextResponse.json(
      successResponse({
        cuentas,
        cobros,
        resumen: {
          total_pendiente: Math.round(totalPendiente),
          total_vencido: Math.round(totalVencido),
          cobrado_mes: Math.round(cobradoMes),
          parciales,
        },
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/cobros/cuentas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las cuentas por cobrar."), { status: 500 });
  }
}
