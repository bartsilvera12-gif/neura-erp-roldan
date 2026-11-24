"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileInput } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { estadoOrden, entregaAtrasada } from "@/lib/compras/orden-estado";

type Orden = {
  id: string; numero_control: string; proveedor_nombre: string; fecha: string;
  fecha_entrega?: string | null; estado: string; compra_numero?: string | null; items?: unknown[];
};

const fmtFecha = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

/**
 * Las órdenes de compra que todavía no se facturaron, dentro de Compras, con
 * «Cargar factura».
 *
 * Sin estados, «1/2» ni botones de recepción (pedido del cliente: «quitá lo
 * de pendiente y demás»): la aprobación y la recepción ahora están en la
 * compra misma (script 104).
 */
export default function OrdenesEnCompras() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch("/api/ordenes-compra", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setOrdenes((j.data?.ordenes ?? []) as Orden[]);
    } catch { /* el panel es un extra: sin él, Compras sigue */ }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const abiertas = useMemo(
    () => ordenes.filter((o) => ["en_transito", "por_confirmar", "recibida"].includes(estadoOrden(o))),
    [ordenes]
  );
  if (abiertas.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">
          Órdenes de compra sin factura <span className="text-sm font-normal text-slate-500">({abiertas.length})</span>
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1.5 pr-3">N°</th><th className="py-1.5 pr-3">Proveedor</th><th className="py-1.5 pr-3">Pedida</th>
              <th className="py-1.5 pr-3">Llega</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-violet-100">
            {abiertas.map((o) => {
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
                  <td className="whitespace-nowrap py-2 text-right">
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
