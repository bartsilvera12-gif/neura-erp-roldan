import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivoYAuth } from "@/lib/imports/import-helpers";
import { parseClientesRows, buildClientesResolverMaps, buildClientesPreview } from "@/lib/imports/clientes-importer";

export async function POST(request: NextRequest) {
  const res = await leerArchivoYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const parsed = parseClientesRows(res.ctx.rows);
    const maps = await buildClientesResolverMaps(res.ctx.schema, res.ctx.empresaId);
    return NextResponse.json(successResponse(buildClientesPreview(parsed, maps)));
  } catch (e) {
    console.error("[clientes/import/preview]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar la vista previa."), { status: 500 });
  }
}
