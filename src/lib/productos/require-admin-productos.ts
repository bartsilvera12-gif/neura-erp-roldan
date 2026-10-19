import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import type { UsuarioConEmpresaYRol } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const MSG_PRODUCTOS_SOLO_ADMIN =
  "Solo un administrador puede crear, editar o eliminar productos. Podés consultar el catálogo y ver el detalle de cada producto.";

type Ctx = { auth: UsuarioConEmpresaYRol; supabase: AppSupabaseClient };

/**
 * Guard de servidor para MUTAR el catálogo de productos (crear/editar/eliminar):
 * solo administradores.
 *
 * El personal de sucursal (roles `usuario` / `supervisor`) conserva acceso de
 * LECTURA — los GET de productos quedan abiertos para que puedan consultar el
 * catálogo, precios y stock. No usar este guard en los GET.
 *
 * Ocultar los botones en la UI no alcanza: sin este guard, un usuario no admin
 * podía crear o modificar productos llamando la API directamente. Usa la misma
 * definición de admin que `/api/me/rol` (isAdmin → esRolAdminEmpresaOGlobal),
 * así la UI (useIsAdmin) y el backend coinciden exactamente.
 */
export async function requireAdminProductos(
  request: Request
): Promise<{ ok: true; ctx: Ctx } | { ok: false; response: NextResponse }> {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }),
    };
  }
  if (!isAdmin(ctx.auth)) {
    return {
      ok: false,
      response: NextResponse.json(errorResponse(MSG_PRODUCTOS_SOLO_ADMIN), { status: 403 }),
    };
  }
  return { ok: true, ctx };
}
