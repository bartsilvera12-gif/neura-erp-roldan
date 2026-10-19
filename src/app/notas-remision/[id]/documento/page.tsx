"use client";

import { use, useEffect, useState } from "react";
import { fetchNR, type NotaRemision } from "@/lib/multideposito/client";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

function fmt(n: number) {
  return n.toLocaleString("es-PY");
}
function fmtFecha(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return String(iso);
  }
}
function fmtFechaHora(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${fmtFecha(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return String(iso);
  }
}

export default function DocumentoNRPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [nr, setNr] = useState<NotaRemision | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCargando(true);
      const r = await fetchNR(id);
      if (!r.ok) {
        setError(r.error);
        setCargando(false);
        return;
      }
      setNr(r.data.nota_remision);
      setCargando(false);
    })();
  }, [id]);

  if (cargando) return <div className="p-8 text-sm text-slate-500">Cargando…</div>;
  if (error) return <div className="p-8 text-sm text-rose-700">{error}</div>;
  if (!nr) return <div className="p-8 text-sm text-slate-500">NR no encontrada.</div>;

  const total = (nr.items ?? []).reduce((s, i) => s + i.cantidad, 0);
  const origenNombre = nr.origen?.nombre ?? "";
  const destinoNombre = nr.destino?.nombre ?? "";

  return (
    <>
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
        }
        .doc-a4 {
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #1f2937;
          font-feature-settings: "tnum";
        }
        .doc-a4 h1, .doc-a4 h2, .doc-a4 h3 { font-family: inherit; }
      `}</style>

      <div className="doc-a4 mx-auto p-6 print:p-0" style={{ maxWidth: "210mm" }}>
        <div className="no-print mb-4 flex items-center justify-between">
          <a href="/notas-remision" className="text-sm text-slate-600 hover:underline">← Volver al historial</a>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            Imprimir
          </button>
        </div>

        <div
          className="bg-white ring-1 ring-slate-200 rounded-md p-10 print:ring-0 print:rounded-none print:p-0 print:shadow-none"
          style={{ minHeight: "270mm" }}
        >
          {/* Encabezado: logo + datos empresa | título doc + número */}
          <div className="flex items-start justify-between gap-8">
            <div className="flex items-start gap-4 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={EMPRESA_DOC.logoUrl}
                alt={EMPRESA_DOC.nombre}
                style={{ maxWidth: "150px", maxHeight: "80px", width: "auto", height: "auto", objectFit: "contain" }}
              />
              <div className="min-w-0">
                <p className="text-[15px] font-extrabold tracking-tight text-slate-900 leading-tight">
                  {EMPRESA_DOC.nombre}
                </p>
                {EMPRESA_DOC.direccion.length > 0 && (
                  <p className="text-[11px] text-slate-600 leading-snug">{EMPRESA_DOC.direccion.join(" · ")}</p>
                )}
                <p className="text-[11px] text-slate-600 leading-snug">
                  {EMPRESA_DOC.telefono && <><strong>Tel:</strong> {EMPRESA_DOC.telefono}</>}
                  {EMPRESA_DOC.telefono && EMPRESA_DOC.email && <span className="mx-1">·</span>}
                  {EMPRESA_DOC.email && <><strong>Email:</strong> {EMPRESA_DOC.email}</>}
                </p>
              </div>
            </div>

            <div className="shrink-0 rounded-md border border-slate-300 px-4 py-3 text-right">
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Documento no fiscal</p>
              <h1 className="mt-1 text-[15px] font-bold uppercase tracking-wide text-slate-900">Nota de Remisión</h1>
              <p className="mt-2 font-mono text-[18px] font-bold text-slate-900">{nr.numero}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                Estado: <strong className="uppercase text-slate-700">{nr.estado}</strong>
              </p>
            </div>
          </div>

          <div className="my-5 h-px bg-slate-300" />

          {/* Datos generales */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
            <Field label="Fecha de emisión" value={fmtFechaHora(nr.fecha)} />
            <Field label="Emisor / remitente" value={nr.emisor} />
            <Field label="Motivo (resumen)" value={nr.motivo} />
            <Field label="Fecha de inicio del traslado" value={fmtFecha(nr.fecha_inicio_traslado)} />
            <Field label="Fecha de término del traslado" value={fmtFecha(nr.fecha_fin_traslado)} />
            <Field label="Kilómetros estimados de recorrido" value="—" />
          </div>

          {/* Punto de partida / llegada */}
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className="rounded-md border border-slate-300 px-4 py-3">
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Punto de partida</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-900">{origenNombre || "—"}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Dirección: —</p>
            </div>
            <div className="rounded-md border border-slate-300 px-4 py-3">
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Punto de llegada</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-900">{destinoNombre || "—"}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Dirección: —</p>
            </div>
          </div>

          {/* Motivo del traslado — checkboxes estilo SIFEN */}
          <div className="mt-5 rounded-md border border-slate-300 px-4 py-3">
            <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500 mb-2">Motivo del traslado (marque una sola opción)</p>
            <MotivoChecks motivo={nr.motivo} />
          </div>

          {/* Transporte */}
          <div className="mt-5 rounded-md border border-slate-300 px-4 py-3">
            <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500 mb-2">Datos del transporte</p>
            <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
              <Field label="Marca del vehículo" value="—" />
              <Field label="Número de chapa" value={nr.chapa ?? "—"} />
              <Field label="Comprobante de venta relacionado" value="—" />
              <Field label="Transportista (razón social)" value={nr.transportista ?? "—"} />
              <Field label="RUC / CI del transportista" value={nr.ruc_transportista ?? "—"} />
              <Field label="Dirección del transportista" value="—" />
              <Field label="Conductor" value={nr.conductor ?? "—"} />
              <Field label="CI del conductor" value={nr.ci_conductor ?? "—"} />
              <Field label="Dirección del conductor" value="—" />
            </div>
          </div>

          {/* Ítems */}
          <div className="mt-6">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-y-2 border-slate-800 text-slate-800">
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Código</th>
                  <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">Cantidad</th>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Detalle de mercadería</th>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Lote</th>
                </tr>
              </thead>
              <tbody>
                {(nr.items ?? []).map((it, idx) => (
                  <tr key={it.producto_id} className={idx % 2 === 1 ? "bg-slate-50" : ""}>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600">{it.producto_sku ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{fmt(it.cantidad)}</td>
                    <td className="px-2 py-1.5 text-slate-800">{it.producto_nombre ?? it.producto_id}</td>
                    <td className="px-2 py-1.5 text-slate-500">—</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-800">
                  <td className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
                    Total
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-[13px] font-bold text-slate-900">{fmt(total)}</td>
                  <td className="px-2 py-2 text-[10px] text-slate-500" colSpan={2}>unidades</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Observaciones */}
          {nr.observaciones?.trim() && (
            <div className="mt-5 rounded-md border border-slate-300 px-4 py-3">
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Observaciones</p>
              <p className="mt-1 text-[12px] text-slate-800 whitespace-pre-wrap">{nr.observaciones}</p>
            </div>
          )}

          {/* Estado de recepción */}
          {nr.estado === "aprobada" && (
            <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 text-[11px] text-slate-700">
              Recepción confirmada por <strong>{nr.aprobada_por}</strong> el {fmtFechaHora(nr.aprobada_at)}.
            </div>
          )}
          {nr.estado === "rechazada" && (
            <div className="mt-4 rounded-md border border-slate-400 bg-slate-100 px-4 py-2 text-[11px] text-slate-700">
              Rechazada. Motivo: {nr.motivo_rechazo}
            </div>
          )}

          {/* Firmas — 3 columnas estilo SIFEN: Firma, Aclaración, Fecha */}
          <div className="mt-14 grid grid-cols-3 gap-8 text-[11px]">
            <div className="border-t border-slate-800 pt-1 text-center">
              <p className="uppercase tracking-wider text-slate-600">Firma</p>
            </div>
            <div className="border-t border-slate-800 pt-1 text-center">
              <p className="uppercase tracking-wider text-slate-600">Aclaración de firma</p>
            </div>
            <div className="border-t border-slate-800 pt-1 text-center">
              <p className="uppercase tracking-wider text-slate-600">Fecha</p>
            </div>
          </div>

          {/* Pie: destino de las copias + leyenda */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-[9px] text-slate-500">
            <span>
              <strong>Original:</strong> Destinatario · <strong>Duplicado:</strong> Remitente ·{" "}
              <strong>Triplicado:</strong> Administración Tributaria · <strong>Cuadruplicado:</strong> Transportista
            </span>
            <span>Página 1 de 1</span>
          </div>
          <div className="mt-2 text-center text-[9px] text-slate-400">
            Documento no fiscal · válido únicamente como constancia interna de traslado de mercadería.
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[12px] font-medium text-slate-800">{value?.toString().trim() || "—"}</p>
    </div>
  );
}

/** Grilla de checkboxes con los 13 motivos típicos del formulario SIFEN.
 *  Marca la opción cuyo nombre coincide (case-insensitive) con el motivo del NR;
 *  si no coincide con ninguno específico, marca "Traslado entre locales de la empresa"
 *  como default razonable (es lo más común para transferencias Central → Abasto). */
function MotivoChecks({ motivo }: { motivo?: string | null }) {
  const opciones = [
    "Venta",
    "Importación",
    "Compra",
    "Consignación",
    "Devolución",
    "Traslado entre locales de la empresa",
    "Transformación",
    "Reparación",
    "Exportación",
    "Emisor móvil",
    "Exhibición",
    "Ferias",
    "Otros (indique motivos no previstos)",
  ];
  const target = (motivo ?? "").trim().toLowerCase();
  const explicit = opciones.findIndex((o) => o.toLowerCase() === target);
  const marcada = explicit >= 0 ? explicit : opciones.indexOf("Traslado entre locales de la empresa");
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 text-[11px] text-slate-700">
      {opciones.map((o, i) => (
        <label key={o} className="flex items-center gap-2">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center border border-slate-500 ${
              i === marcada ? "bg-slate-800 text-white" : "bg-white text-transparent"
            }`}
          >
            <span className="text-[10px] font-bold leading-none">X</span>
          </span>
          {o}
        </label>
      ))}
    </div>
  );
}
