"use client";

import { useEffect, useState } from "react";

/**
 * Hook simple para leer el rol ERP del usuario actual (desde /api/me/rol).
 * Devuelve `rol=null` mientras carga o si falla la lectura — usar `loaded`
 * para diferenciar. Se comparte cache HTTP con useIsAdmin (mismo endpoint
 * sin cache-control especial; ambos hooks piden por separado, pero como es
 * `cache: no-store` no hay riesgo de stale entre pestañas).
 *
 * `facultades` viene en la misma respuesta: el menú la necesita porque un
 * perfil puede abrir una pantalla que el nivel esconde (ver
 * `puedeVerSidebarSlugPorRol`).
 */
export function useRolErp(): { rol: string | null; facultades: string[]; loaded: boolean } {
  const [rol, setRol] = useState<string | null>(null);
  const [facultades, setFacultades] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    fetch("/api/me/rol", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success && j.data && typeof j.data.rol !== "undefined") {
          setRol(j.data.rol == null ? null : String(j.data.rol));
        }
        if (j?.success && Array.isArray(j.data?.facultades)) {
          setFacultades(j.data.facultades.filter((f: unknown): f is string => typeof f === "string"));
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancel) setLoaded(true);
      });
    return () => {
      cancel = true;
    };
  }, []);
  return { rol, facultades, loaded };
}
