"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import EmpleadoEspecialidades from "@/components/rrhh/EmpleadoEspecialidades";
import EmpleadoArchivos from "@/components/rrhh/EmpleadoArchivos";
import EmpleadoSalarios from "@/components/rrhh/EmpleadoSalarios";

type Empleado = Record<string, unknown> & { id: string; nombre: string };

export default function EmpleadoDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${params.id}`);
        const j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.error || "Error");
        setEmpleado(j.data?.empleado);
        const e = j.data?.empleado ?? {};
        setForm({
          // Estado laboral
          estado: e.estado ?? "activo",
          tipo_contrato: e.tipo_contrato ?? "",
          jornada_laboral: e.jornada_laboral ?? "",
          // Contacto emergencia
          contacto_emergencia_nombre: e.contacto_emergencia_nombre ?? "",
          contacto_emergencia_telefono: e.contacto_emergencia_telefono ?? "",
          contacto_emergencia_parentesco: e.contacto_emergencia_parentesco ?? "",
          // Datos personales
          nombre: e.nombre ?? "",
          tipo_documento: e.tipo_documento ?? "CI",
          documento: e.documento ?? "",
          fecha_nacimiento: e.fecha_nacimiento ?? "",
          lugar_nacimiento: e.lugar_nacimiento ?? "",
          nacionalidad: e.nacionalidad ?? "Paraguaya",
          estado_civil: e.estado_civil ?? "",
          grupo_sanguineo: e.grupo_sanguineo ?? "",
          // Contacto
          telefono: e.telefono ?? "",
          email: e.email ?? "",
          direccion: e.direccion ?? "",
          // Datos laborales
          cargo: e.cargo ?? "",
          departamento: e.departamento ?? "",
          seccion: e.seccion ?? "",
          tipo_empleado: e.tipo_empleado ?? "",
          tipo_periodo: e.tipo_periodo ?? "mensual",
          fecha_ingreso: e.fecha_ingreso ?? "",
          fecha_baja: e.fecha_baja ?? "",
          supervisor: e.supervisor ?? "",
          // Compensación
          salario_base: String(e.salario_base ?? 0),
          moneda: e.moneda ?? "PYG",
          // Bancario
          banco: e.banco ?? "",
          numero_cuenta: e.numero_cuenta ?? "",
          // Otros
          observaciones: e.observaciones ?? "",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, salario_base: Number(form.salario_base) || 0 }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setMsg({ ok: true, text: "Cambios guardados." });
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  async function darDeBaja() {
    if (!confirm("¿Confirmás dar de baja a este empleado?")) return;
    const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${params.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.success) { setMsg({ ok: false, text: j.error ?? "Error" }); return; }
    router.push("/rrhh/empleados");
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Error: {error}</div>;
  if (!empleado) return <div className="p-6 text-sm text-slate-500">No encontrado.</div>;

  const F = (k: string) => form[k] ?? "";
  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <Link href="/rrhh/empleados" className="text-sm text-teal-700 hover:underline">← Empleados</Link>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-600">RRHH · Empleado</p>
          <h1 className="text-2xl font-bold text-slate-900">{empleado.nombre as string}</h1>
          {(empleado.cargo as string) && <p className="text-sm text-slate-500 mt-1">{empleado.cargo as string}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={darDeBaja} className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded text-sm">
            Dar de baja
          </button>
          <button type="submit" form="empleado-form" disabled={saving}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      <form id="empleado-form" onSubmit={guardar} className="space-y-5">
        {/* Estado laboral */}
        <Section title="Estado laboral">
          <Grid cols={3}>
            <SelectField label="Estado" value={F("estado")} onChange={(v) => setF("estado", v)}
              options={[["activo","Activo"],["baja","Baja"],["suspendido","Suspendido"],["pendiente","Pendiente"]]} />
            <TextField label="Tipo de contrato" placeholder="Ej: indefinido, temporal, prueba"
              value={F("tipo_contrato")} onChange={(v) => setF("tipo_contrato", v)} />
            <TextField label="Jornada laboral" placeholder="Ej: completa, parcial 30h, turnos"
              value={F("jornada_laboral")} onChange={(v) => setF("jornada_laboral", v)} />
          </Grid>
        </Section>

        {/* Contacto emergencia */}
        <Section title="Contacto de emergencia">
          <Grid cols={3}>
            <TextField label="Nombre" value={F("contacto_emergencia_nombre")} onChange={(v) => setF("contacto_emergencia_nombre", v)} />
            <TextField label="Teléfono" value={F("contacto_emergencia_telefono")} onChange={(v) => setF("contacto_emergencia_telefono", v)} />
            <TextField label="Parentesco" placeholder="Ej: esposa, madre, hermano"
              value={F("contacto_emergencia_parentesco")} onChange={(v) => setF("contacto_emergencia_parentesco", v)} />
          </Grid>
        </Section>

        {/* Datos personales */}
        <Section title="Datos personales">
          <Grid cols={3}>
            <TextField label="Nombre completo *" required value={F("nombre")} onChange={(v) => setF("nombre", v)} />
            <SelectField label="Tipo de documento" value={F("tipo_documento")} onChange={(v) => setF("tipo_documento", v)}
              options={[["CI","CI"],["RUC","RUC"],["Pasaporte","Pasaporte"]]} />
            <TextField label="Nro. documento" value={F("documento")} onChange={(v) => setF("documento", v)} />
            <TextField label="Fecha de nacimiento" type="date" value={F("fecha_nacimiento")} onChange={(v) => setF("fecha_nacimiento", v)} />
            <TextField label="Lugar de nacimiento" placeholder="Ej: Asunción" value={F("lugar_nacimiento")} onChange={(v) => setF("lugar_nacimiento", v)} />
            <TextField label="Nacionalidad" value={F("nacionalidad")} onChange={(v) => setF("nacionalidad", v)} />
            <SelectField label="Estado civil" value={F("estado_civil")} onChange={(v) => setF("estado_civil", v)}
              options={[["","—"],["soltero","Soltero/a"],["casado","Casado/a"],["divorciado","Divorciado/a"],["viudo","Viudo/a"],["union_de_hecho","Unión de hecho"]]} />
            <SelectField label="Grupo sanguíneo" value={F("grupo_sanguineo")} onChange={(v) => setF("grupo_sanguineo", v)}
              options={[["","—"],["O+","O+"],["O-","O-"],["A+","A+"],["A-","A-"],["B+","B+"],["B-","B-"],["AB+","AB+"],["AB-","AB-"]]} />
          </Grid>
        </Section>

        {/* Contacto */}
        <Section title="Contacto">
          <Grid cols={3}>
            <TextField label="Teléfono" placeholder="0981 000 000" value={F("telefono")} onChange={(v) => setF("telefono", v)} />
            <TextField label="E-mail" type="email" value={F("email")} onChange={(v) => setF("email", v)} />
            <TextField label="Dirección" value={F("direccion")} onChange={(v) => setF("direccion", v)} />
          </Grid>
        </Section>

        {/* Datos laborales */}
        <Section title="Datos laborales">
          <Grid cols={3}>
            <TextField label="Cargo" placeholder="Ej: Operario, Vendedor" value={F("cargo")} onChange={(v) => setF("cargo", v)} />
            <TextField label="Departamento" value={F("departamento")} onChange={(v) => setF("departamento", v)} />
            <TextField label="Sección" value={F("seccion")} onChange={(v) => setF("seccion", v)} />
            <TextField label="Tipo empleado" placeholder="administrativo, operario, chofer…"
              value={F("tipo_empleado")} onChange={(v) => setF("tipo_empleado", v)} />
            <SelectField label="Tipo de período" value={F("tipo_periodo")} onChange={(v) => setF("tipo_periodo", v)}
              options={[["mensual","Mensual"],["quincenal","Quincenal"],["jornal","Jornal"]]} />
            <TextField label="Supervisor" placeholder="Nombre del supervisor" value={F("supervisor")} onChange={(v) => setF("supervisor", v)} />
            <TextField label="Fecha de ingreso" type="date" value={F("fecha_ingreso")} onChange={(v) => setF("fecha_ingreso", v)} />
            <TextField label="Fecha de baja" type="date" value={F("fecha_baja")} onChange={(v) => setF("fecha_baja", v)} />
          </Grid>
        </Section>

        {/* Compensación */}
        <Section title="Compensación">
          <Grid cols={3}>
            <div>
              <label className="text-xs text-slate-600 font-medium uppercase tracking-wide">Salario base</label>
              <div className="flex gap-2 mt-1">
                <select value={F("moneda")} onChange={(e) => setF("moneda", e.target.value)}
                  className="px-2 py-2 border border-slate-300 rounded-md text-sm">
                  <option value="PYG">Gs</option>
                  <option value="USD">USD</option>
                </select>
                <input type="number" min="0" value={F("salario_base")} onChange={(e) => setF("salario_base", e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm" />
              </div>
            </div>
            <TextField label="Banco" value={F("banco")} onChange={(v) => setF("banco", v)} />
            <TextField label="Número de cuenta" value={F("numero_cuenta")} onChange={(v) => setF("numero_cuenta", v)} />
          </Grid>
        </Section>

        {/* Observaciones */}
        <Section title="Observaciones">
          <textarea value={F("observaciones")} onChange={(e) => setF("observaciones", e.target.value)}
            rows={3} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm" />
        </Section>
      </form>

      {/* Secciones adicionales */}
      <EmpleadoSalarios empleadoId={params.id} />
      <EmpleadoEspecialidades empleadoId={params.id} />
      <EmpleadoArchivos empleadoId={params.id} />
    </div>
  );
}

/* ── Helpers de layout ─────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  const cls = cols === 3
    ? "grid grid-cols-1 md:grid-cols-3 gap-4"
    : "grid grid-cols-1 md:grid-cols-2 gap-4";
  return <div className={cls}>{children}</div>;
}

function TextField({ label, value, onChange, type = "text", placeholder, required = false }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-600 font-medium">{label}</label>
      <input type={type} required={required} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="text-xs text-slate-600 font-medium">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
