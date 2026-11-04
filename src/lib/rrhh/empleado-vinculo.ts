import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Legajo del empleado y su usuario del sistema (script 73).
 *
 * El legajo es el código del empleado: texto, único por empresa. El usuario
 * es a lo sumo UN empleado; un empleado puede no tener usuario.
 */

/** Columnas que agrega el script 73. Mientras no corra, se guarda sin ellas. */
export const COLUMNAS_SCRIPT_73 = ["legajo", "usuario_id"] as const;

export const AVISO_FALTA_73 =
  "Se guardó, pero sin legajo ni usuario: falta correr 73_legajo_y_usuario_del_empleado.sql en la base.";

/** El error de PostgREST/Postgres cuando falta una columna del script 73. */
export function faltaScript73(msg: string | null | undefined): boolean {
  const m = String(msg ?? "");
  return /42703|PGRST204|does not exist|schema cache/i.test(m) && /legajo|usuario_id/.test(m);
}

/** Saca del payload las columnas del script 73 (para reintentar sin ellas). */
export function sinColumnas73<T extends Record<string, unknown>>(o: T): T {
  const c = { ...o };
  for (const k of COLUMNAS_SCRIPT_73) delete c[k];
  return c;
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
