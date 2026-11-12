import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { formatoPreimpreso, htmlRellenoPreimpresa } from "@/lib/facturacion/preimpresa";
import { guardarPreimpresa, leerPreimpresa } from "@/lib/facturacion/server/preimpresa-config";

/**
 * GET  /api/configuracion/factura-preimpresa          — tipo de papel y formato.
 * GET  /api/configuracion/factura-preimpresa?prueba=1 — hoja de prueba con datos
 *      de ejemplo y una marca en cada punto, para alinear sobre el talonario.
 * PUT  /api/configuracion/factura-preimpresa          — guarda (solo admin).
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
  const cfg = await leerPreimpresa(schema, ctx.auth.empresa_id);

  if (new URL(request.url).searchParams.get("prueba") === "1") {
    const html = htmlRellenoPreimpresa(cfg.formato, {
      fecha: "12/11/2026",
      credito: false,
      razon_social: "CLIENTE DE PRUEBA S.A.",
      ruc: "80012345-6",
      direccion: "AVDA. EJEMPLO 1234",
      items: [
        { cantidad: 2, descripcion: "CAÑO CUADRADO 20X20X1.20", precio: 37137, tasa: "10", total: 74274 },
        { cantidad: 10, descripcion: "CHAPA ZINC ACANALADA N° 27 3M", precio: 85000, tasa: "10", total: 850000 },
        { cantidad: 1, descripcion: "PRODUCTO EXENTO DE PRUEBA", precio: 5000, tasa: "EX", total: 5000 },
      ],
      total_letras: "NOVECIENTOS VEINTINUEVE MIL DOSCIENTOS SETENTA Y CUATRO",
    }, {
      titulo: "Prueba de alineación · factura preimpresa",
      aviso: "HOJA DE PRUEBA: imprimila sobre una factura en blanco (o encimá a contraluz) y ajustá las posiciones en Configuración → Facturación. Cada X roja marca el punto configurado.",
      prueba: true,
    });
    return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return NextResponse.json(successResponse(cfg));
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) return NextResponse.json(errorResponse("Solo un administrador."), { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { tipo_papel?: unknown; formato?: unknown };
    const tipo = b.tipo_papel === "autoimpresor" ? "autoimpresor" : "preimpresa";
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    await guardarPreimpresa(schema, ctx.auth.empresa_id, tipo, formatoPreimpreso(b.formato));
    return NextResponse.json(successResponse(await leerPreimpresa(schema, ctx.auth.empresa_id)));
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    if (/tipo_papel|formato_preimpreso/.test(m)) {
      return NextResponse.json(errorResponse("Falta correr el script 87 para guardar el formato del talonario."), { status: 503 });
    }
    return NextResponse.json(errorResponse(m || "No se pudo guardar."), { status: 400 });
  }
}
