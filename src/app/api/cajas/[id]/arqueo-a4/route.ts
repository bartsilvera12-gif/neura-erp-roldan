import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getResumenCaja, getDetalleCaja } from "@/lib/caja/server";
import { DENOMINACIONES } from "@/lib/caja/denominaciones";
import { EMPRESA_DOC, membreteLinea } from "@/lib/documentos/membrete";

/**
 * GET /api/cajas/[id]/arqueo-a4 — arqueo formal del turno, para imprimir (5.4).
 *
 * "Contar billetes y monedas por denominación; impresión formal en A4,
 * separando ingresos, egresos y resumen."
 *
 * Las tres secciones van separadas a propósito: mezcladas, un cierre es una
 * lista de números que no se puede revisar. Separadas, cada bloque se controla
 * contra su propio respaldo — las ventas contra los comprobantes, los egresos
 * contra sus facturas, y el conteo contra lo que hay en el cajón.
 *
 * ── VISTA PREVIA CON EL TURNO ABIERTO ─────────────────────────────────────
 * La misma hoja sirve para mirar cómo viene el turno antes de cerrarlo, que es
 * cuando sirve de algo: con la caja ya cerrada no se puede corregir nada. Si la
 * caja está abierta, la hoja sale marcada como VISTA PREVIA y cambia en tres
 * cosas, porque los números del cierre todavía no existen:
 *
 *   1. El conteo por denominación sale EN BLANCO, para contar a mano sobre el
 *      papel. Antes caía al arqueo de apertura, que es lo que había en el cajón
 *      al empezar: imprimirlo acá como si fuera el conteo de cierre sería un
 *      conteo inventado.
 *   2. En vez de "Monto Rendido" y "Diferencia" —que salen de contar— van dos
 *      renglones en blanco para completar y restar a mano.
 *   3. Dice "Parcial al <hora>", porque lo que sigue abierto va a cambiar.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

/** Solo la hora, en Paraguay. La columna del detalle no necesita la fecha:
 *  todo el turno es del mismo día y repetirla llenaría la hoja de ruido. */
function horaPy(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCHours())}:${p(py.getUTCMinutes())}:${p(py.getUTCSeconds())}`;
}

/** Fecha y hora de Paraguay (UTC−3), sin depender de la tzdata del servidor. */
function fechaHoraPy(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

/** Una fila de la tabla de totales. */
function fila(label: string, valor: number, clase = ""): string {
  return `<tr class="${clase}"><td>${esc(label)}</td><td class="m">${gs(valor)}</td></tr>`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const { id: cajaId } = await context.params;
    const sp = new URL(request.url).searchParams;

    const resumen = await getResumenCaja(ctx.supabase, empresaId, cajaId, sucursalId);
    if (!resumen) return new NextResponse("Turno de caja no encontrado.", { status: 404 });
    const detalle = await getDetalleCaja(ctx.supabase, empresaId, cajaId, sucursalId);

    const c = resumen.caja;
    const cerrada = c.estado === "cerrada";
    /**
     * Con la caja abierta no hay conteo de cierre. El de apertura NO sirve de
     * reemplazo: es lo que había al empezar el turno, y ponerlo donde va el
     * conteo final daría una diferencia que nadie contó.
     */
    const arqueo = cerrada ? (c.arqueo_cierre_json ?? []) : [];

    // ── Conteo por denominación ───────────────────────────────────────────
    const porValor = new Map<number, number>();
    for (const a of arqueo) porValor.set(Number(a.denominacion), Number(a.cantidad) || 0);
    const filasDenom = (tipo: "billete" | "moneda") =>
      DENOMINACIONES.filter((d) => d.tipo === tipo).map((d) => {
        const cant = porValor.get(d.valor) ?? 0;
        if (!cerrada) {
          // Renglón para completar a mano sobre el papel impreso.
          return `<tr>
            <td class="m">${gs(d.valor)}</td>
            <td class="m llenar"></td>
            <td class="m llenar"></td>
          </tr>`;
        }
        return `<tr${cant === 0 ? ' class="cero"' : ""}>
          <td class="m">${gs(d.valor)}</td>
          <td class="m">${cant || "—"}</td>
          <td class="m b">${cant > 0 ? gs(d.valor * cant) : "—"}</td>
        </tr>`;
      }).join("");
    const totalContado = arqueo.reduce((s, a) => s + (Number(a.valor) || 0), 0);

    // ── Movimientos, separados ────────────────────────────────────────────
    const movs = resumen.movimientos;
    const ingresos = movs.filter((m) => m.tipo === "ingreso");
    const egresos = movs.filter((m) => m.tipo === "egreso" || m.tipo === "retiro");
    const listaMovs = (lista: typeof movs) =>
      lista.length === 0
        ? `<tr><td colspan="3" class="vacio">Sin movimientos.</td></tr>`
        : lista.map((m) => {
            // Qué papel respalda el egreso. Va impreso aunque el archivo esté
            // en el sistema: con la hoja en la mano, el contador tiene que
            // poder ver de un vistazo cuáles tienen respaldo y cuáles le van a
            // faltar, sin abrir la computadora.
            const papeles = (m.adjuntos ?? []).map((a) => a.tipo);
            const marca = papeles.length
              ? ` <span class="papel">[${papeles.map((t) => (t === "factura" ? "factura" : "recibo")).join(" + ")}]</span>`
              : m.tipo === "egreso"
              ? ` <span class="sinpapel">[sin comprobante]</span>`
              : "";
            const clase = m.tipo_egreso ? ` <span class="obs">· ${esc(m.tipo_egreso)}</span>` : "";
            return `<tr>
            <td>${esc(m.concepto)}${clase}${m.observacion ? ` <span class="obs">· ${esc(m.observacion)}</span>` : ""}${marca}</td>
            <td class="med">${esc(m.medio_pago)}</td>
            <td class="m b">${gs(m.monto)}</td>
          </tr>`;
          }).join("");

    // Punto 5.2: el cierre lista TODAS las operaciones del turno, no solo las
    // anuladas. Un cierre sin el detalle obliga a ir a buscar las ventas a otra
    // pantalla para controlar contra los comprobantes en papel, que es
    // justamente lo que se hace con esta hoja en la mano.
    type VentaCierre = {
      numero_control?: string | null; fecha?: string; total?: number;
      estado?: string | null; metodo_pago?: string | null; tipo_venta?: string | null;
      usuario_nombre?: string | null; cliente_nombre?: string | null;
      anulacion_motivo?: string | null;
    };
    const ventasDetalle = (detalle?.ventas ?? []) as VentaCierre[];
    const esAnulada = (v: VentaCierre) => String(v.estado ?? "") === "anulada";
    const anuladas = ventasDetalle.filter(esAnulada);
    const vivas = ventasDetalle.filter((v) => !esAnulada(v));
    const totalVivas = vivas.reduce((s, v) => s + (Number(v.total) || 0), 0);

    const MEDIO: Record<string, string> = {
      efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia",
      cheque: "Cheque", mixto: "Mixto", credito: "Crédito",
    };

    const soloHora = (iso: string | undefined) => {
      if (!iso) return "—";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
    };

    const filaVenta = (v: VentaCierre) => {
      const anulada = esAnulada(v);
      const medio = String(v.metodo_pago ?? "");
      return `<tr class="${anulada ? "anul" : ""}">
        <td class="hora">${soloHora(v.fecha)}</td>
        <td>${esc(v.numero_control ?? "—")}${
          anulada
            ? `<span class="tag-anul">ANULADA</span><div class="motivo">${esc(v.anulacion_motivo ?? "sin motivo registrado")}</div>`
            : ""
        }</td>
        <td>${esc(v.cliente_nombre ?? "Consumidor final")}</td>
        <td>${esc(v.usuario_nombre ?? "—")}</td>
        <td class="med">${esc(MEDIO[medio] ?? medio ?? "—")}</td>
        <td class="m">${gs(Number(v.total) || 0)}</td>
      </tr>`;
    };

    // ── Lo que el formato del cliente muestra y acá no se calculaba ────────
    // Rango de facturas del turno: en la hoja impresa es lo primero que se
    // controla contra el talonario.
    const numeros = ventasDetalle
      .map((v) => String(v.numero_control ?? "").replace(/\D/g, ""))
      .filter(Boolean)
      .sort();
    const facturaDesde = numeros[0] ?? "";
    const facturaHasta = numeros[numeros.length - 1] ?? "";

    const esCredito = (v: VentaCierre) => String(v.tipo_venta ?? "").toUpperCase() === "CREDITO";
    const ventaContado = vivas.filter((v) => !esCredito(v)).reduce((t, v) => t + (Number(v.total) || 0), 0);
    const ventaCredito = vivas.filter(esCredito).reduce((t, v) => t + (Number(v.total) || 0), 0);
    const ventaAnulada = anuladas.reduce((t, v) => t + (Number(v.total) || 0), 0);

    const contado = arqueo.length > 0 ? totalContado : (c.monto_cierre_contado ?? 0);
    const diferencia = Number(c.diferencia ?? 0);

    /** Un renglón de las tres columnas del encabezado. */
    const kv = (rotulo: string, valor: number | string, fuerte = false) => `
      <tr${fuerte ? ' class="fuerte"' : ""}>
        <td>${esc(rotulo)}</td>
        <td class="m${fuerte ? " b" : ""}">${typeof valor === "number" ? gs(valor) : esc(valor)}</td>
      </tr>`;

    /** Una sección del detalle, con su subtotal, como en el formato del cliente. */
    const seccion = (titulo: string, filas: string, rotuloTotal: string, total: number) => `
      <tr class="secc"><td colspan="4">${esc(titulo)}</td></tr>
      ${filas}
      <tr class="subt">
        <td colspan="3" class="m">${esc(rotuloTotal)}</td>
        <td class="m b">${gs(total)}</td>
      </tr>`;

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Cierre de caja ${esc(String(c.numero_caja))} — ${esc(EMPRESA_DOC.nombre)}</title>
<style>
  /* Margen 0: Chrome imprime su encabezado y su pie dentro del margen de
     @page, y sin margen no le queda lugar para dibujarlos. */
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
  .estado { display: inline-block; border: 1px solid #000; padding: 1px 6px; font-size: 10px; font-weight: 700; }

  h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
       margin: 10px 0 4px; padding-bottom: 2px; border-bottom: 1.5px solid #000; }

  table { width: 100%; border-collapse: collapse; }
  th { border: 1px solid #000; padding: 2px 5px; font-size: 10px; text-align: left; font-weight: 700; }
  td { border: 1px solid #000; padding: 2px 5px; font-size: 10px; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .b { font-weight: 700; }
  .cero td { color: #999; }
  .med { width: 80px; text-transform: capitalize; }
  .obs { color: #666; font-style: italic; }
  /* Qué papel respalda cada egreso, para controlar con la hoja en la mano. */
  .papel { color: #2E7D32; font-size: 9px; font-weight: 600; }
  .sinpapel { color: #B45309; font-size: 9px; font-weight: 600; }
  .hora { width: 38px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  /* Una anulada se distingue en gris, con su marca y su motivo. El tachado va
     SOLO en el importe, que es donde significa algo ("no cuenta"): tachar el
     renglón entero deja la hora y el motivo sin poder leerse, porque una
     línea sobre el texto no se puede quitar desde adentro. */
  .anul td { color: #777; }
  .anul .m { text-decoration: line-through; }
  .anul .motivo { font-style: italic; font-size: 9px; color: #666; }
  .tag-anul {
    display: inline-block; border: 1px solid #999; padding: 0 3px;
    font-size: 8px; font-weight: 700; letter-spacing: .04em; margin-left: 4px;
    vertical-align: 1px;
  }
  tfoot td { border-top: 2px solid #000; }
  .vacio { text-align: center; color: #888; padding: 6px; }

  .cols { display: flex; gap: 8mm; }
  .col { flex: 1; }

  .totales td { border: 0; padding: 2px 4px; font-size: 11px; }
  .totales tr.sep td { border-top: 1px solid #999; }
  .totales tr.fuerte td { border-top: 1.5px solid #000; font-weight: 700; font-size: 12px; }
  .totales tr.dif td { font-weight: 700; font-size: 13px; }
  .falta { color: #b00; }
  /* Vista previa: los espacios que se completan a mano sobre el papel. */
  .llenar { border-bottom: 1px solid #bbb; min-width: 46px; }
  .llenar-linea { display: inline-block; width: 90px; border-bottom: 1px solid #555; }
  .aviso-previa { margin: 6px 0 0; padding: 5px 7px; border: 1px solid #d9a441;
    background: #fdf6e7; font-size: 10px; line-height: 1.45; }
  .sobra { color: #060; }

  .firmas { margin-top: 20px; display: flex; gap: 30px; }
  .firma { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 10px; text-align: center; }
  .nota { margin-top: 10px; font-size: 9px; color: #555; line-height: 1.5; }

  /* Formato de la casa: encabezado con la fecha de emisión a la derecha, tres
     columnas de totales y el detalle por tipo con subtotales. */
  .cab { display: flex; justify-content: space-between; align-items: baseline; }
  .cab .momento { font-size: 10px; color: #333; }
  .cab2 { display: flex; gap: 18px; flex-wrap: wrap; font-size: 10px;
          border-bottom: 1.5px solid #000; padding-bottom: 5px; margin: 4px 0 8px; }
  .cols3 { display: flex; gap: 6mm; align-items: flex-start; }
  .col3 { flex: 1; min-width: 0; }
  .col3 h2 { font-size: 10px; border-bottom: 1px solid #000; }
  table.kv { width: 100%; }
  table.kv td { border: 0; padding: 1px 2px; font-size: 10px; }
  table.kv tr.fuerte td { border-top: 1.2px solid #000; font-weight: 700; padding-top: 3px; }
  table.kv tr.hueco td { height: 8px; }
  table.det { margin-top: 10px; }
  table.det th { border: 0; border-bottom: 1.2px solid #000; }
  table.det td { border: 0; padding: 1.5px 4px; }
  table.det tr.secc td { font-weight: 700; padding-top: 6px; border-bottom: .5px solid #bbb; }
  table.det tr.subt td { border-top: .5px solid #999; padding-bottom: 4px; }
  table.det td.ind { padding-left: 14px; }
  .ref { width: 150px; }
  .resumen-t { margin-top: 12px; }
  .resumen { display: flex; gap: 24px; flex-wrap: wrap; font-size: 11px; }
  .obs-linea { margin-top: 14px; border-top: 1px solid #000; padding-top: 3px;
               font-size: 10px; width: 45%; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>

  ${membreteLinea()}
  <div class="cab">
    <h1>${cerrada ? "Cierre de Caja" : "Cierre de Caja — VISTA PREVIA"}</h1>
    <div class="momento">${cerrada ? "" : "Parcial al "}${esc(fechaHoraPy(new Date().toISOString()))}</div>
  </div>
  <div class="cab2">
    <div><b>Responsable:</b> ${esc(String(c.numero_caja))} - ${esc(
      (detalle?.caja as { cerrada_por_nombre?: string | null; abierta_por_nombre?: string | null } | undefined)
        ?.cerrada_por_nombre
      ?? (detalle?.caja as { abierta_por_nombre?: string | null } | undefined)?.abierta_por_nombre
      ?? ""
    )}</div>
    <div><b>Apertura:</b> ${esc(fechaHoraPy(c.fecha_apertura))}</div>
    <div><b>Cierre:</b> ${esc(fechaHoraPy(c.fecha_cierre))} ${cerrada ? "" : "(abierta)"}</div>
  </div>

  <!-- Las tres columnas del formato de la casa: de dónde salió la plata, qué
       se contó, y cómo se repartió la venta. -->
  <div class="cols3">
    <div class="col3">
      <h2>Datos Principales</h2>
      <table class="kv">
        ${kv("Apertura:", c.monto_apertura)}
        ${kv("Venta:", ventaContado)}
        ${kv("Cobranza:", 0)}
        ${kv("Egreso:", -resumen.egresos_efectivo)}
        ${kv("Retiro p/ Deposito:", -resumen.retiros_efectivo)}
        ${kv("Ant. de Facturación:", resumen.anticipos_efectivo ?? 0)}
        ${kv("Otra Ent.:", 0)}
        ${kv("Ant. Utilizado:", 0)}
        ${kv("Dif. Caja Ant.:", resumen.diferencia_arrastrada)}
        ${kv("Total", resumen.efectivo_esperado, true)}
      </table>
    </div>
    <div class="col3">
      <h2>Arqueo de Efectivo, Cheque, Tarjeta</h2>
      <table class="kv">
        ${kv("Efectivo", contado)}
        ${kv("Cheque:", resumen.total_cheque)}
        ${kv("Tarjeta:", resumen.total_tarjeta)}
        ${kv("Deposito Bancario:", resumen.total_transferencia)}
        ${kv("Nota Crédito:", 0)}
        <tr class="hueco"><td colspan="2"></td></tr>
        ${kv("Inicio Nro de Factura:", facturaDesde || "-")}
        ${kv("Fin Nro de Factura:", facturaHasta || "-")}
        ${kv("Total", contado + resumen.total_cheque + resumen.total_tarjeta + resumen.total_transferencia, true)}
      </table>
    </div>
    <div class="col3">
      <h2>Desglose de la Venta</h2>
      <table class="kv">
        ${kv("Venta Contado:", ventaContado)}
        ${kv("Venta Crédito:", ventaCredito)}
        ${kv("Venta Anulada:", ventaAnulada)}
        ${kv("Total Venta:", ventaContado + ventaCredito, true)}
        ${kv("Efectivo:", resumen.total_efectivo)}
        ${kv("Cheque:", resumen.total_cheque)}
        ${kv("Tarjeta:", resumen.total_tarjeta)}
        ${kv("D. Banc:", resumen.total_transferencia)}
        ${kv("N. Cred.:", 0)}
        ${kv("Ant. Usado:", 0)}
      </table>
    </div>
  </div>

  <!-- El detalle, por tipo y con su subtotal: es el orden en el que se
       controla la hoja contra los comprobantes en papel. -->
  <table class="det">
    <thead>
      <tr>
        <th>Tipo / Descripción</th>
        <th class="ref">Sim/Nº de Cheque</th>
        <th class="hora">Hora</th>
        <th class="m">Monto</th>
      </tr>
    </thead>
    <tbody>
      ${seccion(
        "Arqueo de Efectivo",
        DENOMINACIONES.map((d) => {
          const cant = porValor.get(d.valor) ?? 0;
          return `<tr${cant === 0 ? ' class="cero"' : ""}>
            <td class="ind">de ${gs(d.valor)} — ${cant} unid</td>
            <td></td><td></td>
            <td class="m">${gs(d.valor * cant)}</td>
          </tr>`;
        }).join(""),
        "Total Arqueo de Efectivo",
        contado
      )}
      ${seccion(
        "Egreso",
        egresos.filter((m) => m.tipo === "egreso").map((m) => `<tr>
          <td class="ind">${esc(m.concepto)}${m.observacion ? ` <span class="obs">· ${esc(m.observacion)}</span>` : ""}</td>
          <td class="ref">${(m.adjuntos ?? []).length ? "con comprobante" : "<span class=\"sinpapel\">sin comprobante</span>"}</td>
          <td class="hora">${esc(horaPy(m.created_at))}</td>
          <td class="m">${gs(m.monto)}</td>
        </tr>`).join("") || '<tr><td colspan="4" class="vacio">Sin egresos.</td></tr>',
        "Total Egreso",
        resumen.egresos_efectivo
      )}
      ${seccion(
        "Retiro p/ Deposito",
        egresos.filter((m) => m.tipo === "retiro").map((m) => `<tr>
          <td class="ind">${esc(m.concepto)}</td>
          <td></td>
          <td class="hora">${esc(horaPy(m.created_at))}</td>
          <td class="m">${gs(m.monto)}</td>
        </tr>`).join("") || '<tr><td colspan="4" class="vacio">Sin retiros.</td></tr>',
        "Total Deposito",
        resumen.retiros_efectivo
      )}
      ${seccion(
        "Otra Entrada",
        ingresos.map((m) => `<tr>
          <td class="ind">${esc(m.concepto)}</td>
          <td class="ref">${esc(m.medio_pago)}</td>
          <td class="hora">${esc(horaPy(m.created_at))}</td>
          <td class="m">${gs(m.monto)}</td>
        </tr>`).join("") || '<tr><td colspan="4" class="vacio">Sin otras entradas.</td></tr>',
        "T. O. Entrada",
        resumen.ingresos_efectivo
      )}
    </tbody>
  </table>

  <h2 class="resumen-t">Resumen</h2>
  <div class="resumen">
    <span><b>Monto a Rendir:</b> ${gs(resumen.efectivo_esperado)}</span>
    ${cerrada
      ? `<span><b>Monto Rendido:</b> ${gs(contado)}</span>
         <span class="${diferencia < 0 ? "falta" : diferencia > 0 ? "sobra" : ""}">
           <b>Diferencia:</b> ${diferencia > 0 ? "+" : ""}${gs(diferencia)}${diferencia < 0 ? " (faltante)" : diferencia > 0 ? " (sobrante)" : ""}
         </span>`
      : `<span><b>Monto Rendido:</b> <span class="llenar-linea"></span></span>
         <span><b>Diferencia:</b> <span class="llenar-linea"></span></span>`}
  </div>
  ${cerrada ? "" : `<p class="aviso-previa">
    <b>Esto es una vista previa:</b> el turno sigue abierto y los números van a
    cambiar con cada venta, cobro o egreso que entre de acá en adelante. El
    conteo de billetes y el monto rendido están en blanco a propósito, para
    contar a mano. El cierre definitivo se imprime después de cerrar la caja.
  </p>`}

  ${c.observacion_cierre ? `<p class="nota"><b>Observación:</b> ${esc(c.observacion_cierre)}</p>` : ""}

  <div class="firmas">
    <div class="firma">Recibo por</div>
    <div class="firma">Responsable</div>
  </div>
  <div class="obs-linea">Observación</div>

  ${anuladas.length > 0 ? `<p class="nota">
    ${anuladas.length} comprobante(s) anulado(s) por ${gs(ventaAnulada)}: no suman en la venta
    porque esa plata no entró, pero se declaran porque el comprobante existió.
  </p>` : ""}

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
    console.error("[/api/cajas/[id]/arqueo-a4]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el arqueo.", { status: 500 });
  }
}
