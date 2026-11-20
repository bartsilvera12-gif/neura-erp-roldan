/**
 * Nota de remisión impresa ENCIMA del formulario preimpreso de Aceros
 * (23,5 × 32 cm, timbrado de imprenta, pedido del cliente).
 *
 * El formulario ya trae los títulos, los renglones, el número y el timbrado:
 * acá se imprimen solo los datos, cada uno sobre su renglón. Nada de bordes
 * ni títulos.
 *
 * ── DE DÓNDE SALEN LAS POSICIONES ─────────────────────────────────────────
 *   Del formulario escaneado que mandó el cliente (1206 × 2000 px a la vista),
 *   llevado a 23,5 × 32 cm. Cada campo es (x, y) en esos píxeles: x donde
 *   empieza el texto (después de la etiqueta impresa), y la altura del
 *   renglón.
 *
 *   Las impresoras corren el papel unos milímetros, cada una distinto. Por
 *   eso la hoja trae, en pantalla, el formulario de fondo para ver cómo cae
 *   y botones para correr todo a la izquierda/derecha/arriba/abajo. El ajuste
 *   se guarda en esa computadora y se usa en las próximas impresiones.
 */

const ANCHO_CM = 23.5;
const ALTO_CM = 32;
const PX_ANCHO = 1206;
const PX_ALTO = 2000;

const xcm = (px: number) => (px / PX_ANCHO) * ANCHO_CM;
const ycm = (px: number) => (px / PX_ALTO) * ALTO_CM;

/** Dónde va cada dato, en píxeles del formulario escaneado. */
const POS = {
  fecha_emision: [195, 370],
  dest_nombre: [200, 430], dest_ruc: [925, 432],
  dest_direccion: [105, 457],
  comprobante_nro: [215, 514], motivo_texto: [870, 516],
  fecha_expedicion: [180, 542], tipo_comprobante: [910, 545],
  fecha_inicio: [225, 569], timbrado: [890, 573],
  partida_direccion: [240, 597], fecha_termino: [1015, 601],
  partida_ciudad: [90, 624],
  llegada_direccion: [245, 652], partida_departamento: [842, 653],
  llegada_ciudad: [90, 679], llegada_departamento: [842, 682],
  km: [268, 708],
  vehiculo_marca: [195, 819], vehiculo_rua: [1015, 822],
  remolque_rua: [545, 850],
  conductor_nombre: [268, 902], conductor_ci: [912, 903],
  conductor_direccion: [105, 930],
  otro_motivo: [320, 1121], comp_venta: [880, 1121],
} as const;

/** El centro de cada casilla de «Motivo del traslado». */
const CASILLAS = {
  venta: [168, 1006], exportacion: [168, 1043], compra: [168, 1080],
  importacion: [421, 1006], consignacion: [421, 1043], devolucion: [421, 1081],
  traslado_locales: [810, 1006], transformacion: [810, 1043], reparacion: [810, 1080],
  emisor_movil: [1088, 1006], exhibicion: [1088, 1043], ferias: [1088, 1080],
} as const;

/** La grilla de artículos: 15 renglones entre y=1162 y y=1745. */
const FILA_TOP = 1162;
const FILA_ALTO = (1745 - 1162) / 15;
export const FILAS_POR_HOJA = 15;
const COL_COD = 30;
const COL_CANT_DER = 232; // la cantidad va alineada a la derecha de su columna
const COL_DESC = 246;

export type MotivoTraslado = keyof typeof CASILLAS;

export interface DatosRemisionPreimpresa {
  titulo: string;
  fecha_emision: string;
  destinatario: { nombre: string; ruc?: string | null; direccion?: string | null };
  comprobante_nro?: string | null;
  tipo_comprobante?: string | null;
  timbrado?: string | null;
  motivo: MotivoTraslado | null;
  /** Texto de «Motivo de traslado» arriba (si no, sale del motivo). */
  motivo_texto?: string | null;
  otro_motivo?: string | null;
  fecha_expedicion?: string | null;
  fecha_inicio?: string | null;
  fecha_termino?: string | null;
  partida: { direccion?: string | null; ciudad?: string | null; departamento?: string | null };
  llegada: { direccion?: string | null; ciudad?: string | null; departamento?: string | null };
  km?: string | null;
  vehiculo?: { marca?: string | null; rua?: string | null; remolque?: string | null };
  conductor?: { nombre?: string | null; ci?: string | null; direccion?: string | null };
  items: Array<{ codigo?: string | null; cantidad: string; descripcion: string }>;
}

const ETIQUETA_MOTIVO: Record<MotivoTraslado, string> = {
  venta: "Venta", exportacion: "Exportación", compra: "Compra", importacion: "Importación",
  consignacion: "Consignación", devolucion: "Devolución", traslado_locales: "Traslado entre locales de la empresa",
  transformacion: "Transformación", reparacion: "Reparación", emisor_movil: "Emisor móvil",
  exhibicion: "Exhibición", ferias: "Ferias",
};

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Un texto ubicado en el formulario. `max` = ancho disponible en px del formulario. */
function campo([x, y]: readonly [number, number], texto: string | null | undefined, max = 600, clase = ""): string {
  const t = (texto ?? "").trim();
  if (!t) return "";
  return `<div class="c ${clase}" style="left:${xcm(x).toFixed(3)}cm;top:${(ycm(y) - 0.25).toFixed(3)}cm;max-width:${xcm(max).toFixed(3)}cm">${esc(t)}</div>`;
}

function hoja(d: DatosRemisionPreimpresa, items: DatosRemisionPreimpresa["items"]): string {
  const p = POS;
  const partes: string[] = [
    campo(p.fecha_emision, d.fecha_emision, 300),
    campo(p.dest_nombre, d.destinatario.nombre, 520),
    campo(p.dest_ruc, d.destinatario.ruc, 220),
    campo(p.dest_direccion, d.destinatario.direccion, 1030),
    campo(p.comprobante_nro, d.comprobante_nro, 510),
    campo(p.motivo_texto, d.motivo_texto ?? (d.motivo ? ETIQUETA_MOTIVO[d.motivo] : null), 270),
    campo(p.fecha_expedicion, d.fecha_expedicion, 550),
    campo(p.tipo_comprobante, d.tipo_comprobante, 230),
    campo(p.fecha_inicio, d.fecha_inicio, 500),
    campo(p.timbrado, d.timbrado, 250),
    campo(p.partida_direccion, d.partida.direccion, 495),
    campo(p.fecha_termino, d.fecha_termino, 130),
    campo(p.partida_ciudad, d.partida.ciudad, 1050),
    campo(p.llegada_direccion, d.llegada.direccion, 490),
    campo(p.partida_departamento, d.partida.departamento, 300),
    campo(p.llegada_ciudad, d.llegada.ciudad, 650),
    campo(p.llegada_departamento, d.llegada.departamento, 300),
    campo(p.km, d.km, 870),
    campo(p.vehiculo_marca, d.vehiculo?.marca, 530),
    campo(p.vehiculo_rua, d.vehiculo?.rua, 130),
    campo(p.remolque_rua, d.vehiculo?.remolque, 600),
    campo(p.conductor_nombre, d.conductor?.nombre, 465),
    campo(p.conductor_ci, d.conductor?.ci, 235),
    campo(p.conductor_direccion, d.conductor?.direccion, 1040),
    campo(p.otro_motivo, d.otro_motivo, 400),
    campo(p.comp_venta, d.motivo ? d.comprobante_nro : null, 260),
  ];
  if (d.motivo) {
    const [x, y] = CASILLAS[d.motivo];
    partes.push(`<div class="c x" style="left:${(xcm(x) - 0.2).toFixed(3)}cm;top:${(ycm(y) - 0.22).toFixed(3)}cm">X</div>`);
  }
  items.forEach((it, i) => {
    const y = FILA_TOP + FILA_ALTO * (i + 0.5);
    partes.push(
      campo([COL_COD, y], it.codigo, 112, "chico"),
      `<div class="c" style="left:${xcm(150).toFixed(3)}cm;width:${xcm(COL_CANT_DER - 150).toFixed(3)}cm;text-align:right;top:${(ycm(y) - 0.25).toFixed(3)}cm">${esc(it.cantidad)}</div>`,
      campo([COL_DESC, y], it.descripcion, 895),
    );
  });
  return `<section class="hoja">${partes.join("")}</section>`;
}

export function remisionPreimpresaHtml(d: DatosRemisionPreimpresa): string {
  const tandas: DatosRemisionPreimpresa["items"][] = [];
  for (let i = 0; i < Math.max(1, d.items.length); i += FILAS_POR_HOJA) tandas.push(d.items.slice(i, i + FILAS_POR_HOJA));

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(d.titulo)}</title>
<style>
  @page { size: ${ANCHO_CM}cm ${ALTO_CM}cm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #e5e7eb; }
  .hoja { position: relative; width: ${ANCHO_CM}cm; height: ${ALTO_CM}cm; overflow: hidden; background: #fff; margin: 0 auto 12px; }
  .con-fondo .hoja { background: #fff url('/documentos/nota-remision-aceros.jpg') 0 0 / ${ANCHO_CM}cm ${ALTO_CM}cm no-repeat; }
  .con-fondo .hoja .c { color: #1d4ed8; }
  .mover { position: absolute; inset: 0; transform: translate(var(--dx, 0mm), var(--dy, 0mm)); }
  .c { position: absolute; font-size: 10pt; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c.chico { font-size: 8.5pt; }
  .c.x { font-size: 13pt; font-weight: bold; }
  .barra { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 8px; background: #111827; color: #fff; font-size: 13px; }
  .barra button { background: #374151; color: #fff; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 13px; }
  .barra button.prim { background: #0ea5e9; font-weight: bold; }
  @media print {
    body { background: #fff; }
    .barra { display: none; }
    .hoja { margin: 0; page-break-after: always; background: none !important; }
    .hoja:last-child { page-break-after: auto; }
    .hoja .c { color: #000 !important; }
  }
</style></head>
<body class="con-fondo">
  <div class="barra">
    <button class="prim" onclick="window.print()">Imprimir sobre el formulario</button>
    <label><input type="checkbox" id="fondo" checked> Ver el formulario de fondo (no se imprime)</label>
    <span>Correr:</span>
    <button onclick="mover(0,-1)">↑ 1 mm</button><button onclick="mover(0,1)">↓ 1 mm</button>
    <button onclick="mover(-1,0)">← 1 mm</button><button onclick="mover(1,0)">→ 1 mm</button>
    <span id="ajuste"></span>
    <button onclick="mover(0,0,true)">Volver a 0</button>
  </div>
  ${tandas.map((t) => hoja(d, t).replace('<section class="hoja">', '<section class="hoja"><div class="mover">').replace(/<\/section>$/, "</div></section>")).join("")}
<script>
  (function () {
    var K = "remision-aceros-ajuste";
    var a = { dx: 0, dy: 0 };
    try { a = JSON.parse(localStorage.getItem(K) || "") || a; } catch (e) {}
    function aplicar() {
      document.documentElement.style.setProperty("--dx", a.dx + "mm");
      document.documentElement.style.setProperty("--dy", a.dy + "mm");
      document.getElementById("ajuste").textContent = "Ajuste: " + a.dx + " mm horizontal, " + a.dy + " mm vertical";
    }
    window.mover = function (dx, dy, cero) {
      if (cero) { a = { dx: 0, dy: 0 }; } else { a.dx += dx; a.dy += dy; }
      try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) {}
      aplicar();
    };
    document.getElementById("fondo").addEventListener("change", function (e) {
      document.body.classList.toggle("con-fondo", e.target.checked);
    });
    aplicar();
  })();
</script>
</body></html>`;
}
