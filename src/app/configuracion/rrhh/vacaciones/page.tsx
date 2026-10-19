"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export const dynamic = "force-dynamic";

type Politica = {
  dias_anuales: number;
  tipo_computo: "naturales" | "laborables";
  proporcional_ingreso: boolean;
  requiere_aprobacion: boolean;
  permitir_saldo_negativo: boolean;
  arrastra_pendientes: boolean;
  arrastra_dias_max: number | null;
  pais_region: string | null;
  // Fase H
  dias_empresa: number | null;
  dias_empleado: number | null;
};

const DEFAULTS: Politica = {
  dias_anuales: 30,
  tipo_computo: "naturales",
  proporcional_ingreso: true,
  requiere_aprobacion: true,
  permitir_saldo_negativo: false,
  arrastra_pendientes: false,
  arrastra_dias_max: null,
  pais_region: "ES",
  dias_empresa: 15,
  dias_empleado: 15,
};

const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
const label = "block text-sm font-medium text-slate-700 mb-1.5";

export default function PoliticaVacacionesPage() {
  const [p, setP] = useState<Politica>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/rrhh/vacaciones/politica", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { politica?: Politica } }) => {
        if (j?.success && j.data?.politica) setP({ ...DEFAULTS, ...j.data.politica });
      })
      .finally(() => setLoading(false));
  }, []);

  async function guardar() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/vacaciones/politica", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      setMsg(j.success ? "Política guardada." : j.error ?? "No se pudo guardar");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Configuración"
        title="Política de vacaciones"
        description="Reglas globales que aplican al cálculo de días, saldos y solicitudes."
        backHref="/configuracion"
        backLabel="Configuración"
      />

      <div className="rounded-xl border border-slate-200 bg-white p-5 max-w-3xl space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Días anuales por defecto</label>
            <input type="number" min={0} max={365} className={input}
              value={p.dias_anuales}
              onChange={(e) => setP({ ...p, dias_anuales: Number(e.target.value) || 0 })} />
            <p className="mt-1 text-xs text-slate-500">España: 30 naturales o 22 laborables.</p>
          </div>
          <div>
            <label className={label}>Tipo de cómputo</label>
            <select className={input} value={p.tipo_computo}
              onChange={(e) => setP({ ...p, tipo_computo: e.target.value === "laborables" ? "laborables" : "naturales" })}>
              <option value="naturales">Días naturales (incluye fines de semana y festivos)</option>
              <option value="laborables">Días laborables (solo lunes a viernes)</option>
            </select>
          </div>
        </div>

        {/* Fase H · Desglose empresa/empleado */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <h4 className="text-sm font-semibold text-slate-800">Desglose empresa / empleado</h4>
          <p className="text-xs text-slate-500">
            Del total anual, cuántos días los define la empresa y cuántos elige el empleado.
            Dejá en blanco si no querés distinguir. Suma sugerida = total anual.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={label}>Días definidos por la empresa</label>
              <input type="number" min={0} max={365} className={input}
                value={p.dias_empresa ?? ""}
                placeholder="Ej. 15"
                onChange={(e) => setP({ ...p, dias_empresa: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
            </div>
            <div>
              <label className={label}>Días elegidos por el empleado</label>
              <input type="number" min={0} max={365} className={input}
                value={p.dias_empleado ?? ""}
                placeholder="Ej. 15"
                onChange={(e) => setP({ ...p, dias_empleado: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
            </div>
          </div>
          {p.dias_empresa !== null && p.dias_empleado !== null && (p.dias_empresa + p.dias_empleado) !== p.dias_anuales && (
            <p className="mt-2 text-xs text-amber-700">
              Aviso: la suma ({(p.dias_empresa ?? 0) + (p.dias_empleado ?? 0)}) no coincide con los días anuales ({p.dias_anuales}). Podés dejarlo así si el convenio lo requiere.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Switch
            label="Calcular proporcional por fecha de ingreso"
            hint="Si está activo: empleados que ingresan a mitad de año tienen días proporcionales al tiempo trabajado."
            checked={p.proporcional_ingreso}
            onChange={(v) => setP({ ...p, proporcional_ingreso: v })}
          />
          <Switch
            label="Requiere aprobación"
            hint="Si está activo: las solicitudes nacen como pendientes y un admin las aprueba. Si está apagado: se aprueban al instante."
            checked={p.requiere_aprobacion}
            onChange={(v) => setP({ ...p, requiere_aprobacion: v })}
          />
          <Switch
            label="Permitir saldo negativo"
            hint="Permitir que un empleado solicite más días de los que tiene disponibles."
            checked={p.permitir_saldo_negativo}
            onChange={(v) => setP({ ...p, permitir_saldo_negativo: v })}
          />
          <Switch
            label="Arrastrar días pendientes al año siguiente"
            checked={p.arrastra_pendientes}
            onChange={(v) => setP({ ...p, arrastra_pendientes: v })}
          />
        </div>

        {p.arrastra_pendientes && (
          <div className="max-w-xs">
            <label className={label}>Máximo de días a arrastrar <span className="text-xs font-normal text-slate-400">(opcional)</span></label>
            <input type="number" min={0} className={input}
              value={p.arrastra_dias_max ?? ""}
              onChange={(e) => setP({ ...p, arrastra_dias_max: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
          </div>
        )}

        <div className="max-w-xs">
          <label className={label}>País / región (calendario de festivos)</label>
          <input className={input} value={p.pais_region ?? ""} placeholder="ES"
            onChange={(e) => setP({ ...p, pais_region: e.target.value || null })} />
          <p className="mt-1 text-xs text-slate-500">Reservado para Fase 2 (cargar festivos por región).</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
          <button type="button" onClick={guardar} disabled={saving}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar política"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ label: lab, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <label className="inline-flex items-center mt-1">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300" />
      </label>
      <div>
        <p className="text-sm font-medium text-slate-800">{lab}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
