"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Ventas del año mes por mes: barras para lo facturado (contado y crédito
 * apiladas) y una línea para la utilidad, si quien mira puede ver costos.
 *
 * Archivo aparte para cargarlo con `dynamic()` entero: recharts pesa y
 * envolver sus piezas por separado rompe los ejes (ver ChartCobradoPorDia).
 */
export type PuntoMes = { mes: string; contado: number; credito: number; utilidad?: number };

const millones = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString("es-PY", { maximumFractionDigits: 1 })} mil M`;
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${Math.round(n / 1_000).toLocaleString("es-PY")} mil`;
  return String(Math.round(n));
};
const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

export default function GraficoVentasAnual({ data, conUtilidad }: { data: PuntoMes[]; conUtilidad: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => millones(Number(v))} width={60} />
        <Tooltip
          cursor={{ fill: "rgba(79,174,178,0.08)" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as PuntoMes;
            return (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-lg">
                <p className="mb-1 font-semibold">{String(label)}</p>
                <p>Total: <strong className="tabular-nums">{gs(r.contado + r.credito)}</strong></p>
                <p className="text-slate-500">Contado {gs(r.contado)} · Crédito {gs(r.credito)}</p>
                {conUtilidad && r.utilidad != null && (
                  <p className="text-emerald-700">Utilidad: <strong className="tabular-nums">{gs(r.utilidad)}</strong></p>
                )}
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="contado" name="Contado" stackId="v" fill="#4FAEB2" radius={[0, 0, 0, 0]} />
        <Bar dataKey="credito" name="Crédito" stackId="v" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        {conUtilidad && <Line type="monotone" dataKey="utilidad" name="Utilidad" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
