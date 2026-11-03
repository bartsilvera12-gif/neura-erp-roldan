"use client";

import { useEffect, useState } from "react";
import { soloFacultadesConocidas, type Facultad } from "@/lib/perfiles/facultades";

/**
 * Las facultades del usuario, para que la pantalla muestre lo que de verdad
 * va a poder hacer.
 *
 * Sale del mismo /api/me/rol que ya piden `useIsAdmin` y `useRolErp`: sin
 * cache especial, pero `no-store`, así que un cambio de perfil se ve al
 * recargar y no al día siguiente.
 *
 * `cargando` existe para no mostrar "no podés" mientras todavía no se sabe:
 * un cartel de permiso que aparece y desaparece se lee como un error del
 * sistema.
 */
export function useFacultades(): { tiene: (f: Facultad) => boolean; cargando: boolean } {
  const [lista, setLista] = useState<Facultad[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch("/api/me/rol", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success) setLista(soloFacultadesConocidas(j.data?.facultades));
        setCargando(false);
      })
      .catch(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, []);

  return { tiene: (f: Facultad) => lista.includes(f), cargando };
}
