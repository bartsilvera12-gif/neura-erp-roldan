import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { descuentoMaximoDe } from "@/lib/ventas/server/descuento-maximo";

/**
 * GET /api/me/rol — devuelve {rol, isAdmin, descuentoMaximo}. Usado por la UI
 * para mostrar u ocultar cosas.
 *
 * `descuentoMaximo` (punto 2.3) es el tope de descuento del usuario en Caja.
 * null = sin tope. Sirve para avisar en pantalla antes de intentar cobrar;
 * el límite de verdad lo aplica el servidor al crear la venta.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthWithRol(request);
  if (!auth) return NextResponse.json(errorResponse("No autenticado"), { status: 401 });

  let descuentoMaximo: number | null = null;
  try {
    const sb = await createServiceRoleClientForEmpresa(auth.empresa_id);
    descuentoMaximo = await descuentoMaximoDe(sb, auth.empresa_id, auth.usuarioCatalogId);
  } catch {
    // Sin el dato la UI no limita nada y el servidor sigue validando igual.
  }

  return NextResponse.json(successResponse({
    rol: auth.rol ?? null,
    isAdmin: isAdmin(auth),
    descuentoMaximo,
  }));
}
