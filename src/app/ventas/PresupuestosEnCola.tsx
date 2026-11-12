"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { FileText } from "lucide-react";

/**
 * Los presupuestos que los vendedores mandaron a cobrar, en la pantalla
 * principal de Caja.
 *
 * Antes solo se veían adentro de "+ Nueva venta": la cajera, mirando Caja, no
 * se enteraba de que había presupuestos esperando. Se actualiza solo cada 15
 * segundos, así lo que manda el vendedor aparece sin recargar.
 */

type EnCola = { id: string; numero_control: string; cliente_nombre: string; total: number; enviado_a_caja_por: string | null };

const gs = (n: number) => "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");

export default function PresupuestosEnCola() {
  const [cola, setCola] = useState<EnCola[]>([]);

  useEffect(() => {
    let cancel = false;
    const pedir = () =>
      fetchWithSupabaseSession("/api/presupuestos?cola_caja=1", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (cancel || !j?.success) return;
          const filas = (j.data?.presupuestos ?? []) as Record<string, unknown>[];
          setCola(
            filas.map((p) => ({
              id: String(p.id),
              numero_control: String(p.numero_control ?? ""),
              cliente_nombre: String(p.cliente_nombre ?? "Cliente"),
              total: Number(p.total) || 0,
              enviado_a_caja_por: typeof p.enviado_a_caja_por === "string" ? p.enviado_a_caja_por : null,
            }))
          );
        })
        .catch(() => { /* si falla, se reintenta en la próxima vuelta */ });
    void pedir();
    const t = window.setInterval(() => { void pedir(); }, 15_000);
    return () => { cancel = true; window.clearInterval(t); };
  }, []);

  if (cola.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
      <p className="flex items-center gap-2 text-base font-bold text-emerald-900">
        <FileText className="h-5 w-5" />
        {cola.length === 1 ? "Hay un presupuesto esperando cobro" : `Hay ${cola.length} presupuestos esperando cobro`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {cola.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
            <span className="text-sm text-slate-800">
              <span className="font-mono font-semibold">{p.numero_control}</span> — {p.cliente_nombre}
              {p.enviado_a_caja_por && <span className="ml-2 text-xs text-slate-500">lo mandó {p.enviado_a_caja_por}</span>}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-sm font-bold tabular-nums text-slate-800">{gs(p.total)}</span>
              <a
                href={`/ventas/nueva?presupuesto_id=${p.id}`}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Cobrar
              </a>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
