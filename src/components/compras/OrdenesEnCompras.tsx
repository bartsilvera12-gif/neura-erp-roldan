"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, FileInput, Truck } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { estadoOrden, ETIQUETA_ESTADO_ORDEN, type EstadoOrden } from "@/lib/compras/orden-estado";

type Orden = {
  id: string; numero_control: string; proveedor_nombre: string; fecha: string;
  fecha_entrega?: string | null; estado: string; compra_numero?: string | null; items?: unknown[];
};

const fmtFecha = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

/**
 * Las órdenes de compra que todavía no se facturaron, dentro de Compras
 * (pedido del cliente): en tránsito o recibidas, con filtro, el botón para
 * marcarlas recibidas / en tránsito y «Cargar factura».
 */
export default function OrdenesEnCompras() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [filtro, setFiltro] = useState<"todas" | EstadoOrden>("todas");
  const [ocupada, setOcupada] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch("/api/ordenes-compra", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setOrdenes((j.data?.ordenes ?? []) as Orden[]);
    } catch { /* el panel es un extra: sin él, Compras sigue */ }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const abiertas = useMemo(
    () => ordenes.filter((o) => ["en_transito", "recibida"].includes(estadoOrden(o))),
    [ordenes]
  );
  const visibles = filtro === "todas" ? abiertas : abiertas.filter((o) => estadoOrden(o) === filtro);
  if (abiertas.length === 0) return null;

  async function cambiar(o: Orden) {
    setOcupada(o.id);
    try {
      await apiFetch("/api/ordenes-compra", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, estado: estadoOrden(o) === "recibida" ? "pendiente" : "recibida" }),
      });
      await cargar();
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

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">Órdenes de compra sin factura</h3>
        <div className="flex flex-wrap gap-1.5">
          {chip("todas", "Todas", abiertas.length)}
          {chip("en_transito", "En tránsito", abiertas.filter((o) => estadoOrden(o) === "en_transito").length)}
          {chip("recibida", "Recibidas", abiertas.filter((o) => estadoOrden(o) === "recibida").length)}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1.5 pr-3">N°</th><th className="py-1.5 pr-3">Proveedor</th><th className="py-1.5 pr-3">Pedida</th>
              <th className="py-1.5 pr-3">Llega</th><th className="py-1.5 pr-3">Estado</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-violet-100">
            {visibles.map((o) => {
              const e = estadoOrden(o);
              return (
                <tr key={o.id}>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-700">{o.numero_control}</td>
                  <td className="py-2 pr-3 font-medium text-slate-800">{o.proveedor_nombre}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtFecha(o.fecha)}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtFecha(o.fecha_entrega)}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e === "recibida" ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"}`}>
                      {ETIQUETA_ESTADO_ORDEN[e]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <button type="button" disabled={ocupada === o.id} onClick={() => void cambiar(o)}
                      className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {e === "recibida" ? <><Truck className="h-3.5 w-3.5" /> En tránsito</> : <><Check className="h-3.5 w-3.5" /> Recibido</>}
                    </button>
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
