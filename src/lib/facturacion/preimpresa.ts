/**
 * FACTURA PREIMPRESA: dónde cae cada dato sobre el talonario de imprenta.
 *
 * Todo en milímetros desde el borde superior izquierdo de la hoja. Los
 * valores por defecto son de un talonario A4 típico; se ajustan desde
 * Configuración → Facturación imprimiendo la hoja de prueba sobre una factura
 * en blanco (o un papel común encimado a contraluz).
 *
 * `x` es el borde IZQUIERDO del texto; en las columnas de importes, `x` es el
 * borde DERECHO (los números se alinean a la derecha, como en el recuadro).
 */

export type Punto = { x: number; y: number };

export type FormatoPreimpreso = {
  /** Tamaño de la hoja. */
  hoja: { ancho: number; alto: number };
  /** Corrimiento general, para ajustar todo junto si la impresora mueve el papel. */
  ajuste: Punto;
  /** Tamaño de letra en puntos. */
  letra: number;
  fecha: Punto;
  /** Dónde va la X de "Contado" y la de "Crédito". */
  contado: Punto;
  credito: Punto;
  razon_social: Punto;
  ruc: Punto;
  direccion: Punto;
  /** Productos: primera fila, alto de cada fila y cuántas entran. */
  items: { y: number; alto_fila: number; max_filas: number };
  /** Columnas de los productos (cantidad y descripción: borde izq.; importes: borde der.). */
  col: { cantidad: number; descripcion: number; ancho_descripcion: number; precio: number; exentas: number; iva5: number; iva10: number };
  subtotales_y: number;
  total_letras: Punto;
  total_numero: Punto;
  liq_iva5: Punto;
  liq_iva10: Punto;
  liq_total: Punto;
};

/**
 * Medido sobre el talonario de Aceros Metal Roldán (ImpreGraf, timbrado
 * 18975026, formulario continuo de 9½" de ancho con original, duplicado y
 * triplicado, para impresora matricial). Las medidas salen del escaneo del
 * 12/11/2026; el alto de la hoja (8½") hay que confirmarlo midiendo de
 * perforación a perforación.
 *
 * Renglones a 4,23 mm (6 líneas por pulgada, el paso de una matricial).
 */
export const FORMATO_POR_DEFECTO: FormatoPreimpreso = {
  hoja: { ancho: 241.3, alto: 215.9 },
  ajuste: { x: 0, y: 0 },
  letra: 9,
  fecha: { x: 50, y: 50 },
  contado: { x: 171, y: 50 },
  credito: { x: 202.5, y: 50 },
  razon_social: { x: 56, y: 59.5 },
  ruc: { x: 30, y: 54.5 },
  direccion: { x: 37, y: 66.5 },
  items: { y: 82, alto_fila: 4.23, max_filas: 15 },
  col: { cantidad: 44, descripcion: 61, ancho_descripcion: 52, precio: 143, exentas: 168.5, iva5: 192.5, iva10: 218 },
  subtotales_y: 168,
  total_letras: { x: 50, y: 177 },
  total_numero: { x: 218, y: 177 },
  liq_iva5: { x: 67, y: 185 },
  liq_iva10: { x: 110, y: 185 },
  liq_total: { x: 160, y: 185 },
};

/** El formato guardado, completado con los valores por defecto. */
export function formatoPreimpreso(guardado: unknown): FormatoPreimpreso {
  const g = (guardado && typeof guardado === "object" ? guardado : {}) as Record<string, unknown>;
  const out = JSON.parse(JSON.stringify(FORMATO_POR_DEFECTO)) as Record<string, unknown>;
  for (const [k, v] of Object.entries(g)) {
    if (!(k in out)) continue;
    const base = out[k];
    if (base && typeof base === "object" && v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (kk in (base as Record<string, unknown>) && Number.isFinite(Number(vv))) (base as Record<string, unknown>)[kk] = Number(vv);
      }
    } else if (typeof base === "number" && Number.isFinite(Number(v))) {
      out[k] = Number(v);
    }
  }
  return out as unknown as FormatoPreimpreso;
}

export type DatosFactura = {
  fecha: string; // dd/mm/aaaa
  credito: boolean;
  razon_social: string;
  ruc: string;
  direccion: string;
  items: Array<{ cantidad: number; descripcion: string; precio: number; tasa: "EX" | "5" | "10"; total: number }>;
  total_letras: string;
};

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const gs = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-PY");

/**
 * El HTML que se imprime SOBRE el talonario: solo los datos, sin líneas ni
 * recuadros, cada uno en su lugar. `prueba` agrega una cruz en cada punto,
 * para ver dónde cae al alinear.
 */
export function htmlRellenoPreimpresa(f: FormatoPreimpreso, d: DatosFactura, opts: { titulo: string; aviso?: string; prueba?: boolean; auto?: boolean }): string {
  const ax = f.ajuste.x, ay = f.ajuste.y;
  const at = (p: Punto, txt: string, alinear: "izq" | "der" = "izq", ancho?: number) => {
    const estilo = alinear === "der"
      ? `right:${f.hoja.ancho - (p.x + ax)}mm;top:${p.y + ay}mm;text-align:right;`
      : `left:${p.x + ax}mm;top:${p.y + ay}mm;${ancho ? `width:${ancho}mm;overflow:hidden;white-space:nowrap;` : ""}`;
    const cruz = opts.prueba ? `<span class="cruz" style="left:${p.x + ax - 1.5}mm;top:${p.y + ay - 1.5}mm"></span>` : "";
    return `${cruz}<div class="t" style="${estilo}">${esc(txt)}</div>`;
  };

  let ex = 0, g5 = 0, g10 = 0;
  const filas = d.items.slice(0, f.items.max_filas).map((it, i) => {
    const y = f.items.y + i * f.items.alto_fila;
    if (it.tasa === "EX") ex += it.total; else if (it.tasa === "5") g5 += it.total; else g10 += it.total;
    const cant = (Number(it.cantidad) || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
    return [
      at({ x: f.col.cantidad, y }, cant),
      at({ x: f.col.descripcion, y }, it.descripcion, "izq", f.col.ancho_descripcion),
      at({ x: f.col.precio, y }, gs(it.precio), "der"),
      at({ x: it.tasa === "EX" ? f.col.exentas : it.tasa === "5" ? f.col.iva5 : f.col.iva10, y }, gs(it.total), "der"),
    ].join("");
  }).join("");
  // Los que no entran en el talonario se suman igual, para que el total cierre.
  for (const it of d.items.slice(f.items.max_filas)) {
    if (it.tasa === "EX") ex += it.total; else if (it.tasa === "5") g5 += it.total; else g10 += it.total;
  }
  const total = ex + g5 + g10;
  const iva5 = Math.round(g5 / 21), iva10 = Math.round(g10 / 11);

  const cuerpo = [
    at(f.fecha, d.fecha),
    at(d.credito ? f.credito : f.contado, "X"),
    at(f.razon_social, d.razon_social),
    at(f.ruc, d.ruc),
    d.direccion ? at(f.direccion, d.direccion) : "",
    filas,
    at({ x: f.col.exentas, y: f.subtotales_y }, ex ? gs(ex) : "", "der"),
    at({ x: f.col.iva5, y: f.subtotales_y }, g5 ? gs(g5) : "", "der"),
    at({ x: f.col.iva10, y: f.subtotales_y }, g10 ? gs(g10) : "", "der"),
    at(f.total_letras, d.total_letras),
    at(f.total_numero, gs(total), "der"),
    at(f.liq_iva5, gs(iva5)),
    at(f.liq_iva10, gs(iva10)),
    at(f.liq_total, gs(iva5 + iva10)),
  ].join("");

  const excedidos = d.items.length - f.items.max_filas;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(opts.titulo)}</title>
<style>
  @page { size: ${f.hoja.ancho}mm ${f.hoja.alto}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: ${f.letra}pt; color: #000; }
  .hoja { position: relative; width: ${f.hoja.ancho}mm; height: ${f.hoja.alto}mm; overflow: hidden; }
  .t { position: absolute; line-height: 1; }
  .cruz { position: absolute; width: 3mm; height: 3mm; border-left: 0.2mm solid red; border-top: 0.2mm solid red; transform: rotate(45deg); }
  .aviso { font-family: Arial, sans-serif; background: #fff7e6; border-bottom: 1px solid #f0c36d; padding: 8px 12px; font-size: 13px; }
  @media print { .aviso { display: none; } }
</style></head><body>
${opts.aviso || excedidos > 0 ? `<div class="aviso">${opts.aviso ? esc(opts.aviso) : ""}${excedidos > 0 ? ` · Atención: ${excedidos} producto(s) no entran en el talonario (máximo ${f.items.max_filas} renglones); el total los incluye.` : ""}</div>` : ""}
<div class="hoja">${cuerpo}</div>
${opts.auto ? "<script>window.onload=()=>window.print()</script>" : ""}
</body></html>`;
}
