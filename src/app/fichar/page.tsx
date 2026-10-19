import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export const dynamic = "force-dynamic";

/**
 * `/fichar` sin token: resuelve la empresa automáticamente y redirige al
 * kiosco real `/fichar/[token]`. Si todavía no hay token activo y existe una
 * sola empresa con empleados, lo provisiona en el momento — así RRHH no
 * tiene que tocar nada para que funcione el link.
 *
 * Si hay más de una empresa con empleados (caso multi-tenant), no podemos
 * adivinar cuál: se muestra un mensaje pidiendo el link específico.
 */
export default async function FicharIndexPage() {
  const sb = createServiceRoleClient();

  // 1) Si ya hay un token activo, usá ese (sin importar cuántas empresas haya).
  //    En instalaciones mono-empresa hay siempre uno solo.
  const tokensQ = await sb
    .from("fichar_tokens")
    .select("token, empresa_id")
    .eq("activo", true)
    .order("created_at", { ascending: false })
    .limit(2);
  const tokens = (tokensQ.data ?? []) as Array<{ token: string; empresa_id: string }>;
  if (tokens.length === 1) {
    redirect(`/fichar/${tokens[0].token}`);
  }
  if (tokens.length > 1) {
    return <Aviso titulo="Necesitás el link específico" cuerpo="Hay más de una empresa configurada. Pedile a RRHH el link completo (/fichar/...)." />;
  }

  // 2) No hay token activo. Si existe una sola empresa con empleados, generá uno.
  const empleadosQ = await sb
    .from("empleados")
    .select("empresa_id")
    .eq("activo", true);
  const empresas = new Set<string>();
  for (const r of (empleadosQ.data ?? []) as Array<{ empresa_id: string }>) {
    empresas.add(r.empresa_id);
  }
  if (empresas.size === 0) {
    return <Aviso titulo="Sin empleados cargados" cuerpo="Cargá empleados desde el ERP antes de usar el kiosco." />;
  }
  if (empresas.size > 1) {
    return <Aviso titulo="Configurá el link en RRHH" cuerpo="Hay más de una empresa. Pedile a RRHH que genere y comparta el link específico desde RRHH → Control horario." />;
  }
  const empresaId = [...empresas][0];

  // Provisionar token nuevo.
  let token = "";
  for (let intento = 0; intento < 5; intento++) {
    token = randomBytes(8).toString("hex");
    const ins = await sb
      .from("fichar_tokens")
      .insert([{ token, empresa_id: empresaId, activo: true }])
      .select("token")
      .single();
    if (!ins.error && ins.data) break;
    if (ins.error && !/duplicate|unique/i.test(ins.error.message)) {
      return <Aviso titulo="No se pudo generar el link" cuerpo={ins.error.message} />;
    }
    token = "";
  }
  if (!token) {
    return <Aviso titulo="No se pudo generar el link" cuerpo="Reintentá en un momento." />;
  }
  redirect(`/fichar/${token}`);
}

function Aviso({ titulo, cuerpo }: { titulo: string; cuerpo: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xl">⚠</div>
        <h1 className="text-base font-semibold text-slate-900">{titulo}</h1>
        <p className="mt-2 text-sm text-slate-600">{cuerpo}</p>
      </div>
    </div>
  );
}
