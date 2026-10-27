"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImprimirTablaButton from "@/components/ui/ImprimirTablaButton";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Informe de cobranzas (punto 10.2).
 *
 * "Cobranzas: cliente, cobro, fecha, importe y comprobante; filtros por
 * cliente y fecha."
 *
 * Las dos columnas de comprobante son a propósito: "Factura" es contra qué se
 * imputó la plata y "Comprobante" es con qué se demuestra que entró (número de
 * transferencia, de cheque, de boleta). Con una sola, cruzar contra el extracto
 * del banco obliga a abrir cobro por cobro.
 */

type Fila = {
  id: string;
  fecha_pago: string;
  cliente_id: string | null;
  cliente_nombre: string;
  numero_venta: string | null;
  monto: number;
  metodo_pago: string;
  entidad: string | null;
  referencia: string | null;
  usuario_nombre: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  anulado_por: string | null;
};

type Informe = {
  filas: Fila[];
  resumen: {
    cantidad: number;
    total: number;
    anulados: number;
    total_anulado: number;
    por_metodo: { metodo: string; cantidad: number; total: number }[];
    por_cliente: { cliente_id: string | null; nombre: string; cantidad: number; total: number }[];
  };
  recortado: boolean;
};

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

function fechaPy(iso: string): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso.slice(0, 10);
}

const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
  otro: "Otro",
};

const inputCls =
  "rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none";

/** Primer y último día del mes en curso, en hora de Paraguay. */
function mesActual(): { desde: string; hasta: string } {
  const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
}

export default function CobranzasReportePage() {
  const inicial = mesActual();
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [metodo, setMetodo] = useState("");
  const [estado, setEstado] = useState("activos");
  const [q, setQ] = useState("");

  const [data, setData] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = new URLSearchParams();
  if (desde) query.set("desde", desde);
  if (hasta) query.set("hasta", hasta);
  if (metodo) query.set("metodo", metodo);
  if (estado) query.set("estado", estado);
  if (q.trim()) query.set("q", q.trim());
  const qs = query.toString();

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/reportes/cobranzas?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(String(j?.error ?? "No se pudo cargar el informe."));
        setData(null);
        return;
      }
      setData(j.data as Informe);
    } catch {
      setError("No se pudo cargar el informe.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [qs]);

  // Medio segundo de espera para que escribir en el buscador no dispare una
  // consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => { cargar(); }, 400);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reportes"
        title="Cobranzas"
        description="Qué se cobró, a quién, cuándo y con qué comprobante"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <span className="inline-flex items-start gap-2">
            <ExportExcelButton url={`/api/reportes/cobranzas/export?${qs}`} />
            {/* El importe NO se totaliza al pie: el detalle incluye los cobros
                anulados, marcados en su columna, y sumarlos daria una cobranza
                mas alta que la real. El total que sirve esta en las tarjetas
                de arriba, donde lo cobrado y lo anulado van separados. */}
            <ImprimirTablaButton
              titulo="Cobranzas"
              subtitulo={desde || hasta ? `Del ${desde || "inicio"} al ${hasta || "hoy"}` : undefined}
              columnas={["Fecha", "Cliente", "Factura", "Importe", "Medio", "Comprobante", "Cobró", "Anulado", "Motivo"]}
              filas={(data?.filas ?? []).map((f) => [
                fechaPy(f.fecha_pago),
                f.cliente_nombre,
                f.numero_venta ?? "",
                f.monto,
                METODO_LABEL[f.metodo_pago] ?? f.metodo_pago,
                f.referencia ?? "",
                f.usuario_nombre ?? "",
                f.anulado ? "SÍ" : "",
                f.anulado_motivo ?? "",
              ])}
            />
          </span>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Desde</label>
            <input type="date" value={desde} max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hasta</label>
            <input type="date" value={hasta} min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Medio de pago</label>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">Todos</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Estado</label>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className={`${inputCls} w-full`}>
              <option value="activos">Solo vigentes</option>
              <option value="anulados">Solo anulados</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Cliente, factura o comprobante"
              className={`${inputCls} w-full`} />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact accent label="Total cobrado" value={gs(data.resumen.total)} />
            <StatCard compact label="Cobros" value={String(data.resumen.cantidad)} />
            <StatCard compact label="Clientes" value={String(data.resumen.por_cliente.length)} />
            <StatCard compact label="Anulados" value={String(data.resumen.anulados)} />
          </div>

          {data.recortado && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              El informe llegó al tope de 1000 cobros y está recortado. Acotá el rango de fechas.
            </div>
          )}

          {data.resumen.por_metodo.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.resumen.por_metodo.map((m) => (
                <span key={m.metodo} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  {METODO_LABEL[m.metodo] ?? m.metodo}: <strong>{gs(m.total)}</strong> ({m.cantidad})
                </span>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 font-semibold">Factura</th>
                    <th className="px-4 py-3 font-semibold text-right">Importe</th>
                    <th className="px-4 py-3 font-semibold">Medio</th>
                    <th className="px-4 py-3 font-semibold">Comprobante</th>
                    <th className="px-4 py-3 font-semibold">Cobró</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {cargando ? (
                    <tr><td colSpan={7} className="py-12 text-center text-slate-400">Cargando…</td></tr>
                  ) : data.filas.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-slate-400">No hubo cobros con esos filtros.</td></tr>
                  ) : (
                    data.filas.map((f) => (
                      <tr key={f.id} className={f.anulado ? "bg-rose-50/40" : "hover:bg-slate-50"}>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fechaPy(f.fecha_pago)}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {f.cliente_nombre}
                          {f.anulado && (
                            <div className="text-[11px] text-rose-600">
                              Anulado{f.anulado_por ? ` por ${f.anulado_por}` : ""}
                              {f.anulado_motivo ? `: ${f.anulado_motivo}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{f.numero_venta ?? "—"}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-semibold ${f.anulado ? "text-slate-400 line-through" : "text-slate-800"}`}>
                          {gs(f.monto)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {METODO_LABEL[f.metodo_pago] ?? f.metodo_pago}
                          {f.entidad && <div className="text-[11px] text-slate-400">{f.entidad}</div>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{f.referencia ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{f.usuario_nombre ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="max-w-3xl text-xs leading-relaxed text-slate-400">
            <strong>Factura</strong> es contra qué se imputó la plata; <strong>Comprobante</strong> es con qué se
            demuestra que entró (número de transferencia, de cheque, de boleta). Los cobros anulados se muestran
            tachados, con su motivo, y no suman en los totales: esa plata volvió al saldo del cliente.
          </p>
        </>
      )}
    </div>
  );
}
