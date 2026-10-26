import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { informeComisiones } from "@/lib/comisiones/server/comisiones-pg";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * GET /api/comisiones/hoja — hoja de ventas del vendedor, para firmar (4.2).
 *
 * "Generar una hoja imprimible con todas las ventas del vendedor y espacio
 * para firma."
 *
 * Para qué sirve: el vendedor firma conforme con lo que se le liquida. Sin
 * eso, una discusión a fin de mes se resuelve de memoria.
 *
 * Por eso la hoja imprime el detalle venta por venta y no solo el total: una
 * firma sobre un número suelto no prueba sobre qué se estuvo de acuerdo.
 *
 * Parámetros: vendedor (obligatorio), desde, hasta.
 */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

/** Fecha en hora de Paraguay (UTC−3), sin depender de la tzdata del servidor. */
function fechaPy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()}`;
}

function ahoraPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return new NextResponse("Solo un administrador puede emitir la hoja de comisiones.", { status: 403 });
    }

    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const vendedorId = (sp.get("vendedor") ?? "").trim();
    if (!vendedorId) return new NextResponse("Falta el vendedor.", { status: 400 });
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const informe = await informeComisiones(schema, empresaId, sucursalId, {
      desde, hasta, vendedorId, categoriaId: null,
    });

    const vd = informe.vendedores[0];
    const nombre = vd?.vendedor_nombre ?? "Vendedor";
    const periodo = desde && hasta
      ? `${fechaPy(`${desde}T12:00:00Z`)} al ${fechaPy(`${hasta}T12:00:00Z`)}`
      : desde ? `desde el ${fechaPy(`${desde}T12:00:00Z`)}`
      : hasta ? `hasta el ${fechaPy(`${hasta}T12:00:00Z`)}`
      : "todo el historial";

    const filas = informe.ventas.map((v) => `
      <tr>
        <td class="n">${esc(v.numero_control)}</td>
        <td class="f">${esc(fechaPy(v.fecha))}</td>
        <td>${esc(v.cliente_nombre ?? "Consumidor final")}</td>
        <td class="m">${gs(v.facturado)}</td>
        <td class="m">${v.descuento > 0 ? gs(v.descuento) : "—"}</td>
        <td class="m">${gs(v.ganancia)}</td>
        <td class="m b">${gs(v.comision)}</td>
      </tr>`).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Comisiones — ${esc(nombre)}</title>
<style>
  /* Margen 0: Chrome imprime su encabezado y su pie dentro del margen de
     @page, y sin margen no le queda lugar. El aire lo ponen el padding del
     body y las filas espaciadoras de thead/tfoot, que se repiten por hoja. */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 0 10mm 10mm; font-size: 11px; }

  .print-btn { position: fixed; top: 12px; right: 12px; z-index: 10; background: #4FAEB2;
    color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px;
    font-weight: 600; cursor: pointer; }
  @media print { .print-btn { display: none; } }

  .encabezado { padding-top: 10mm; }
  .empresa { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: #444; }
  h1 { font-size: 18px; margin: 0 0 2px; font-weight: 700; }
  .sub { display: flex; justify-content: space-between; align-items: flex-end; }
  .meta { font-size: 11px; line-height: 1.6; }
  .fecha { font-size: 11px; white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }
  tr.aire td { border: 0; padding: 0; height: 7mm; }
  thead tr.aire td { height: 9mm; }

  th { border: 1px solid #000; padding: 3px 5px; font-size: 10.5px; text-align: left; font-weight: 700; }
  td { border: 1px solid #000; padding: 3px 5px; font-size: 10px; }
  .n { width: 78px; font-family: "Courier New", monospace; font-size: 9.5px; }
  .f { width: 62px; white-space: nowrap; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .b { font-weight: 700; }
  tbody tr { height: 18px; }

  .totales { margin-top: 10px; width: 62%; margin-left: auto; }
  .totales td { border: 0; padding: 2px 5px; font-size: 11px; }
  .totales tr.destacada td { border-top: 1.5px solid #000; font-weight: 700; font-size: 12px; padding-top: 4px; }

  .conforme { margin-top: 16px; font-size: 10px; line-height: 1.5; }
  .firmas { margin-top: 26px; display: flex; gap: 40px; }
  .firma { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 10px; text-align: center; }
  .nota { margin-top: 12px; font-size: 9.5px; color: #555; line-height: 1.5; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>

  <div class="encabezado">
    <div class="empresa">${esc(EMPRESA_DOC.nombre)}</div>
    <h1>Liquidación de comisiones</h1>
    <div class="sub">
      <div class="meta">
        <div><b>Vendedor:</b> ${esc(nombre)}${vd?.tipo_vendedor ? ` · ${esc(vd.tipo_vendedor)}` : ""}</div>
        <div><b>Período:</b> ${esc(periodo)}</div>
      </div>
      <div class="fecha">Emitida el ${esc(ahoraPy())}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr class="aire"><td colspan="7"></td></tr>
      <tr>
        <th>Comprobante</th>
        <th>Fecha</th>
        <th>Cliente</th>
        <th class="m">Vendido</th>
        <th class="m">Descuento</th>
        <th class="m">Ganancia</th>
        <th class="m">Comisión</th>
      </tr>
    </thead>
    <tfoot><tr class="aire"><td colspan="7"></td></tr></tfoot>
    <tbody>
      ${filas || `<tr><td colspan="7" style="text-align:center;padding:16px">Sin ventas en el período.</td></tr>`}
    </tbody>
  </table>

  <table class="totales">
    <tbody>
      <tr><td>Operaciones</td><td class="m">${informe.totales.operaciones}</td></tr>
      <tr><td>Vendido (sin IVA)</td><td class="m">${gs(informe.totales.facturado)}</td></tr>
      <tr><td>Descuentos otorgados</td><td class="m">${gs(informe.totales.descuento)}</td></tr>
      <tr><td>Ganancia generada</td><td class="m">${gs(informe.totales.ganancia)}</td></tr>
      <tr class="destacada"><td>TOTAL A LIQUIDAR</td><td class="m">Gs. ${gs(informe.totales.comision)}</td></tr>
    </tbody>
  </table>

  <p class="conforme">
    Declaro estar conforme con el detalle de ventas y el importe de comisiones liquidado
    en la presente hoja, correspondiente al período indicado.
  </p>

  <div class="firmas">
    <div class="firma">Firma del vendedor</div>
    <div class="firma">Aclaración y C.I.</div>
    <div class="firma">Por la empresa</div>
  </div>

  <p class="nota">
    La comisión se calcula ${informe.base_calculo === "margen"
      ? "sobre la ganancia de cada venta (precio sin IVA menos costo), así que un descuento la reduce en la misma proporción en que reduce la rentabilidad"
      : "sobre el importe vendido sin IVA"}.
    Las ventas anuladas no se incluyen. Los importes son sin IVA.
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
    console.error("[/api/comisiones/hoja]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar la hoja de comisiones.", { status: 500 });
  }
}
