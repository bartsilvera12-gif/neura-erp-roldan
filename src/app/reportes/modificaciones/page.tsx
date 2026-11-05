"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { formatFechaHora } from "@/lib/fecha/asuncion";
import Selector from "@/components/ui/Selector";

/**
 * Lo que tocó el administrador.
 *
 * El detalle campo por campo de cada cambio sigue en el historial de su
 * módulo —el de la venta, el del precio—. Esto contesta la otra pregunta, la
 * que antes obligaba a recorrer seis pantallas: qué se tocó esta semana, y
 * quién.
 */
type Movimiento = {
  id: string;
  entidad: string;
  entidad_id: string | null;
  referencia: string | null;
  accion: string;
  detalle: string | null;
  motivo: string | null;
  usuario_nombre: string;
  es_admin: boolean;
  created_at: string;
};

const ENTIDADES = ["", "venta", "caja", "presupuesto", "producto", "comisiones"];

const ACCION_LABEL: Record<string, string> = {
  editar: "Editó",
  anular: "Anuló",
  reabrir: "Reabrió",
  configurar: "Configuró",
  cambiar_pago: "Cambió el pago",
};

function ymdPy(d = new Date()): string {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function haceUnMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return ymdPy(d);
}

export default function ModificacionesPage() {
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [desde, setDesde] = useState(haceUnMes());
  const [hasta, setHasta] = useState(ymdPy());
  const [entidad, setEntidad] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      if (entidad) qs.set("entidad", entidad);
      const r = await fetchWithSupabaseSession(`/api/reportes/modificaciones?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        setMovs([]);
        return;
      }
      setMovs(j.data.movimientos ?? []);
      setAviso(typeof j.data.aviso === "string" ? j.data.aviso : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, entidad]);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reportes" className="text-sm text-sky-600 hover:underline">← Reportes</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800 sm:text-3xl">Modificaciones administrativas</h1>
        <p className="text-slate-600">
          Qué se tocó, quién lo tocó y cuándo: anulaciones de ventas, ediciones, turnos de caja
          reabiertos. El detalle de cada cambio sigue en el historial de su módulo.
        </p>
      </div>

      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{aviso}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-slate-500">
          Desde
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)}
                 className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Hasta
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)}
                 className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Módulo
          <Selector value={entidad} onChange={(e) => setEntidad(e.target.value)}
                  className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {ENTIDADES.map((e) => (
              <option key={e || "todos"} value={e}>{e === "" ? "Todos" : e}</option>
            ))}
          </Selector>
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : movs.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No hubo modificaciones administrativas en el período. Es la respuesta esperada: estas
            cosas no deberían pasar todos los días.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Cuándo</th>
                <th className="px-4 py-3 text-left font-semibold">Quién</th>
                <th className="px-4 py-3 text-left font-semibold">Qué hizo</th>
                <th className="px-4 py-3 text-left font-semibold">Sobre</th>
                <th className="px-4 py-3 text-left font-semibold">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 tabular-nums">
                    {formatFechaHora(m.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{m.usuario_nombre}</span>
                    {/* Si no era administrador, se marca: el dato importa justo
                        cuando la acción la hizo alguien que no debería. */}
                    {!m.es_admin && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                        no admin
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="font-medium">{ACCION_LABEL[m.accion] ?? m.accion}</span>
                    <span className="ml-1 text-slate-500">{m.entidad}</span>
                    {m.detalle && <div className="text-xs text-slate-500">{m.detalle}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {m.referencia || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {m.motivo || <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
