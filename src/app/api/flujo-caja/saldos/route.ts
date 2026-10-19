import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Posición de liquidez del mes: saldos por banco y moneda, efectivo en caja y
 * valor de mercadería.
 *
 * Son datos informativos y de carga manual — el ERP no tiene conciliación
 * bancaria. No alimentan la proyección de pagos: esa sale de las compras.
 * Lo único que sí sale de acá son los fondos con los que arranca el flujo,
 * que es la suma de bancos + efectivo (la mercadería no es plata disponible).
 *
 * GET  /api/flujo-caja/saldos?anio&mes
 * PUT  /api/flujo-caja/saldos — reemplaza las filas del mes.
 */

const TIPOS = ["banco", "efectivo", "mercaderia"] as const;
type Tipo = (typeof TIPOS)[number];

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown, max = 200): string | null =>
  v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max);

function parsePeriodo(o: Record<string, unknown>): { anio: number; mes: number } | null {
  const anio = Number(o.anio), mes = Number(o.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return null;
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { anio, mes };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const hoy = new Date();
    const anio = Number(sp.get("anio")) || hoy.getUTCFullYear();
    const mes = Number(sp.get("mes")) || hoy.getUTCMonth() + 1;

    const { data, error } = await ctx.supabase
      .from("flujo_caja_saldos")
      .select("id, tipo, descripcion, entidad_bancaria_id, moneda, importe, orden, observacion")
      .eq("empresa_id", ctx.auth.empresa_id).eq("anio", anio).eq("mes", mes)
      .order("tipo").order("orden").order("descripcion");
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ saldos: data ?? [] }));
  } catch (err) {
    console.error("[/api/flujo-caja/saldos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los saldos."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const o = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

    const periodo = parsePeriodo(o);
    if (!periodo) return NextResponse.json(errorResponse("Período inválido."), { status: 400 });

    const crudas = Array.isArray(o.saldos) ? (o.saldos as Record<string, unknown>[]) : [];
    const filas: Record<string, unknown>[] = [];
    for (const [i, s] of crudas.entries()) {
      const tipo = String(s.tipo ?? "") as Tipo;
      if (!(TIPOS as readonly string[]).includes(tipo)) {
        return NextResponse.json(errorResponse(`Tipo inválido en la fila ${i + 1}.`), { status: 400 });
      }
      const descripcion = str(s.descripcion);
      if (!descripcion) {
        return NextResponse.json(
          errorResponse(`Falta la descripción en la fila ${i + 1} (nombre del banco, caja, depósito…).`),
          { status: 400 }
        );
      }
      filas.push({
        empresa_id: empresaId,
        anio: periodo.anio,
        mes: periodo.mes,
        tipo,
        descripcion,
        entidad_bancaria_id: str(s.entidad_bancaria_id, 64),
        moneda: String(s.moneda ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG",
        importe: num(s.importe),
        orden: Number.isFinite(Number(s.orden)) ? Number(s.orden) : i,
        observacion: str(s.observacion, 500),
      });
    }

    // Una misma cuenta no puede venir dos veces: el UNIQUE de la tabla lo
    // rechazaría igual, pero conviene avisar con el nombre y no con el error de PG.
    const vistas = new Set<string>();
    for (const f of filas) {
      const k = `${f.tipo}|${String(f.descripcion).toLowerCase()}|${f.moneda}`;
      if (vistas.has(k)) {
        return NextResponse.json(
          errorResponse(`"${f.descripcion}" (${f.moneda}) está repetido.`),
          { status: 400 }
        );
      }
      vistas.add(k);
    }

    // Reemplazo completo del mes: es una foto, no un historial incremental.
    const del = await ctx.supabase
      .from("flujo_caja_saldos").delete()
      .eq("empresa_id", empresaId).eq("anio", periodo.anio).eq("mes", periodo.mes);
    if (del.error) throw new Error(del.error.message);

    if (filas.length > 0) {
      const ins = await ctx.supabase.from("flujo_caja_saldos").insert(filas);
      if (ins.error) throw new Error(ins.error.message);
    }

    return NextResponse.json(successResponse({ guardados: filas.length }));
  } catch (err) {
    console.error("[/api/flujo-caja/saldos PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron guardar los saldos."), { status: 500 });
  }
}
