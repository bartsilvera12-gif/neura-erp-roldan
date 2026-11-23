"use client";

import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { useRolErp } from "@/lib/auth/use-rol-erp";

/**
 * ¿Puede modificar el inventario? (casilla de perfil «Modificar inventario»;
 * el administrador siempre). Sin ella el módulo es para ver e imprimir.
 *
 * Es para la pantalla: el que manda es el servidor
 * (`bloqueoModificarInventario`). Mientras carga, se asume que NO, así no
 * aparecen botones que después desaparecen.
 */
export function usePuedeModificarInventario(): { puede: boolean; loaded: boolean } {
  const { isAdmin, loaded: l1 } = useIsAdmin();
  const { facultades, loaded: l2 } = useRolErp();
  const loaded = l1 && l2;
  return { puede: loaded && (isAdmin || facultades.includes("modificar_inventario")), loaded };
}

export const AVISO_SOLO_LECTURA =
  "Solo lectura: tu perfil ve e imprime el inventario, pero no lo modifica. Para cambiar algo hace falta la casilla «Modificar inventario».";
