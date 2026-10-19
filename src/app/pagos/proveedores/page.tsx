"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Factura = {
  numero_control: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  plazo_dias: number | null;
  estado: string;
  metodo_pago: string | null;
  referencia_pago: string | null;
  fecha_pago: string | null;
  total: number;
  vencimiento: string | null;
  vencida: boolean;
  dias_para_vencer: number | null;
};

type Proveedor = {
  proveedor_id: string | null;
  proveedor_nombre: string;
  total_pendiente: number;
  total_vencido: number;
  total_pagado: number;
  cant_pendiente: number;
  cant_vencida: number;
  cant_pagada: number;
  proximo_vencimiento: string | null;
  facturas: Factura[];
};

async function abrirOrdenPago(numeroControl: string) {
  try {
    const res = await fetchWithSupabaseSession(`/api/compras/orden-pago?numero_control=${encodeURIComponent(numeroControl)}`);
    if (!res.ok) { alert("No se pudo generar la orden de pago."); return; }
    const html = await res.text();
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  } catch {
    alert("No se pudo generar la orden de pago.");
  }
}

const fmtGs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export default function EstadoCuentaProveedoresPage() {
  const [rows, setRows] = useState<Proveedor[]>([]);
  const [totales, setTotales] = useState({ pendiente: 0, vencido: 0, pagado: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithSupabaseSession("/api/pagos/proveedores-estado-cuenta");
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
        setRows((j.data?.proveedores ?? []) as Proveedor[]);
        setTotales(j.data?.totales ?? { pendiente: 0, vencido: 0, pagado: 0 });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((p) => p.proveedor_nombre.toLowerCase().includes(s));
  }, [rows, q]);

  function toggle(key: string) {
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const badge = (f: Factura) => {
    if (f.estado === "pagada") return <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">Pagada</span>;
    if (f.vencida) return <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[11px] font-semibold">Vencida</span>;
    return <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-[11px] font-semibold">Pendiente</span>;
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Cobranzas · Proveedores</p>
          <h1 className="text-2xl font-bold text-slate-900">Estado de cuenta — Proveedores</h1>
          <p className="text-sm text-slate-500 mt-0.5">Lo que debés a cada proveedor: pendiente, vencido y ya pagado.</p>
        </div>
        <Link href="/pagos" className="text-sm text-[#4FAEB2] hover:underline">← Volver a Pagos</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="text-xs uppercase text-orange-700">Total pendiente</div>
          <div className="text-2xl font-bold text-orange-800 mt-1 tabular-nums">{fmtGs(totales.pendiente)}</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="text-xs uppercase text-red-700">Vencido</div>
          <div className="text-2xl font-bold text-red-800 mt-1 tabular-nums">{fmtGs(totales.vencido)}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs uppercase text-emerald-700">Ya pagado</div>
          <div className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">{fmtGs(totales.pagado)}</div>
        </div>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…"
        className="w-full sm:max-w-sm mb-4 px-3 py-2 border border-slate-300 rounded-md text-sm" />

      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && !error && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-6"></th>
                <th className="text-left px-3 py-2 font-medium">Proveedor</th>
                <th className="text-right px-3 py-2 font-medium">Pendiente</th>
                <th className="text-right px-3 py-2 font-medium">Vencido</th>
                <th className="text-center px-3 py-2 font-medium">Facturas</th>
                <th className="text-left px-3 py-2 font-medium">Próx. vencimiento</th>
                <th className="text-right px-3 py-2 font-medium">Pagado</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Sin compras a crédito.</td></tr>
              )}
              {filtrados.map((p) => {
                const key = p.proveedor_id ?? p.proveedor_nombre;
                const abierto = abiertos.has(key);
                return (
                  <ProvRows key={key} p={p} abierto={abierto} onToggle={() => toggle(key)} badge={badge} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProvRows({
  p, abierto, onToggle, badge,
}: {
  p: Proveedor;
  abierto: boolean;
  onToggle: () => void;
  badge: (f: Factura) => React.ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={onToggle}>
        <td className="px-2 text-center text-slate-400">{abierto ? "▾" : "▸"}</td>
        <td className="px-3 py-2.5 font-medium text-slate-800">{p.proveedor_nombre}</td>
        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-orange-700">{fmtGs(p.total_pendiente)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-red-600">{p.total_vencido > 0 ? fmtGs(p.total_vencido) : "—"}</td>
        <td className="px-3 py-2.5 text-center text-slate-600">{p.cant_pendiente}{p.cant_vencida > 0 ? ` (${p.cant_vencida} venc.)` : ""}</td>
        <td className="px-3 py-2.5 text-slate-600">{fmtFecha(p.proximo_vencimiento)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{p.total_pagado > 0 ? fmtGs(p.total_pagado) : "—"}</td>
      </tr>
      {abierto && (
        <tr className="bg-slate-50/50">
          <td></td>
          <td colSpan={6} className="px-3 py-2">
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="text-left py-1">N° control</th>
                  <th className="text-left py-1">N° factura</th>
                  <th className="text-left py-1">Vencimiento</th>
                  <th className="text-left py-1">Estado</th>
                  <th className="text-left py-1">Pago</th>
                  <th className="text-right py-1">Total</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {p.facturas.map((f) => (
                  <tr key={f.numero_control} className="border-t border-slate-100">
                    <td className="py-1.5 font-mono text-slate-700">{f.numero_control}</td>
                    <td className="py-1.5 text-slate-600">{f.numero_factura ?? "—"}</td>
                    <td className={`py-1.5 ${f.vencida ? "text-red-600 font-semibold" : "text-slate-600"}`}>
                      {fmtFecha(f.vencimiento)}
                      {f.estado !== "pagada" && f.dias_para_vencer != null && (
                        <span className="ml-1 text-[10px] text-slate-400">
                          ({f.dias_para_vencer < 0 ? `${Math.abs(f.dias_para_vencer)}d vencida` : `en ${f.dias_para_vencer}d`})
                        </span>
                      )}
                    </td>
                    <td className="py-1.5">{badge(f)}</td>
                    <td className="py-1.5 text-slate-500">
                      {f.estado === "pagada"
                        ? `${f.metodo_pago ?? ""}${f.referencia_pago ? ` · ${f.referencia_pago}` : ""}${f.fecha_pago ? ` · ${fmtFecha(f.fecha_pago)}` : ""}`
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium text-slate-800">{fmtGs(f.total)}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => abrirOrdenPago(f.numero_control)}
                        className="text-[11px] font-medium text-sky-700 hover:underline whitespace-nowrap">🖨 Orden</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
