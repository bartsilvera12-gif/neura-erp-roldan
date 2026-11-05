"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { BadgeCheck, Briefcase, Clock, HeartPulse, IdCard, Phone, StickyNote, UserRound, Wallet } from "lucide-react";
import CiudadBarrio from "@/components/geo/CiudadBarrio";
import { DIAS_SEMANA, HORARIO_SUGERIDO, horasSemanales, normalizarHorario, resumenHorario, type HorarioSemanal } from "@/lib/rrhh/horario";
import type { UsuarioParaVincular } from "@/lib/rrhh/empleado-vinculo";

/**
 * Formulario del empleado: el MISMO para el alta y para la ficha.
 *
 * Antes eran dos copias que se habían separado: la ficha no tenía hora de
 * entrada ni tolerancia (que sí se cargaban en el alta, y sin las cuales el
 * control horario no mide tardanzas) y cargo/departamento eran texto libre en
 * un lado y catálogo en el otro.
 */

type CatalogItem = { id: string; nombre: string };
type CatalogEndpoint = { url: string; listKey: string; nameField?: string };

const CATALOGS = {
  tipos_empleado: { url: "/api/rrhh/tipos-empleado-catalogo", listKey: "tipos" } as CatalogEndpoint,
  departamentos: { url: "/api/rrhh/departamentos-catalogo", listKey: "departamentos" } as CatalogEndpoint,
  cargos: { url: "/api/rrhh/cargos-catalogo", listKey: "cargos" } as CatalogEndpoint,
  bancos: { url: "/api/entidades-bancarias", listKey: "entidades", nameField: "banco" } as CatalogEndpoint,
};

/** Valores iniciales de un empleado nuevo. */
export const FORM_EMPLEADO_VACIO: Record<string, string> = {
  legajo: "",
  usuario_id: "",
  estado: "activo",
  tipo_contrato: "",
  jornada_laboral: "",
  hora_entrada_prevista: "",
  /** JSON del horario por día (script 74); vacío = sin horario. */
  horario_semanal: "",
  tolerancia_minutos: "0",
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
  ciudad: "",
  barrio: "",
  cargo: "",
  departamento: "",
  seccion: "",
  tipo_empleado: "",
  tipo_periodo: "mensual",
  fecha_ingreso: "",
  fecha_baja: "",
  supervisor: "",
  salario_base: "0",
  moneda: "PYG",
  banco: "",
  numero_cuenta: "",
  observaciones: "",
};

/** Del registro de la base al formulario (todo como texto). */
export function formDesdeEmpleado(e: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = { ...FORM_EMPLEADO_VACIO };
  for (const k of Object.keys(out)) {
    const v = e[k];
    if (v !== null && v !== undefined) out[k] = String(v);
  }
  // La hora viene como "08:00:00": el input type=time quiere "08:00".
  if (out.hora_entrada_prevista) out.hora_entrada_prevista = out.hora_entrada_prevista.slice(0, 5);
  // El horario es jsonb: String() lo dejaría en "[object Object]".
  const h = normalizarHorario(e.horario_semanal);
  out.horario_semanal = h ? JSON.stringify(h) : "";
  return out;
}

/** Del formulario al cuerpo del POST/PATCH. */
export function cuerpoDesdeForm(form: Record<string, string>): Record<string, unknown> {
  return {
    ...form,
    salario_base: Number(form.salario_base) || 0,
    tolerancia_minutos: Number(form.tolerancia_minutos) || 0,
    usuario_id: form.usuario_id || null,
    horario_semanal: normalizarHorario(form.horario_semanal),
  };
}

async function fetchCatalog(cat: CatalogEndpoint): Promise<CatalogItem[]> {
  const res = await fetchWithSupabaseSession(cat.url);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.success === false) throw new Error(j?.error || "Error");
  const raw = ((j?.data ?? {})[cat.listKey] ?? []) as unknown[];
  return raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { id: String(o.id ?? ""), nombre: String((o.nombre as string) ?? (cat.nameField ? (o[cat.nameField] as string) : "") ?? "") };
    })
    .filter((x) => x.id && x.nombre);
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

export default function EmpleadoForm({
  form,
  setF,
  usuarios,
  falta73,
  esNuevo,
  onSubmit,
}: {
  form: Record<string, string>;
  setF: (k: string, v: string) => void;
  usuarios: UsuarioParaVincular[];
  /** El script 73 no corrió: legajo y usuario no se pueden guardar todavía. */
  falta73: boolean;
  esNuevo: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [cargos, setCargos] = useState<CatalogItem[]>([]);
  const [departamentos, setDepartamentos] = useState<CatalogItem[]>([]);
  const [tiposEmpleado, setTiposEmpleado] = useState<CatalogItem[]>([]);
  const [bancos, setBancos] = useState<CatalogItem[]>([]);

  useEffect(() => {
    fetchCatalog(CATALOGS.cargos).then(setCargos).catch(() => {});
    fetchCatalog(CATALOGS.departamentos).then(setDepartamentos).catch(() => {});
    fetchCatalog(CATALOGS.tipos_empleado).then(setTiposEmpleado).catch(() => {});
    fetchCatalog(CATALOGS.bancos).then(setBancos).catch(() => {});
  }, []);

  async function crear(cat: CatalogEndpoint, nombre: string, setter: (v: CatalogItem[]) => void, campo: string) {
    await createCatalogItem(cat, nombre);
    setter(await fetchCatalog(cat));
    setF(campo, nombre);
  }

  const F = (k: string) => form[k] ?? "";

  return (
    <form id="empleado-form" onSubmit={onSubmit} className="space-y-5">
      <Section icon={<IdCard className="h-4 w-4" />} title="Identificación"
        hint="El código identifica al empleado. El usuario es con el que entra al sistema, si entra.">
        {falta73 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Falta correr <b>73_legajo_y_usuario_del_empleado.sql</b> en la base: hasta entonces el código de empleado y el
            usuario no se guardan.
          </p>
        )}
        <Grid>
          <TextField label="Código de empleado" value={F("legajo")} onChange={(v) => setF("legajo", v.toUpperCase())}
            placeholder={esNuevo ? "Automático (siguiente número)" : "Ej: 0001"} disabled={falta73} />
          <div className="md:col-span-2">
            <label className={labelCls}>Usuario del sistema</label>
            <select value={F("usuario_id")} onChange={(e) => setF("usuario_id", e.target.value)} disabled={falta73}
              className={inputCls}>
              <option value="">— No usa el sistema —</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.nombre || u.email) ?? u.id}{u.nombre && u.email ? ` · ${u.email}` : ""}{u.estado && u.estado !== "activo" ? ` (${u.estado})` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">Un usuario corresponde a un solo empleado.</p>
          </div>
          <SelectField label="Estado" value={F("estado")} onChange={(v) => setF("estado", v)}
            options={[["activo", "Activo"], ["baja", "Baja"], ["suspendido", "Suspendido"], ["pendiente", "Pendiente"]]} />
        </Grid>
      </Section>

      <Section icon={<UserRound className="h-4 w-4" />} title="Datos personales">
        <Grid>
          <div className="md:col-span-2">
            <TextField label="Nombre completo *" required value={F("nombre")} onChange={(v) => setF("nombre", v)} />
          </div>
          <SelectField label="Tipo de documento" value={F("tipo_documento")} onChange={(v) => setF("tipo_documento", v)}
            options={[["CI", "CI"], ["RUC", "RUC"], ["Pasaporte", "Pasaporte"]]} />
          <TextField label="Nro. documento" value={F("documento")} onChange={(v) => setF("documento", v)} />
          <TextField label="Fecha de nacimiento" type="date" value={F("fecha_nacimiento")} onChange={(v) => setF("fecha_nacimiento", v)} />
          <TextField label="Lugar de nacimiento" placeholder="Ej: Asunción" value={F("lugar_nacimiento")} onChange={(v) => setF("lugar_nacimiento", v)} />
          <TextField label="Nacionalidad" value={F("nacionalidad")} onChange={(v) => setF("nacionalidad", v)} />
          <SelectField label="Estado civil" value={F("estado_civil")} onChange={(v) => setF("estado_civil", v)}
            options={[["", "—"], ["soltero", "Soltero/a"], ["casado", "Casado/a"], ["divorciado", "Divorciado/a"], ["viudo", "Viudo/a"], ["union_de_hecho", "Unión de hecho"]]} />
          <SelectField label="Grupo sanguíneo" value={F("grupo_sanguineo")} onChange={(v) => setF("grupo_sanguineo", v)}
            options={[["", "—"], ["O+", "O+"], ["O-", "O-"], ["A+", "A+"], ["A-", "A-"], ["B+", "B+"], ["B-", "B-"], ["AB+", "AB+"], ["AB-", "AB-"]]} />
        </Grid>
      </Section>

      <Section icon={<Phone className="h-4 w-4" />} title="Contacto">
        <Grid>
          <TextField label="Teléfono" placeholder="0981 000 000" value={F("telefono")} onChange={(v) => setF("telefono", v)} />
          {/* Minúsculas desde el campo: así se ve cómo queda guardado. */}
          <TextField label="E-mail" type="email" value={F("email")} onChange={(v) => setF("email", v.toLowerCase())} />
          <TextField label="Dirección" placeholder="Calle y número" value={F("direccion")} onChange={(v) => setF("direccion", v)} />
          <CiudadBarrio ciudad={F("ciudad")} barrio={F("barrio")} onCiudad={(v) => setF("ciudad", v)} onBarrio={(v) => setF("barrio", v)}
            inputCls={inputCls} labelCls={labelCls} />
        </Grid>
      </Section>

      <Section icon={<Briefcase className="h-4 w-4" />} title="Puesto y jornada">
        <Grid>
          <CatalogSelectField label="Cargo" value={F("cargo")} onChange={(v) => setF("cargo", v)} options={cargos}
            onCreate={(n) => crear(CATALOGS.cargos, n, setCargos, "cargo")} />
          <CatalogSelectField label="Departamento" value={F("departamento")} onChange={(v) => setF("departamento", v)} options={departamentos}
            onCreate={(n) => crear(CATALOGS.departamentos, n, setDepartamentos, "departamento")} />
          <TextField label="Sección" value={F("seccion")} onChange={(v) => setF("seccion", v)} />
          <CatalogSelectField label="Tipo de empleado" value={F("tipo_empleado")} onChange={(v) => setF("tipo_empleado", v)} options={tiposEmpleado}
            onCreate={(n) => crear(CATALOGS.tipos_empleado, n, setTiposEmpleado, "tipo_empleado")} />
          <TextField label="Supervisor" placeholder="Nombre del supervisor" value={F("supervisor")} onChange={(v) => setF("supervisor", v)} />
          <SelectField label="Tipo de contrato" value={F("tipo_contrato")} onChange={(v) => setF("tipo_contrato", v)}
            options={opcionesConActual(F("tipo_contrato"), [["", "—"], ["indefinido", "Por tiempo indefinido"], ["temporal", "Plazo fijo"], ["prueba", "Período de prueba"], ["obra", "Por obra determinada"]])} />
          <SelectField label="Jornada laboral" value={F("jornada_laboral")} onChange={(v) => setF("jornada_laboral", v)}
            options={opcionesConActual(F("jornada_laboral"), [["", "—"], ["completa", "Completa"], ["parcial", "Parcial"], ["turnos", "Turnos"]])} />
          <TextField label="Fecha de ingreso" type="date" value={F("fecha_ingreso")} onChange={(v) => setF("fecha_ingreso", v)} />
          {!esNuevo && (
            <TextField label="Fecha de baja" type="date" value={F("fecha_baja")} onChange={(v) => setF("fecha_baja", v)} />
          )}
        </Grid>
      </Section>

      <EditorHorario
        valor={F("horario_semanal")}
        onChange={(v) => setF("horario_semanal", v)}
        tolerancia={F("tolerancia_minutos")}
        onTolerancia={(v) => setF("tolerancia_minutos", v)}
      />

      <Section icon={<Wallet className="h-4 w-4" />} title="Sueldo y cobro"
        hint="Mensualero cobra un sueldo fijo por mes; jornalero cobra por día trabajado. Con esto se arma el recibo de salario.">
        <div className="mb-4">
          <label className={labelCls}>Cómo cobra</label>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {([
              ["mensual", "Mensualero", "Sueldo fijo por mes"],
              ["jornal", "Jornalero", "Jornal por día trabajado"],
            ] as const).map(([v, t, d]) => {
              const on = (F("tipo_periodo") || "mensual") === v;
              return (
                <button key={v} type="button" onClick={() => setF("tipo_periodo", v)} aria-pressed={on}
                  className={`rounded-lg border px-4 py-2.5 text-left transition-colors ${
                    on ? "border-[#4FAEB2] bg-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]" : "border-slate-200 bg-white hover:border-[#4FAEB2]/50"
                  }`}>
                  <span className={`block text-sm font-semibold ${on ? "text-[#2F6E71]" : "text-slate-800"}`}>{t}</span>
                  <span className="block text-xs text-slate-500">{d}</span>
                </button>
              );
            })}
          </div>
          {!["", "mensual", "jornal"].includes(F("tipo_periodo")) && (
            <p className="mt-1.5 text-xs text-amber-700">Tiene cargado “{F("tipo_periodo")}”: elegí una de las dos opciones.</p>
          )}
        </div>
        <Grid>
          <div>
            <label className={labelCls}>{F("tipo_periodo") === "jornal" ? "Jornal diario" : "Salario mensual"}</label>
            <div className="mt-1 flex gap-2">
              <select value={F("moneda")} onChange={(e) => setF("moneda", e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20">
                <option value="PYG">Gs</option>
                <option value="USD">USD</option>
              </select>
              <input type="number" min="0" value={F("salario_base")} onChange={(e) => setF("salario_base", e.target.value)}
                className={`${inputCls} mt-0 flex-1 tabular-nums`} />
            </div>
            {Number(F("salario_base")) > 0 && F("moneda") === "PYG" && (
              <p className="mt-1 text-xs text-slate-400">
                {F("tipo_periodo") === "jornal"
                  ? `≈ Gs. ${Math.round(Number(F("salario_base")) * 30).toLocaleString("es-PY")} por mes de 30 días`
                  : `≈ Gs. ${Math.round(Number(F("salario_base")) / 30).toLocaleString("es-PY")} por día`}
              </p>
            )}
          </div>
          <CatalogSelectField label="Banco" value={F("banco")} onChange={(v) => setF("banco", v)} options={bancos}
            onCreate={(n) => crear(CATALOGS.bancos, n, setBancos, "banco")} />
          <TextField label="Número de cuenta" value={F("numero_cuenta")} onChange={(v) => setF("numero_cuenta", v)} />
        </Grid>
      </Section>

      <Section icon={<HeartPulse className="h-4 w-4" />} title="Contacto de emergencia">
        <Grid>
          <TextField label="Nombre" value={F("contacto_emergencia_nombre")} onChange={(v) => setF("contacto_emergencia_nombre", v)} />
          <TextField label="Teléfono" value={F("contacto_emergencia_telefono")} onChange={(v) => setF("contacto_emergencia_telefono", v)} />
          <TextField label="Parentesco" placeholder="Ej: esposa, madre, hermano"
            value={F("contacto_emergencia_parentesco")} onChange={(v) => setF("contacto_emergencia_parentesco", v)} />
        </Grid>
      </Section>

      <Section icon={<StickyNote className="h-4 w-4" />} title="Observaciones">
        <textarea value={F("observaciones")} onChange={(e) => setF("observaciones", e.target.value)} rows={3}
          className={inputCls} />
      </Section>
    </form>
  );
}

/**
 * Horario por día. Antes era una sola "hora de entrada" para toda la semana:
 * el sábado corto no se podía cargar y la tardanza del sábado se medía mal.
 *
 * Arriba se eligen los días con un toque; abajo, cada día que trabaja con su
 * entrada, su salida y una barra que muestra el turno en la jornada.
 */
function EditorHorario({ valor, onChange, tolerancia, onTolerancia }: {
  valor: string;
  onChange: (v: string) => void;
  tolerancia: string;
  onTolerancia: (v: string) => void;
}) {
  const horario: HorarioSemanal = normalizarHorario(valor) ?? {};
  const guardar = (h: HorarioSemanal) => onChange(Object.keys(h).length ? JSON.stringify(h) : "");
  const cambiar = (clave: keyof HorarioSemanal, campo: "entrada" | "salida", v: string) =>
    guardar({ ...horario, [clave]: { entrada: horario[clave]?.entrada ?? null, salida: horario[clave]?.salida ?? null, [campo]: v || null } });
  const alternar = (clave: keyof HorarioSemanal) => {
    const h = { ...horario };
    if (h[clave]) delete h[clave];
    else {
      // Al prender un día, copia el horario del primer día que ya trabaja.
      const base = DIAS_SEMANA.map((d) => horario[d.clave]).find(Boolean) ?? { entrada: "07:00", salida: "17:00" };
      h[clave] = { ...base };
    }
    guardar(h);
  };
  const activos = DIAS_SEMANA.filter((d) => horario[d.clave]);
  const primero = activos[0] ? horario[activos[0].clave] : undefined;
  const vacio = activos.length === 0;
  const horas = horasSemanales(horario);

  return (
    <Section icon={<Clock className="h-4 w-4" />} title="Horario"
      hint="Los días que trabaja y a qué hora entra y sale. Con esto el control horario mide las tardanzas.">
      {/* Días */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {DIAS_SEMANA.map(({ clave, corto, largo }) => {
            const on = !!horario[clave];
            return (
              <button key={clave} type="button" onClick={() => alternar(clave)} title={on ? `${largo}: trabaja` : `${largo}: no trabaja`}
                aria-pressed={on}
                className={`h-10 w-12 rounded-lg text-sm font-semibold transition-colors ${
                  on ? "bg-[#4FAEB2] text-white shadow-sm hover:bg-[#3F8E91]" : "border border-slate-200 bg-white text-slate-400 hover:border-[#4FAEB2]/50 hover:text-slate-600"
                }`}>
                {corto}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => guardar(HORARIO_SUGERIDO)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91]">
            L a V 07–17 · Sáb 07–11
          </button>
          {primero && activos.length > 1 && (
            <button type="button"
              onClick={() => guardar(Object.fromEntries(activos.map((d) => [d.clave, { ...primero }])) as HorarioSemanal)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91]">
              Igualar todos al {activos[0].largo.toLowerCase()}
            </button>
          )}
          {!vacio && (
            <button type="button" onClick={() => guardar({})} className="px-2 py-2 text-slate-400 hover:text-rose-600">Borrar</button>
          )}
        </div>
      </div>

      {/* Turnos */}
      {vacio ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 py-8 text-center">
          <Clock className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          <p className="text-sm text-slate-500">Tocá los días que trabaja, o usá el horario de la casa.</p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {activos.map(({ clave, largo }) => {
            const t = horario[clave]!;
            return (
              <div key={clave} className="grid grid-cols-[92px_auto_1fr] items-center gap-4 px-4 py-2.5 max-md:grid-cols-[92px_1fr]">
                <span className="text-sm font-medium text-slate-800">{largo}</span>
                <div className="flex items-center gap-2">
                  <input type="time" value={t.entrada ?? ""} onChange={(e) => cambiar(clave, "entrada", e.target.value)} aria-label={`Entrada ${largo}`}
                    className="w-[104px] rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
                  <span className="text-slate-300">→</span>
                  <input type="time" value={t.salida ?? ""} onChange={(e) => cambiar(clave, "salida", e.target.value)} aria-label={`Salida ${largo}`}
                    className="w-[104px] rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
                </div>
                <BarraTurno entrada={t.entrada} salida={t.salida} />
              </div>
            );
          })}
        </div>
      )}

      {/* Pie: total y tolerancia */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
        <div className="text-sm text-slate-600">
          {vacio ? "Sin horario cargado" : (
            <>
              <b className="text-slate-900">{horas} h</b> por semana
              <span className="ml-2 text-xs text-slate-400">{resumenHorario(horario)}</span>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Tolerancia para la entrada
          <span className="relative">
            <input type="number" min={0} max={120} value={tolerancia} onChange={(e) => onTolerancia(e.target.value)}
              className="w-20 rounded-lg border border-slate-200 bg-white py-1.5 pl-2.5 pr-9 text-right text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">min</span>
          </span>
        </label>
      </div>
    </Section>
  );
}

/** El turno dibujado sobre la jornada de 05:00 a 22:00, con la duración. */
function BarraTurno({ entrada, salida }: { entrada: string | null; salida: string | null }) {
  const aMin = (h: string | null) => {
    const m = h ? /^(\d{1,2}):(\d{2})/.exec(h) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const ini = 5 * 60, fin = 22 * 60;
  const a = aMin(entrada), b = aMin(salida);
  const ok = a != null && b != null && b > a;
  const pos = (m: number) => `${Math.max(0, Math.min(100, ((m - ini) / (fin - ini)) * 100))}%`;
  const dur = ok ? (b! - a!) / 60 : 0;
  return (
    <div className="flex items-center gap-3 max-md:col-span-2">
      <div className="relative h-2.5 flex-1 rounded-full bg-slate-100">
        {[6, 12, 18].map((h) => (
          <span key={h} className="absolute top-0 h-full w-px bg-slate-200" style={{ left: pos(h * 60) }} />
        ))}
        {ok && (
          <span className="absolute top-0 h-full rounded-full bg-[#4FAEB2]" style={{ left: pos(a!), width: `calc(${pos(b!)} - ${pos(a!)})` }} />
        )}
      </div>
      <span className={`w-12 text-right text-xs tabular-nums ${ok ? "font-medium text-slate-600" : "text-slate-300"}`}>
        {ok ? `${Number.isInteger(dur) ? dur : dur.toFixed(1).replace(".", ",")} h` : "—"}
      </span>
    </div>
  );
}

/** Un valor viejo que no está en la lista (se cargaba como texto libre) se sigue viendo. */
function opcionesConActual(actual: string, opciones: [string, string][]): [string, string][] {
  return actual && !opciones.some(([v]) => v === actual) ? [...opciones, [actual, actual]] : opciones;
}

/* ── Piezas de layout ─────────────────────────────────────────────── */

const labelCls = "text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:bg-slate-50 disabled:text-slate-400";

export function Section({ icon, title, hint, children }: { icon?: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-2.5">
        {icon && (
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#3F8E91]">
            {icon}
          </span>
        )}
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{children}</div>;
}

function TextField({ label, value, onChange, type = "text", placeholder, required = false, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; disabled?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input type={type} required={required} value={value} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function CatalogSelectField({ label, value, onChange, options, onCreate }: {
  label: string; value: string; onChange: (v: string) => void;
  options: CatalogItem[]; onCreate: (nombre: string) => Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Un valor ya cargado que no está en el catálogo (texto libre de antes) se sigue viendo.
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
    setCreating(true);
    setErr(null);
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
      <label className={labelCls}>{label}</label>
      <div className="mt-1 flex gap-1.5">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} mt-0 min-w-0 flex-1`}>
          <option value="">—</option>
          {showsCurrent && <option value={value}>{value}</option>}
          {options.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
        </select>
        <button type="button" onClick={() => setModalOpen(true)} title={`Crear ${label.toLowerCase()}`}
          className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-[#3F8E91] hover:bg-[#4FAEB2]/5">
          + Nuevo
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeModal}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <BadgeCheck className="h-4 w-4 text-[#3F8E91]" /> Nuevo {label.toLowerCase()}
            </h3>
            <p className="mb-3 text-xs text-slate-500">Queda en el catálogo para los demás empleados.</p>
            <input autoFocus value={nuevo} onChange={(e) => setNuevo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
                if (e.key === "Escape") { e.preventDefault(); closeModal(); }
              }}
              placeholder="Nombre" className={inputCls} />
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={creating} onClick={closeModal}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
              <button type="button" disabled={creating || !nuevo.trim()} onClick={submit}
                className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {creating ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
