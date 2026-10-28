"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import ModalCampo from "@/components/ui/ModalCampo";

/**
 * Los pedidos de descuento esperando respuesta, en el encabezado.
 *
 * ── POR QUÉ ACÁ Y NO EN UNA PANTALLA ──────────────────────────────────────
 *   Del otro lado hay un vendedor con un cliente adelante esperando. Una
 *   pantalla a la que hay que entrar se mira cuando uno se acuerda, y para
 *   entonces el cliente se fue. En el encabezado está a la vista en cualquier
 *   pantalla del sistema.
 *
 * ── SE PREGUNTA CADA DIEZ SEGUNDOS ────────────────────────────────────────
 *   Es una espera de mostrador. Un minuto —lo que usa la campana de lotes por
 *   vencer— sería una eternidad con alguien parado. Diez segundos es rápido y
 *   sigue siendo una consulta chica.
 *
 *   No se muestra nada a quien no puede autorizar: la ruta le contesta lista
 *   vacía y el botón no aparece.
 */

interface Solicitud {
  id: string;
  solicitante_nombre: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_lista: number;
  precio_pedido: number;
  descuento_pct: number;
  tope_pct: number | null;
  created_at: string;
  expira_at: string;
}

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** "hace 2 min", que es lo que importa cuando alguien está esperando. */
function haceCuanto(iso: string): string {
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seg < 60) return `hace ${seg}s`;
  return `hace ${Math.round(seg / 60)} min`;
}

export default function AutorizacionesDescuento() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [puede, setPuede] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Rechazo en curso: se pide el motivo en un modal, no en el cartel del
   *  navegador. Al abrirlo se cierra la lista: con las dos cosas encima, no se
   *  entiende cuál de los pedidos se está rechazando. */
  const [rechazando, setRechazando] = useState<Solicitud | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/descuentos/solicitudes", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (!j?.success) return;
      setPuede(j.data?.puede_autorizar === true);
      setSolicitudes((j.data?.solicitudes ?? []) as Solicitud[]);
    } catch {
      /* silencioso: no puede romper el encabezado */
    }
  }, []);

  useEffect(() => {
    void cargar();
    const id = window.setInterval(cargar, 10_000);
    return () => window.clearInterval(id);
  }, [cargar]);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  // El motivo solo se pide al rechazar: aprobar no necesita explicación, y un
  // rechazo sin razón deja al vendedor sin saber qué decirle al cliente.
  async function resolver(id: string, aprobar: boolean, motivo: string | null = null) {
    setResolviendo(id);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/descuentos/solicitudes/${id}/resolver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aprobar, motivo }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo contestar.");
      setSolicitudes((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      void cargar();
    } finally {
      setResolviendo(null);
    }
  }

  // Sin permiso para autorizar, o sin nada pendiente, el botón no ocupa lugar.
  if (!puede || solicitudes.length === 0) return null;

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="relative rounded-lg p-2 text-amber-600 transition-colors hover:bg-amber-50"
        aria-label={`${solicitudes.length} pedido(s) de descuento esperando`}
        title="Pedidos de descuento esperando tu respuesta"
      >
        <Bell className="h-5 w-5 origin-top animate-[campanita_1.2s_ease-in-out_2]" />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] animate-pulse items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
          {solicitudes.length}
        </span>
      </button>

      {abierto && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Descuentos para autorizar</p>
            <p className="text-[11px] text-slate-500">Hay alguien esperando en el mostrador.</p>
          </div>
          {error && <p className="bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {solicitudes.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <p className="text-sm text-slate-800">
                  <strong>{s.solicitante_nombre || "Un vendedor"}</strong> quiere vender con{" "}
                  <strong className="text-amber-700">{s.descuento_pct}%</strong> de descuento
                  {s.tope_pct != null && <> (su tope es {s.tope_pct}%)</>}.
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {s.cantidad} × {s.producto_nombre}
                  {s.sku && <span className="font-mono text-[11px] text-slate-400"> · {s.sku}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {gs(s.precio_lista)} → <strong className="text-slate-700">{gs(s.precio_pedido)}</strong>
                  <span className="ml-2 text-[11px] text-slate-400">{haceCuanto(s.created_at)}</span>
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={resolviendo === s.id}
                    onClick={() => void resolver(s.id, true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Autorizar
                  </button>
                  <button
                    type="button"
                    disabled={resolviendo === s.id}
                    onClick={() => { setRechazando(s); setAbierto(false); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rechazando && (
        <ModalCampo
          titulo={`Rechazar ${rechazando.descuento_pct}% en ${rechazando.producto_nombre}`}
          descripcion={`${rechazando.solicitante_nombre || "El vendedor"} va a ver lo que escribas acá, así sabe qué decirle al cliente.`}
          etiqueta="Motivo"
          placeholder="Ej: ese producto no lleva descuento"
          ayuda="Se puede dejar vacío."
          textoGuardar="Rechazar"
          onGuardar={async (v) => {
            const s = rechazando;
            setRechazando(null);
            await resolver(s.id, false, v.trim() || null);
          }}
          onCerrar={() => { setRechazando(null); setAbierto(true); }}
        />
      )}
    </div>
  );
}
