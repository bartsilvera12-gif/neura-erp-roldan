import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import {
  historialCategorias,
  clientesSinCompras,
  situacionClientes,
} from "@/lib/clientes/server/categorias-pg";
import { periodoPy, rangoDePeriodo } from "@/lib/clientes/categoria-automatica";

/**
 * GET /api/clientes/categorias/historial
 *
 * Dos preguntas en una ruta, porque se miran juntas desde la misma pantalla:
 *
 *   ?desde&hasta[&q][&categoria]  → los cambios de categoría del período
 *   ...&sin_compras=1             → los clientes que NO compraron
 *
 * `q` busca por nombre o por RUC. Cuando viene, la respuesta trae además la
 * SITUACIÓN de los clientes que coinciden: en qué categoría están hoy y cuánto
 * compraron en el período. Sin eso, buscar a un cliente que nunca cambió de
 * categoría devolvía "ningún cambio en esas fechas" — cierto, y inútil: la
 * pregunta era en qué categoría está y cuánto compró.
 *
 * El modo "sin compras" no es un filtro del historial: el que no compró
 * normalmente no genera renglón —si ya estaba en la categoría más baja no
 * cambió nada— así que buscarlo ahí no lo encontraría nunca. Ver
 * `clientesSinCompras`.
 */
export const dynamic = "force-dynamic";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const FALTA_TABLA =
  "Falta correr 55_categorias_cliente_automaticas.sql en la base: todavía no hay historial de categorías.";

function esTablaFaltante(msg: string): boolean {
  return /clientes_categoria_historial|monto_minimo_mensual/.test(msg)
    && /does not exist|42P01|42703/i.test(msg);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    // Por defecto, el mes en curso: es el período por el que se pregunta.
    const mesActual = rangoDePeriodo(periodoPy())!;
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : mesActual.desde;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : mesActual.hasta;
    if (desde > hasta) {
      return NextResponse.json(
        errorResponse("La fecha de inicio es posterior a la de fin."),
        { status: 400 }
      );
    }
    const clienteId = (sp.get("cliente") ?? "").trim() || null;
    const categoriaId = (sp.get("categoria") ?? "").trim() || null;
    const busqueda = (sp.get("q") ?? "").trim();
    const sinCompras = sp.get("sin_compras") === "1";

    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    if (sinCompras) {
      const filas = await clientesSinCompras(schema, empresaId, sucursalId, desde, hasta, {
        categoriaId,
        busqueda,
      });
      return NextResponse.json(successResponse({
        modo: "sin_compras" as const,
        desde, hasta,
        sin_compras: filas,
        cambios: [],
        situacion: [],
      }));
    }

    const [filas, situacion] = await Promise.all([
      historialCategorias(schema, empresaId, desde, hasta, {
        clienteId, categoriaId, busqueda,
      }),
      busqueda
        ? situacionClientes(schema, empresaId, sucursalId, busqueda, desde, hasta)
        : Promise.resolve([]),
    ]);
    return NextResponse.json(successResponse({
      modo: "cambios" as const,
      desde, hasta,
      cambios: filas,
      sin_compras: [],
      situacion,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    if (esTablaFaltante(msg)) {
      return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
    }
    console.error("[/api/clientes/categorias/historial]", msg || err);
    if (/Pool no disponible/.test(msg)) {
      return NextResponse.json(
        errorResponse("No hay conexión directa a la base para este informe."),
        { status: 503 }
      );
    }
    return NextResponse.json(
      errorResponse("No se pudo cargar el historial de categorías."),
      { status: 500 }
    );
  }
}
