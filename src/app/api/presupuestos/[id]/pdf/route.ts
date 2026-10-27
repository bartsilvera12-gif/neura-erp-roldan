import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";

/**
 * GET /api/presupuestos/[id]/pdf
 *
 * Genera un PDF REAL (pdf-lib) del presupuesto y lo devuelve como descarga
 * directa (Content-Disposition: attachment). NO abre el diálogo de impresión.
 * Documento comercial NO fiscal — no toca SIFEN ni stock.
 */

// Punto 9.4: el presupuesto va en azul. Es el único documento del sistema que
// sale del local y llega a una mesa donde hay tres presupuestos más encima; el
// azul institucional lo distingue de la factura y del remito, que son del verde
// de la marca.
//
// Dos tonos y no uno: el oscuro para las reglas y la franja de la tabla, donde
// tiene que haber contraste contra el blanco y contra el texto blanco encima;
// el medio para el número del presupuesto, que es lo primero que se busca.
const AZUL = rgb(0x1e / 255, 0x4e / 255, 0x8c / 255);
const AZUL_MEDIO = rgb(0x25 / 255, 0x63 / 255, 0xeb / 255);
const DARK = rgb(0x1f / 255, 0x29 / 255, 0x37 / 255);
const GREY = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const LIGHT = rgb(0xee / 255, 0xf2 / 255, 0xf4 / 255);
const WHITE = rgb(1, 1, 1);

// A4 en puntos.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const RIGHT = PAGE_W - MARGIN;

// Columnas de la tabla de ítems.
const COL = {
  cantCenter: 62,
  descLeft: 92,
  descMax: 300, // límite derecho de la descripción (para el wrap)
  precioRight: 378,
  ivaCenter: 402,
  descuentoRight: 466,
  totalRight: RIGHT,
};

const IVA_LABEL: Record<string, string> = { EXENTA: "Exenta", "5%": "5%", "10%": "10%" };

/** Reemplaza caracteres fuera de WinAnsi/Latin-1 (pdf-lib no los soporta). */
function san(v: unknown): string {
  return String(v ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "-")
    .replace(/ /g, " ")
    // Cualquier otro char fuera de Latin-1 → espacio, para no romper el encoding.
    .replace(/[^\x00-\xFF]/g, " ");
}

function fmtMoneda(n: unknown, moneda: string): string {
  const v = Number(n) || 0;
  const simbolo = moneda === "USD" ? "USD " : "Gs. ";
  return simbolo + v.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}

function fmtFecha(iso: unknown): string {
  if (!iso) return "-";
  try {
    return new Date(String(iso)).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return String(iso);
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = san(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * Como wrap, pero respetando los renglones que escribió el usuario.
 *
 * `wrap` junta todo con espacios, así que una lista de tres condiciones
 * escrita en tres renglones salía como un solo párrafo corrido. En un texto
 * que puede terminar discutiéndose, cada condición tiene que leerse aparte.
 */
function wrapParrafos(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const parrafo of String(text ?? "").split(/\r?\n/)) {
    if (!parrafo.trim()) {
      // Un renglón en blanco separa bloques: se conserva, pero no se acumulan.
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(...wrap(parrafo, font, size, maxWidth));
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? out : [""];
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });

  const pq = await ctx.supabase
    .from("presupuestos")
    .select("*")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (pq.error || !pq.data) return new NextResponse("Presupuesto no encontrado", { status: 404 });
  const p = pq.data as Record<string, unknown>;

  const itq = await ctx.supabase
    .from("presupuesto_items")
    .select("producto_nombre, sku, cantidad, unidad_medida, precio_unitario, iva_tipo, descuento, total")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("presupuesto_id", id)
    .order("created_at", { ascending: true });
  const items = (itq.data ?? []) as Record<string, unknown>[];

  const moneda = String(p.moneda ?? "PYG");
  const e = EMPRESA_DOC;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Logo (opcional; si falla, se omite sin romper). El archivo es PNG → embedPng.
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "brand", "roldan-doc-logo.png"));
    logo = await pdf.embedPng(bytes);
  } catch {
    /* sin logo */
  }

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const T = (
    pg: PDFPage,
    s: string,
    x: number,
    yBaseline: number,
    size: number,
    f: PDFFont = font,
    color = DARK
  ) => pg.drawText(san(s), { x, y: yBaseline, size, font: f, color });
  const TR = (pg: PDFPage, s: string, xRight: number, yb: number, size: number, f: PDFFont = font, color = DARK) =>
    T(pg, s, xRight - f.widthOfTextAtSize(san(s), size), yb, size, f, color);
  const TC = (pg: PDFPage, s: string, cx: number, yb: number, size: number, f: PDFFont = font, color = DARK) =>
    T(pg, s, cx - f.widthOfTextAtSize(san(s), size) / 2, yb, size, f, color);

  // ═══════ Membrete: logo izq + datos empresa der ═══════
  const headTop = y;
  if (logo) {
    const maxW = 120, maxH = 60;
    const scale = Math.min(maxW / logo.width, maxH / logo.height);
    const w = logo.width * scale, h = logo.height * scale;
    page.drawImage(logo, { x: MARGIN, y: headTop - h, width: w, height: h });
  }
  let ry = headTop - 4;
  TR(page, e.nombre, RIGHT, ry, 13, bold, DARK); ry -= 13;
  if (e.propietario) { TR(page, e.propietario, RIGHT, ry, 9, bold, rgb(0.22, 0.25, 0.28)); ry -= 11; }
  if (e.ruc) { TR(page, `RUC: ${e.ruc}`, RIGHT, ry, 9, bold, DARK); ry -= 11; }
  for (const a of e.actividad) { TR(page, a, RIGHT, ry, 7.5, font, GREY); ry -= 9; }
  TR(page, `Tel: ${e.telefono}`, RIGHT, ry, 8.5, bold, rgb(0.22, 0.25, 0.28)); ry -= 10;
  for (const d of e.direccion) { TR(page, d, RIGHT, ry, 8, font, GREY); ry -= 9.5; }

  y = Math.min(headTop - 70, ry) - 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 2, color: AZUL });
  y -= 24;

  // ═══════ Título + número ═══════
  T(page, "PRESUPUESTO", MARGIN, y, 20, bold, DARK);
  TR(page, String(p.numero_control ?? ""), RIGHT, y + 4, 16, bold, AZUL_MEDIO);
  TR(page, `Fecha: ${fmtFecha(p.fecha)}`, RIGHT, y - 12, 9, font, GREY);
  if (p.fecha_vencimiento) TR(page, `Valido hasta: ${fmtFecha(p.fecha_vencimiento)}`, RIGHT, y - 23, 9, font, GREY);
  y -= 40;

  // ═══════ Cajas Cliente / Datos ═══════
  const boxTop = y;
  const boxW = (RIGHT - MARGIN - 16) / 2;
  const boxL = { x: MARGIN, w: boxW };
  const boxR = { x: MARGIN + boxW + 16, w: boxW };

  const clienteLines: string[] = [];
  clienteLines.push(`__B__${san(p.cliente_nombre)}`);
  if (p.cliente_ruc) clienteLines.push(`RUC/CI: ${san(p.cliente_ruc)}`);
  if (p.cliente_telefono) clienteLines.push(`Tel: ${san(p.cliente_telefono)}`);
  if (p.cliente_direccion) clienteLines.push(san(p.cliente_direccion));

  const datosLines: string[] = [];
  datosLines.push(`Moneda: ${moneda === "USD" ? "Dolares (USD)" : "Guaranies (PYG)"}`);
  if (p.validez_dias) datosLines.push(`Validez: ${san(p.validez_dias)} dia(s)`);
  if (p.forma_pago) datosLines.push(`Forma de pago: ${san(p.forma_pago)}`);
  if (p.plazo_entrega) datosLines.push(`Plazo de entrega: ${san(p.plazo_entrega)}`);

  const boxLines = Math.max(clienteLines.length, datosLines.length);
  const boxH = 22 + boxLines * 12 + 8;

  const drawBox = (bx: { x: number; w: number }, titulo: string, lines: string[]) => {
    page.drawRectangle({ x: bx.x, y: boxTop - boxH, width: bx.w, height: boxH, borderColor: rgb(0.9, 0.9, 0.92), borderWidth: 1, color: rgb(0.99, 0.995, 1) });
    T(page, titulo.toUpperCase(), bx.x + 10, boxTop - 15, 8, bold, GREY);
    let ly = boxTop - 30;
    for (const ln of lines) {
      if (ln.startsWith("__B__")) T(page, ln.slice(5), bx.x + 10, ly, 10, bold, DARK);
      else T(page, ln, bx.x + 10, ly, 9, font, rgb(0.25, 0.28, 0.32));
      ly -= 12;
    }
  };
  drawBox(boxL, "Cliente", clienteLines);
  drawBox(boxR, "Datos del presupuesto", datosLines);
  y = boxTop - boxH - 22;

  // ═══════ Tabla de ítems ═══════
  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 16, width: RIGHT - MARGIN, height: 18, color: AZUL });
    const hb = y - 12;
    TC(page, "CANT.", COL.cantCenter, hb, 8, bold, WHITE);
    T(page, "DESCRIPCION", COL.descLeft, hb, 8, bold, WHITE);
    TR(page, "PRECIO UNIT.", COL.precioRight, hb, 8, bold, WHITE);
    TC(page, "IVA", COL.ivaCenter, hb, 8, bold, WHITE);
    TR(page, "DESC.", COL.descuentoRight, hb, 8, bold, WHITE);
    TR(page, "TOTAL", COL.totalRight, hb, 8, bold, WHITE);
    y -= 20;
  };
  drawTableHeader();

  const rowSize = 9, lineH = 11;
  for (const it of items) {
    const nombre = san(it.producto_nombre);
    const skuTxt = it.sku ? ` · ${san(it.sku)}` : "";
    const descLines = wrap(nombre + skuTxt, font, rowSize, COL.descMax - COL.descLeft);
    const rowH = descLines.length * lineH + 6;

    // Salto de página si no entra la fila.
    if (y - rowH < MARGIN + 70) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawTableHeader();
    }

    const cant = Number(it.cantidad) || 0;
    const unidad = it.unidad_medida ? ` ${san(it.unidad_medida)}` : "";
    const topB = y - rowSize;
    TC(page, `${cant.toLocaleString("es-PY", { maximumFractionDigits: 3 })}${unidad}`, COL.cantCenter, topB, rowSize, font, DARK);
    descLines.forEach((ln, i) => T(page, ln, COL.descLeft, y - rowSize - i * lineH, rowSize, font, DARK));
    TR(page, fmtMoneda(it.precio_unitario, moneda), COL.precioRight, topB, rowSize, font, DARK);
    TC(page, IVA_LABEL[String(it.iva_tipo)] ?? String(it.iva_tipo), COL.ivaCenter, topB, rowSize, font, DARK);
    TR(page, Number(it.descuento) > 0 ? fmtMoneda(it.descuento, moneda) : "-", COL.descuentoRight, topB, rowSize, font, DARK);
    TR(page, fmtMoneda(it.total, moneda), COL.totalRight, topB, rowSize, bold, DARK);

    y -= rowH;
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: RIGHT, y: y + 2 }, thickness: 0.5, color: LIGHT });
  }
  if (items.length === 0) {
    TC(page, "Sin items", (MARGIN + RIGHT) / 2, y - 12, 9, font, GREY);
    y -= 20;
  }

  // ═══════ Totales ═══════
  y -= 8;
  const totLabelX = RIGHT - 200;
  const totRow = (label: string, valor: string, big = false) => {
    T(page, label, totLabelX, y, big ? 12 : 10, big ? bold : font, big ? DARK : GREY);
    TR(page, valor, RIGHT, y, big ? 13 : 10, big ? bold : font, big ? DARK : DARK);
    y -= big ? 20 : 15;
  };
  totRow("Subtotal (sin IVA)", fmtMoneda(p.subtotal, moneda));
  totRow("IVA", fmtMoneda(p.monto_iva, moneda));
  if (Number(p.descuento_total) > 0) totRow("Descuentos", `- ${fmtMoneda(p.descuento_total, moneda)}`);
  page.drawLine({ start: { x: totLabelX, y: y + 6 }, end: { x: RIGHT, y: y + 6 }, thickness: 1.5, color: AZUL });
  y -= 6;
  totRow("TOTAL", fmtMoneda(p.total, moneda), true);

  // ═══════ Condiciones / Observaciones ═══════
  const condiciones: string[] = [];
  if (p.validez_dias) condiciones.push(`Validez: ${san(p.validez_dias)} dia(s)${p.fecha_vencimiento ? ` (vence ${fmtFecha(p.fecha_vencimiento)})` : ""}`);
  if (p.forma_pago) condiciones.push(`Forma de pago: ${san(p.forma_pago)}`);
  if (p.plazo_entrega) condiciones.push(`Plazo de entrega: ${san(p.plazo_entrega)}`);

  const ensureSpace = (need: number) => {
    if (y - need < MARGIN + 50) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  if (condiciones.length) {
    y -= 10;
    ensureSpace(20 + condiciones.length * 12);
    T(page, "CONDICIONES COMERCIALES", MARGIN, y, 8, bold, GREY);
    y -= 14;
    for (const c of condiciones) { T(page, `- ${c}`, MARGIN + 4, y, 9, font, rgb(0.25, 0.28, 0.32)); y -= 12; }
  }

  // El texto libre de condiciones (punto 9.4). Va junto a las fijas y antes de
  // las observaciones: es lo que obliga, no una nota sobre la mercadería.
  if (p.condiciones_comerciales) {
    const condLines = wrapParrafos(String(p.condiciones_comerciales), font, 9, RIGHT - MARGIN - 4);
    y -= condiciones.length ? 2 : 10;
    ensureSpace(20 + condLines.length * 12);
    if (!condiciones.length) {
      T(page, "CONDICIONES COMERCIALES", MARGIN, y, 8, bold, GREY);
      y -= 14;
    }
    for (const ln of condLines) { T(page, ln, MARGIN + 4, y, 9, font, rgb(0.25, 0.28, 0.32)); y -= 12; }
  }

  if (p.observaciones) {
    y -= 8;
    const obsLines = wrapParrafos(String(p.observaciones), font, 9, RIGHT - MARGIN - 4);
    ensureSpace(20 + obsLines.length * 12);
    T(page, "OBSERVACIONES", MARGIN, y, 8, bold, GREY);
    y -= 14;
    for (const ln of obsLines) { T(page, ln, MARGIN + 4, y, 9, font, rgb(0.25, 0.28, 0.32)); y -= 12; }
  }

  // ── QUIÉN LO EMITIÓ NO VA EN LA HOJA ──────────────────────────────────────
  //   El presupuesto es lo que se le entrega al cliente, y ahí el correo
  //   interno del vendedor no le dice nada: le ocupa lugar y expone una
  //   dirección de la empresa sin motivo.
  //
  //   El dato sigue guardado y se muestra adentro del sistema, en el listado
  //   y en la ficha del presupuesto, que es donde alguien pregunta "¿quién
  //   hizo esta cotización?".

  // ═══════ Pie legal ═══════
  ensureSpace(40);
  y = Math.max(y, MARGIN + 30);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.82, 0.82, 0.85) });
  y -= 12;
  TC(page, "Presupuesto sujeto a disponibilidad de stock y validez indicada.", (MARGIN + RIGHT) / 2, y, 8, font, GREY);
  y -= 10;
  TC(page, "Documento no fiscal - no valido como factura.", (MARGIN + RIGHT) / 2, y, 8, font, GREY);

  const bytes = await pdf.save();
  const nombreArchivo = `Presupuesto-${String(p.numero_control ?? id).replace(/[^\w.-]+/g, "_")}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
