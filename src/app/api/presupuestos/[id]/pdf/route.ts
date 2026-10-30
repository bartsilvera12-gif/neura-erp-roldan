import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import { PLANTILLA_POR_DEFECTO, formaPagoConAnticipo } from "@/lib/presupuestos/plantilla";

/**
 * GET /api/presupuestos/[id]/pdf
 *
 * El presupuesto impreso, con el formato que usa la casa. Documento comercial
 * NO fiscal: no toca SIFEN ni stock.
 *
 * El diseño sigue el modelo que el cliente ya venía usando en su sistema
 * anterior, porque es el papel que sus clientes reconocen: blanco y negro,
 * membrete arriba, la cotización en el medio y las condiciones abajo. No se
 * "mejoró" a propósito — un presupuesto que llega distinto al de siempre
 * genera llamadas preguntando si es el mismo.
 *
 * Los textos fijos (forma de pago, validez y las condiciones) salen de
 * `presupuesto_plantilla`, que edita un administrador desde Configuración.
 */

const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.35, 0.35, 0.35);

// A4 en puntos.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 38;
const RIGHT = PAGE_W - MARGIN;

/** Columnas de la cotización, tomadas del modelo. */
const COL = {
  item: MARGIN + 12,
  articulo: MARGIN + 50,
  articuloMax: 235,
  cantidadRight: 360,
  kilosRight: 412,
  unitarioRight: 492,
  totalRight: RIGHT,
};

/** Reemplaza caracteres fuera de WinAnsi/Latin-1 (pdf-lib no los soporta). */
function san(v: unknown): string {
  return String(v ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x00-\xFF]/g, " ");
}

/** Importe sin símbolo: el documento ya dice "Gs." en el rótulo. */
function num(n: unknown, decimales = 0): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString("es-PY", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

function fmtFecha(iso: unknown): string {
  if (!iso) return "-";
  try {
    return new Date(String(iso)).toLocaleDateString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
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

  // Los textos fijos. Si la tabla todavía no existe (script 44 sin correr) se
  // usan los de siempre: el documento tiene que salir igual.
  let plantilla = PLANTILLA_POR_DEFECTO;
  try {
    const plq = await ctx.supabase
      .from("presupuesto_plantilla")
      .select("forma_pago, validez, observaciones, anticipo_pct")
      .eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();
    if (!plq.error && plq.data) {
      const d = plq.data as Record<string, unknown>;
      plantilla = {
        forma_pago: String(d.forma_pago ?? PLANTILLA_POR_DEFECTO.forma_pago),
        validez: String(d.validez ?? PLANTILLA_POR_DEFECTO.validez),
        observaciones: String(d.observaciones ?? PLANTILLA_POR_DEFECTO.observaciones),
        anticipo_pct: Number(d.anticipo_pct) || 0,
      };
    }
  } catch {
    /* sin plantilla cargada: quedan los textos por defecto */
  }

  const e = EMPRESA_DOC;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "brand", "roldan-doc-logo.png"));
    logo = await pdf.embedPng(bytes);
  } catch {
    /* sin logo */
  }

  const page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const T = (s: string, x: number, yb: number, size: number, f: PDFFont = font, color = NEGRO) =>
    page.drawText(san(s), { x, y: yb, size, font: f, color });
  const TR = (s: string, xRight: number, yb: number, size: number, f: PDFFont = font, color = NEGRO) =>
    T(s, xRight - f.widthOfTextAtSize(san(s), size), yb, size, f, color);
  const regla = (yy: number, grosor = 0.8, desde = MARGIN, hasta = RIGHT) =>
    page.drawLine({ start: { x: desde, y: yy }, end: { x: hasta, y: yy }, thickness: grosor, color: NEGRO });

  // ── Membrete: logo a la izquierda, datos al lado ──────────────────────────
  const headTop = y;
  let textoX = MARGIN;
  if (logo) {
    const maxW = 86, maxH = 86;
    const escala = Math.min(maxW / logo.width, maxH / logo.height);
    const w = logo.width * escala;
    const h = logo.height * escala;
    page.drawImage(logo, { x: MARGIN, y: headTop - h, width: w, height: h });
    textoX = MARGIN + w + 18;
  }
  let hy = headTop - 12;
  T(e.nombre, textoX, hy, 13, bold); hy -= 16;
  if (e.ruc) { T(`RUC: ${e.ruc}`, textoX, hy, 9.5); hy -= 14; }
  for (const d of e.direccion) { T(`Dirección: ${d}`, textoX, hy, 9.5); hy -= 14; }
  if (e.telefono) { T(`Teléfonos: ${e.telefono}`, textoX, hy, 9.5); hy -= 14; }
  if (e.email) { T(`Email: ${e.email}`, textoX, hy, 9.5); hy -= 14; }

  y = Math.min(headTop - 92, hy) - 10;
  regla(y, 2);
  y -= 18;

  // ── Encabezado del documento ──────────────────────────────────────────────
  T("SEÑORES", MARGIN, y, 10, bold);
  TR(`N°: ${String(p.numero_control ?? "")}`, RIGHT, y, 10, bold);
  y -= 14;
  TR(`Fecha: ${fmtFecha(p.fecha)}`, RIGHT, y, 9, bold);
  y -= 13;

  // El vendedor del presupuesto (script 41) y, si no hay, quien lo emitió.
  const vendedor = String(p.vendedor_nombre ?? p.usuario_nombre ?? "");
  T(String(p.cliente_nombre ?? "-"), MARGIN, y, 11, bold);
  TR(`Vendedor: ${vendedor}`, RIGHT, y, 9, bold);
  y -= 13;
  T("RUC / CI:", MARGIN, y, 9, bold);
  T(String(p.cliente_ruc ?? ""), MARGIN + 72, y, 9);
  TR("Teléfono:", RIGHT, y, 9, bold);
  y -= 13;
  T("Teléfono:", MARGIN, y, 9, bold);
  T(String(p.cliente_telefono ?? ""), MARGIN + 72, y, 9);
  y -= 13;
  T("Email:", MARGIN, y, 9, bold);
  y -= 15;
  T("PRESENTE:", MARGIN, y, 9, bold);
  // Subrayado, como en el modelo.
  page.drawLine({
    start: { x: MARGIN, y: y - 2 },
    end: { x: MARGIN + bold.widthOfTextAtSize("PRESENTE:", 9), y: y - 2 },
    thickness: 0.8,
    color: NEGRO,
  });
  y -= 22;

  // ── Cotización ────────────────────────────────────────────────────────────
  T("COTIZACIÓN DE LO SOLICITADO:", MARGIN, y, 9.5, bold);
  y -= 16;

  T("Item", COL.item, y, 8.5, bold);
  T("Artículo", COL.articulo, y, 8.5, bold);
  TR("Cantidad", COL.cantidadRight, y, 8.5, bold);
  TR("Kilos", COL.kilosRight, y, 8.5, bold);
  TR("Precio Unitario", COL.unitarioRight, y, 8.5, bold);
  TR("Precio Total", COL.totalRight, y, 8.5, bold);
  y -= 4;
  regla(y, 0.8);
  y -= 12;

  const ALTO_FILA = 15;
  items.forEach((it, i) => {
    const lineas = wrap(String(it.producto_nombre ?? ""), font, 8.5, COL.articuloMax);
    T(String(i + 1), COL.item, y, 8.5);
    lineas.forEach((l, k) => T(l, COL.articulo, y - k * 10, 8.5));
    TR(num(it.cantidad, 2), COL.cantidadRight, y, 8.5);
    // Los productos no tienen peso cargado: la columna queda con guion, igual
    // que en el modelo. Si algún día se carga, acá va el kilaje.
    TR("-", COL.kilosRight, y, 8.5, font, GRIS);
    TR(num(it.precio_unitario), COL.unitarioRight, y, 8.5);
    TR(num(it.total), COL.totalRight, y, 8.5);
    y -= ALTO_FILA + (lineas.length - 1) * 10;
  });

  // Renglones vacíos hasta el bloque de totales, como en el documento de
  // siempre: el cliente ve de un vistazo que no falta nada abajo.
  // Medido contra el documento real: con los totales más abajo, las catorce
  // líneas de condiciones no entran y se cortan sin que nadie se entere.
  const Y_TOTALES = 360;
  while (y > Y_TOTALES + ALTO_FILA) {
    TR("-", COL.kilosRight, y, 8.5, font, GRIS);
    y -= ALTO_FILA;
  }
  y = Y_TOTALES;

  // ── Forma de pago y validez (izquierda) ───────────────────────────────────
  const yIzq = y;
  T("FORMA DE PAGO:", MARGIN, yIzq, 9.5, bold);
  const formaPago = formaPagoConAnticipo(plantilla.forma_pago, plantilla.anticipo_pct);
  wrap(formaPago, font, 8.5, 230).forEach((l, k) => T(l, MARGIN + 14, yIzq - 16 - k * 11, 8.5));
  T("VALIDEZ DE LA OFERTA:", MARGIN, yIzq - 56, 9.5, bold);
  wrap(plantilla.validez, font, 8.5, 230).forEach((l, k) => T(l, MARGIN + 14, yIzq - 72 - k * 11, 8.5));

  // ── Totales (derecha) ─────────────────────────────────────────────────────
  const xRotuloDer = 300;
  let ty = yIzq;
  regla(ty + 12, 0.8, xRotuloDer, RIGHT);

  const filaTotal = (rotulo: string, valor: string, negrita = false, tamano = 9) => {
    T(rotulo, xRotuloDer, ty, tamano, negrita ? bold : font, negrita ? NEGRO : GRIS);
    TR(valor, RIGHT, ty, tamano, negrita ? bold : font, negrita ? NEGRO : GRIS);
    ty -= 16;
  };

  const total = Number(p.total) || 0;
  const iva = Number(p.monto_iva) || 0;
  const anticipoPct = plantilla.anticipo_pct;
  const anticipoRequerido = anticipoPct > 0 ? Math.round((total * anticipoPct) / 100) : null;

  // El rótulo lleva "Gs." porque el modelo lo lleva, y porque un número sin
  // moneda en un papel que viaja es una discusión esperando a pasar.
  filaTotal("TOTAL PRESUPUESTO: Gs.", num(total), true, 9.5);
  filaTotal("IVA INCLUIDO (10%):", num(iva));
  filaTotal("TOTAL KILOS:", "-");
  filaTotal(`ANTICIPO REQUERIDO (${num(anticipoPct)}%):`, anticipoRequerido == null ? "-" : num(anticipoRequerido), true);
  filaTotal("ANTICIPO ABONADO:", "-");
  regla(ty + 11, 0.8, xRotuloDer, RIGHT);
  ty -= 2;
  filaTotal("SALDO A PAGAR: Gs.", num(total - (anticipoRequerido ?? 0)), true, 10);
  regla(ty + 11, 1.2, xRotuloDer, RIGHT);

  // ── Observaciones ─────────────────────────────────────────────────────────
  y = Math.min(yIzq - 96, ty) - 14;
  T("OBSERVACIONES / CONDICIONES:", MARGIN, y, 9, bold);
  y -= 13;
  // Si las condiciones no entran, siguen en otra hoja. Cortarlas sería el peor
  // de los finales: el papel que se discute es justamente este.
  let hoja = page;
  const escribirCondicion = (l: string) => {
    if (y < MARGIN + 26) {
      hoja = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      hoja.drawText(san("OBSERVACIONES / CONDICIONES (continuación):"), {
        x: MARGIN, y, size: 9, font: bold, color: NEGRO,
      });
      y -= 16;
    }
    hoja.drawText(san(l), { x: MARGIN + 14, y, size: 7.5, font, color: NEGRO });
    y -= 9.5;
  };
  for (const linea of plantilla.observaciones.split(/\r?\n/)) {
    const texto = linea.trim();
    if (!texto) continue;
    for (const l of wrap(`- ${texto}`, font, 7.5, RIGHT - MARGIN - 14)) escribirCondicion(l);
    y -= 2;
  }

  // ── Pie ───────────────────────────────────────────────────────────────────
  hoja.drawText(san("FECHA PRESUPUESTO:"), { x: MARGIN, y: MARGIN + 4, size: 9, font: bold, color: NEGRO });
  hoja.drawText(san(fmtFecha(p.fecha)), { x: MARGIN + 130, y: MARGIN + 4, size: 9, font: bold, color: NEGRO });

  const bytes = await pdf.save();
  const nombre = `presupuesto-${String(p.numero_control ?? id)}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
