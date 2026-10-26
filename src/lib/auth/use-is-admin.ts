"use client";

import { useEffect, useState } from "react";

/**
 * Hook simple: rol admin y tope de descuento del usuario.
 *
 * `descuentoMaximo` (punto 2.3): null = sin tope. Es para avisar en pantalla;
 * el límite de verdad lo aplica el servidor al crear la venta.
 */
export function useIsAdmin(): { isAdmin: boolean; loaded: boolean; descuentoMaximo: number | null } {
  const [isAdmin, setIsAdmin] = useState(false);
  const [descuentoMaximo, setDescuentoMaximo] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    fetch("/api/me/rol", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        setIsAdmin(j?.success && j.data?.isAdmin === true);
        const d = j?.data?.descuentoMaximo;
        setDescuentoMaximo(typeof d === "number" && Number.isFinite(d) ? d : null);
        setLoaded(true);
      })
      .catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);
  return { isAdmin, loaded, descuentoMaximo };
}
