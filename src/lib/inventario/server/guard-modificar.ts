import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { tieneFacultad } from "@/lib/perfiles/server/facultades-usuario";

export const MSG_INVENTARIO_SOLO_LECTURA =
  "Tu perfil ve el inventario pero no lo modifica. Pedile a un administrador la casilla «Modificar inventario».";

/**
 * Guard de las rutas que MODIFICAN el inventario (pedido del cliente: «si le
 * doy el módulo de inventario sale todo; que solo pueda ver para imprimir, que
 * no se pueda modificar»).
 *
 * Con el módulo Inventario se ve e imprime. Para cambiar algo —movimientos de
 * stock, transferencias entre depósitos, rubros, ubicaciones, importaciones,
 * lotes, imágenes, precios por categoría, costos de proveedor— hace falta la
 * facultad `modificar_inventario` del perfil. El administrador siempre puede.
 *
 * Devuelve la respuesta de error lista, o null si puede seguir.
 */
export async function bloqueoModificarInventario(request: Request): Promise<NextResponse | null> {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  if (isAdmin(ctx.auth)) return null;
  if (await tieneFacultad(ctx.supabase, ctx.auth, "modificar_inventario")) return null;
  return NextResponse.json(errorResponse(MSG_INVENTARIO_SOLO_LECTURA), { status: 403 });
}
