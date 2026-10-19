import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/** DELETE /api/compras/notas-credito/[id] — elimina una nota de crédito de compra. */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { error } = await ctx.supabase
      .from("notas_credito_compra")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ deleted: true }));
  } catch (err) {
    console.error("[/api/compras/notas-credito/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar la nota de crédito."), { status: 500 });
  }
}
