"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export const dynamic = "force-dynamic";

type Recibo = {
  id: string;
  empleado_id: string;
  periodo_desde: string;
  periodo_hasta: string;
  total_dias: number;
  dias_trabajados: number;
  empresa_nombre_snapshot: string | null;
  empresa_ruc_snapshot: string | null;
  empresa_ips_patronal_snapshot: string | null;
  empresa_centro_snapshot: string | null;
  empleado_nombre_snapshot: string | null;
  empleado_documento_snapshot: string | null;
  empleado_afiliacion_ips_snapshot: string | null;
  empleado_categoria_ips_snapshot: string | null;
  empleado_cargo_snapshot: string | null;
  empleado_antiguedad_snapshot: string | null;
  total_devengado: number;
  total_deducciones: number;
  liquido: number;
  coste_empresa: number;
  estado: string;
  observaciones: string | null;
};

type Devengo = {
  id?: string;
  concepto: string;
  cantidad: number | null;
  importe_unitario: number | null;
  importe_total: number;
  es_salarial: boolean;
  orden: number;
};
type Deduccion = {
  id?: string;
  tipo: "ips_trabajador" | "prestamo" | "otro" | "ips_patronal";
  concepto: string;
  base: number | null;
  tipo_pct: number | null;
  importe: number;
  orden: number;
};

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numn = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number) => (Number(n) || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RecibePage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const [cab, setCab] = useState<Recibo | null>(null);
  const [devengos, setDevengos] = useState<Devengo[]>([]);
  const [deducciones, setDeducciones] = useState<Deduccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchWithSupabaseSession(`/api/rrhh/nomina/recibos/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { recibo: Recibo; devengos: Devengo[]; deducciones: Deduccion[] }; error?: string };
        if (r.ok && j.success && j.data) {
          setCab(j.data.recibo);
          setDevengos(j.data.devengos.map((d, i) => ({ ...d, orden: d.orden ?? i })));
          setDeducciones(j.data.deducciones.map((d, i) => ({ ...d, orden: d.orden ?? i })));
          setErr(null);
        } else setErr(j.error ?? "No se pudo cargar");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const totalDevengado = useMemo(() => devengos.reduce((a, d) => a + num(d.importe_total), 0), [devengos]);
  const totalDeducTrab = useMemo(
    () => deducciones.filter((d) => d.tipo !== "ips_patronal").reduce((a, d) => a + num(d.importe), 0),
    [deducciones]
  );
  const totalAportEmp = useMemo(
    () => deducciones.filter((d) => d.tipo === "ips_patronal").reduce((a, d) => a + num(d.importe), 0),
    [deducciones]
  );
  const liquido = totalDevengado - totalDeducTrab;
  const costeEmpresa = totalDevengado + totalAportEmp;

  const setCabField = (k: keyof Recibo, v: unknown) => {
    if (!cab) return;
    setCab({ ...cab, [k]: v as never });
  };

  const addDevengo = (es_salarial = true) => {
    setDevengos((d) => [...d, { concepto: "", cantidad: null, importe_unitario: null, importe_total: 0, es_salarial, orden: d.length }]);
  };
  const updateDevengo = (i: number, patch: Partial<Devengo>) => {
    setDevengos((d) => d.map((x, idx) => {
      if (idx !== i) return x;
      const next = { ...x, ...patch };
      // Auto-cálculo si están cantidad y importe_unitario
      if (patch.cantidad !== undefined || patch.importe_unitario !== undefined) {
        if (next.cantidad !== null && next.importe_unitario !== null) {
          next.importe_total = Number((next.cantidad * next.importe_unitario).toFixed(2));
        }
      }
      return next;
    }));
  };
  const removeDevengo = (i: number) => setDevengos((d) => d.filter((_, idx) => idx !== i));

  const addDeduccion = (tipo: Deduccion["tipo"]) => {
    setDeducciones((d) => [...d, { tipo, concepto: "", base: null, tipo_pct: null, importe: 0, orden: d.length }]);
  };
  const updateDeduccion = (i: number, patch: Partial<Deduccion>) => {
    setDeducciones((d) => d.map((x, idx) => {
      if (idx !== i) return x;
      const next = { ...x, ...patch };
      if (patch.base !== undefined || patch.tipo_pct !== undefined) {
        if (next.base !== null && next.tipo_pct !== null) {
          next.importe = Number(((next.base * next.tipo_pct) / 100).toFixed(2));
        }
      }
      return next;
    }));
  };
  const removeDeduccion = (i: number) => setDeducciones((d) => d.filter((_, idx) => idx !== i));

  const guardar = async () => {
    if (!cab || !id) return;
    setSaving(true);
    const body = {
      periodo_desde: cab.periodo_desde,
      periodo_hasta: cab.periodo_hasta,
      total_dias: cab.total_dias,
      dias_trabajados: cab.dias_trabajados,
      estado: cab.estado,
      observaciones: cab.observaciones,
      devengos: devengos.map((d, i) => ({ ...d, orden: i })),
      deducciones: deducciones.map((d, i) => ({ ...d, orden: i })),
    };
    const r = await fetchWithSupabaseSession(`/api/rrhh/nomina/recibos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    setSaving(false);
    if (r.ok && j.success) {
      alert("Guardado");
    } else {
      alert(j.error ?? "Error al guardar");
    }
  };

  if (loading) return <div className="p-6 text-slate-500">Cargando…</div>;
  if (err || !cab) return <div className="p-6 text-rose-600">{err ?? "Recibo no encontrado"}</div>;

  const deducPorTipo = (tipo: Deduccion["tipo"]) => deducciones.map((d, i) => ({ d, i })).filter((x) => x.d.tipo === tipo);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Recibo · ${cab.periodo_desde}`}
        title={cab.empleado_nombre_snapshot ?? "Recibo"}
        description="Cargá los devengos y deducciones. Los totales se recalculan automáticamente."
        backHref="/rrhh/nomina/recibos"
        backLabel="Recibos"
        actions={
          <div className="flex items-center gap-2">
            <a href={`/api/rrhh/nomina/recibos/${cab.id}/pdf`} target="_blank" rel="noreferrer"
               className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">
              📄 Descargar PDF
            </a>
            <button onClick={guardar} disabled={saving}
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F9EA2] disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        }
      />

      {/* Cabecera */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Cabecera</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Periodo desde" type="date" value={cab.periodo_desde} onChange={(v) => setCabField("periodo_desde", v)} />
          <Field label="Periodo hasta" type="date" value={cab.periodo_hasta} onChange={(v) => setCabField("periodo_hasta", v)} />
          <Field label="Total días" type="number" value={String(cab.total_dias)} onChange={(v) => setCabField("total_dias", parseInt(v, 10) || 0)} />
          <Field label="Días cotizados" type="number" value={String(cab.dias_trabajados)} onChange={(v) => setCabField("dias_trabajados", parseInt(v, 10) || 0)} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          <strong>Empresa:</strong> {cab.empresa_nombre_snapshot ?? "—"} ({cab.empresa_ruc_snapshot ?? "sin RUC"}) ·{" "}
          <strong>IPS patronal:</strong> {cab.empresa_ips_patronal_snapshot ?? "—"} ·{" "}
          <strong>Centro:</strong> {cab.empresa_centro_snapshot ?? "—"}<br />
          <strong>Trabajador:</strong> {cab.empleado_nombre_snapshot} · RUC {cab.empleado_documento_snapshot ?? "—"} · Afiliación {cab.empleado_afiliacion_ips_snapshot ?? "—"} · Categoría IPS {cab.empleado_categoria_ips_snapshot ?? "—"} · Cargo {cab.empleado_cargo_snapshot ?? "—"}
        </p>
        <p className="mt-1 text-xs text-amber-700">
          Si faltan estos datos, editalos en la <a className="underline" href={`/rrhh/empleados`}>ficha del empleado</a> o en la configuración de la empresa, y volvé a crear el recibo (los snapshots se toman al crearlo).
        </p>
      </div>

      {/* Devengos */}
      <Seccion titulo="I. Devengos">
        <TablaDevengos devengos={devengos} onUpdate={updateDevengo} onRemove={removeDevengo} />
        <div className="flex gap-2 p-3">
          <button onClick={() => addDevengo(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">+ Concepto salarial</button>
          <button onClick={() => addDevengo(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">+ Concepto no salarial</button>
          <div className="ml-auto text-sm">
            <strong>Total devengado:</strong> <span className="font-bold">Gs {fmt(totalDevengado)}</span>
          </div>
        </div>
      </Seccion>

      {/* Deducciones */}
      <Seccion titulo="II. Deducciones">
        <TablaDeducciones titulo="1. Aportación del trabajador a la Seguridad Social y recaudación conjunta"
          rows={deducPorTipo("ips_trabajador")} onUpdate={updateDeduccion} onRemove={removeDeduccion}
          onAdd={() => addDeduccion("ips_trabajador")} />
        <TablaDeducciones titulo="2. I.R.P.F."
          rows={deducPorTipo("prestamo")} onUpdate={updateDeduccion} onRemove={removeDeduccion}
          onAdd={() => addDeduccion("prestamo")} />
        <TablaDeducciones titulo="3. Productos en especie"
          rows={deducPorTipo("otro")} onUpdate={updateDeduccion} onRemove={removeDeduccion}
          onAdd={() => addDeduccion("otro")} />
        <div className="flex items-center gap-4 border-t border-slate-100 p-3 text-sm">
          <div><strong>Total a deducir:</strong> Gs {fmt(totalDeducTrab)}</div>
          <div className="rounded-lg bg-[#E5F4F4] px-3 py-1.5 text-base font-bold text-[#0F6F73]">
            Líquido a percibir: Gs {fmt(liquido)}
          </div>
        </div>
      </Seccion>

      {/* Bases / Aportación empresa */}
      <Seccion titulo="Bases de cotización y aportación de la empresa">
        <TablaDeducciones titulo="Aportaciones de la empresa"
          rows={deducPorTipo("ips_patronal")} onUpdate={updateDeduccion} onRemove={removeDeduccion}
          onAdd={() => addDeduccion("ips_patronal")} />
        <div className="flex items-center justify-end gap-3 p-3 text-sm">
          <strong>Coste empresa:</strong> <span className="font-bold">Gs {fmt(costeEmpresa)}</span>
        </div>
      </Seccion>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">{titulo}</div>
      {children}
    </div>
  );
}

function TablaDevengos({ devengos, onUpdate, onRemove }: {
  devengos: Devengo[];
  onUpdate: (i: number, patch: Partial<Devengo>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50/60 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-xs font-semibold">Concepto</th>
            <th className="px-3 py-2 text-xs font-semibold text-right w-24">Cantidad</th>
            <th className="px-3 py-2 text-xs font-semibold text-right w-28">Importe Gs</th>
            <th className="px-3 py-2 text-xs font-semibold text-right w-32">Total Gs</th>
            <th className="px-3 py-2 text-xs font-semibold w-24">Tipo</th>
            <th className="px-3 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {devengos.map((d, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-3 py-1.5">
                <input value={d.concepto} onChange={(e) => onUpdate(i, { concepto: e.target.value })}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm" placeholder="Concepto" />
              </td>
              <td className="px-3 py-1.5">
                <input type="number" step="0.01" value={d.cantidad ?? ""} onChange={(e) => onUpdate(i, { cantidad: numn(e.target.value) })}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-right" />
              </td>
              <td className="px-3 py-1.5">
                <input type="number" step="0.01" value={d.importe_unitario ?? ""} onChange={(e) => onUpdate(i, { importe_unitario: numn(e.target.value) })}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-right" />
              </td>
              <td className="px-3 py-1.5">
                <input type="number" step="0.01" value={d.importe_total} onChange={(e) => onUpdate(i, { importe_total: num(e.target.value) })}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-right font-semibold" />
              </td>
              <td className="px-3 py-1.5">
                <select value={d.es_salarial ? "s" : "n"} onChange={(e) => onUpdate(i, { es_salarial: e.target.value === "s" })}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm">
                  <option value="s">Salarial</option>
                  <option value="n">No salarial</option>
                </select>
              </td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => onRemove(i)} className="text-rose-600 hover:underline text-xs">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaDeducciones({ titulo, rows, onUpdate, onRemove, onAdd }: {
  titulo: string;
  rows: Array<{ d: Deduccion; i: number }>;
  onUpdate: (i: number, patch: Partial<Deduccion>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="border-t border-slate-100">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50/40">
        <span className="text-xs font-semibold text-slate-700">{titulo}</span>
        <button onClick={onAdd} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs hover:bg-slate-50">+ Añadir</button>
      </div>
      {rows.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-xs">Concepto</th>
              <th className="px-3 py-1.5 text-xs text-right w-28">Base</th>
              <th className="px-3 py-1.5 text-xs text-right w-20">%</th>
              <th className="px-3 py-1.5 text-xs text-right w-28">Importe Gs</th>
              <th className="px-3 py-1.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, i }) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-1.5">
                  <input value={d.concepto} onChange={(e) => onUpdate(i, { concepto: e.target.value })}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" step="0.01" value={d.base ?? ""} onChange={(e) => onUpdate(i, { base: numn(e.target.value) })}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-right" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" step="0.01" value={d.tipo_pct ?? ""} onChange={(e) => onUpdate(i, { tipo_pct: numn(e.target.value) })}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-right" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" step="0.01" value={d.importe} onChange={(e) => onUpdate(i, { importe: num(e.target.value) })}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-right font-semibold" />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button onClick={() => onRemove(i)} className="text-rose-600 hover:underline text-xs">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
