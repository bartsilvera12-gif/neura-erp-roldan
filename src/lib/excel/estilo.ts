/**
 * Escritor de Excel con formato, para los informes que salen del sistema.
 *
 * ── POR QUÉ NO ALCANZA EL QUE YA HABÍA ────────────────────────────────────
 *   `src/lib/excel/export.ts` usa la librería `xlsx` (SheetJS) en su versión
 *   comunitaria. Esa versión escribe anchos de columna, autofiltro y formatos
 *   de número, pero DESCARTA los estilos de celda: si se le pasa negrita o un
 *   relleno, el archivo sale igual sin ellos. Está comprobado: el `styles.xml`
 *   del libro generado queda con una sola fuente y sin rellenos.
 *
 *   Para un informe que se imprime y se manda al contador eso no alcanza. Acá
 *   se usa `exceljs`, que sí los escribe, y se deja el otro archivo intacto
 *   para las plantillas de importación: una plantilla que el usuario va a
 *   llenar no quiere adornos, quiere columnas crudas.
 *
 * ── QUÉ RESUELVE EL FORMATO, QUE NO ES DECORACIÓN ─────────────────────────
 *   Los informes que hoy exporta el sistema salen como una grilla pelada con
 *   los títulos en MAYUSCULA_CON_GUIONES y los importes sin separador de
 *   miles. En una planilla de mil productos eso se lee mal y se audita peor:
 *   al bajar la pantalla se pierde de vista qué columna es cuál, y un importe
 *   de siete cifras sin puntos se confunde con otro de seis.
 *
 *   De ahí las decisiones:
 *     · encabezado fijo (freeze) y autofiltro → la fila 1000 sigue sabiendo
 *       de qué columna se trata, y se puede filtrar sin preparar nada;
 *     · separador de miles por tipo de dato → los guaraníes sin decimales,
 *       los dólares con cuatro (una cotización de 0,8410 no se puede redondear
 *       a 0,84 sin mover el costo), las cantidades con los que hagan falta;
 *     · encabezado con el nombre de la empresa, el informe y el período →
 *       la planilla impresa se explica sola, sin depender del nombre del
 *       archivo;
 *     · fila de totales marcada → se ve de una que es el cierre y no un
 *       renglón más.
 */
import ExcelJS from "exceljs";

/** Verde del membrete de los documentos impresos: un solo color en todo el ERP. */
const VERDE = "FF2E7D32";
const VERDE_CLARO = "FFEDF5EE";
const GRIS_TEXTO = "FF6B7280";
const GRIS_LINEA = "FFD1D5DB";

/**
 * Cómo se escribe cada columna.
 *
 *   gs        guaraníes, sin decimales (la moneda no tiene centavos)
 *   usd       dólares con cuatro decimales (ver nota de arriba)
 *   cantidad  unidades; hasta tres decimales, pero sin ceros de relleno
 *   entero    unidades enteras
 *   porcentaje con un decimal
 *   fecha     dd/mm/aaaa
 *   texto     tal cual, alineado a la izquierda
 */
export type FormatoCelda =
  | "gs"
  | "usd"
  | "cantidad"
  | "entero"
  | "porcentaje"
  | "fecha"
  | "texto";

const NUM_FMT: Record<FormatoCelda, string | undefined> = {
  gs: "#,##0",
  usd: "#,##0.0000",
  cantidad: "#,##0.###",
  entero: "#,##0",
  porcentaje: "#,##0.0%",
  fecha: "dd/mm/yyyy",
  texto: undefined,
};

export interface ColumnaEstilada<T> {
  /** Título legible. En minúscula con mayúscula inicial: es lo que se lee. */
  header: string;
  value: (row: T) => string | number | boolean | null | undefined | Date;
  /** Ancho en caracteres. Si no se pasa, se calcula del contenido. */
  width?: number;
  formato?: FormatoCelda;
  /**
   * Si la fila de totales suma esta columna. Solo tiene sentido en columnas
   * numéricas; en las de texto el total queda vacío.
   */
  suma?: boolean;
}

export interface EncabezadoInforme {
  /** Nombre de la empresa, de `empresas.nombre_empresa`. */
  empresa: string;
  /** RUC, si está cargado. Se omite el renglón si viene vacío. */
  ruc?: string | null;
  /** Nombre del informe, como lo llama el usuario. */
  informe: string;
  /** "Setiembre 2025", "01/09/2025 al 30/09/2025", lo que corresponda. */
  periodo?: string | null;
  /** Nombre de la sucursal, cuando el informe es de una sola. */
  sucursal?: string | null;
  /** Aclaraciones al pie del encabezado: criterios, exclusiones, supuestos. */
  notas?: string[];
}

export interface HojaEstilada<T> {
  nombre: string;
  filas: T[];
  columnas: ColumnaEstilada<T>[];
  /** Si se agrega la fila de totales. Por defecto sí, si hay alguna columna con `suma`. */
  totales?: boolean;
  /** Texto de la primera celda de la fila de totales. */
  etiquetaTotales?: string;
  /**
   * Saca el autofiltro. Es para las hojas de "Resumen", que son pares
   * concepto/valor: ahí el embudo no filtra nada útil y encima invita a
   * esconder renglones de un resumen que se lee completo o no se lee.
   */
  sinFiltro?: boolean;
}

/** Paraguay está siempre en UTC−3; no hay horario de verano que corregir. */
const OFFSET_PY_MS = -3 * 60 * 60 * 1000;

function ahoraPy(): string {
  const d = new Date(Date.now() + OFFSET_PY_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Ancho de columna cuando no se declara uno.
 *
 * Se mide el título y una muestra de los valores, no todas las filas: en una
 * planilla de miles de renglones recorrerla entera para medir texto cuesta más
 * que el archivo, y con doscientas filas el ancho ya no cambia. El tope de 52
 * existe porque una descripción larga, si se la deja crecer, empuja todo lo
 * demás fuera de la hoja impresa.
 */
function anchoAuto<T>(col: ColumnaEstilada<T>, filas: T[]): number {
  let max = col.header.length;
  const muestra = filas.length > 200 ? filas.slice(0, 200) : filas;
  for (const f of muestra) {
    const v = col.value(f);
    if (v == null) continue;
    const largo =
      v instanceof Date ? 10 : typeof v === "number" ? String(Math.round(v)).length + 4 : String(v).length;
    if (largo > max) max = largo;
  }
  return Math.min(Math.max(max + 2, 9), 52);
}

/** Convierte un índice 0-based a letra de columna de Excel (0 → A, 26 → AA). */
function letraCol(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function esNumerico(f: FormatoCelda | undefined): boolean {
  return f === "gs" || f === "usd" || f === "cantidad" || f === "entero" || f === "porcentaje";
}

/**
 * Arma una hoja con encabezado, títulos fijos, autofiltro y totales.
 *
 * El encabezado ocupa filas fijas y después viene la tabla. Se calcula en qué
 * fila arranca en vez de dejarlo en una constante porque los renglones del
 * encabezado son opcionales (puede no haber RUC, ni período, ni sucursal) y
 * una constante se desincroniza con el primer informe que no los tenga.
 */
function escribirHoja<T>(
  ws: ExcelJS.Worksheet,
  hoja: HojaEstilada<T>,
  enc: EncabezadoInforme
): void {
  const cols = hoja.columnas;
  const ultima = letraCol(cols.length - 1);

  const titulos: { texto: string; tam: number; negrita: boolean; color?: string }[] = [
    { texto: enc.empresa, tam: 14, negrita: true, color: VERDE },
    { texto: enc.informe, tam: 12, negrita: true },
  ];
  const sub: string[] = [];
  if (enc.ruc) sub.push(`RUC ${enc.ruc}`);
  if (enc.periodo) sub.push(enc.periodo);
  if (enc.sucursal) sub.push(enc.sucursal);
  if (sub.length) titulos.push({ texto: sub.join("  ·  "), tam: 10, negrita: false, color: GRIS_TEXTO });
  titulos.push({ texto: `Generado el ${ahoraPy()}`, tam: 9, negrita: false, color: GRIS_TEXTO });
  for (const n of enc.notas ?? []) {
    titulos.push({ texto: n, tam: 9, negrita: false, color: GRIS_TEXTO });
  }

  titulos.forEach((t, i) => {
    const fila = i + 1;
    ws.mergeCells(`A${fila}:${ultima}${fila}`);
    const c = ws.getCell(`A${fila}`);
    c.value = t.texto;
    c.font = { bold: t.negrita, size: t.tam, color: { argb: t.color ?? "FF111827" } };
    c.alignment = { vertical: "middle" };
    ws.getRow(fila).height = t.tam + 7;
  });

  // Un renglón en blanco separa el encabezado de la tabla: pegados, el título
  // del informe se lee como si fuera el nombre de la primera columna.
  const filaTitulos = titulos.length + 2;

  const hdr = ws.getRow(filaTitulos);
  cols.forEach((col, i) => {
    const c = hdr.getCell(i + 1);
    c.value = col.header;
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
    c.alignment = {
      vertical: "middle",
      horizontal: esNumerico(col.formato) ? "right" : "left",
      wrapText: true,
    };
    c.border = { bottom: { style: "thin", color: { argb: VERDE } } };
  });
  hdr.height = 22;

  cols.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width ?? anchoAuto(col, hoja.filas);
  });

  hoja.filas.forEach((f, idx) => {
    const row = ws.getRow(filaTitulos + 1 + idx);
    cols.forEach((col, i) => {
      const c = row.getCell(i + 1);
      const v = col.value(f);
      c.value = v == null || v === "" ? null : (v as ExcelJS.CellValue);
      const fmt = NUM_FMT[col.formato ?? "texto"];
      if (fmt) c.numFmt = fmt;
      c.font = { size: 10 };
      c.alignment = {
        vertical: "middle",
        horizontal: esNumerico(col.formato) ? "right" : col.formato === "fecha" ? "center" : "left",
      };
      c.border = { bottom: { style: "hair", color: { argb: GRIS_LINEA } } };
    });
  });

  const haySumas = cols.some((c) => c.suma);
  const conTotales = hoja.totales ?? haySumas;
  const filaFin = filaTitulos + hoja.filas.length;

  if (conTotales && hoja.filas.length > 0) {
    const row = ws.getRow(filaFin + 1);
    cols.forEach((col, i) => {
      const c = row.getCell(i + 1);
      if (i === 0) {
        c.value = hoja.etiquetaTotales ?? "TOTALES";
      } else if (col.suma) {
        // Se escribe la fórmula y no el número ya sumado: si el contador
        // filtra o borra renglones, el total se recalcula en vez de quedar
        // afirmando un importe que ya no corresponde a lo que se ve.
        const l = letraCol(i);
        c.value = { formula: `SUBTOTAL(109,${l}${filaTitulos + 1}:${l}${filaFin})` };
      }
      const fmt = NUM_FMT[col.formato ?? "texto"];
      if (fmt) c.numFmt = fmt;
      c.font = { bold: true, size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_CLARO } };
      c.alignment = { vertical: "middle", horizontal: esNumerico(col.formato) ? "right" : "left" };
      c.border = { top: { style: "thin", color: { argb: VERDE } } };
    });
  }

  // Congelar debajo de los títulos y filtrar sobre ellos. `SUBTOTAL(109,...)`
  // de la fila de totales depende de esto: ignora lo que el filtro esconde.
  ws.views = [{ state: "frozen", ySplit: filaTitulos }];
  if (hoja.filas.length > 0 && !hoja.sinFiltro) {
    ws.autoFilter = { from: `A${filaTitulos}`, to: `${ultima}${filaFin}` };
  }

  // Al imprimir: apaisada, ajustada al ancho de la hoja y repitiendo los
  // títulos en cada página. Sin esto una planilla de mil productos sale en
  // treinta hojas sin saber qué columna es cuál a partir de la segunda.
  ws.pageSetup = {
    orientation: cols.length > 6 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9, // A4
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter = { oddFooter: "&L&F&C&P / &N&R&D" };
  ws.pageSetup.printTitlesRow = `${filaTitulos}:${filaTitulos}`;
}

/**
 * Importe en guaraníes ya escrito con puntos de mil.
 *
 * Es para las hojas de "Resumen", donde una misma columna "Valor" mezcla
 * importes, cantidades y frases. El formato de número de Excel se aplica por
 * columna y ahí no sirve: una columna en `#,##0` convertiría las frases en
 * basura. Entonces el importe se guarda como texto ya formateado. Vale solo en
 * esas hojas: en las de detalle los importes van como número, porque el
 * contador los suma y los ordena.
 */
export function formatearGs(n: number): string {
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Igual que `formatearGs`, con hasta tres decimales, para cantidades. */
export function formatearCantidad(n: number): string {
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 3 }).format(n);
}

/**
 * Declara una hoja dejando que TypeScript deduzca el tipo de las filas.
 *
 * Existe para poder meter hojas de tipos distintos en un mismo arreglo. Sin
 * esto hay que castear cada hoja, y el casteo apaga la deducción justo donde
 * hace falta: dentro de `value: (x) => x.algo`, donde un campo mal escrito
 * tiene que fallar al compilar y no al abrir el archivo.
 */
export function hoja<T>(h: HojaEstilada<T>): HojaEstilada<unknown> {
  return h as HojaEstilada<unknown>;
}

/** Un informe de una sola hoja. */
export async function buildXlsxEstilado<T>(
  hoja: HojaEstilada<T>,
  enc: EncabezadoInforme
): Promise<Buffer> {
  return buildXlsxEstiladoMulti([hoja as HojaEstilada<unknown>], enc);
}

/**
 * Un informe de varias hojas. Comparten el encabezado porque son el mismo
 * informe partido por criterio (por sucursal, por rubro), no informes
 * distintos: esos van en archivos distintos dentro del ZIP.
 */
export async function buildXlsxEstiladoMulti(
  hojas: HojaEstilada<unknown>[],
  enc: EncabezadoInforme
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = enc.empresa;
  wb.created = new Date();
  for (const h of hojas) {
    // Excel corta los nombres de hoja en 31 caracteres y no admite : \ / ? * [ ]
    const nombre = h.nombre.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Datos";
    escribirHoja(wb.addWorksheet(nombre), h, enc);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
