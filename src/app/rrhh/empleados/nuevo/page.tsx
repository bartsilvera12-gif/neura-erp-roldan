"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import PageHeader from "@/components/ui/PageHeader";
import EmpleadoForm, { FORM_EMPLEADO_VACIO, cuerpoDesdeForm } from "@/components/rrhh/EmpleadoForm";
import type { UsuarioParaVincular } from "@/lib/rrhh/empleado-vinculo";

export default function NuevoEmpleadoPage() {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(FORM_EMPLEADO_VACIO);
  const [usuarios, setUsuarios] = useState<UsuarioParaVincular[]>([]);
  const [falta73, setFalta73] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Los usuarios para el selector salen del listado de empleados, que ya los trae.
  useEffect(() => {
    fetchWithSupabaseSession("/api/rrhh/empleados")
      .then((r) => r.json())
      .then((j) => {
        setUsuarios(j?.data?.usuarios ?? []);
        setFalta73(Boolean(j?.data?.aviso));
      })
      .catch(() => {});
  }, []);

  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) { setMsg("El nombre es obligatorio."); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetchWithSupabaseSession("/api/rrhh/empleados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoDesdeForm(form)),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      router.push(`/rrhh/empleados/${j.data.empleado.id}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow="RRHH · Empleados"
        title="Nuevo empleado"
        description="Si dejás el código de empleado vacío, se le asigna el siguiente número."
        backHref="/rrhh/empleados"
        backLabel="Empleados"
        actions={
          <div className="flex gap-2">
            <Link href="/rrhh/empleados" className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</Link>
            <button type="submit" form="empleado-form" disabled={saving}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
              {saving ? "Guardando…" : "Crear empleado"}
            </button>
          </div>
        }
      />

      {msg && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{msg}</div>}

      <EmpleadoForm form={form} setF={setF} usuarios={usuarios} falta73={falta73} esNuevo onSubmit={guardar} />
    </div>
  );
}
