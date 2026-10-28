"use client";

import { useState } from "react";
import { saveBaileysWhatsappChannel } from "@/lib/chat/actions";

/**
 * Nombre y URL del puente de un canal de WhatsApp por QR.
 *
 * Un canal por QR no tiene credenciales que cargar —se vincula escaneando—,
 * así que la pantalla mostraba solo el QR. Quedaban dos cosas sin forma de
 * cambiarse: cómo se llama el canal (y con varios números, "WhatsApp por QR"
 * repetido no le dice nada a nadie) y a qué puente apunta, que hace falta si
 * el contenedor se mueve de dominio.
 */
export function BaileysChannelSettings({
  channelId,
  nombreInicial,
  bridgeUrlInicial,
  onSaved,
}: {
  channelId: string;
  nombreInicial: string;
  bridgeUrlInicial: string;
  onSaved?: () => void;
}) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [bridgeUrl, setBridgeUrl] = useState(bridgeUrlInicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const sinCambios = nombre.trim() === nombreInicial && bridgeUrl.trim() === bridgeUrlInicial;

  async function guardar() {
    const url = bridgeUrl.trim();
    setError(null);
    setOk(false);
    if (!nombre.trim()) {
      setError("Poné un nombre para el canal.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setError("La URL del puente debe empezar con http:// o https://");
      return;
    }
    setGuardando(true);
    try {
      await saveBaileysWhatsappChannel({ id: channelId, nombre: nombre.trim(), bridge_url: url });
      setOk(true);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Datos del canal</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Nombre del canal</span>
          <input
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setOk(false); }}
            placeholder="Ej. WhatsApp Ventas"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Con varios números, es lo que distingue uno de otro en el inbox.
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700">URL del puente</span>
          <input
            value={bridgeUrl}
            onChange={(e) => { setBridgeUrl(e.target.value); setOk(false); }}
            placeholder="https://wa-bridge.tudominio.com"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Cambiala solo si el contenedor del puente se mudó de dominio.
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando || sinCambios}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {ok && <span className="text-sm font-medium text-emerald-700">Guardado.</span>}
      </div>
    </div>
  );
}
