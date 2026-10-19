"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Feriado = { id: string; fecha: string; nombre: string; ambito: string };
type Ausencia = {
  id: string;
  empleado_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: "reposo" | "vacaciones" | "permiso" | "baja" | "otro";
  observacion: string | null;
  empleados?: { nombre?: string } | { nombre?: string }[] | null;
};
type Empleado = { id: string; nombre: string };

const INPUT = "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none";
const LABEL = "text-xs font-semibold uppercase tracking-wider text-slate-500";

const TIPO_LABEL: Record<Ausencia["tipo"], string> = {
  reposo: "Reposo médico",
  vacaciones: "Vacaciones",
  permiso: "Permiso",
  baja: "Baja",
  otro: "Otro",
};

function ImportarEspanaBtn({ onDone, setMsg }: { onDone: () => void; setMsg: (m: string | null) => void }) {
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const importar = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/rrhh/feriados/importar-espana?anio=${anio}`, { method: "POST" });
      const j = await r.json();
      if (!j.success) { setMsg(j.error ?? "Error al importar"); return; }
      setMsg(`Importados ${j.data?.importados ?? 0} feriados de España ${anio}.`);
      onDone();
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={anio}
        onChange={(e) => setAnio(e.target.value)}
        className="w-20 border border-slate-200 rounded-md px-2 py-1 text-sm bg-white"
      />
      <button
        type="button"
        onClick={importar}
        disabled={loading}
        className="text-xs font-medium bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-3 py-1.5 rounded-md disabled:opacity-50"
      >
        {loading ? "Importando…" : "Importar feriados ES"}
      </button>
    </div>
  );
}

function empleadoNombre(a: Ausencia): string {
  const e = a.empleados;
  if (!e) return "—";
  if (Array.isArray(e)) return e[0]?.nombre ?? "—";
  return e.nombre ?? "—";
}

function formatFecha(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function FeriadosAusenciasPage() {
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);

  const [nuevoFeriado, setNuevoFeriado] = useState({ fecha: "", nombre: "" });
  const [nuevaAusencia, setNuevaAusencia] = useState({
    empleado_id: "",
    fecha_desde: "",
    fecha_hasta: "",
    tipo: "reposo" as Ausencia["tipo"],
    observacion: "",
  });
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [fR, aR, eR] = await Promise.all([
        fetchWithSupabaseSession("/api/rrhh/feriados"),
        fetchWithSupabaseSession("/api/rrhh/ausencias"),
        fetchWithSupabaseSession("/api/rrhh/empleados"),
      ]);
      const fJ = await fR.json();
      const aJ = await aR.json();
      const eJ = await eR.json();
      if (fJ.success) setFeriados(fJ.data?.feriados ?? []);
      if (aJ.success) setAusencias(aJ.data?.ausencias ?? []);
      const empList = (eJ.data?.empleados ?? eJ.empleados ?? []) as Array<{ id: string; nombre: string }>;
      setEmpleados(empList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const crearFeriado = async () => {
    setMsg(null);
    if (!nuevoFeriado.fecha || !nuevoFeriado.nombre.trim()) {
      setMsg("Fecha y nombre son requeridos.");
      return;
    }
    const r = await fetchWithSupabaseSession("/api/rrhh/feriados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevoFeriado),
    });
    const j = await r.json();
    if (!j.success) { setMsg(j.error ?? "Error"); return; }
    setNuevoFeriado({ fecha: "", nombre: "" });
    void cargar();
  };

  const borrarFeriado = async (id: string) => {
    if (!window.confirm("¿Eliminar este feriado?")) return;
    await fetchWithSupabaseSession(`/api/rrhh/feriados?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void cargar();
  };

  const crearAusencia = async () => {
    setMsg(null);
    if (!nuevaAusencia.empleado_id || !nuevaAusencia.fecha_desde || !nuevaAusencia.fecha_hasta) {
      setMsg("Empleado y rango de fechas son requeridos.");
      return;
    }
    const r = await fetchWithSupabaseSession("/api/rrhh/ausencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevaAusencia),
    });
    const j = await r.json();
    if (!j.success) { setMsg(j.error ?? "Error"); return; }
    setNuevaAusencia({ empleado_id: "", fecha_desde: "", fecha_hasta: "", tipo: "reposo", observacion: "" });
    void cargar();
  };

  const borrarAusencia = async (id: string) => {
    if (!window.confirm("¿Eliminar esta ausencia?")) return;
    await fetchWithSupabaseSession(`/api/rrhh/ausencias?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void cargar();
  };

  return (
    <div className="p-6 max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Zentra · RRHH"
        title="Feriados y ausencias"
        description="Se reflejan automáticamente en el reporte de marcaciones (fondo amarillo = feriado, rojo = ausencia, naranja = feriado trabajado)."
      />

      {msg && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{msg}</div>
      )}

      {/* Feriados */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800">Feriados</h2>
          <ImportarEspanaBtn onDone={() => { void cargar(); }} setMsg={setMsg} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Fecha</span>
            <input type="date" value={nuevoFeriado.fecha} onChange={(e) => setNuevoFeriado((f) => ({ ...f, fecha: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Nombre</span>
            <input type="text" placeholder="Ej. Día del Trabajador" value={nuevoFeriado.nombre} onChange={(e) => setNuevoFeriado((f) => ({ ...f, nombre: e.target.value }))} className={INPUT} />
          </label>
          <div className="flex items-end">
            <Button onClick={crearFeriado} variant="primary">Agregar</Button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : feriados.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No hay feriados cargados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left py-2">Fecha</th>
                <th className="text-left py-2">Nombre</th>
                <th className="text-right py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {feriados.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 tabular-nums">{formatFecha(f.fecha)}</td>
                  <td className="py-2 text-slate-800 font-medium">{f.nombre}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => borrarFeriado(f.id)} className="text-rose-600 hover:text-rose-700 text-xs">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Ausencias */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Ausencias por empleado</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Empleado</span>
            <select value={nuevaAusencia.empleado_id} onChange={(e) => setNuevaAusencia((a) => ({ ...a, empleado_id: e.target.value }))} className={INPUT}>
              <option value="">— Seleccionar —</option>
              {empleados.map((e) => (<option key={e.id} value={e.id}>{e.nombre}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Desde</span>
            <input type="date" value={nuevaAusencia.fecha_desde} onChange={(e) => setNuevaAusencia((a) => ({ ...a, fecha_desde: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Hasta</span>
            <input type="date" value={nuevaAusencia.fecha_hasta} onChange={(e) => setNuevaAusencia((a) => ({ ...a, fecha_hasta: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Tipo</span>
            <select value={nuevaAusencia.tipo} onChange={(e) => setNuevaAusencia((a) => ({ ...a, tipo: e.target.value as Ausencia["tipo"] }))} className={INPUT}>
              {Object.entries(TIPO_LABEL).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Observación</span>
            <input type="text" placeholder="Opcional" value={nuevaAusencia.observacion} onChange={(e) => setNuevaAusencia((a) => ({ ...a, observacion: e.target.value }))} className={INPUT} />
          </label>
        </div>
        <div className="mb-4">
          <Button onClick={crearAusencia} variant="primary">Agregar ausencia</Button>
        </div>
        {ausencias.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No hay ausencias cargadas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left py-2">Empleado</th>
                <th className="text-left py-2">Desde</th>
                <th className="text-left py-2">Hasta</th>
                <th className="text-left py-2">Tipo</th>
                <th className="text-left py-2">Observación</th>
                <th className="text-right py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ausencias.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 text-slate-800">{empleadoNombre(a)}</td>
                  <td className="py-2 tabular-nums">{formatFecha(a.fecha_desde)}</td>
                  <td className="py-2 tabular-nums">{formatFecha(a.fecha_hasta)}</td>
                  <td className="py-2 text-slate-700">{TIPO_LABEL[a.tipo]}</td>
                  <td className="py-2 text-slate-500">{a.observacion ?? "—"}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => borrarAusencia(a.id)} className="text-rose-600 hover:text-rose-700 text-xs">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
