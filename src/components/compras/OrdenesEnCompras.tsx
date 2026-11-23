"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CheckCheck, FileInput, Truck } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import {
  estadoOrden,
  entregaAtrasada,
  textoConfirmaciones,
  confirmacionesHechas,
  ETIQUETA_ESTADO_ORDEN,
  type EstadoOrden,
} from "@/lib/compras/orden-estado";

/** Qué botones le tocan a quien mira (lo calcula el servidor). */
type Acciones = { confirmar: boolean; aceptar: boolean; deshacer: boolean; esperandoOtro: boolean };

type Orden = {
  id: string; numero_control: string; proveedor_nombre: string; fecha: string;
  fecha_entrega?: string | null; estado: string; compra_numero?: string | null; items?: unknown[];
  /** Script 100: las dos confirmaciones de recepción. */
  recibida_por_1_nombre?: string | null;
  recibida_por_1_at?: string | null;
  recibida_por_2_nombre?: string | null;
  recibida_por_2_at?: string | null;
  _recepcion?: Acciones;
};

/** «1/2»: cuántas de las dos confirmaciones de recepción están hechas. */
function Confirmaciones({ o }: { o: Orden }) {
  const texto = textoConfirmaciones(o);
  if (!texto) return null;
  const completas = confirmacionesHechas(o) >= 2;
  return (
    <span
      className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${completas ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}
      title={completas ? "Confirmada por dos personas" : "Confirmaciones de recepción: hacen falta dos"}
    >
      {texto}
    </span>
  );
}

const fmtFecha = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

const TONO: Record<EstadoOrden, string> = {
  en_transito: "bg-violet-100 text-violet-800",
  por_confirmar: "bg-amber-100 text-amber-900",
  recibida: "bg-emerald-100 text-emerald-800",
  facturada: "bg-sky-100 text-sky-800",
  anulada: "bg-slate-100 text-slate-500",
};

/**
 * Las órdenes de compra que todavía no se facturaron, dentro de Compras
 * (pedido del cliente): en tránsito, por confirmar o recibidas, con filtro,
 * los botones de recepción y «Cargar factura».
 *
 * RECEPCIÓN CON DOS PERSONAS (pedido del cliente): quien recibe la mercadería
 * marca «Recibido» y la orden queda «Por confirmar»; el administrador recibe
 * el aviso en la campana y le da «Aceptar». Hasta que estén las dos
 * confirmaciones la orden NO cuenta como recibida. Quién puede qué lo decide
 * el servidor (`_recepcion`), no esta pantalla.
 */
export default function OrdenesEnCompras() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [filtro, setFiltro] = useState<"todas" | EstadoOrden>("todas");
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** false = falta el script 100 y «Recibido» es de un solo click. */
  const [dobleConfirmacion, setDobleConfirmacion] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch("/api/ordenes-compra", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) {
        setOrdenes((j.data?.ordenes ?? []) as Orden[]);
        setDobleConfirmacion(j.data?.recepcion_doble !== false);
      }
    } catch { /* el panel es un extra: sin él, Compras sigue */ }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const abiertas = useMemo(
    () => ordenes.filter((o) => ["en_transito", "por_confirmar", "recibida"].includes(estadoOrden(o))),
    [ordenes]
  );
  const visibles =
    filtro === "todas"
      ? abiertas
      : filtro === "en_transito"
        // El chip «Pendientes» muestra las dos etapas internas.
        ? abiertas.filter((o) => ["en_transito", "por_confirmar"].includes(estadoOrden(o)))
        : abiertas.filter((o) => estadoOrden(o) === filtro);
  if (abiertas.length === 0) return null;

  /** `confirmar` = «Recibido» o «Aceptar»; si no, vuelve a tránsito. */
  async function recepcion(o: Orden, confirmar: boolean) {
    setOcupada(o.id);
    setError(null);
    setAviso(null);
    try {
      const r = await apiFetch("/api/ordenes-compra", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          confirmar ? { id: o.id, confirmar_recepcion: true } : { id: o.id, deshacer_recepcion: true }
        ),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        // Antes esta pantalla ignoraba la respuesta: si el servidor rechazaba
        // la confirmación, el botón no hacía nada y no se sabía por qué.
        setError(j?.error ?? `No se pudo registrar (${r.status}).`);
        return;
      }
      if (typeof j.data?.mensaje === "string") setAviso(j.data.mensaje);
      if (j.data?.recepcion_doble === false) {
        setDobleConfirmacion(false);
        if (typeof j.data?.aviso === "string") setAviso(j.data.aviso);
      }
      await cargar();
    } catch {
      setError("No se pudo conectar. Probá de nuevo.");
    } finally {
      setOcupada(null);
    }
  }

  const chip = (v: typeof filtro, label: string, n: number) => (
    <button type="button" onClick={() => setFiltro(v)}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${filtro === v ? "border-[#4FAEB2] bg-[#4FAEB2] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
      {label} <span className="opacity-70">({n})</span>
    </button>
  );

  const cuenta = (e: EstadoOrden) => abiertas.filter((o) => estadoOrden(o) === e).length;

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">Órdenes de compra sin factura</h3>
        <div className="flex flex-wrap gap-1.5">
          {/* «Pendientes» junta las dos etapas internas (sin confirmar y
              esperando al administrador): el cliente pidió ver aprobado y
              rechazado nomás, no el detalle del tránsito. Quién tiene que
              hacer qué se ve en la fila. */}
          {chip("todas", "Todas", abiertas.length)}
          {chip("en_transito", "Pendientes", cuenta("en_transito") + cuenta("por_confirmar"))}
          {chip("recibida", "Aprobadas", cuenta("recibida"))}
        </div>
      </div>

      {!dobleConfirmacion && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Falta correr el script 100: por ahora «Recibido» lo marca una sola persona.
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
      )}
      {aviso && !error && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{aviso}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1.5 pr-3">N°</th><th className="py-1.5 pr-3">Proveedor</th><th className="py-1.5 pr-3">Pedida</th>
              <th className="py-1.5 pr-3">Llega</th><th className="py-1.5 pr-3">Estado</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-violet-100">
            {visibles.map((o) => {
              const e = estadoOrden(o);
              const acc: Acciones = o._recepcion ?? { confirmar: e === "en_transito", aceptar: false, deshacer: false, esperandoOtro: false };
              const atrasada = entregaAtrasada(o);
              return (
                <tr key={o.id}>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-700">{o.numero_control}</td>
                  <td className="py-2 pr-3 font-medium text-slate-800">{o.proveedor_nombre}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtFecha(o.fecha)}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {fmtFecha(o.fecha_entrega)}
                    {atrasada && (
                      <span className="ml-1 text-[11px] font-semibold text-amber-700">· ya tendría que haber llegado</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONO[e]}`}>
                      {ETIQUETA_ESTADO_ORDEN[e]}
                    </span>
                    {/* Cuántas de las dos confirmaciones están hechas: de un
                        vistazo se ve si falta alguien. */}
                    <Confirmaciones o={o} />
                    {/* Quién confirmó qué: el control de dos personas sirve si
                        se puede ver. */}
                    {o.recibida_por_1_nombre && (
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        Recibió {o.recibida_por_1_nombre}
                        {o.recibida_por_2_nombre ? ` · aceptó ${o.recibida_por_2_nombre}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {acc.confirmar && (
                      <button type="button" disabled={ocupada === o.id} onClick={() => void recepcion(o, true)}
                        className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        <Check className="h-3.5 w-3.5" /> Recibido
                      </button>
                    )}
                    {acc.aceptar && (
                      <button type="button" disabled={ocupada === o.id} onClick={() => void recepcion(o, true)}
                        className="mr-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                        <CheckCheck className="h-3.5 w-3.5" /> Aceptar
                      </button>
                    )}
                    {acc.esperandoOtro && !acc.aceptar && (
                      <span className="mr-2 text-[11px] text-amber-800">Espera al administrador</span>
                    )}
                    {acc.deshacer && (
                      <button type="button" disabled={ocupada === o.id} onClick={() => void recepcion(o, false)}
                        className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        <Truck className="h-3.5 w-3.5" /> En tránsito
                      </button>
                    )}
                    <Link href={`/compras/nueva?orden=${o.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                      <FileInput className="h-3.5 w-3.5" /> Cargar factura
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
