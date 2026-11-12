import { NextRequest, NextResponse } from "next/server";
import { resolverCtx } from "../../_ctx";
import { getTransferenciaDetalle } from "@/lib/transferencias/server/transferencias-queries";
import { membreteA4, EMPRESA_DOC } from "@/lib/documentos/membrete";
import { hojaSobria } from "@/lib/documentos/hoja-sobria";

export const dynamic = "force-dynamic";

/**
 * GET /api/transferencias/[id]/remision — nota de remisión de una
 * transferencia entre sucursales, para imprimir y que viaje con la
 * mercadería. Es lo que se muestra si para el camión un control en la ruta.
 *
 * Documento interno, no fiscal. Dos copias por hoja: una queda en la sucursal
 * que despacha y la otra la firma quien recibe.
 */

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fecha(v: unknown): string {
  const s = String(v ?? "");
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const py = new Date(d.getTime() - 3 * 3_600_000);
  return `${String(py.getUTCDate()).padStart(2, "0")}/${String(py.getUTCMonth() + 1).padStart(2, "0")}/${py.getUTCFullYear()}`;
}
const num = (n: unknown) => (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const r = await resolverCtx(request);
  if (!r.ok) return new NextResponse("No autorizado", { status: 401 });
  const { id } = await ctxParams.params;
  const det = await getTransferenciaDetalle({
    schemaRaw: r.ctx.schema,
    empresaId: r.ctx.empresaId,
    sucursalId: r.ctx.sucursalId,
    transferenciaId: id,
  });
  if (!det) return new NextResponse("Transferencia no encontrada", { status: 404 });

  const cab = det.cabecera as unknown as Record<string, unknown>;
  const items = det.items as unknown as Array<Record<string, unknown>>;
  const despachada = !!cab.despachada_at;
  // Lo que viaja: lo despachado; si todavía no se despachó, lo aprobado o lo
  // pedido, y la hoja lo aclara.
  const cant = (it: Record<string, unknown>) =>
    despachada ? Number(it.cantidad_despachada) || 0
      : Number(it.cantidad_aprobada) || Number(it.cantidad_solicitada) || 0;
  const filas = items.filter((it) => cant(it) > 0);
  const totalUnidades = filas.reduce((s, it) => s + cant(it), 0);
  const numero = String(cab.numero_remision ?? "") || String(cab.numero ?? "");

  const copia = (tag: string) => `
  <section class="copia">
    ${membreteA4("", { linea: "1px solid #D4D4D8", compacto: true })}
    <div class="titulo">
      <div>
        <h1>Nota de remisión</h1>
        <p class="periodo">Transferencia entre sucursales · N° ${esc(numero)}${despachada ? "" : " · BORRADOR: todavía no se despachó"}</p>
      </div>
      <span class="copia-tag">${tag}</span>
    </div>

    <div class="datos">
      <div><span class="lbl">Sale de</span><span class="val fuerte">${esc(cab.sucursal_origen_nombre)}</span></div>
      <div><span class="lbl">Va a</span><span class="val fuerte">${esc(cab.sucursal_destino_nombre)}</span></div>
      <div><span class="lbl">Fecha</span><span class="val">${fecha(cab.despachada_at ?? cab.aprobada_at ?? cab.solicitada_at)}</span></div>
      <div><span class="lbl">Transferencia</span><span class="val">${esc(cab.numero)}</span></div>
      <div><span class="lbl">Despachó</span><span class="val">${esc(cab.despachada_por_nombre) || "—"}</span></div>
      <div><span class="lbl">Pidió</span><span class="val">${esc(cab.solicitada_por_nombre) || "—"}</span></div>
    </div>

    <table class="items">
      <thead><tr><th>Código</th><th>Producto</th><th>Unidad</th><th class="num">Cantidad</th></tr></thead>
      <tbody>
        ${filas.map((it) => `<tr><td class="cod">${esc(it.sku)}</td><td>${esc(it.nombre)}</td><td>${esc(it.unidad)}</td><td class="num">${num(cant(it))}</td></tr>`).join("")}
      </tbody>
      <tfoot><tr><td colspan="3">${filas.length} ${filas.length === 1 ? "artículo" : "artículos"}</td><td class="num">${num(totalUnidades)}</td></tr></tfoot>
    </table>

    ${cab.observacion_solicitud ? `<p class="obs"><span class="lbl">Observación</span> ${esc(cab.observacion_solicitud)}</p>` : ""}

    <div class="transporte">
      <span>Chofer: ______________________________</span>
      <span>C.I.: ________________</span>
      <span>Vehículo / chapa: ________________</span>
    </div>

    <div class="firmas">
      <div class="firma">Entregó · ${esc(cab.sucursal_origen_nombre)}</div>
      <div class="firma">Recibió · ${esc(cab.sucursal_destino_nombre)}<span>Aclaración y fecha</span></div>
    </div>
  </section>`;

  const html = hojaSobria({
    titulo: `Remisión ${esc(numero)} · ${esc(EMPRESA_DOC.nombre)}`,
    cuerpo: `${copia("Copia origen")}${copia("Copia destino")}`,
    css: `
  table.items { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
  table.items th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; color: #71717A; border-bottom: 1px solid #18181B; padding: 4px 4px; }
  table.items td { padding: 3px 4px; border-bottom: 1px solid #F4F4F5; }
  table.items .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.items .cod { font-family: ui-monospace, monospace; font-size: 9px; color: #52525B; }
  table.items tfoot td { font-weight: 700; border-top: 1px solid #18181B; border-bottom: none; padding-top: 5px; }
  .transporte { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 12px; font-size: 9.5px; color: #3F3F46; }
`,
  });
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
