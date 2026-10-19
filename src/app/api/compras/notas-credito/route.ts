import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Notas de crédito de COMPRA (recibidas del proveedor).
 * Documento que reduce lo que se le debe a un proveedor sobre una compra/factura
 * concreta (por ejemplo, productos rechazados). NO fiscal desde nuestro lado.
 *
 * GET  /api/compras/notas-credito?compra=COMP-000123  → lista (opcional por compra)
 * POST /api/compras/notas-credito                      → crea una NC
 */

export const dynamic = "force-dynamic";

const COLS =
  "id, proveedor_id, proveedor_nombre, compra_numero_control, numero_nc, nro_timbrado, fecha, monto, motivo, usuario_nombre, created_at";

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const compra = new URL(request.url).searchParams.get("compra");
    let q = ctx.supabase
      .from("notas_credito_compra")
      .select(COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("created_at", { ascending: false });
    if (compra) q = q.eq("compra_numero_control", compra);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ notasCredito: data ?? [] }));
  } catch (err) {
    console.error("[/api/compras/notas-credito GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las notas de crédito."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const monto = num(body.monto);
    if (!(monto > 0)) return NextResponse.json(errorResponse("El monto debe ser mayor a 0."), { status: 400 });
    const compraNC = s(body.compra_numero_control);
    if (!compraNC) return NextResponse.json(errorResponse("Falta la compra a la que se imputa."), { status: 400 });

    const insert = {
      empresa_id: ctx.auth.empresa_id,
      sucursal_id: ctx.auth.sucursal_id ?? null,
      proveedor_id: s(body.proveedor_id),
      proveedor_nombre: s(body.proveedor_nombre),
      compra_numero_control: compraNC,
      numero_nc: s(body.numero_nc),
      nro_timbrado: s(body.nro_timbrado),
      fecha: s(body.fecha) ?? new Date().toISOString().slice(0, 10),
      monto,
      motivo: s(body.motivo),
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
    };

    const { data, error } = await ctx.supabase
      .from("notas_credito_compra")
      .insert(insert)
      .select(COLS)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ notaCredito: data }));
  } catch (err) {
    console.error("[/api/compras/notas-credito POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la nota de crédito."), { status: 500 });
  }
}
