"use client";

/**
 * Reporte: Productos a vencer.
 * Lista lotes activos con cantidad>0 cuya fecha_vencimiento cae en la ventana
 * elegida (7/15/30/60/90 días). KPI cards por nivel de urgencia + tabla ordenada
 * ASC por fecha_vencimiento (los más urgentes arriba).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Lote = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  numero_lote: string;
  fecha_vencimiento: string;
  cantidad: number;
  dias_restantes: number;
  nivel: "critico" | "proximo" | "advertencia" | "ok";
};

type Counts = { critico: number; proximo: number; advertencia: number; total: number };

const DIAS_OPCIONES = [7, 15, 30, 60, 90] as const;

const nivelBadge: Record<Lote["nivel"], string> = {
  critico: "bg-red-100 text-red-700 border-red-200",
  proximo: "bg-amber-100 text-amber-700 border-amber-200",
  advertencia: "bg-yellow-50 text-yellow-700 border-yellow-200",
  ok: "bg-slate-100 text-slate-600 border-slate-200",
};

const nivelLabel: Record<Lote["nivel"], string> = {
  critico: "Crítico",
  proximo: "Próximo",
  advertencia: "Advertencia",
  ok: "OK",
};

export default function ProductosAVencerPage() {
  const [dias, setDias] = useState<number>(30);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [counts, setCounts] = useState<Counts>({ critico: 0, proximo: 0, advertencia: 0, total: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const r = await fetchWithSupabaseSession(
          `/api/lotes/proximos-vencer?dias=${dias}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (cancel) return;
        if (!r.ok || !j?.success) {
          setError(j?.error ?? "No se pudo cargar el reporte.");
          setLotes([]);
          setCounts({ critico: 0, proximo: 0, advertencia: 0, total: 0 });
        } else {
          setLotes((j.data?.lotes ?? []) as Lote[]);
          setCounts(
            (j.data?.counts ?? { critico: 0, proximo: 0, advertencia: 0, total: 0 }) as Counts
          );
        }
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : "Error de red");
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [dias]);

  async function exportarExcel() {
    // Antes generábamos CSV con comas, pero Excel es-PY usa `;` como
    // separador → todo caía en la columna A. Ahora exportamos un .xlsx
    // real (SheetJS) para que abra como tabla en cualquier locale.
    const XLSX = await import("xlsx");
    const encabezado = [
      "Producto",
      "SKU",
      "Nº lote",
      "Cantidad",
      "Fecha vencimiento",
      "Días restantes",
      "Nivel",
    ];
    const filas = lotes.map((l) => [
      l.producto_nombre,
      l.producto_sku,
      l.numero_lote,
      Number(l.cantidad),
      l.fecha_vencimiento,
      Number(l.dias_restantes),
      nivelLabel[l.nivel],
    ]);
    const ws = XLSX.utils.aoa_to_sheet([encabezado, ...filas]);
    ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos a vencer");
    XLSX.writeFile(wb, `productos-a-vencer-${dias}d.xlsx`);
  }

  const totalKpi = useMemo(() => counts.total, [counts.total]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
            Productos a vencer
          </h1>
          <p className="text-gray-600">
            Lotes activos con vencimiento en los próximos {dias} días. Los más urgentes van arriba.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-600">Ventana:</label>
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 outline-none"
          >
            {DIAS_OPCIONES.map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportarExcel}
            disabled={lotes.length === 0}
            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Crítico ≤7 d" value={counts.critico} tone="red" />
        <KpiCard label="Próximo ≤15 d" value={counts.proximo} tone="amber" />
        <KpiCard label="Advertencia ≤30 d" value={counts.advertencia} tone="yellow" />
        <KpiCard label="Total en ventana" value={totalKpi} tone="slate" />
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500 animate-pulse">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : lotes.length === 0 ? (
        <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-6 text-center">
          Ningún lote activo vence en los próximos {dias} días. Todo bajo control.
        </p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[720px] table-auto text-sm text-left border-collapse">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="py-2.5 px-3 font-medium">Producto</th>
                <th className="py-2.5 px-3 font-medium">SKU</th>
                <th className="py-2.5 px-3 font-medium">Nº lote</th>
                <th className="py-2.5 px-3 font-medium text-right">Cantidad</th>
                <th className="py-2.5 px-3 font-medium">Vencimiento</th>
                <th className="py-2.5 px-3 font-medium text-right">Días restantes</th>
                <th className="py-2.5 px-3 font-medium">Nivel</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-2 px-3 font-medium text-slate-800">
                    <Link
                      href={`/inventario/${l.producto_id}/editar`}
                      className="hover:text-sky-700 hover:underline"
                    >
                      {l.producto_nombre}
                    </Link>
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-slate-500">{l.producto_sku}</td>
                  <td className="py-2 px-3 font-mono text-xs">{l.numero_lote}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{l.cantidad}</td>
                  <td className="py-2 px-3">{l.fecha_vencimiento}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {l.dias_restantes < 0 ? (
                      <span className="text-red-700 font-semibold">
                        vencido hace {-l.dias_restantes} d
                      </span>
                    ) : (
                      <span>{l.dias_restantes} d</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${nivelBadge[l.nivel]}`}
                    >
                      {nivelLabel[l.nivel]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "yellow" | "slate";
}) {
  const cls =
    tone === "red"
      ? "bg-red-50 border-red-200 text-red-700"
      : tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-700"
      : tone === "yellow"
      ? "bg-yellow-50 border-yellow-200 text-yellow-700"
      : "bg-slate-50 border-slate-200 text-slate-700";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}
