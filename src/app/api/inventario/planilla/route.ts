import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { applyTokenSearch } from "@/lib/productos/token-search";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * GET /api/inventario/planilla — planilla de conteo físico, lista para imprimir.
 *
 * Es el papel que se lleva al depósito: artículos ordenados, el stock del
 * sistema en una columna y DOS en blanco para anotar a mano lo que se cuenta.
 * Después esa diferencia se carga como ajuste.
 *
 * POR QUÉ DOS COLUMNAS DE CONTEO
 *   El segundo conteo es el que cierra la discusión. Cuando el primero no
 *   coincide con el sistema, se recuenta sin borrar lo anterior: queda a la
 *   vista si la diferencia era de conteo o de stock.
 *
 * Parámetros, todos opcionales:
 *   categoria — id de rubro. Se puede repetir (?categoria=a&categoria=b) o
 *               mandar separado por comas. Sin ninguno = inventario general.
 *   sin_categoria — "1" agrega los artículos sin rubro.
 *   q         — filtra por nombre, SKU o código de barras.
 *   stock     — "con" deja solo los que tienen stock; "todos" (default) trae todo.
 *   oculto    — "1" oculta la columna Stock Act.
 *
 * Sobre `oculto`: contar con el stock del sistema a la vista induce a escribir
 * ese número en vez del real. Para un conteo ciego, que es el que sirve para
 * auditar, conviene esconderlo.
 *
 * Con VARIOS rubros sale una hoja por rubro, cada una con su propio
 * encabezado y su total. Es para repartir: cada persona se lleva su rubro.
 */

const SIN_RUBRO = "__sin__";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Fecha y hora de Paraguay (UTC−3), sin depender de la tzdata del servidor. */
function ahoraPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const num = (n: unknown) => Number(n ?? 0).toLocaleString("es-PY");

/** Lee `categoria` venga repetido o separado por comas, sin duplicados. */
function leerRubros(sp: URLSearchParams): string[] {
  const crudos = [...sp.getAll("categoria"), ...sp.getAll("categorias")]
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  if (sp.get("sin_categoria") === "1") crudos.push(SIN_RUBRO);
  return [...new Set(crudos)];
}

type Fila = Record<string, unknown>;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const rubros = leerRubros(sp);
    const idsReales = rubros.filter((r) => r !== SIN_RUBRO);
    const incluyeSinRubro = rubros.includes(SIN_RUBRO);
    const q = (sp.get("q") ?? "").trim();
    const soloConStock = sp.get("stock") === "con";
    const ocultarStock = sp.get("oculto") === "1";

    // Se re-arma por cada lote: un builder de supabase-js no se reutiliza
    // después de ejecutarse.
    const build = () => {
      let base = aplicarFiltroSucursal(
        ctx.supabase
          .from("productos")
          .select("id, nombre, sku, codigo_barras, stock_actual, unidad_medida, categoria_principal_id, controla_stock")
          .eq("empresa_id", empresaId)
          .eq("activo", true),
        sucursalId
      );
      if (q) base = applyTokenSearch(base, q, ["nombre", "sku", "codigo_barras"]);
      // Un solo criterio: varios rubros, o los sin rubro, o la combinación.
      if (idsReales.length > 0 && incluyeSinRubro) {
        base = base.or(
          `categoria_principal_id.in.(${idsReales.join(",")}),categoria_principal_id.is.null`
        );
      } else if (idsReales.length > 0) {
        base = base.in("categoria_principal_id", idsReales);
      } else if (incluyeSinRubro) {
        base = base.is("categoria_principal_id", null);
      }
      return base.order("nombre");
    };

    // PostgREST corta en 1000 filas aunque se pida un range mayor, y una
    // planilla de inventario completo pasa ese número sin problema: se traen
    // lotes hasta agotar. Cortar en 1000 dejaría artículos sin contar.
    const CHUNK = 1000;
    const MAX = 50_000;
    const crudas: Fila[] = [];
    for (let desde = 0; desde < MAX; desde += CHUNK) {
      const { data, error } = await build().range(desde, desde + CHUNK - 1);
      if (error) throw new Error(error.message);
      const lote = (data ?? []) as unknown as Fila[];
      if (lote.length === 0) break;
      crudas.push(...lote);
      if (lote.length < CHUNK) break;
    }

    let filas = crudas.filter((p) => p.controla_stock !== false);
    if (soloConStock) filas = filas.filter((p) => (Number(p.stock_actual) || 0) > 0);

    // ── Nombres de los rubros, para el encabezado de cada hoja ────────────
    const nombreRubro = new Map<string, string>();
    if (idsReales.length > 0) {
      const c = await ctx.supabase
        .from("categorias_productos").select("id, nombre")
        .eq("empresa_id", empresaId).in("id", idsReales);
      for (const r of (c.data ?? []) as Fila[]) {
        nombreRubro.set(String(r.id), String(r.nombre ?? ""));
      }
    }

    // ── Agrupado ──────────────────────────────────────────────────────────
    // Con un solo rubro (o ninguno) es una planilla sola. Con varios, una por
    // rubro: la idea es repartirlas, cada persona cuenta lo suyo.
    type Bloque = { titulo: string; filas: Fila[] };
    let bloques: Bloque[];
    if (rubros.length > 1) {
      bloques = rubros.map((r) => ({
        titulo: r === SIN_RUBRO ? "Sin rubro" : (nombreRubro.get(r) || "Rubro"),
        filas: filas.filter((p) =>
          r === SIN_RUBRO
            ? p.categoria_principal_id == null
            : String(p.categoria_principal_id ?? "") === r
        ),
      }));
    } else {
      const uno = rubros[0];
      bloques = [{
        titulo: uno == null ? "" : uno === SIN_RUBRO ? "Sin rubro" : (nombreRubro.get(uno) || ""),
        filas,
      }];
    }

    const cols = ocultarStock ? 5 : 6;
    const fecha = ahoraPy();

    const bloquesHtml = bloques.map((b, i) => `
  <section class="hoja${i > 0 ? " salto" : ""}">
    <div class="encabezado">
      <div class="empresa">${esc(EMPRESA_DOC.nombre)}</div>
      <h1>Planilla de Inventario</h1>
      <div class="sub">
        <div class="meta">
          <div><b>Rubro:</b> ${b.titulo ? esc(b.titulo) : '<span class="linea"></span>'}</div>
          <div><b>Marca:</b> <span class="linea"></span></div>
        </div>
        <div class="fecha">${esc(fecha)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr class="aire"><td colspan="${cols}"></td></tr>
        <tr>
          <th>Cód</th>
          <th>Cód Ref.</th>
          <th>Artículo</th>
          ${ocultarStock ? "" : "<th>Stock Act</th>"}
          <th>1er conteo</th>
          <th>2do conteo</th>
        </tr>
      </thead>
      <tfoot>
        <tr class="aire"><td colspan="${cols}"></td></tr>
      </tfoot>
      <tbody>
        ${b.filas.map((p) => `
        <tr>
          <td class="cod">${esc(p.codigo_barras ?? "")}</td>
          <td class="ref">${esc(p.sku ?? "")}</td>
          <td class="art">${esc(p.nombre ?? "")}</td>
          ${ocultarStock ? "" : `<td class="stock">${num(p.stock_actual)}</td>`}
          <td class="conteo"></td>
          <td class="conteo"></td>
        </tr>`).join("") ||
        `<tr><td colspan="${cols}" style="text-align:center;padding:16px">Sin artículos para los filtros elegidos.</td></tr>`}
      </tbody>
    </table>

    <p class="pie">
      ${b.filas.length} ${b.filas.length === 1 ? "artículo" : "artículos"}.
      Las columnas de conteo van en blanco: se completan a mano.
      El <b>2do conteo</b> es para recontar lo que no cuadró, sin borrar el primero.
    </p>

    <div class="firmas">
      <div class="firma">Contó</div>
      <div class="firma">Controló</div>
      <div class="firma">Fecha</div>
    </div>
  </section>`).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Planilla de Inventario — ${esc(EMPRESA_DOC.nombre)}</title>
<style>
  /* Margen 0 a propósito. Chrome imprime SU encabezado y SU pie (la fecha, el
     título repetido, el link) dentro del margen de @page: sin margen no le
     queda lugar y no los dibuja. El aire de la hoja lo ponen el padding
     lateral del body y las filas espaciadoras del thead/tfoot, que son las
     únicas que se repiten en TODAS las páginas. */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif; color: #111;
    margin: 0; padding: 0 10mm 10mm; font-size: 11px;
  }

  .print-btn {
    position: fixed; top: 12px; right: 12px; z-index: 10;
    background: #4FAEB2; color: #fff; border: 0; border-radius: 8px;
    padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  @media print { .print-btn { display: none; } }

  /* Cada rubro arranca en hoja nueva: la planilla se reparte. */
  .salto { break-before: page; page-break-before: always; }

  .encabezado { padding-top: 10mm; }
  .empresa { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: #444; }
  h1 { font-size: 19px; margin: 0 0 2px; font-weight: 700; }
  .sub { display: flex; justify-content: space-between; align-items: flex-end; }
  .meta { font-size: 11px; line-height: 1.6; }
  .meta b { font-weight: 700; }
  /* Si no vino de un filtro, queda un renglón para escribirlo a mano. */
  .linea { display: inline-block; width: 150px; border-bottom: 1px solid #999; }
  .fecha { font-size: 11px; white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }  /* repite el encabezado en cada hoja */
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }

  /* Filas sin borde ni contenido. Como thead y tfoot se repiten en cada hoja,
     son las que dejan aire arriba y abajo en la 2da página en adelante, donde
     el padding del body ya no llega. Sin esto la tabla arrancaría pegada al
     borde y la impresora recortaría la primera línea. */
  tr.aire td { border: 0; padding: 0; height: 7mm; }
  thead tr.aire td { height: 9mm; }

  th {
    border: 1px solid #000; padding: 3px 5px; font-size: 11px;
    text-align: left; font-weight: 700; background: #fff;
  }
  td { border: 1px solid #000; padding: 4px 5px; font-size: 10.5px; }

  /* Los códigos de barras son de 13 dígitos: con menos ancho se desbordan. */
  .cod    { width: 94px;  font-family: "Courier New", monospace; font-size: 9.5px; }
  .ref    { width: 78px;  font-family: "Courier New", monospace; font-size: 9.5px; }
  .art    { }
  /* "Stock Act" en negrita no entra en menos: con 58px el encabezado se partía en dos renglones. */
  .stock  { width: 68px;  text-align: right; }
  /* En blanco a propósito: acá se anota a mano lo contado, así que necesitan
     ancho de sobra para un número escrito a mano. */
  .conteo { width: 70px; background: #fbfbfb; }

  /* Alto generoso: las celdas de conteo se completan a mano y con 15px no
     entra un número escrito con lapicera. */
  tbody tr { height: 22px; }

  .pie { margin-top: 10px; font-size: 10px; color: #333; }
  .firmas { margin-top: 22px; display: flex; gap: 40px; }
  .firma { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 10px; text-align: center; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>
${bloquesHtml}
  ${sp.get("auto") === "1" ? "<script>window.addEventListener('load',()=>window.print())</script>" : ""}
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/planilla]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar la planilla.", { status: 500 });
  }
}
