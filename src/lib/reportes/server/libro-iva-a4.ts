import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * Libro de IVA (Compras o Ventas) listo para imprimir (punto 10.4).
 *
 * "IVA Compras e IVA Ventas: totales con IVA y, en la última página, resumen
 * de base/importe total e IVA total."
 *
 * ── POR QUÉ EL RESUMEN VA AL FINAL Y NO ARRIBA ─────────────────────────────
 *   Un libro de IVA se presenta y se archiva. El que lo revisa —el contador,
 *   o quien venga a fiscalizar— lee el detalle hoja por hoja y al terminar
 *   quiere el cierre: cuánto fue base gravada, cuánto IVA, cuánto exento y
 *   cuánto el total. Puesto arriba, obliga a volver atrás; puesto al final,
 *   cierra el documento donde termina la lectura.
 *
 *   Además se repite la fila de TOTALES al pie de la tabla: esa es la suma de
 *   las columnas, que no es lo mismo que el resumen fiscal de abajo. Una suma
 *   columnas; el otro reordena esas sumas en las cifras que se declaran.
 *
 * ── LA CABECERA SE REPITE EN CADA HOJA ─────────────────────────────────────
 *   `thead { display: table-header-group }` hace que el navegador repita los
 *   títulos de columna al cortar la página. Sin eso, a partir de la segunda
 *   hoja el libro es una grilla de números sin nombre.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = String(iso).slice(0, 10);
  const [a, m, dd] = d.split("-");
  return dd && m && a ? `${dd}/${m}/${a}` : d;
}

export type FilaLibroIva = {
  fecha: string | null;
  /** Cliente o proveedor, según el libro. */
  contraparte: string | null;
  ruc: string | null;
  tipo_comprobante: string | null;
  timbrado: string | null;
  numero: string | null;
  condicion: string | null;
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  /** Las notas de crédito se marcan: restan, no suman. */
  es_nota_credito?: boolean;
};

export type TotalesLibroIva = {
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  cantidad: number;
};

export type DatosLibroIvaA4 = {
  /** "COMPRAS" o "VENTAS". */
  libro: "COMPRAS" | "VENTAS";
  desde: string;
  hasta: string;
  filas: FilaLibroIva[];
  totales: TotalesLibroIva;
  /** Solo en Ventas: facturas, notas de crédito y neto. */
  neto?: { facturas: number; notas_credito: number; neto: number } | null;
  auto?: boolean;
};

export function htmlLibroIvaA4(d: DatosLibroIvaA4): string {
  const esCompras = d.libro === "COMPRAS";
  const columnaContraparte = esCompras ? "Proveedor" : "Cliente";

  const baseGravada = d.totales.gravado5 + d.totales.gravado10;
  const ivaTotal = d.totales.iva5 + d.totales.iva10;

  const fila = (f: FilaLibroIva) => `<tr${f.es_nota_credito ? ' class="nc"' : ""}>
      <td>${fechaCorta(f.fecha)}</td>
      <td>${esc(f.contraparte ?? "—")}</td>
      <td class="mono">${esc(f.ruc ?? "—")}</td>
      <td>${esc(f.tipo_comprobante ?? "—")}${f.es_nota_credito ? " (NC)" : ""}</td>
      <td class="mono">${esc(f.timbrado ?? "—")}</td>
      <td class="mono">${esc(f.numero ?? "—")}</td>
      <td>${esc(f.condicion ?? "—")}</td>
      <td class="m">${gs(f.exento)}</td>
      <td class="m">${gs(f.gravado5)}</td>
      <td class="m">${gs(f.iva5)}</td>
      <td class="m">${gs(f.gravado10)}</td>
      <td class="m">${gs(f.iva10)}</td>
      <td class="m b">${gs(f.total)}</td>
    </tr>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Libro de IVA ${esc(d.libro)} — ${esc(EMPRESA_DOC.nombre)}</title>
<style>
  /* Apaisado: trece columnas no entran en vertical sin achicar los números
     hasta que no se leen. */
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 8mm; font-size: 10px; }

  .print-btn { position: fixed; top: 12px; right: 12px; z-index: 10; background: #4FAEB2;
    color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px;
    font-weight: 600; cursor: pointer; }
  @media print { .print-btn { display: none; } }

  .empresa { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: #444; }
  h1 { font-size: 16px; margin: 0 0 2px; font-weight: 700; }
  .meta { font-size: 10px; line-height: 1.5; margin-bottom: 6px; }

  table { width: 100%; border-collapse: collapse; }
  th { border: 1px solid #000; padding: 2px 4px; font-size: 9px; text-align: left; font-weight: 700;
       background: #f0f0f0; }
  td { border: 1px solid #000; padding: 2px 4px; font-size: 9px; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: "Courier New", monospace; font-size: 8.5px; }
  .b { font-weight: 700; }
  .vacio { text-align: center; color: #888; padding: 8px; }
  /* Las notas de crédito restan: se distinguen para que nadie las sume. */
  .nc td { background: #fbfbfb; font-style: italic; }
  tfoot td { border-top: 2px solid #000; font-weight: 700; }

  /* La cabecera se repite en cada hoja: sin esto, de la segunda en adelante el
     libro es una grilla de números sin nombre. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  /* El resumen arranca en hoja nueva si no entra entero. */
  .resumen { margin-top: 8mm; page-break-inside: avoid; }
  .resumen h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
                margin: 0 0 4px; padding-bottom: 2px; border-bottom: 1.5px solid #000; }
  .resumen table { width: 70%; }
  .resumen td { font-size: 10px; padding: 3px 6px; }
  .resumen .destaca td { font-size: 11px; font-weight: 700; background: #f0f0f0; }

  .firma { margin-top: 12mm; display: flex; gap: 14mm; }
  .firma div { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 9px; text-align: center; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>

  <div class="empresa">${esc(EMPRESA_DOC.nombre)}${EMPRESA_DOC.ruc ? ` · RUC ${esc(EMPRESA_DOC.ruc)}` : ""}</div>
  <h1>Libro de IVA ${esc(d.libro === "COMPRAS" ? "Compras" : "Ventas")}</h1>
  <div class="meta">Período del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)} · ${d.totales.cantidad} comprobante(s)</div>

  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>${columnaContraparte}</th>
        <th>RUC</th>
        <th>Comprobante</th>
        <th>Timbrado</th>
        <th>Número</th>
        <th>Cond.</th>
        <th class="m">Exento</th>
        <th class="m">Gravado 5%</th>
        <th class="m">IVA 5%</th>
        <th class="m">Gravado 10%</th>
        <th class="m">IVA 10%</th>
        <th class="m">Total</th>
      </tr>
    </thead>
    <tbody>
      ${d.filas.length ? d.filas.map(fila).join("") : `<tr><td colspan="13" class="vacio">No hubo comprobantes en el período.</td></tr>`}
    </tbody>
    ${d.filas.length ? `<tfoot>
      <tr>
        <td colspan="7">TOTALES</td>
        <td class="m">${gs(d.totales.exento)}</td>
        <td class="m">${gs(d.totales.gravado5)}</td>
        <td class="m">${gs(d.totales.iva5)}</td>
        <td class="m">${gs(d.totales.gravado10)}</td>
        <td class="m">${gs(d.totales.iva10)}</td>
        <td class="m">${gs(d.totales.total)}</td>
      </tr>
    </tfoot>` : ""}
  </table>

  <div class="resumen">
    <h2>Resumen del período</h2>
    <table>
      <tr><td>Operaciones exentas</td><td class="m">${gs(d.totales.exento)}</td></tr>
      <tr><td>Base gravada 5%</td><td class="m">${gs(d.totales.gravado5)}</td></tr>
      <tr><td>IVA 5%</td><td class="m">${gs(d.totales.iva5)}</td></tr>
      <tr><td>Base gravada 10%</td><td class="m">${gs(d.totales.gravado10)}</td></tr>
      <tr><td>IVA 10%</td><td class="m">${gs(d.totales.iva10)}</td></tr>
      <tr class="destaca"><td>Base gravada total</td><td class="m">${gs(baseGravada)}</td></tr>
      <tr class="destaca"><td>IVA total ${esCompras ? "(crédito fiscal)" : "(débito fiscal)"}</td><td class="m">${gs(ivaTotal)}</td></tr>
      <tr class="destaca"><td>Importe total del período</td><td class="m">${gs(d.totales.total)}</td></tr>
      ${d.neto ? `
      <tr><td>Facturas</td><td class="m">${gs(d.neto.facturas)}</td></tr>
      <tr><td>Notas de crédito</td><td class="m">− ${gs(Math.abs(d.neto.notas_credito))}</td></tr>
      <tr class="destaca"><td>Neto facturado</td><td class="m">${gs(d.neto.neto)}</td></tr>` : ""}
    </table>
  </div>

  <div class="firma">
    <div>Firma del responsable</div>
    <div>Contador</div>
  </div>

  ${d.auto ? "<script>window.addEventListener('load',()=>window.print())</script>" : ""}
</body>
</html>`;
}
