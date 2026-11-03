"use client";

import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { useRolErp } from "@/lib/auth/use-rol-erp";
import { isErpRolSupervisor } from "@/lib/usuarios/erp-rol-normalize";
import { puedeDevolver } from "@/lib/devoluciones/permiso-devolver";

/**
 * ¿Este usuario puede confirmar una devolución?
 *
 * Misma regla que el servidor (`puedeDevolver`), leída desde el mismo lugar:
 * si la pantalla usara su propia condición, el día que cambie la regla una de
 * las dos quedaría diciendo otra cosa y el vendedor cargaría una devolución
 * entera para que se la rechacen al confirmar.
 *
 * `cargando` existe para no mostrar "no podés" mientras todavía no se sabe el
 * rol: un cartel de permiso que aparece y desaparece se lee como un error del
 * sistema.
 */
export function usePuedeDevolver(): { puede: boolean; cargando: boolean; motivo: string | null } {
  const { isAdmin, loaded: adminListo } = useIsAdmin();
  const { rol, loaded: rolListo } = useRolErp();

  const cargando = !adminListo || !rolListo;
  const permiso = puedeDevolver({
    esAdmin: isAdmin,
    esSupervisor: isErpRolSupervisor(rol),
  });

  return {
    puede: permiso.permitido,
    cargando,
    motivo: permiso.permitido ? null : permiso.motivo,
  };
}
