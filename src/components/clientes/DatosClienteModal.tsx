"use client";

import { useEffect, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useFacultades } from "@/lib/perfiles/use-facultades";
import HistorialClienteModal from "@/components/clientes/HistorialClienteModal";

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/**
 * Los datos del cliente sin salir del presupuesto (pedido del cliente): se
 * abre tocando el nombre. Muestra contacto y crédito, y quien tiene la
 * facultad «Fijar crédito» le pone ahí mismo el límite, el plazo y la
 * condición. Abajo, el historial de compras.
 */
export default function DatosClienteModal({
  clienteId,
  onClose,
  onGuardado,
}: {
  clienteId: string;
  onClose: () => void;
  /** Después de cambiar el crédito: para refrescar lo que muestra la pantalla. */
  onGuardado?: () => void;
}) {
  const { tiene } = useFacultades();
  const puedeCredito = tiene("fijar_credito");
  const [c, setC] = useState<Record<string, unknown> | null>(null);
  const [cred, setCred] = useState<{ limite: number | null; dias: number | null; deuda: number; disponible: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limite, setLimite] = useState("");
  const [dias, setDias] = useState("");
  const [condicion, setCondicion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  /** La ficha completa del cliente, en un modal (no en otra pestaña). */
  const [verFicha, setVerFicha] = useState(false);

  async function cargar() {
    setError(null);
    try {
      const [rc, rk] = await Promise.all([
        fetchWithSupabaseSession(`/api/clientes/${clienteId}`, { cache: "no-store" }).then((r) => r.json()),
        fetchWithSupabaseSession(`/api/clientes/${clienteId}/credito`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      const cli = (rc?.data?.cliente ?? rc?.data ?? null) as Record<string, unknown> | null;
      if (!cli) throw new Error(rc?.error ?? "No se pudo cargar el cliente.");
      setC(cli);
      setLimite(cli.limite_credito == null ? "" : String(Math.round(Number(cli.limite_credito))));
      setDias(cli.dias_credito == null ? "" : String(cli.dias_credito));
      setCondicion(String(cli.condicion_pago ?? ""));
      if (rk?.success) setCred(rk.data.credito);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  }
  useEffect(() => { void cargar(); }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardarCredito() {
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/clientes/${clienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limite_credito: limite.replace(/\D/g, "") === "" ? null : Number(limite.replace(/\D/g, "")),
          dias_credito: dias.trim() === "" ? null : Number(dias),
          condicion_pago: condicion || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? "No se pudo guardar.");
      setOk("Crédito guardado.");
      await cargar();
      onGuardado?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  const txt = (k: string) => {
    const v = c?.[k];
    return v == null || String(v).trim() === "" ? "—" : String(v);
  };
  const nombre = c ? String(c.nombre_facturacion ?? c.empresa ?? c.nombre_contacto ?? c.nombre ?? "Cliente") : "Cliente";
  const campo = "w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]";

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-slate-900">{nombre}</h3>
              <p className="text-[11px] text-slate-500">RUC/CI {c ? txt("ruc") !== "—" ? txt("ruc") : txt("documento") : "…"}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>

          {!c && !error ? (
            <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
          ) : (
            <div className="space-y-4 px-5 py-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ["Teléfono", txt("telefono")],
                  ["Email", txt("email")],
                  ["Ciudad", txt("ciudad")],
                  ["Dirección", txt("direccion")],
                  ["Profesión", txt("profesion")],
                  ["Código", txt("codigo")],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[11px] text-slate-400">{k}</dt>
                    <dd className="truncate text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Crédito</p>
                {cred && (
                  <p className="mt-1 text-xs text-slate-600">
                    Debe <strong className="tabular-nums">{gs(cred.deuda)}</strong>
                    {cred.limite != null && <> · disponible <strong className="tabular-nums">{gs(cred.disponible ?? 0)}</strong> de {gs(cred.limite)}</>}
                    {cred.dias != null && <> · plazo {cred.dias} días</>}
                  </p>
                )}
                {puedeCredito ? (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="col-span-3 sm:col-span-1">
                      <span className="mb-1 block text-[11px] font-semibold text-slate-600">Condición</span>
                      <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className={`${campo} bg-white`}>
                        <option value="">—</option>
                        <option value="CONTADO">Contado</option>
                        <option value="CREDITO">Crédito</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[11px] font-semibold text-slate-600">Límite (Gs.)</span>
                      <input inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder="Sin límite" className={`${campo} text-right tabular-nums`} />
                    </label>
                    <label>
                      <span className="mb-1 block text-[11px] font-semibold text-slate-600">Plazo (días)</span>
                      <input type="number" min={0} max={365} value={dias} onChange={(e) => setDias(e.target.value)} className={`${campo} text-right`} />
                    </label>
                    <div className="col-span-3 flex items-center justify-end gap-3">
                      {ok && <span className="text-xs text-emerald-700">{ok}</span>}
                      <button type="button" onClick={() => void guardarCredito()} disabled={guardando}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
                        {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar crédito
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-600">
                    Condición <strong>{condicion || "—"}</strong> · Límite <strong className="tabular-nums">{limite ? gs(Number(limite)) : "sin límite cargado"}</strong>
                    <span className="mt-1 block text-[11px] text-slate-400">El límite lo cambia quien tiene la facultad «Fijar crédito».</span>
                  </p>
                )}
              </div>

              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
            <button type="button" onClick={() => setVerHistorial(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2]">
              <History className="h-3.5 w-3.5" /> Historial de compras
            </button>
            <button type="button" onClick={() => setVerFicha(true)} className="text-xs font-medium text-sky-700 hover:underline">Abrir la ficha completa</button>
          </div>
        </div>
      </div>
      {verFicha && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setVerFicha(false); void cargar(); } }}>
          <div className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">Ficha de {nombre}</p>
              <button type="button" onClick={() => { setVerFicha(false); void cargar(); onGuardado?.(); }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X className="h-4 w-4" /></button>
            </div>
            <iframe title={`Ficha de ${nombre}`} src={`/clientes/${clienteId}?embebido=1`} className="min-h-0 w-full flex-1 border-0" />
          </div>
        </div>
      )}
      {verHistorial && (
        // El modal del historial es z-50: dentro de este contexto queda arriba.
        <div className="relative z-[70]">
          <HistorialClienteModal clienteId={clienteId} clienteNombre={nombre} onClose={() => setVerHistorial(false)} />
        </div>
      )}
    </>
  );
}
