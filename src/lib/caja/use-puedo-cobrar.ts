"use client";

import { useEffect, useState } from "react";

/**
 * ¿Quien mira puede cobrar? Solo la cajera de una caja abierta (o quien ella
 * tenga agregado) y los administradores (pedido del cliente). Lo decide el
 * servidor en /api/caja/estado; mientras carga, no se muestra «Cobrar».
 */
export function usePuedoCobrar(): boolean {
  const [puede, setPuede] = useState(false);
  useEffect(() => {
    let vivo = true;
    fetch("/api/caja/estado", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo) setPuede(j?.data?.puedo_cobrar === true); })
      .catch(() => { /* sin dato, sin botón: el servidor igual lo controla */ });
    return () => { vivo = false; };
  }, []);
  return puede;
}
