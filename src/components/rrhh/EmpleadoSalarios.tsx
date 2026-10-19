"use client";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Salario = {
  id: string;
  fecha_vigencia_desde: string;
  fecha_vigencia_hasta: string | null;
  salario_bruto: number;
  salario_neto: number | null;
  plus_peligrosidad: number;
  plus_prl: number;
  coste_empresa: number | null;
  moneda: string;
  observaciones: string | null;
};

function fmt(n: number | null, moneda = "PYG") {
  if (n == null) return "—";
  const pref = moneda === "USD" ? "USD " : "Gs ";
  return pref + new Intl.NumberFormat("es-PY").format(Math.round(n));
}

export default function EmpleadoSalarios({ empleadoId }: { empleadoId: string }) {
  const [salarios, setSalarios] = useState<Salario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fecha_vigencia_desde: new Date().toISOString().slice(0, 10),
    fecha_vigencia_hasta: "",
    salario_bruto: "",
    salario_neto: "",
    plus_peligrosidad: "",
    plus_prl: "",
    coste_empresa: "",
    moneda: "PYG",
    observaciones: "",
  });

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/salarios`);
      const j = await res.json();
      if (!res.ok) {
        if (res.status === 403) { setError("No tenés permiso para ver salarios."); return; }
        throw new Error(j.error || "Error");
      }
      if (!j.success) throw new Error(j.error || "Error");
      setSalarios((j.data?.salarios ?? []) as Salario[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, [empleadoId]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fecha_vigencia_desde) return alert("Fecha desde obligatoria");
    setSaving(true);
    try {
      const payload = {
        ...form,
        salario_bruto: Number(form.salario_bruto) || 0,
        salario_neto: form.salario_neto === "" ? null : Number(form.salario_neto),
        plus_peligrosidad: Number(form.plus_peligrosidad) || 0,
        plus_prl: Number(form.plus_prl) || 0,
        coste_empresa: form.coste_empresa === "" ? null : Number(form.coste_empresa),
        fecha_vigencia_hasta: form.fecha_vigencia_hasta || null,
      };
      const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/salarios`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setShowForm(false);
      setForm({ ...form, salario_bruto: "", salario_neto: "", plus_peligrosidad: "", plus_prl: "", coste_empresa: "", observaciones: "" });
      cargar();
    } catch (err) { alert(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  async function eliminar(s: Salario) {
    if (!confirm(`¿Eliminar tramo desde ${s.fecha_vigencia_desde}?`)) return;
    const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/salarios/${s.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.success) return alert(j.error || "Error");
    cargar();
  }

  if (error === "No tenés permiso para ver salarios.") {
    return null;  // no mostrar sección si no tiene permiso
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Histórico salarial</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-xs font-medium">
          {showForm ? "Cancelar" : "+ Nuevo tramo"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={agregar} className="mb-4 p-3 border border-slate-200 rounded-md grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className="text-xs text-slate-600">Desde *</label>
            <input required type="date" value={form.fecha_vigencia_desde} onChange={(e) => setForm({ ...form, fecha_vigencia_desde: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Hasta</label>
            <input type="date" value={form.fecha_vigencia_hasta} onChange={(e) => setForm({ ...form, fecha_vigencia_hasta: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Moneda</label>
            <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm">
              <option value="PYG">Guaraníes</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div />
          <div>
            <label className="text-xs text-slate-600">Salario bruto *</label>
            <input required type="number" min="0" value={form.salario_bruto} onChange={(e) => setForm({ ...form, salario_bruto: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Salario neto</label>
            <input type="number" min="0" value={form.salario_neto} onChange={(e) => setForm({ ...form, salario_neto: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Adic. insalubridad</label>
            <input type="number" min="0" value={form.plus_peligrosidad} onChange={(e) => setForm({ ...form, plus_peligrosidad: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Adic. EPP/seguridad</label>
            <input type="number" min="0" value={form.plus_prl} onChange={(e) => setForm({ ...form, plus_prl: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-600">Costo empresa (con aportes)</label>
            <input type="number" min="0" value={form.coste_empresa} onChange={(e) => setForm({ ...form, coste_empresa: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="text-xs text-slate-600">Observaciones</label>
            <input value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm"
              placeholder="Ej: aumento por antigüedad, cambio de cargo, etc." />
          </div>
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar tramo"}
            </button>
          </div>
        </form>
      )}

      {loading ? <p className="text-sm text-slate-400">Cargando…</p> : (
        error ? <p className="text-sm text-red-600">Error: {error}</p> :
        salarios.length === 0 ? <p className="text-sm text-slate-400">Sin historial salarial.</p> :
        <div className="border border-slate-200 rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Desde</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Hasta</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Bruto</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Neto</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Adic. insal.</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Adic. EPP</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Costo empresa</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {salarios.map((s, idx) => (
                <tr key={s.id} className={`border-t border-slate-100 ${idx === 0 && !s.fecha_vigencia_hasta ? "bg-emerald-50/40" : ""}`}>
                  <td className="px-3 py-2 text-slate-700">{s.fecha_vigencia_desde}</td>
                  <td className="px-3 py-2 text-slate-600">{s.fecha_vigencia_hasta ?? <span className="text-emerald-600 text-xs font-medium">Vigente</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(s.salario_bruto, s.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(s.salario_neto, s.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s.plus_peligrosidad > 0 ? fmt(s.plus_peligrosidad, s.moneda) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s.plus_prl > 0 ? fmt(s.plus_prl, s.moneda) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(s.coste_empresa, s.moneda)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => eliminar(s)} className="text-xs text-red-600 hover:text-red-800">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
