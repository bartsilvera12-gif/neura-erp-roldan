"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import EmpleadoForm, { cuerpoDesdeForm, formDesdeEmpleado } from "@/components/rrhh/EmpleadoForm";
import EmpleadoArchivos from "@/components/rrhh/EmpleadoArchivos";
import EmpleadoSalarios from "@/components/rrhh/EmpleadoSalarios";
import EmpleadoVacaciones from "@/components/rrhh/EmpleadoVacaciones";
import { normalizarHorario, resumenHorario } from "@/lib/rrhh/horario";
import { EstadoEmpleadoBadge, Iniciales } from "@/components/rrhh/EmpleadoBadges";
import type { UsuarioParaVincular } from "@/lib/rrhh/empleado-vinculo";
import { Clock, FileText, KeyRound, Palmtree, UserRound, UserX, Wallet } from "lucide-react";

type Pestana = "datos" | "vacaciones" | "salarios" | "documentos";

type Empleado = Record<string, unknown> & { id: string; nombre: string };

export default function EmpleadoDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const pestana: Pestana = (["vacaciones", "salarios", "documentos"] as const).find((t) => t === sp?.get("tab")) ?? "datos";
  const irA = (t: Pestana) => router.replace(t === "datos" ? "?" : `?tab=${t}`, { scroll: false });
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioParaVincular[]>([]);
  const [falta73, setFalta73] = useState(false);
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
        const e = (j.data?.empleado ?? {}) as Empleado;
        setEmpleado(e);
        setUsuarios(j.data?.usuarios ?? []);
        setFalta73(Boolean(j.data?.falta_script_73));
        setForm(formDesdeEmpleado(e));
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
        body: JSON.stringify(cuerpoDesdeForm(form)),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      const actualizado = j.data?.empleado as Empleado;
      setEmpleado(actualizado);
      setForm(formDesdeEmpleado(actualizado));
      setMsg(j.data?.aviso ? { ok: false, text: j.data.aviso } : { ok: true, text: "Cambios guardados." });
      if (!j.data?.aviso) setTimeout(() => setMsg(null), 2500);
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

  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const usuario = usuarios.find((u) => u.id === empleado.usuario_id);
  const legajo = (empleado.legajo as string | null) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Link href="/rrhh/empleados" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-[#3F8E91]">
        <span aria-hidden>←</span> Empleados
      </Link>

      {/* Cabecera: quién es, de un vistazo. */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Iniciales nombre={empleado.nombre} grande />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-slate-900">{empleado.nombre}</h1>
              <EstadoEmpleadoBadge estado={String(empleado.estado ?? "activo")} />
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {[empleado.cargo, empleado.departamento].filter(Boolean).join(" · ") || "Sin cargo cargado"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-semibold text-slate-700">
                Código {legajo ?? "—"}
              </span>
              <span className="rounded-md bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
                {empleado.tipo_periodo === "jornal" ? "Jornalero" : "Mensualero"}
              </span>
              {(() => {
                const h = normalizarHorario(empleado.horario_semanal);
                return h ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-slate-600">
                    <Clock className="h-3 w-3" /> {resumenHorario(h)}
                  </span>
                ) : null;
              })()}
              {usuario ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2]/10 px-2 py-0.5 text-[#3F8E91]">
                  <KeyRound className="h-3 w-3" /> {usuario.nombre || usuario.email}
                  {usuario.nombre && usuario.email ? <span className="text-slate-400">· {usuario.email}</span> : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-slate-400">
                  <UserX className="h-3 w-3" /> Sin usuario del sistema
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={darDeBaja} className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            Dar de baja
          </button>
          {pestana === "datos" && (
            <button type="submit" form="empleado-form" disabled={saving}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {msg.text}
        </div>
      )}

      {/* Pestañas: los datos se editan acá mismo y las vacaciones se registran
          sin salir de la ficha. Lo que se edita en Datos no se pierde al
          cambiar de pestaña: el formulario vive en esta página. */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {([
          ["datos", "Datos y horario", <UserRound key="d" className="h-4 w-4" />],
          ["vacaciones", "Vacaciones", <Palmtree key="v" className="h-4 w-4" />],
          ["salarios", "Historial salarial", <Wallet key="s" className="h-4 w-4" />],
          ["documentos", "Documentos", <FileText key="f" className="h-4 w-4" />],
        ] as const).map(([t, label, icon]) => (
          <button key={t} type="button" onClick={() => irA(t)}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              pestana === t ? "border-[#4FAEB2] text-[#3F8E91]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {pestana === "datos" && (
        <EmpleadoForm form={form} setF={setF} usuarios={usuarios} falta73={falta73} esNuevo={false} onSubmit={guardar} />
      )}
      {pestana === "vacaciones" && <EmpleadoVacaciones empleadoId={params.id} />}
      {pestana === "salarios" && <EmpleadoSalarios empleadoId={params.id} />}
      {pestana === "documentos" && <EmpleadoArchivos empleadoId={params.id} />}
    </div>
  );
}
