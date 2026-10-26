import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * POST /api/export/tabla — convierte en planilla Excel la tabla que el usuario
 * está mirando (requisito general 11.1).
 *
 * ── POR QUÉ UNO GENÉRICO Y NO UNO POR PANTALLA ────────────────────────────
 *   "Impresión y Excel en todos los reportes, listados y documentos
 *   aplicables" son unas quince pantallas. Un endpoint por cada una serían
 *   quince consultas duplicadas que hay que acordarse de tocar cada vez que
 *   la pantalla cambia una columna, y que tarde o temprano empiezan a decir
 *   algo distinto de lo que se ve.
 *
 *   Acá la pantalla manda lo que ya tiene cargado y filtrado. La planilla es,
 *   por construcción, exactamente lo que el usuario está viendo: mismas filas,
 *   mismas columnas, mismo orden. Es la única forma de que no se despeguen.
 *
 * ── NO HAY RIESGO DE FUGA ─────────────────────────────────────────────────
 *   El cuerpo son datos que el servidor ya le entregó a ese usuario en esa
 *   sesión; acá solo se le devuelven en otro formato. No se consulta nada.
 *   Igual exige sesión, para que el endpoint no quede abierto como un
 *   conversor público, y tiene tope de tamaño.
 *
 * ── LA HOJA LLEVA MEMBRETE ────────────────────────────────────────────────
 *   Requisito 11.5: los archivos que salen del sistema tienen que verse de la
 *   empresa. Van tres renglones arriba —empresa, título y cuándo se generó—
 *   antes de los encabezados.
 */

const MAX_FILAS = 20_000;
const MAX_COLUMNAS = 60;

/** Fecha y hora de Paraguay (UTC−3), sin depender de la tzdata del server. */
function selloPy(): string {
  const py = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const titulo = String(b.titulo ?? "Listado").slice(0, 120);
    const archivo = String(b.archivo ?? "listado").slice(0, 80);
    const subtitulo = b.subtitulo == null ? "" : String(b.subtitulo).slice(0, 300);

    const columnas = Array.isArray(b.columnas)
      ? (b.columnas as unknown[]).map((c) => String(c)).slice(0, MAX_COLUMNAS)
      : [];
    const filas = Array.isArray(b.filas) ? (b.filas as unknown[]) : [];

    if (columnas.length === 0) {
      return NextResponse.json(errorResponse("La planilla no tiene columnas."), { status: 400 });
    }
    if (filas.length > MAX_FILAS) {
      return NextResponse.json(
        errorResponse(`Son demasiadas filas para una planilla (${filas.length}). Acotá los filtros.`),
        { status: 400 }
      );
    }

    // Cada fila llega como arreglo de celdas, en el mismo orden que las
    // columnas. Los números se mandan como números para que Excel los pueda
    // sumar; el resto va como texto.
    const cuerpo = filas.map((f) => {
      const celdas = Array.isArray(f) ? f : [];
      return columnas.map((_, i) => {
        const v = celdas[i];
        if (v == null) return "";
        if (typeof v === "number") return Number.isFinite(v) ? v : "";
        if (typeof v === "boolean") return v ? "Sí" : "No";
        return String(v).slice(0, 2000);
      });
    });

    const aoa: (string | number)[][] = [
      [EMPRESA_DOC.nombre],
      [titulo],
      [subtitulo ? `${subtitulo} · generado el ${selloPy()}` : `Generado el ${selloPy()}`],
      [],
      columnas,
      ...cuerpo,
    ];

    // Ancho por columna según el contenido más largo, acotado: sin esto todo
    // sale en 8 caracteres y hay que ensanchar a mano cada vez.
    const anchos = columnas.map((h, i) => {
      const largo = Math.max(
        String(h).length,
        ...cuerpo.slice(0, 500).map((r) => String(r[i] ?? "").length)
      );
      return Math.min(60, Math.max(10, largo + 2));
    });

    const buf = buildXlsxBufferSheets([
      { sheetName: titulo.slice(0, 31) || "Datos", aoa, colWidths: anchos },
    ]);

    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(archivo) });
  } catch (err) {
    console.error("[/api/export/tabla]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar la planilla."), { status: 500 });
  }
}
