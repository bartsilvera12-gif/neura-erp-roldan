import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { datosEmpresaInforme } from "@/lib/excel/encabezado";

/**
 * POST /api/imprimir/tabla — la hoja A4 de la tabla que el usuario está
 * mirando (requisito general 11.1: "imprimible y en Excel").
 *
 * ── ES EL GEMELO DE /api/export/tabla ─────────────────────────────────────
 *   Recibe exactamente lo mismo —las filas que la pantalla ya tiene cargadas
 *   y filtradas— y devuelve el otro formato. Misma data, dos salidas.
 *
 *   Una ruta A4 por pantalla serían quince plantillas que hay que acordarse
 *   de tocar cada vez que una pantalla cambia una columna, y que tarde o
 *   temprano empiezan a decir algo distinto de lo que se ve al lado. Los
 *   informes que SÍ tienen su propia hoja (el arqueo de caja, los libros de
 *   IVA, la utilidad) la tienen porque su diseño no es una tabla: llevan
 *   secciones, totales cruzados y firmas.
 *
 * ── POR QUÉ NO CONSULTA LA BASE ───────────────────────────────────────────
 *   El cuerpo son datos que el servidor ya le entregó a ese usuario en esa
 *   sesión; acá se le devuelven en otro formato. Igual exige sesión, para que
 *   la ruta no quede abierta como un conversor público, y tiene tope.
 */

const MAX_FILAS = 20_000;
const MAX_COLUMNAS = 60;

/** Fecha y hora de Paraguay (UTC−3), sin depender de la tzdata del server. */
function selloPy(): string {
  const py = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fmtNum = (n: number) =>
  n.toLocaleString("es-PY", { maximumFractionDigits: 2 });

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const titulo = String(b.titulo ?? "Listado").slice(0, 120);
    const subtitulo = b.subtitulo == null ? "" : String(b.subtitulo).slice(0, 300);

    const columnas = Array.isArray(b.columnas)
      ? (b.columnas as unknown[]).map((c) => String(c)).slice(0, MAX_COLUMNAS)
      : [];
    const filas = Array.isArray(b.filas) ? (b.filas as unknown[]) : [];
    // Índices de columna que se totalizan al pie. La pantalla sabe cuáles son
    // importes; adivinarlo acá sumaría una columna de números de factura.
    const sumar = new Set(
      Array.isArray(b.sumar) ? (b.sumar as unknown[]).map((n) => Number(n)).filter(Number.isFinite) : []
    );

    if (columnas.length === 0) {
      return NextResponse.json(errorResponse("La hoja no tiene columnas."), { status: 400 });
    }
    if (filas.length > MAX_FILAS) {
      return NextResponse.json(
        errorResponse(`Son demasiadas filas para imprimir (${filas.length}). Acotá los filtros.`),
        { status: 400 }
      );
    }

    const cuerpo = filas.map((f) => {
      const celdas = Array.isArray(f) ? f : [];
      return columnas.map((_, i) => {
        const v = celdas[i];
        if (v == null) return { texto: "", num: null as number | null };
        if (typeof v === "number") {
          return Number.isFinite(v)
            ? { texto: fmtNum(v), num: v }
            : { texto: "", num: null };
        }
        if (typeof v === "boolean") return { texto: v ? "Sí" : "No", num: null };
        return { texto: String(v).slice(0, 2000), num: null };
      });
    });

    // Una columna se alinea a la derecha cuando TODO lo que tiene es numérico.
    // Mirar solo la primera fila se equivoca con las columnas que arrancan
    // vacías, que en estos listados son muchas.
    const esNumerica = columnas.map((_, i) =>
      cuerpo.length > 0 && cuerpo.some((r) => r[i].num !== null) &&
      cuerpo.every((r) => r[i].num !== null || r[i].texto === "")
    );

    const totales = columnas.map((_, i) =>
      sumar.has(i) ? cuerpo.reduce((s, r) => s + (r[i].num ?? 0), 0) : null
    );
    const haySumas = totales.some((t) => t !== null);

    const emp = await datosEmpresaInforme(ctx.auth.empresa_id);

    // Más de ocho columnas no entran en vertical sin que el texto se apile.
    const apaisada = columnas.length > 8;

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
  /* margin:0 saca el encabezado y el pie que Chrome imprime por su cuenta
     (la URL y la fecha del navegador); el margen real lo pone el padding. */
  @page { size: A4 ${apaisada ? "landscape" : "portrait"}; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0;
         padding: 10mm; font-size: 11px; }

  .print-btn { position: fixed; top: 12px; right: 12px; z-index: 10; background: #4FAEB2;
    color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px;
    font-weight: 600; cursor: pointer; }
  @media print { .print-btn { display: none; } }

  .empresa { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: #444; }
  h1 { font-size: 18px; margin: 0 0 2px; font-weight: 700; }
  .meta { font-size: 11px; color: #444; margin-bottom: 8px; }

  table { width: 100%; border-collapse: collapse; }
  /* Sin esto, a partir de la segunda hoja no se sabe qué columna es cuál. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { border: 1px solid #000; padding: 3px 5px; font-size: 10px; text-align: left;
       font-weight: 700; background: #eee; }
  td { border: 1px solid #000; padding: 2px 5px; font-size: 10px; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tfoot td { border-top: 2px solid #000; font-weight: 700; font-size: 11px; }
  .vacio { text-align: center; color: #888; padding: 10px; }
  .pie { margin-top: 8px; font-size: 9px; color: #666; }
</style></head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>
  <p class="empresa">${esc(emp.empresa)}${emp.ruc ? ` · RUC ${esc(emp.ruc)}` : ""}</p>
  <h1>${esc(titulo)}</h1>
  <p class="meta">${subtitulo ? `${esc(subtitulo)} · ` : ""}Generado el ${esc(selloPy())}</p>

  <table>
    <thead><tr>${columnas
      .map((c, i) => `<th${esNumerica[i] ? ' class="m"' : ""}>${esc(c)}</th>`)
      .join("")}</tr></thead>
    <tbody>${
      cuerpo.length === 0
        ? `<tr><td class="vacio" colspan="${columnas.length}">No hay nada para imprimir con estos filtros.</td></tr>`
        : cuerpo
            .map(
              (r) =>
                `<tr>${r
                  .map((c, i) => `<td${esNumerica[i] ? ' class="m"' : ""}>${esc(c.texto)}</td>`)
                  .join("")}</tr>`
            )
            .join("")
    }</tbody>
    ${
      haySumas && cuerpo.length > 0
        ? `<tfoot><tr>${columnas
            .map((_, i) =>
              i === 0
                ? `<td>TOTALES (${cuerpo.length})</td>`
                : totales[i] !== null
                ? `<td class="m">${esc(fmtNum(totales[i] as number))}</td>`
                : "<td></td>"
            )
            .join("")}</tr></tfoot>`
        : ""
    }
  </table>

  <p class="pie">${cuerpo.length} ${cuerpo.length === 1 ? "registro" : "registros"}. Es lo que estaba a la vista en pantalla, con los filtros puestos.</p>
</body></html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/imprimir/tabla]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar la hoja."), { status: 500 });
  }
}
