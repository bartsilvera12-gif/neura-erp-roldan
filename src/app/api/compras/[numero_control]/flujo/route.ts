import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import {
  avanzarFlujoCompra,
  comprasConAprobacion,
  ErrorFlujo,
  type AccionFlujoCompra,
} from "@/lib/compras/server/compras-pg";

/**
 * POST /api/compras/[numero_control]/flujo  { accion: "aprobar" | "en_transito" | "recibido" }
 *
 * Aprobación y recepción de una compra (script 104, pedido del cliente):
 * dos administradores distintos la aprueban y después un administrador la
 * marca «En tránsito» y «Recibido». Recién con «Recibido» entra al stock.
 *
 * Todo esto es solo de administradores (pedido del cliente).
 */
const ACCIONES: readonly AccionFlujoCompra[] = ["aprobar", "en_transito", "recibido"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero_control: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Aprobar y recibir compras lo hace un administrador."),
        { status: 403 }
      );
    }
    const { numero_control } = await params;
    const numero = decodeURIComponent(numero_control ?? "").trim();
    if (!numero) return NextResponse.json(errorResponse("Falta el número de la compra."), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { accion?: unknown };
    const accion = String(body.accion ?? "") as AccionFlujoCompra;
    if (!ACCIONES.includes(accion)) {
      return NextResponse.json(errorResponse("Acción inválida."), { status: 400 });
    }

    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    if (!(await comprasConAprobacion(schema))) {
      return NextResponse.json(
        errorResponse("Falta correr el script 104 (aprobación de compras)."),
        { status: 409 }
      );
    }

    const out = await avanzarFlujoCompra(schema, empresaId, numero, accion, {
      id: ctx.auth.usuarioCatalogId ?? null,
      nombre: ctx.auth.nombre?.trim() || ctx.auth.user?.email || "Administrador",
      sucursal_id: ctx.auth.sucursal_id ?? null,
    });
    return NextResponse.json(successResponse(out));
  } catch (err) {
    if (err instanceof ErrorFlujo) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/compras/flujo]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el paso de la compra."), { status: 500 });
  }
}
