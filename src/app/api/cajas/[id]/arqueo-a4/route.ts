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
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

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
    const arqueo = c.arqueo_cierre_json ?? c.arqueo_apertura_json ?? [];
    const cerrada = c.estado === "cerrada";

    // ── Conteo por denominación ───────────────────────────────────────────
    const porValor = new Map<number, number>();
    for (const a of arqueo) porValor.set(Number(a.denominacion), Number(a.cantidad) || 0);
    const filasDenom = (tipo: "billete" | "moneda") =>
      DENOMINACIONES.filter((d) => d.tipo === tipo).map((d) => {
        const cant = porValor.get(d.valor) ?? 0;
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
      estado?: string | null; metodo_pago?: string | null;
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

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Arqueo de caja ${esc(String(c.numero_caja))} — ${esc(EMPRESA_DOC.nombre)}</title>
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
  .sobra { color: #060; }

  .firmas { margin-top: 20px; display: flex; gap: 30px; }
  .firma { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 10px; text-align: center; }
  .nota { margin-top: 10px; font-size: 9px; color: #555; line-height: 1.5; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>

  ${membreteLinea()}
  <h1>Arqueo de caja ${esc(String(c.numero_caja))}</h1>
  <div class="sub">
    <div class="meta">
      <div><b>Apertura:</b> ${esc(fechaHoraPy(c.fecha_apertura))}${
        detalle?.caja ? ` · ${esc((detalle.caja as { abierta_por_nombre?: string | null }).abierta_por_nombre ?? "")}` : ""
      }</div>
      <div><b>Cierre:</b> ${esc(fechaHoraPy(c.fecha_cierre))}${
        detalle?.caja ? ` · ${esc((detalle.caja as { cerrada_por_nombre?: string | null }).cerrada_por_nombre ?? "")}` : ""
      }</div>
    </div>
    <div class="estado">${cerrada ? "CERRADA" : "ABIERTA"}</div>
  </div>

  <h2>1 · Ingresos</h2>
  <div class="cols">
    <div class="col">
      <table class="totales">
        <tbody>
          ${fila("Fondo de apertura", c.monto_apertura)}
          ${fila("Ventas al contado", resumen.total_contado)}
          ${fila("  · en efectivo", resumen.total_efectivo)}
          ${fila("  · con tarjeta", resumen.total_tarjeta)}
          ${fila("  · por transferencia", resumen.total_transferencia)}
          ${fila("  · con cheque", resumen.total_cheque)}
          ${fila("Ventas a crédito", resumen.total_credito, "sep")}
          ${fila("Anticipos de clientes", resumen.total_anticipos)}
          ${fila("Otros ingresos", resumen.ingresos_efectivo)}
        </tbody>
      </table>
    </div>
    <div class="col">
      <table>
        <thead><tr><th>Concepto</th><th class="med">Medio</th><th class="m">Monto</th></tr></thead>
        <tbody>${listaMovs(ingresos)}</tbody>
      </table>
    </div>
  </div>

  <h2>2 · Egresos y retiros</h2>
  <table>
    <thead><tr><th>Concepto</th><th class="med">Medio</th><th class="m">Monto</th></tr></thead>
    <tbody>${listaMovs(egresos)}</tbody>
  </table>
  <table class="totales" style="width:50%;margin-left:auto">
    <tbody>
      ${fila("Egresos", resumen.egresos_efectivo)}
      ${fila("Retiros de efectivo", resumen.retiros_efectivo)}
      ${fila("Total salidas", resumen.egresos_efectivo + resumen.retiros_efectivo, "fuerte")}
    </tbody>
  </table>

  <h2>3 · Conteo del efectivo</h2>
  <div class="cols">
    <div class="col">
      <table>
        <thead><tr><th colspan="3">Billetes</th></tr>
          <tr><th class="m">Denominación</th><th class="m">Cantidad</th><th class="m">Subtotal</th></tr></thead>
        <tbody>${filasDenom("billete")}</tbody>
      </table>
    </div>
    <div class="col">
      <table>
        <thead><tr><th colspan="3">Monedas</th></tr>
          <tr><th class="m">Denominación</th><th class="m">Cantidad</th><th class="m">Subtotal</th></tr></thead>
        <tbody>${filasDenom("moneda")}</tbody>
      </table>
    </div>
  </div>

  <h2>4 · Resumen</h2>
  <table class="totales" style="width:62%;margin-left:auto">
    <tbody>
      ${fila("Efectivo esperado en el cajón", resumen.efectivo_esperado)}
      ${fila("Efectivo contado", arqueo.length > 0 ? totalContado : (c.monto_cierre_contado ?? 0))}
      ${resumen.diferencia_arrastrada !== 0
        ? fila("Diferencia que venía del turno anterior", resumen.diferencia_arrastrada, "sep")
        : ""}
      <tr class="dif">
        <td>Diferencia de este turno</td>
        <td class="m ${(c.diferencia ?? 0) < 0 ? "falta" : (c.diferencia ?? 0) > 0 ? "sobra" : ""}">
          ${(c.diferencia ?? 0) > 0 ? "+" : ""}${gs(c.diferencia ?? 0)}
          ${(c.diferencia ?? 0) < 0 ? " (faltante)" : (c.diferencia ?? 0) > 0 ? " (sobrante)" : ""}
        </td>
      </tr>
      ${fila("Dinero a rendir", resumen.dinero_a_rendir, "fuerte")}
    </tbody>
  </table>

  <h2>5 · Detalle de operaciones</h2>
  <table>
    <thead>
      <tr>
        <th class="hora">Hora</th>
        <th>Comprobante</th>
        <th>Cliente</th>
        <th>Vendedor</th>
        <th class="med">Medio</th>
        <th class="m">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${ventasDetalle.length === 0
        ? '<tr><td colspan="6" class="vacio">No hubo ventas en este turno.</td></tr>'
        : ventasDetalle.map(filaVenta).join("")}
    </tbody>
    ${ventasDetalle.length > 0 ? `<tfoot>
      <tr class="b">
        <td colspan="5">${vivas.length} operación(es) válida(s)${anuladas.length ? ` · ${anuladas.length} anulada(s)` : ""}</td>
        <td class="m">${gs(totalVivas)}</td>
      </tr>
    </tfoot>` : ""}
  </table>
  ${anuladas.length > 0 ? `<p class="nota">
    Las anuladas figuran en gris, con su motivo, y su importe no suma en el
    total: esa plata no entró. Se listan igual porque el comprobante existió y
    alguien lo anuló.
  </p>` : ""}

  ${c.observacion_cierre ? `<p class="nota"><b>Observación del cierre:</b> ${esc(c.observacion_cierre)}</p>` : ""}

  <div class="firmas">
    <div class="firma">Cajero</div>
    <div class="firma">Controló</div>
    <div class="firma">Fecha y hora</div>
  </div>

  <p class="nota">
    El <b>dinero a rendir</b> es el efectivo esperado menos el fondo de apertura: el fondo no se
    entrega, queda para el turno siguiente. Las ventas a crédito figuran como facturación pero
    no entran al cajón. Los cheques y las ventas con tarjeta o transferencia tampoco suman al
    efectivo contado.
  </p>

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
