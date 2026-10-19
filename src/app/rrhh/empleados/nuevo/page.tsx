"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type CatalogItem = { id: string; nombre: string };

type CatalogEndpoint = {
  url: string;
  listKey: string;
  nameField?: string; // fallback name field when the API doesn't return "nombre"
};

const CATALOGS = {
  tipos_empleado: { url: "/api/rrhh/tipos-empleado-catalogo", listKey: "tipos" } as CatalogEndpoint,
  departamentos: { url: "/api/rrhh/departamentos-catalogo", listKey: "departamentos" } as CatalogEndpoint,
  cargos: { url: "/api/rrhh/cargos-catalogo", listKey: "cargos" } as CatalogEndpoint,
  bancos: { url: "/api/entidades-bancarias", listKey: "entidades", nameField: "banco" } as CatalogEndpoint,
};

function normalizeItems(raw: unknown[], nameField?: string): CatalogItem[] {
  return (raw ?? []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "");
    const nombre = String((o.nombre as string) ?? (nameField ? (o[nameField] as string) : "") ?? "");
    return { id, nombre };
  }).filter((x) => x.id && x.nombre);
}

async function fetchCatalog(cat: CatalogEndpoint): Promise<CatalogItem[]> {
  const res = await fetchWithSupabaseSession(cat.url);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.success === false) throw new Error(j?.error || "Error");
  const data = j?.data ?? {};
  const raw = (data[cat.listKey] ?? []) as unknown[];
  return normalizeItems(raw, cat.nameField);
}

async function createCatalogItem(cat: CatalogEndpoint, nombre: string): Promise<void> {
  const res = await fetchWithSupabaseSession(cat.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.success === false) throw new Error(j?.error || "Error");
}

export default function NuevoEmpleadoPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tiposEmpleado, setTiposEmpleado] = useState<CatalogItem[]>([]);
  const [departamentos, setDepartamentos] = useState<CatalogItem[]>([]);
  const [cargos, setCargos] = useState<CatalogItem[]>([]);
  const [bancos, setBancos] = useState<CatalogItem[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  const [form, setForm] = useState<Record<string, string>>({
    estado: "activo",
    tipo_contrato: "",
    jornada_laboral: "",
    contacto_emergencia_nombre: "",
    contacto_emergencia_telefono: "",
    contacto_emergencia_parentesco: "",
    nombre: "",
    tipo_documento: "CI",
    documento: "",
    fecha_nacimiento: "",
    lugar_nacimiento: "",
    nacionalidad: "Paraguaya",
    estado_civil: "",
    grupo_sanguineo: "",
    telefono: "",
    email: "",
    direccion: "",
    cargo: "",
    departamento: "",
    seccion: "",
    tipo_empleado: "",
    tipo_periodo: "mensual",
    fecha_ingreso: "",
    supervisor: "",
    salario_base: "0",
    moneda: "PYG",
    banco: "",
    numero_cuenta: "",
    observaciones: "",
  });

  const F = (k: string) => form[k] ?? "";
  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      setLoadingCatalogs(true);
      try {
        const [t, d, c, b] = await Promise.all([
          fetchCatalog(CATALOGS.tipos_empleado).catch(() => []),
          fetchCatalog(CATALOGS.departamentos).catch(() => []),
          fetchCatalog(CATALOGS.cargos).catch(() => []),
          fetchCatalog(CATALOGS.bancos).catch(() => []),
        ]);
        setTiposEmpleado(t);
        setDepartamentos(d);
        setCargos(c);
        setBancos(b);
      } finally {
        setLoadingCatalogs(false);
      }
    })();
  }, []);

  async function reload(cat: CatalogEndpoint, setter: (v: CatalogItem[]) => void) {
    const items = await fetchCatalog(cat);
    setter(items);
    return items;
  }

  async function crearCatalogo(cat: CatalogEndpoint, nombre: string, setter: (v: CatalogItem[]) => void, field: string) {
    await createCatalogItem(cat, nombre);
    await reload(cat, setter);
    setF(field, nombre);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setMsg({ ok: false, text: "El nombre es obligatorio" });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      const res = await fetchWithSupabaseSession("/api/rrhh/empleados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, salario_base: Number(form.salario_base) || 0 }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      router.push(`/rrhh/empleados/${j.data.empleado.id}`);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  if (loadingCatalogs) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-sm text-slate-500">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <Link href="/rrhh/empleados" className="text-sm text-teal-700 hover:underline">← Empleados</Link>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-600">RRHH · Empleado</p>
          <h1 className="text-2xl font-bold text-slate-900">Nuevo empleado</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/rrhh/empleados" className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-md text-sm">Cancelar</Link>
          <button type="submit" form="empleado-form" disabled={saving}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
            {saving ? "Guardando…" : "Crear empleado"}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      <form id="empleado-form" onSubmit={guardar} className="space-y-5">
        <Section title="Estado laboral">
          <Grid cols={3}>
            <SelectField label="Estado" value={F("estado")} onChange={(v) => setF("estado", v)}
              options={[["activo","Activo"],["baja","Baja"],["suspendido","Suspendido"],["pendiente","Pendiente"]]} />
            <SelectField label="Tipo de contrato" value={F("tipo_contrato")} onChange={(v) => setF("tipo_contrato", v)}
              options={[["","—"],["indefinido","Indefinido"],["temporal","Temporal"],["prueba","Prueba"],["obra","Obra"]]} />
            <SelectField label="Jornada laboral" value={F("jornada_laboral")} onChange={(v) => setF("jornada_laboral", v)}
              options={[["","—"],["completa","Completa"],["parcial","Parcial"],["turnos","Turnos"]]} />
          </Grid>
        </Section>

        <Section title="Contacto de emergencia">
          <Grid cols={3}>
            <TextField label="Nombre" value={F("contacto_emergencia_nombre")} onChange={(v) => setF("contacto_emergencia_nombre", v)} />
            <TextField label="Teléfono" value={F("contacto_emergencia_telefono")} onChange={(v) => setF("contacto_emergencia_telefono", v)} />
            <TextField label="Parentesco" placeholder="Ej: esposa, madre, hermano"
              value={F("contacto_emergencia_parentesco")} onChange={(v) => setF("contacto_emergencia_parentesco", v)} />
          </Grid>
        </Section>

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

        <Section title="Contacto">
          <Grid cols={3}>
            <TextField label="Teléfono" placeholder="0981 000 000" value={F("telefono")} onChange={(v) => setF("telefono", v)} />
            <TextField label="E-mail" type="email" value={F("email")} onChange={(v) => setF("email", v)} />
            <TextField label="Dirección" value={F("direccion")} onChange={(v) => setF("direccion", v)} />
          </Grid>
        </Section>

        <Section title="Datos laborales">
          <Grid cols={3}>
            <CatalogSelectField label="Cargo" value={F("cargo")} onChange={(v) => setF("cargo", v)}
              options={cargos}
              onCreate={(nombre) => crearCatalogo(CATALOGS.cargos, nombre, setCargos, "cargo")} />
            <CatalogSelectField label="Departamento" value={F("departamento")} onChange={(v) => setF("departamento", v)}
              options={departamentos}
              onCreate={(nombre) => crearCatalogo(CATALOGS.departamentos, nombre, setDepartamentos, "departamento")} />
            <TextField label="Sección" value={F("seccion")} onChange={(v) => setF("seccion", v)} />
            <CatalogSelectField label="Tipo empleado" value={F("tipo_empleado")} onChange={(v) => setF("tipo_empleado", v)}
              options={tiposEmpleado}
              onCreate={(nombre) => crearCatalogo(CATALOGS.tipos_empleado, nombre, setTiposEmpleado, "tipo_empleado")} />
            <SelectField label="Tipo de período" value={F("tipo_periodo")} onChange={(v) => setF("tipo_periodo", v)}
              options={[["mensual","Mensual"],["quincenal","Quincenal"],["jornal","Jornal"]]} />
            <TextField label="Supervisor" placeholder="Nombre del supervisor" value={F("supervisor")} onChange={(v) => setF("supervisor", v)} />
            <TextField label="Fecha de ingreso" type="date" value={F("fecha_ingreso")} onChange={(v) => setF("fecha_ingreso", v)} />
          </Grid>
        </Section>

        <Section title="Compensación">
          <Grid cols={3}>
            <div>
              <label className="text-xs text-slate-600 font-medium">Salario base</label>
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
            <CatalogSelectField label="Banco" value={F("banco")} onChange={(v) => setF("banco", v)}
              options={bancos}
              onCreate={(nombre) => crearCatalogo(CATALOGS.bancos, nombre, setBancos, "banco")} />
            <TextField label="Número de cuenta" value={F("numero_cuenta")} onChange={(v) => setF("numero_cuenta", v)} />
          </Grid>
        </Section>

        <Section title="Observaciones">
          <textarea value={F("observaciones")} onChange={(e) => setF("observaciones", e.target.value)}
            rows={3} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm" />
        </Section>
      </form>
    </div>
  );
}

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

function CatalogSelectField({ label, value, onChange, options, onCreate }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: CatalogItem[];
  onCreate: (nombre: string) => Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If current value isn't in options (already-selected historical value), add it so it shows.
  const showsCurrent = value && !options.some((o) => o.nombre === value);

  function closeModal() {
    if (creating) return;
    setModalOpen(false);
    setNuevo("");
    setErr(null);
  }

  async function submit() {
    const name = nuevo.trim();
    if (!name) return;
    setCreating(true); setErr(null);
    try {
      await onCreate(name);
      setNuevo("");
      setModalOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <label className="text-xs text-slate-600 font-medium">{label}</label>
      <div className="flex gap-1 mt-1">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-md text-sm">
          <option value="">—</option>
          {showsCurrent && <option value={value}>{value}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.nombre}>{o.nombre}</option>
          ))}
        </select>
        <button type="button" onClick={() => setModalOpen(true)}
          title={`Crear nuevo ${label.toLowerCase()}`}
          className="px-3 py-2 border border-slate-300 rounded-md text-sm text-teal-700 hover:bg-slate-50 whitespace-nowrap">
          + Crear
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeModal}>
          <div onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Nuevo {label.toLowerCase()}</h3>
            <p className="text-xs text-slate-500 mb-3">Ingresá el nombre y guardá.</p>
            <input autoFocus value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
                if (e.key === "Escape") { e.preventDefault(); closeModal(); }
              }}
              placeholder="Nombre"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={creating} onClick={closeModal}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" disabled={creating || !nuevo.trim()} onClick={submit}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm disabled:opacity-50">
                {creating ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
