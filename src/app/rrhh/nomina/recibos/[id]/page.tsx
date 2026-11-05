"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { Iniciales } from "@/components/rrhh/EmpleadoBadges";
import {
  DIAS_MES,
  IPS_PATRONAL_PCT,
  IPS_TRABAJADOR_PCT,
  conIpsRecalculado,
  lineaSalario,
  nombreMes,
  totalesRecibo,
  type Descuento,
  type Ingreso,
  type TipoDescuento,
} from "@/lib/rrhh/nomina-py";
import { FileText, Minus, Plus, X } from "lucide-react";

export const dynamic = "force-dynamic";

type Recibo = {
  id: string;
  empleado_id: string;
  periodo_desde: string;
  periodo_hasta: string;
  dias_trabajados: number | null;
  empresa_nombre_snapshot: string | null;
  empleado_nombre_snapshot: string | null;
  empleado_documento_snapshot: string | null;
  empleado_afiliacion_ips_snapshot: string | null;
  empleado_cargo_snapshot: string | null;
  estado: string;
  observaciones: string | null;
};

/** Lo que más se agrega a un recibo, a un clic. */
const INGRESOS_RAPIDOS: Array<{ concepto: string; es_salarial: boolean; hint: string }> = [
  { concepto: "Horas extra", es_salarial: true, hint: "aporta IPS" },
  { concepto: "Comisiones", es_salarial: true, hint: "aporta IPS" },
  { concepto: "Bonificación familiar", es_salarial: false, hint: "no aporta IPS" },
  { concepto: "Otro ingreso", es_salarial: true, hint: "" },
];
const DESCUENTOS_RAPIDOS: Array<{ tipo: TipoDescuento; concepto: string }> = [
  { tipo: "prestamo", concepto: "Anticipo de salario" },
  { tipo: "prestamo", concepto: "Préstamo" },
  { tipo: "judicial", concepto: "Embargo judicial" },
  { tipo: "otro", concepto: "Otro descuento" },
];

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const esSalario = (i: Ingreso) => /^(salario|jornales)/i.test(i.concepto);

export default function ReciboPage() {
  const params = useParams();
  const id = params?.id as string | undefined;
  const [cab, setCab] = useState<Recibo | null>(null);
  const [empleado, setEmpleado] = useState<{ salario_base: number; tipo_periodo: string | null } | null>(null);
  const [ingresos, setIngresos] = useState<Ingreso[]>([]);
  const [descuentos, setDescuentos] = useState<Descuento[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetchWithSupabaseSession(`/api/rrhh/nomina/recibos/${id}`, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as {
          success?: boolean; error?: string;
          data?: { recibo: Recibo; devengos: Ingreso[]; deducciones: Descuento[] };
        };
        if (!r.ok || !j.success || !j.data) { setMsg({ ok: false, text: j.error ?? "No se pudo cargar" }); return; }
        setCab(j.data.recibo);
        setIngresos(j.data.devengos.map((d) => ({ ...d, importe_total: Math.round(Number(d.importe_total) || 0) })));
        setDescuentos(j.data.deducciones.map((d) => ({ ...d, importe: Math.round(Number(d.importe) || 0) })));
        const e = await fetchWithSupabaseSession(`/api/rrhh/empleados/${j.data.recibo.empleado_id}`, { cache: "no-store" });
        const je = (await e.json().catch(() => ({}))) as { data?: { empleado?: { salario_base?: number; tipo_periodo?: string | null } } };
        if (je?.data?.empleado) {
          setEmpleado({ salario_base: Number(je.data.empleado.salario_base) || 0, tipo_periodo: je.data.empleado.tipo_periodo ?? null });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // El IPS siempre acompaña a lo que se cobra (el servidor hace la misma cuenta).
  const descuentosVista = useMemo(() => conIpsRecalculado(ingresos, descuentos), [ingresos, descuentos]);
  const tot = useMemo(() => totalesRecibo(ingresos, descuentosVista), [ingresos, descuentosVista]);
  const ipsTrab = descuentosVista.find((d) => d.tipo === "ips_trabajador");
  const ipsPatr = descuentosVista.find((d) => d.tipo === "ips_patronal");
  const otrosDescuentos = descuentos.map((d, i) => ({ d, i })).filter(({ d }) => d.tipo !== "ips_trabajador" && d.tipo !== "ips_patronal");

  const marcar = () => { setDirty(true); setMsg(null); };

  function cambiarDias(dias: number) {
    if (!cab) return;
    const d = Math.max(0, Math.min(DIAS_MES, Math.trunc(dias) || 0));
    setCab({ ...cab, dias_trabajados: d });
    // La línea de salario se recalcula con los días; el resto no se toca.
    if (empleado && empleado.salario_base > 0) {
      const nueva = lineaSalario(empleado.salario_base, d, empleado.tipo_periodo);
      setIngresos((xs) => {
        const i = xs.findIndex(esSalario);
        return i === -1 ? [nueva, ...xs] : xs.map((x, k) => (k === i ? nueva : x));
      });
    }
    marcar();
  }

  const setIngreso = (i: number, patch: Partial<Ingreso>) => { setIngresos((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x))); marcar(); };
  const setDescuento = (i: number, patch: Partial<Descuento>) => { setDescuentos((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x))); marcar(); };

  async function guardar() {
    if (!cab || !id) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/rrhh/nomina/recibos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dias_trabajados: cab.dias_trabajados ?? DIAS_MES,
          total_dias: DIAS_MES,
          observaciones: cab.observaciones,
          devengos: ingresos,
          deducciones: descuentos.filter((d) => d.tipo !== "ips_trabajador" && d.tipo !== "ips_patronal"),
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: { deducciones?: Descuento[] } };
      if (r.ok && j.success) {
        if (j.data?.deducciones) setDescuentos(j.data.deducciones);
        setDirty(false);
        setMsg({ ok: true, text: "Recibo guardado." });
        setTimeout(() => setMsg(null), 2500);
      } else {
        setMsg({ ok: false, text: j.error ?? "No se pudo guardar" });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  if (!cab) return <div className="p-6 text-sm text-rose-600">{msg?.text ?? "Recibo no encontrado"}</div>;

  const nombre = cab.empleado_nombre_snapshot ?? "Empleado";

  return (
    <div className="space-y-6">
      <Link href="/rrhh/nomina/recibos" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-[#3F8E91]">
        <span aria-hidden>←</span> Salarios de {nombreMes(cab.periodo_desde)}
      </Link>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Iniciales nombre={nombre} grande />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3F8E91]">Recibo de salario · <span className="capitalize">{nombreMes(cab.periodo_desde)}</span></p>
            <h1 className="truncate text-xl font-bold text-slate-900">{nombre}</h1>
            <p className="text-xs text-slate-500">
              {[cab.empleado_cargo_snapshot, cab.empleado_documento_snapshot ? `CI ${cab.empleado_documento_snapshot}` : null,
                cab.empleado_afiliacion_ips_snapshot ? `IPS ${cab.empleado_afiliacion_ips_snapshot}` : null].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href={`/api/rrhh/nomina/recibos/${cab.id}/pdf`} target="_blank" rel="noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${dirty ? "pointer-events-none opacity-50" : ""}`}
            title={dirty ? "Guardá primero" : "Imprimir el recibo"}>
            <FileText className="h-4 w-4" /> Imprimir
          </a>
          <button onClick={guardar} disabled={saving || !dirty}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
            {saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{msg.text}</div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Días */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Días trabajados</h2>
              <p className="text-xs text-slate-500">El mes se liquida sobre 30 días. Con menos, el salario se ajusta solo.</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => cambiarDias((cab.dias_trabajados ?? DIAS_MES) - 1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Un día menos"><Minus className="h-4 w-4" /></button>
              <input type="number" min={0} max={30} value={cab.dias_trabajados ?? DIAS_MES} onChange={(e) => cambiarDias(Number(e.target.value))}
                className="w-16 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-semibold tabular-nums" />
              <button type="button" onClick={() => cambiarDias((cab.dias_trabajados ?? DIAS_MES) + 1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Un día más"><Plus className="h-4 w-4" /></button>
            </div>
          </section>

          {/* Ingresos */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Ingresos</h2>
              <span className="text-sm font-semibold tabular-nums text-slate-800">{gs(tot.total_ingresos)}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {ingresos.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">Sin ingresos. El empleado no tiene salario cargado en su ficha.</p>}
              {ingresos.map((x, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <input value={x.concepto} onChange={(e) => setIngreso(i, { concepto: e.target.value })}
                    className="min-w-[160px] flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none" />
                  {x.cantidad != null && x.importe_unitario != null && (
                    <span className="text-xs text-slate-400">{x.cantidad} × {gs(x.importe_unitario)}</span>
                  )}
                  <button type="button" onClick={() => setIngreso(i, { es_salarial: !x.es_salarial })}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${x.es_salarial ? "bg-[#4FAEB2]/10 text-[#3F8E91] ring-[#4FAEB2]/30" : "bg-slate-50 text-slate-500 ring-slate-200"}`}
                    title="Si aporta o no al IPS">
                    {x.es_salarial ? "aporta IPS" : "no aporta IPS"}
                  </button>
                  <MontoGs value={x.importe_total} onChange={(v) => setIngreso(i, { importe_total: v, cantidad: null, importe_unitario: null })} />
                  <button type="button" onClick={() => { setIngresos((xs) => xs.filter((_, k) => k !== i)); marcar(); }}
                    className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
              {INGRESOS_RAPIDOS.map((q) => (
                <button key={q.concepto} type="button" title={q.hint}
                  onClick={() => { setIngresos((xs) => [...xs, { concepto: q.concepto, cantidad: null, importe_unitario: null, importe_total: 0, es_salarial: q.es_salarial }]); marcar(); }}
                  className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91]">
                  + {q.concepto}
                </button>
              ))}
            </div>
          </section>

          {/* Descuentos */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Descuentos</h2>
              <span className="text-sm font-semibold tabular-nums text-slate-800">− {gs(tot.total_descuentos)}</span>
            </div>
            <div className="divide-y divide-slate-100">
              <div className="flex items-center gap-3 bg-slate-50/50 px-5 py-3">
                <span className="flex-1 text-sm font-medium text-slate-800">
                  IPS · aporte del trabajador
                  <span className="ml-2 text-xs font-normal text-slate-400">{IPS_TRABAJADOR_PCT}% de {gs(ipsTrab?.base ?? 0)} · se calcula solo</span>
                </span>
                <span className="w-36 text-right text-sm font-semibold tabular-nums text-slate-700">{gs(ipsTrab?.importe ?? 0)}</span>
                <span className="w-6" />
              </div>
              {otrosDescuentos.map(({ d, i }) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <input value={d.concepto} onChange={(e) => setDescuento(i, { concepto: e.target.value })}
                    className="min-w-[160px] flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none" />
                  <MontoGs value={d.importe} onChange={(v) => setDescuento(i, { importe: v, base: null, tipo_pct: null })} />
                  <button type="button" onClick={() => { setDescuentos((xs) => xs.filter((_, k) => k !== i)); marcar(); }}
                    className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
              {DESCUENTOS_RAPIDOS.map((q) => (
                <button key={q.concepto} type="button"
                  onClick={() => { setDescuentos((xs) => [...xs, { tipo: q.tipo, concepto: q.concepto, base: null, tipo_pct: null, importe: 0 }]); marcar(); }}
                  className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91]">
                  + {q.concepto}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="text-xs font-medium text-slate-600">Observaciones (salen en el recibo)</label>
            <textarea rows={2} value={cab.observaciones ?? ""} onChange={(e) => { setCab({ ...cab, observaciones: e.target.value }); marcar(); }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
          </section>
        </div>

        {/* Resumen, siempre a la vista */}
        <aside className="h-fit space-y-4 lg:sticky lg:top-4">
          <div className="rounded-xl border border-[#4FAEB2]/30 bg-gradient-to-b from-[#4FAEB2]/10 to-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[#3F8E91]">Neto a cobrar</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{gs(tot.neto)}</p>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Ingresos</dt><dd className="tabular-nums text-slate-800">{gs(tot.total_ingresos)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Descuentos</dt><dd className="tabular-nums text-slate-800">− {gs(tot.total_descuentos)}</dd></div>
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Para la empresa</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">IPS patronal ({String(IPS_PATRONAL_PCT).replace(".", ",")}%)</dt><dd className="tabular-nums text-slate-800">{gs(ipsPatr?.importe ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">IPS a depositar (total)</dt><dd className="tabular-nums text-slate-800">{gs((ipsPatr?.importe ?? 0) + (ipsTrab?.importe ?? 0))}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold"><dt className="text-slate-700">Costo total</dt><dd className="tabular-nums text-slate-900">{gs(tot.costo_empresa)}</dd></div>
            </dl>
            <p className="mt-3 text-[11px] text-slate-400">El aporte patronal no se descuenta al trabajador ni sale en su recibo.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Monto en guaraníes con separador de miles mientras se escribe. */
function MontoGs({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative w-36">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">Gs.</span>
      <input inputMode="numeric" value={value ? Math.round(value).toLocaleString("es-PY") : ""} placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
        className="w-full rounded-lg border border-slate-200 py-1.5 pl-9 pr-2.5 text-right text-sm font-semibold tabular-nums focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
    </div>
  );
}
