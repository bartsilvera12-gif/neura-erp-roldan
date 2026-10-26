"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

/**
 * Indicadores de tipo de cambio en el Dashboard (punto 7.1).
 *
 * "Indicadores editables: comprador y vendedor en el Dashboard, editables por
 * usuarios autorizados."
 *
 * QUIÉN ES UN USUARIO AUTORIZADO
 *   El administrador. La cotización define el costo en guaraníes de todo lo
 *   que se compra en dólares, así que no es un dato de mostrador. El permiso
 *   de verdad lo aplica el servidor en POST /api/tipos-cambio; acá solo se
 *   oculta el formulario para no ofrecer algo que va a rebotar.
 *
 * CARGAR NO ES EDITAR
 *   Guardar agrega una cotización nueva, no corrige la anterior. Las compras
 *   que ya se cargaron usaron la vieja: si se pudiera reescribir, el costo de
 *   todo lo comprado ese día cambiaría solo y los informes dejarían de
 *   coincidir con las facturas en papel. Es lo que pide el punto 7.2.
 */

type Cotizacion = {
  id: string;
  moneda: string;
  compra: number;
  venta: number;
  vigente_desde: string;
  usuario_nombre: string | null;
  observacion: string | null;
};

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

/** Fecha y hora de Paraguay (UTC−3), sin depender de la tzdata del server. */
function fechaHoraPy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

export default function TipoCambioCard() {
  const { isAdmin } = useIsAdmin();
  const [vigente, setVigente] = useState<Cotizacion | null>(null);
  const [migrado, setMigrado] = useState(true);
  const [cargando, setCargando] = useState(true);

  const [abierto, setAbierto] = useState(false);
  const [compra, setCompra] = useState("");
  const [venta, setVenta] = useState("");
  const [observacion, setObservacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const cargar = useCallback(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/tipos-cambio?limit=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success) {
          setVigente((j.data?.vigente ?? null) as Cotizacion | null);
          setMigrado(j.data?.migrado !== false);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, []);

  useEffect(() => cargar(), [cargar]);

  // Al abrir el formulario se precarga la última cotización: lo normal es
  // moverla unos guaraníes, no escribirla de cero.
  function abrir() {
    setCompra(vigente ? String(vigente.compra) : "");
    setVenta(vigente ? String(vigente.venta) : "");
    setObservacion("");
    setError(null);
    setOkMsg(null);
    setAbierto(true);
  }

  async function guardar() {
    const c = Number(compra.replace(/\./g, "").replace(",", "."));
    const v = Number(venta.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(v) || v <= 0) {
      setError("Poné las dos cotizaciones, comprador y vendedor, mayores a cero.");
      return;
    }
    if (v < c) {
      setError("El vendedor no puede ser menor que el comprador. ¿Están al revés?");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/tipos-cambio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moneda: "USD", compra: c, venta: v, observacion: observacion.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) {
        setError(String(j?.error ?? "No se pudo guardar la cotización."));
        return;
      }
      setAbierto(false);
      setOkMsg("Cotización cargada.");
      cargar();
    } catch {
      setError("No se pudo guardar la cotización.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return null;

  // Sin la migración corrida la tarjeta no tiene nada que mostrar y avisar del
  // script en el Dashboard no le sirve a nadie del mostrador.
  if (!migrado) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden>💱</span>
            <h3 className="text-sm font-semibold text-slate-800">Dólar (USD)</h3>
          </div>
          {vigente ? (
            <p className="mt-0.5 text-xs text-slate-400">
              Cargado el {fechaHoraPy(vigente.vigente_desde)}
              {vigente.usuario_nombre ? ` por ${vigente.usuario_nombre}` : ""}.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-amber-600">
              Todavía no se cargó ninguna cotización.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tipos-cambio"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Historial
          </Link>
          {isAdmin && !abierto && (
            <button
              type="button"
              onClick={abrir}
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
            >
              Actualizar
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Comprador</div>
          <div className="text-lg font-semibold text-slate-800">
            {vigente ? fmt(vigente.compra) : "—"}
          </div>
          <div className="text-[11px] leading-snug text-slate-400">
            Para convertir lo que se cobra en dólares.
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Vendedor</div>
          <div className="text-lg font-semibold text-slate-800">
            {vigente ? fmt(vigente.venta) : "—"}
          </div>
          <div className="text-[11px] leading-snug text-slate-400">
            Para costear las compras en dólares.
          </div>
        </div>
      </div>

      {vigente?.observacion && (
        <p className="mt-2 text-xs text-slate-500">{vigente.observacion}</p>
      )}
      {okMsg && <p className="mt-2 text-xs text-emerald-600">✓ {okMsg}</p>}

      {abierto && (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs text-slate-500">
            Se carga una cotización nueva. La anterior queda en el historial con
            su fecha: las compras que ya la usaron no cambian.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Comprador</label>
              <input
                type="text"
                inputMode="numeric"
                value={compra}
                onChange={(e) => setCompra(e.target.value)}
                placeholder="Ej: 7300"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Vendedor</label>
              <input
                type="text"
                inputMode="numeric"
                value={venta}
                onChange={(e) => setVenta(e.target.value)}
                placeholder="Ej: 7500"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Observación <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              placeholder="De dónde salió la cotización"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar cotización"}
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              disabled={guardando}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
