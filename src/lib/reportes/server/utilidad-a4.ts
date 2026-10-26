import { EMPRESA_DOC, membreteLinea } from "@/lib/documentos/membrete";
import type { RentabilidadRow } from "@/lib/reportes/rentabilidad-types";

/**
 * El HTML del informe de utilidad para imprimir (punto 10.1).
 *
 * Está separado de la ruta a propósito: así la plantilla se puede renderizar
 * con datos de prueba y mirar el A4 resultante sin pasar por la sesión ni por
 * la base. Un informe que se imprime se revisa mirándolo, no leyendo el código
 * que lo arma.
 *
 * ── LAS DOS COLUMNAS QUE NO HAY QUE CONFUNDIR ──────────────────────────────
 *   La utilidad está en guaraníes y el margen en porcentaje, y van separadas
 *   porque responden preguntas distintas. Un rubro al 60% que vende poco deja
 *   menos plata que uno al 12% que vende mucho; mirando solo el porcentaje se
 *   decide al revés. La hoja agrega una tercera columna, "% de la utilidad",
 *   que es la que dice de dónde sale realmente la ganancia del período.
 *
 * ── LAS DOS TABLAS ─────────────────────────────────────────────────────────
 *   Primero por rubro, que es la decisión gruesa. Abajo, los productos que más
 *   utilidad dejan: es donde se ve qué artículo puntual sostiene el rubro, o
 *   qué artículo le arrastra el promedio.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const pct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`;

/** Cuántos productos entran en la segunda tabla. */
export const TOP_PRODUCTOS = 30;

export type DatosUtilidadA4 = {
  periodoLabel: string;
  desde: string;
  hasta: string;
  totalFacturacion: number;
  totalCosto: number;
  totalGanancia: number;
  filasRubro: RentabilidadRow[];
  topProductos: RentabilidadRow[];
  /** true dispara la impresión al cargar (?auto=1). */
  auto?: boolean;
};

export function htmlUtilidadA4(d: DatosUtilidadA4): string {
  const margenTotal = d.totalFacturacion > 0 ? (d.totalGanancia / d.totalFacturacion) * 100 : 0;

  const filaRubro = (f: RentabilidadRow) => `<tr>
      <td>${esc(f.nombre)}</td>
      <td class="m">${gs(f.unidades)}</td>
      <td class="m">${gs(f.facturacion)}</td>
      <td class="m">${gs(f.costo)}</td>
      <td class="m b">${gs(f.ganancia)}</td>
      <td class="m">${pct(f.margen)}</td>
      <td class="m">${pct(f.participacion)}</td>
    </tr>`;

  const filaProd = (f: RentabilidadRow) => `<tr>
      <td>${esc(f.nombre)}</td>
      <td>${esc(f.categoria ?? "Sin rubro")}</td>
      <td class="m">${gs(f.unidades)}</td>
      <td class="m">${gs(f.facturacion)}</td>
      <td class="m b">${gs(f.ganancia)}</td>
      <td class="m">${pct(f.margen)}</td>
    </tr>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Utilidad ${esc(d.periodoLabel)} — ${esc(EMPRESA_DOC.nombre)}</title>
<style>
  /* Sin margen de @page, Chrome no tiene dónde dibujar su encabezado ni el
     pie con la URL, que en un informe que se archiva solo estorban. */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 10mm; font-size: 11px; }

  .print-btn { position: fixed; top: 12px; right: 12px; z-index: 10; background: #4FAEB2;
    color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px;
    font-weight: 600; cursor: pointer; }
  @media print { .print-btn { display: none; } }

  .empresa { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: #444; }
  h1 { font-size: 18px; margin: 0 0 2px; font-weight: 700; }
  .sub { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; }
  .meta { font-size: 11px; line-height: 1.6; }

  h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
       margin: 10px 0 4px; padding-bottom: 2px; border-bottom: 1.5px solid #000; }

  table { width: 100%; border-collapse: collapse; }
  th { border: 1px solid #000; padding: 2px 5px; font-size: 10px; text-align: left; font-weight: 700; }
  td { border: 1px solid #000; padding: 3px 5px; font-size: 10px; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .b { font-weight: 700; }
  .vacio { text-align: center; color: #888; padding: 6px; }

  /* Los totales van arriba y abajo: arriba para leerlos de una, abajo para
     cerrar la tabla sin tener que sumar a mano. */
  .kpis { display: flex; gap: 4mm; margin: 6px 0 2px; }
  .kpi { flex: 1; border: 1px solid #000; padding: 4px 6px; }
  .kpi .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  .kpi .val { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }

  .nota { margin-top: 8px; font-size: 9px; color: #555; line-height: 1.5; }
  .firma { margin-top: 14mm; display: flex; gap: 10mm; }
  .firma div { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 9px; text-align: center; }

  /* Las dos tablas no se parten entre páginas si entran enteras. */
  thead { display: table-header-group; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>

  ${membreteLinea()}
  <div class="sub">
    <div>
      <h1>Utilidad del período</h1>
      <div class="meta">
        ${esc(d.periodoLabel)} · del ${esc(d.desde)} al ${esc(d.hasta)}
      </div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="lbl">Ventas sin IVA</div><div class="val">${gs(d.totalFacturacion)}</div></div>
    <div class="kpi"><div class="lbl">Costo de lo vendido</div><div class="val">${gs(d.totalCosto)}</div></div>
    <div class="kpi"><div class="lbl">Utilidad bruta (Gs.)</div><div class="val">${gs(d.totalGanancia)}</div></div>
    <div class="kpi"><div class="lbl">Margen sobre venta</div><div class="val">${pct(margenTotal)}</div></div>
  </div>

  <h2>Por rubro</h2>
  <table>
    <thead>
      <tr>
        <th>Rubro</th>
        <th class="m">Unid.</th>
        <th class="m">Ventas sin IVA</th>
        <th class="m">Costo</th>
        <th class="m">Utilidad Gs.</th>
        <th class="m">Margen %</th>
        <th class="m">% de la utilidad</th>
      </tr>
    </thead>
    <tbody>
      ${d.filasRubro.length ? d.filasRubro.map(filaRubro).join("") : `<tr><td colspan="7" class="vacio">No hubo ventas en el período.</td></tr>`}
    </tbody>
    ${d.filasRubro.length ? `<tfoot><tr>
      <td class="b">TOTAL</td>
      <td class="m b">${gs(d.filasRubro.reduce((s, f) => s + f.unidades, 0))}</td>
      <td class="m b">${gs(d.totalFacturacion)}</td>
      <td class="m b">${gs(d.totalCosto)}</td>
      <td class="m b">${gs(d.totalGanancia)}</td>
      <td class="m b">${pct(margenTotal)}</td>
      <td class="m b">100.0%</td>
    </tr></tfoot>` : ""}
  </table>

  <!-- El título dice el número real: si hay 8 productos, "los 30" seria mentira. -->
  <h2>${d.topProductos.length >= TOP_PRODUCTOS
        ? `Los ${TOP_PRODUCTOS} productos que más utilidad dejaron`
        : d.topProductos.length === 1
        ? "El único producto vendido"
        : `Los ${d.topProductos.length} productos vendidos, por utilidad`}</h2>
  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th>Rubro</th>
        <th class="m">Unid.</th>
        <th class="m">Ventas sin IVA</th>
        <th class="m">Utilidad Gs.</th>
        <th class="m">Margen %</th>
      </tr>
    </thead>
    <tbody>
      ${d.topProductos.length ? d.topProductos.map(filaProd).join("") : `<tr><td colspan="6" class="vacio">Sin datos.</td></tr>`}
    </tbody>
  </table>

  <p class="nota">
    La <strong>utilidad</strong> está en guaraníes y el <strong>margen</strong> en porcentaje:
    no son lo mismo. Un rubro con margen alto y poca venta deja menos plata que uno
    con margen bajo y mucha venta; la columna <strong>% de la utilidad</strong> es la
    que dice de dónde sale realmente la ganancia del período.
    Ventas sin IVA (subtotal de las líneas vendidas); costo = costo de cada producto
    al momento de la venta. Excluye ventas anuladas y de consignación.
  </p>

  <div class="firma">
    <div>Preparado por</div>
    <div>Revisado por</div>
  </div>

  ${d.auto ? "<script>window.addEventListener('load',()=>window.print())</script>" : ""}
</body>
</html>`;
}
