"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { CalendarDays, Scale } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Política de vacaciones.
 *
 * Los días los fija la ley paraguaya (art. 218 del Código del Trabajo), no la
 * empresa: acá se muestran, no se editan. Antes esta pantalla venía armada
 * para España (30 días naturales, 15 de la empresa y 15 del empleado,
 * proporcional por año calendario).
 *
 * Lo único que decide la casa es si se pueden adelantar vacaciones. "Requiere
 * aprobación" no está: la pantalla de Vacaciones registra siempre aprobado, y
 * una casilla que no hace nada es peor que no tenerla.
 */

type Politica = { permitir_saldo_negativo: boolean } & Record<string, unknown>;

const TRAMOS: [string, string][] = [
  ["Hasta 5 años de antigüedad", "12 días hábiles"],
  ["Más de 5 y hasta 10 años", "18 días hábiles"],
  ["Más de 10 años", "30 días hábiles"],
];

export default function PoliticaVacacionesPage() {
  const [p, setP] = useState<Politica>({ permitir_saldo_negativo: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/rrhh/vacaciones/politica", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { politica?: Politica } }) => {
        if (j?.success && j.data?.politica) setP({ ...j.data.politica, permitir_saldo_negativo: j.data.politica.permitir_saldo_negativo === true });
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
        // Se guarda la regla paraguaya en las columnas viejas, para que nada
        // que todavía las lea vuelva a ver los valores de España.
        body: JSON.stringify({
          dias_anuales: 12,
          tipo_computo: "laborables",
          proporcional_ingreso: false,
          requiere_aprobacion: false,
          permitir_saldo_negativo: p.permitir_saldo_negativo,
          arrastra_pendientes: true,
          arrastra_dias_max: null,
          pais_region: "PY",
          dias_empresa: null,
          dias_empleado: null,
        }),
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
        eyebrow="Configuración · RRHH"
        title="Política de vacaciones"
        description="Cómo se calculan las vacaciones según la ley paraguaya."
        backHref="/rrhh/vacaciones"
        backLabel="Vacaciones"
      />

      <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#3F8E91]"><Scale className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Lo que dice la ley</h2>
              <p className="text-xs text-slate-500">Código del Trabajo, art. 218</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {TRAMOS.map(([a, d]) => (
                <tr key={a}>
                  <td className="py-2.5 text-slate-600">{a}</td>
                  <td className="py-2.5 text-right font-semibold text-slate-800">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-4 space-y-1.5 text-xs text-slate-500">
            <li>· El derecho nace después de <b className="text-slate-700">cada año de trabajo continuo</b>, contado desde la fecha de ingreso.</li>
            <li>· Se cuentan <b className="text-slate-700">días hábiles: de lunes a sábado</b>. Domingos y feriados no se descuentan.</li>
            <li>· Se pueden acumular <b className="text-slate-700">hasta dos períodos</b>; lo más viejo deja de sumar al saldo.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#3F8E91]"><CalendarDays className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Lo que decide la empresa</h2>
              <p className="text-xs text-slate-500">Sobre el mínimo de la ley</p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input type="checkbox" checked={p.permitir_saldo_negativo}
              onChange={(e) => setP({ ...p, permitir_saldo_negativo: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]" />
            <span>
              <span className="block text-sm font-medium text-slate-800">Permitir adelantar vacaciones</span>
              <span className="block text-xs text-slate-500">
                Dejar registrar más días de los que el empleado tiene disponibles, por ejemplo antes de cumplir su
                primer año. Apagado, el sistema no lo deja.
              </span>
            </span>
          </label>

          <p className="mt-4 text-xs text-slate-500">
            Los feriados que el gobierno traslada cada año (1 de marzo, 12 de junio, 29 de septiembre) se cargan en{" "}
            <Link href="/rrhh/feriados-ausencias?tab=feriados" className="font-medium text-[#3F8E91] hover:underline">RRHH → Feriados</Link>.
            Los de fecha fija y la Semana Santa ya los conoce el sistema.
          </p>

          <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
            <button type="button" onClick={guardar} disabled={saving}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
