"use client";

import { useFacultades } from "@/lib/perfiles/use-facultades";
import { puedeDevolver } from "@/lib/devoluciones/permiso-devolver";

/**
 * ¿Este usuario puede confirmar una devolución?
 *
 * Misma regla que el servidor (`puedeDevolver`) y misma fuente: la facultad
 * `autorizar_devolucion` del perfil. Si la pantalla usara su propia condición,
 * el día que cambie la regla una de las dos quedaría diciendo otra cosa y el
 * vendedor cargaría una devolución entera para que se la rechacen al
 * confirmar.
 *
 * `cargando` existe para no mostrar "no podés" mientras todavía no se sabe el
 * rol: un cartel de permiso que aparece y desaparece se lee como un error del
 * sistema.
 */
export function usePuedeDevolver(): { puede: boolean; cargando: boolean; motivo: string | null } {
  const { tiene, cargando } = useFacultades();
  const permiso = puedeDevolver({ autoriza: tiene("autorizar_devolucion") });

  return {
    puede: permiso.permitido,
    cargando,
    motivo: permiso.permitido ? null : permiso.motivo,
  };
}
