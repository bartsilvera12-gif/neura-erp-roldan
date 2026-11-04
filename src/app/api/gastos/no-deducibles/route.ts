import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import {
  clasificarGasto, reclamables, resumirNoDeducibles, type GastoParaRevisar,
} from "@/lib/gastos/deducible";

/**
 * GET /api/gastos/no-deducibles?desde=2026-10-01&hasta=2026-10-31
 *
 * Los gastos del período que no sirven para la SET, separados en los que no
 * tienen factura y los que la tienen incompleta.
 *
 * ── LOS EGRESOS DE CAJA VAN APARTE, Y SOLO CONTADOS ────────────────────────
 *   El pedido fue explícito: "mantener los egresos directos de caja separados
 *   del módulo de gastos". Así que no se mezclan en el listado.
 *
 *   Pero tampoco se pueden omitir, porque son 14.150 contra 3 gastos: si el
 *   reporte dijera solamente "1 gasto sin factura", estaría describiendo el
 *   0,02% de lo que la casa gasta. Van como un dato al costado, contados, con
 *   el aviso de que ninguno trae comprobante porque la migración no los trajo.
 *
 * ── POR QUÉ NO SE GUARDA LA CLASIFICACIÓN ──────────────────────────────────
 *   Se calcula al leer. Si mañana el proveedor manda el timbrado que faltaba y
 *   se carga, el gasto sale solo de este reporte. Guardar un "no deducible"
 *   obligaría a recalcularlo a mano y quedaría marcando un gasto ya corregido.
 */

const hoyPy = (): Date => new Date(Date.now() - 3 * 3_600_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fechaValida = (s: string | null): string | null =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;
    const sucursalId = exigirSucursal(auth.sucursal_id);

    const sp = request.nextUrl.searchParams;
    const hoy = hoyPy();
    // Por defecto, el mes en curso: es el período que se está revisando.
    const primero = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const desde = fechaValida(sp.get("desde")) ?? iso(primero);
    const hasta = fechaValida(sp.get("hasta")) ?? iso(hoy);

    // ── Los gastos del módulo ───────────────────────────────────────────────
    // Con fallback: `cuenta_contable_id` lo agrega el script 69 y el timbrado
    // y el RUC pueden faltar en una base que todavía no corrió todo.
    const COLS = "id, fecha, categoria, descripcion, beneficiario, monto, monto_iva, numero_factura, nro_timbrado, proveedor_ruc";
    const COLS_MINIMO = "id, fecha, categoria, descripcion, monto";

    let crudos: Record<string, unknown>[] = [];
    let columnasCompletas = true;
    try {
      crudos = await traerTodas<Record<string, unknown>>((d, h) =>
        supabase.from("gastos").select(COLS)
          .eq("empresa_id", empresaId).eq("sucursal_id", sucursalId)
          .gte("fecha", desde).lte("fecha", hasta)
          .order("fecha", { ascending: false }).range(d, h)
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/does not exist|42703/.test(msg)) throw e;
      columnasCompletas = false;
      crudos = await traerTodas<Record<string, unknown>>((d, h) =>
        supabase.from("gastos").select(COLS_MINIMO)
          .eq("empresa_id", empresaId).eq("sucursal_id", sucursalId)
          .gte("fecha", desde).lte("fecha", hasta)
          .order("fecha", { ascending: false }).range(d, h)
      );
    }

    const gastos: GastoParaRevisar[] = crudos.map((g) => ({
      id: String(g.id),
      fecha: String(g.fecha ?? ""),
      categoria: g.categoria == null ? null : String(g.categoria),
      descripcion: g.descripcion == null ? null : String(g.descripcion),
      beneficiario: g.beneficiario == null ? null : String(g.beneficiario),
      monto: Number(g.monto ?? 0),
      monto_iva: g.monto_iva == null ? null : Number(g.monto_iva),
      numero_factura: g.numero_factura == null ? null : String(g.numero_factura),
      nro_timbrado: g.nro_timbrado == null ? null : String(g.nro_timbrado),
      proveedor_ruc: g.proveedor_ruc == null ? null : String(g.proveedor_ruc),
    }));

    const clasificados = gastos.map(clasificarGasto);
    const resumen = resumirNoDeducibles(clasificados);

    // ── Los egresos de caja, solo contados ──────────────────────────────────
    // `adjuntos` es un array: vacío = se pagó y no quedó comprobante.
    let egresos: { total: number; sin_comprobante: number; monto_sin_comprobante: number } | null = null;
    try {
      const movs = await traerTodas<Record<string, unknown>>((d, h) =>
        supabase.from("caja_movimientos")
          .select("id, monto, adjuntos, anulado_at")
          .eq("empresa_id", empresaId).eq("sucursal_id", sucursalId).eq("tipo", "egreso")
          .gte("created_at", `${desde}T00:00:00`).lte("created_at", `${hasta}T23:59:59`)
          .order("created_at", { ascending: false }).range(d, h)
      );
      const vivos = movs.filter((m) => m.anulado_at == null);
      const sin = vivos.filter((m) => !Array.isArray(m.adjuntos) || m.adjuntos.length === 0);
      egresos = {
        total: vivos.length,
        sin_comprobante: sin.length,
        monto_sin_comprobante: sin.reduce((a, m) => a + Number(m.monto ?? 0), 0),
      };
    } catch { /* si la columna adjuntos no está, el reporte va sin este dato */ }

    return NextResponse.json(successResponse({
      desde,
      hasta,
      resumen,
      // Solo lo que no sirve: el listado es de eso. Los deducibles ya se ven
      // en /gastos y repetirlos acá haría buscar entre los buenos.
      gastos: clasificados.filter((g) => g.clase !== "deducible"),
      reclamables: reclamables(clasificados),
      egresos_caja: egresos,
      columnas_completas: columnasCompletas,
      aviso: columnasCompletas
        ? null
        : "Esta base no tiene los campos de timbrado y RUC en gastos: solo se puede distinguir si hay o no número de factura.",
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/gastos/no-deducibles]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo armar el reporte."), { status: 500 });
  }
}
