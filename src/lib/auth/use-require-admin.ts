"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

/**
 * Gate de cliente para páginas que solo debe usar un administrador (p. ej. alta
 * y edición de productos). Cuando el rol ya cargó y NO es admin, redirige a
 * `fallback`. Es defensa en profundidad: la autorización real vive en la API
 * (requireAdminProductos), pero esto evita que un usuario de sucursal llegue por
 * URL a un formulario que igual sería rechazado al guardar.
 */
export function useRequireAdmin(fallback = "/inventario"): { isAdmin: boolean; loaded: boolean } {
  const router = useRouter();
  const { isAdmin, loaded } = useIsAdmin();
  useEffect(() => {
    if (loaded && !isAdmin) router.replace(fallback);
  }, [loaded, isAdmin, router, fallback]);
  return { isAdmin, loaded };
}
