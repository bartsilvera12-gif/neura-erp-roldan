"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

interface ReporteCliente {
  total_facturado_12m: number;
  ticket_promedio_12m: number;
  cantidad_facturas_12m: number;
  saldo_pendiente: number;
  dias_desde_ultima_compra: number | null;
  ultima_compra: { factura_id: string; numero_factura: string; fecha: string; monto: number } | null;
  ultimas_compras: Array<{ factura_id: string; numero_factura: string; fecha: string; monto: number; saldo: number; estado: string }>;
  top_productos: Array<{ producto_nombre: string; cantidad: number; total: number }>;
  ranking: { posicion: number; total_clientes: number } | null;
}

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export default function ClienteReportes({ clienteId }: { clienteId: string }) {
  const [data, setData] = useState<ReporteCliente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    (async () => {
      try {
        const r = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/reporte`, { cache: "no-store" });
        const j = await r.json();
        if (cancel) return;
        if (!r.ok || !j?.success) {
          setError(j?.error ?? "No se pudo cargar el reporte.");
        } else {
          setData(j.data as ReporteCliente);
        }
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "Error de red.");
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => { cancel = true; };
  }, [clienteId]);

  if (cargando) return <p className="text-sm text-slate-500 animate-pulse">Cargando reporte…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Métricas principales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Facturado 12m" value={formatGs(data.total_facturado_12m)} hint={`${data.cantidad_facturas_12m} facturas`} accent />
        <Card label="Ticket promedio" value={formatGs(data.ticket_promedio_12m)} />
        <Card
          label="Saldo pendiente"
          value={formatGs(data.saldo_pendiente)}
          hint={data.saldo_pendiente > 0 ? "Tiene deuda" : "Al día"}
          color={data.saldo_pendiente > 0 ? "amber" : "emerald"}
        />
        <Card
          label="Días desde última compra"
          value={data.dias_desde_ultima_compra != null ? String(data.dias_desde_ultima_compra) : "—"}
          hint={
            data.dias_desde_ultima_compra == null
              ? "Sin compras registradas"
              : data.dias_desde_ultima_compra > 90
                ? "Más de 3 meses"
                : data.dias_desde_ultima_compra > 30
                  ? "Recomprá pronto"
                  : "Activo"
          }
          color={
            data.dias_desde_ultima_compra == null || data.dias_desde_ultima_compra > 90
              ? "rose"
              : data.dias_desde_ultima_compra > 30
                ? "amber"
                : "emerald"
          }
        />
      </div>

      {/* Ranking */}
      {data.ranking && (
        <div className="rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 px-4 py-3 text-sm">
          🏆 Posición <b>#{data.ranking.posicion}</b> de <b>{data.ranking.total_clientes}</b> clientes por monto facturado en los últimos 12 meses.
        </div>
      )}

      {/* Últimas compras */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Últimas 10 compras</h3>
        </div>
        {data.ultimas_compras.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Este cliente no tiene compras registradas en los últimos 12 meses.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Factura</th>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-right px-4 py-2">Monto</th>
                <th className="text-right px-4 py-2">Saldo</th>
                <th className="text-left px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.ultimas_compras.map((c) => (
                <tr key={c.factura_id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Link href={`/facturas/${c.factura_id}`} className="text-sky-700 hover:underline font-mono text-xs">
                      {c.numero_factura}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatFecha(c.fecha)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatGs(c.monto)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${c.saldo > 0 ? "text-amber-700 font-semibold" : "text-slate-400"}`}>
                    {formatGs(c.saldo)}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      (c.estado ?? "").toLowerCase() === "pagado" ? "bg-emerald-100 text-emerald-700"
                      : (c.estado ?? "").toLowerCase() === "anulado" ? "bg-slate-100 text-slate-500 line-through"
                      : "bg-amber-100 text-amber-700"
                    }`}>{c.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Top productos */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Top 5 productos comprados (últimos 12m)</h3>
        </div>
        {data.top_productos.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Sin datos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Producto</th>
                <th className="text-right px-4 py-2">Unidades</th>
                <th className="text-right px-4 py-2">Total facturado</th>
              </tr>
            </thead>
            <tbody>
              {data.top_productos.map((p, i) => (
                <tr key={p.producto_nombre} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">
                    <span className="mr-2 text-slate-400">#{i + 1}</span>
                    {p.producto_nombre}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.cantidad.toLocaleString("es-PY")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatGs(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Card({
  label, value, hint, accent, color,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  color?: "emerald" | "amber" | "rose";
}) {
  const colorClass =
    color === "emerald" ? "text-emerald-700"
    : color === "amber" ? "text-amber-700"
    : color === "rose" ? "text-rose-700"
    : accent ? "text-[#3F8E91]" : "text-slate-800";
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${accent ? "ring-1 ring-[#4FAEB2]/25" : ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${colorClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
