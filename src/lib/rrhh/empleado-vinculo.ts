import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Legajo del empleado y su usuario del sistema (script 73).
 *
 * El legajo es el código del empleado: texto, único por empresa. El usuario
 * es a lo sumo UN empleado; un empleado puede no tener usuario.
 */

/**
 * Columnas de `empleados` que agregan scripts que corre el cliente. Mientras
 * un script no corrió, PostgREST rechaza el insert/update entero si las nombra
 * (42703): se reintenta sin ellas y se avisa cuál falta.
 */
const COLUMNAS_POR_SCRIPT: Array<{ script: string; columnas: string[]; que: string }> = [
  { script: "73_legajo_y_usuario_del_empleado.sql", columnas: ["legajo", "usuario_id"], que: "legajo ni usuario" },
  { script: "74_horario_y_domicilio_del_empleado.sql", columnas: ["horario_semanal", "ciudad", "barrio"], que: "horario ni ciudad y barrio" },
];

/** El error de PostgREST/Postgres cuando falta una columna del script 73. */
export function faltaScript73(msg: string | null | undefined): boolean {
  const m = String(msg ?? "");
  return /42703|PGRST204|does not exist|schema cache/i.test(m) && /legajo|usuario_id/.test(m);
}

type Resultado = { data: unknown; error: { message: string } | null };

/**
 * Escribe y, si la base todavía no tiene alguna columna nueva, reintenta sin
 * las de ese script. Devuelve también los avisos para la pantalla.
 */
export async function escribirEmpleado(
  escribir: (payload: Record<string, unknown>) => PromiseLike<Resultado>,
  payload: Record<string, unknown>
): Promise<Resultado & { avisos: string[] }> {
  let actual = { ...payload };
  const avisos: string[] = [];
  for (let intento = 0; intento <= COLUMNAS_POR_SCRIPT.length; intento++) {
    const r = await escribir(actual);
    const msg = r.error?.message ?? "";
    const falta = r.error && /42703|PGRST204|does not exist|schema cache/i.test(msg)
      ? COLUMNAS_POR_SCRIPT.find((g) => g.columnas.some((c) => msg.includes(c)) && g.columnas.some((c) => c in actual))
      : undefined;
    if (!falta) return { ...r, avisos };
    for (const c of falta.columnas) delete actual[c];
    avisos.push(`Se guardó sin ${falta.que}: falta correr ${falta.script} en la base.`);
    actual = { ...actual };
  }
  return { data: null, error: { message: "No se pudo guardar el empleado." }, avisos };
}

export function normalizarLegajo(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, 30) : null;
}

/**
 * El próximo legajo numérico: uno más que el más alto, con cuatro dígitos
 * (0001, 0002…). Los legajos con letras no cuentan para la serie.
 */
export async function siguienteLegajo(sb: AppSupabaseClient, empresaId: string): Promise<string | null> {
  const r = await sb.from("empleados").select("legajo").eq("empresa_id", empresaId).not("legajo", "is", null);
  if (r.error) return null;
  let max = 0;
  for (const f of (r.data ?? []) as Array<{ legajo: string | null }>) {
    const s = String(f.legajo ?? "").trim();
    if (/^\d{1,15}$/.test(s)) max = Math.max(max, Number(s));
  }
  return String(max + 1).padStart(4, "0");
}

/**
 * Antes de escribir: que el legajo no lo tenga otro empleado, y que el
 * usuario exista en la empresa y no esté vinculado a otro empleado.
 * Devuelve el mensaje para la pantalla, o null si está todo bien.
 *
 * Los índices únicos del script 73 frenan lo mismo, pero con un error de
 * Postgres que nadie entiende.
 */
export async function validarLegajoYUsuario(
  sb: AppSupabaseClient,
  empresaId: string,
  datos: { legajo?: string | null; usuario_id?: string | null },
  excluirEmpleadoId?: string
): Promise<string | null> {
  if (datos.legajo) {
    let q = sb.from("empleados").select("id, nombre").eq("empresa_id", empresaId).eq("legajo", datos.legajo);
    if (excluirEmpleadoId) q = q.neq("id", excluirEmpleadoId);
    const r = await q.limit(1);
    if (r.error && !faltaScript73(r.error.message)) throw new Error(r.error.message);
    const otro = (r.data ?? [])[0] as { nombre?: string } | undefined;
    if (otro) return `El legajo ${datos.legajo} ya es de ${otro.nombre ?? "otro empleado"}.`;
  }
  if (datos.usuario_id) {
    const u = await sb.from("usuarios").select("id").eq("empresa_id", empresaId).eq("id", datos.usuario_id).maybeSingle();
    if (u.error) throw new Error(u.error.message);
    if (!u.data) return "Ese usuario no existe en la empresa.";

    let q = sb.from("empleados").select("id, nombre").eq("empresa_id", empresaId).eq("usuario_id", datos.usuario_id);
    if (excluirEmpleadoId) q = q.neq("id", excluirEmpleadoId);
    const r = await q.limit(1);
    if (r.error && !faltaScript73(r.error.message)) throw new Error(r.error.message);
    const otro = (r.data ?? [])[0] as { nombre?: string } | undefined;
    if (otro) return `Ese usuario ya está vinculado a ${otro.nombre ?? "otro empleado"}. Un usuario es un solo empleado.`;
  }
  return null;
}

export type UsuarioParaVincular = { id: string; nombre: string | null; email: string | null; estado: string | null };

/** Usuarios de la empresa, para elegir con cuál se vincula el empleado. */
export async function usuariosDeLaEmpresa(sb: AppSupabaseClient, empresaId: string): Promise<UsuarioParaVincular[]> {
  const r = await sb.from("usuarios").select("id, nombre, email, estado").eq("empresa_id", empresaId).order("nombre");
  if (r.error) return [];
  return (r.data ?? []) as UsuarioParaVincular[];
}
