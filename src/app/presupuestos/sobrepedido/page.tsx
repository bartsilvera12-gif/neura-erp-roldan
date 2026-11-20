"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Fila = {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  pedido: number;
  stock: number;
  falta: number;
  presupuestos: Array<{ id: string; numero: string | null; cliente: string | null; cantidad: number }>;
};

const num = (n: number) => n.toLocaleString("es-PY", { maximumFractionDigits: 2 });

/**
 * Sobrepedido (pedido del cliente): los materiales que piden los presupuestos
 * vigentes y que no alcanzan con el stock. Es lo que hay que comprar para
 * poder cumplirlos. Se llega desde la campana.
 */
export default function SobrepedidoPage() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/presupuestos/sobrepedido", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j?.success) throw new Error(j?.error ?? "No se pudo cargar."); setFilas(j.data.filas as Fila[]); })
      .catch((e) => setError(e instanceof Error ? e.message : "Error de red."));
  }, []);

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <Link href="/presupuestos" className="text-sm text-[#4FAEB2] hover:underline">← Presupuestos</Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Sobrepedido</h1>
        <p className="text-slate-600">
          Materiales de los presupuestos vigentes (creados, enviados o aprobados, sin cobrar) que no alcanzan con el stock.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!filas && !error ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
      ) : filas && filas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Alcanza el stock para todos los presupuestos vigentes.
        </div>
      ) : filas ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3 text-right">Piden</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Falta</th>
                <th className="px-4 py-3">Presupuestos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((f) => (
                <tr key={f.producto_id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/inventario/${f.producto_id}`} className="font-medium text-slate-800 hover:text-[#3F8E91]">{f.producto_nombre}</Link>
                    {f.sku && <p className="font-mono text-[11px] text-slate-400">{f.sku}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(f.pedido)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(f.stock)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-red-600">{num(f.falta)}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setAbierto(abierto === f.producto_id ? null : f.producto_id)}
                      className="text-xs font-medium text-sky-700 hover:underline">
                      {f.presupuestos.length} {f.presupuestos.length === 1 ? "presupuesto" : "presupuestos"}
                    </button>
                    {abierto === f.producto_id && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {f.presupuestos.map((p, i) => (
                          <li key={`${p.id}-${i}`}>
                            <Link href={`/presupuestos/${p.id}`} className="font-mono text-[#3F8E91] hover:underline">{p.numero ?? "—"}</Link>
                            <span className="text-slate-500"> · {p.cliente ?? "—"} · {num(p.cantidad)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
