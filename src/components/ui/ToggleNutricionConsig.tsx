"use client";

import { useCallback, useEffect, useState } from "react";

export type Modo = "nutricion" | "consignataria";

/**
 * Toggle "Nutrición | Consignataria" — pills teal/slate.
 * Se usa en las páginas /gastos, /pagos y /gestion-clientes para separar
 * la operación normal del ERP (nutrición) de la operación de intermediación
 * (consignataria).
 */
export function ToggleNutricionConsig(_props: {
  value: Modo;
  onChange: (m: Modo) => void;
  className?: string;
}) {
  // En Roldán e Hijos este toggle no aplica (no hay línea de negocio 'consignataria').
  // Se hereda de Reserva Ecológica donde separaba nutrición vs consignataria.
  // Retornamos null para no renderizar nada — el useModoPersistido queda intacto
  // y el modo por default es 'nutricion' que es el que Roldán e Hijos usa siempre.
  void _props;
  return null;
}

/**
 * Hook para persistir el modo elegido por página en localStorage.
 * Devuelve [modo, setModo] listo para pasar al toggle.
 *
 * Nota: el estado inicial es siempre "nutricion" (SSR-safe). En el primer
 * efecto client-side lee de localStorage y sincroniza si hay valor previo,
 * evitando mismatches de hidratación.
 */
const MODO_EVENT = "modo-nc-changed";

export function useModoPersistido(storageKey: string, initial: Modo = "nutricion"): [Modo, (m: Modo) => void] {
  const [modo, setModoState] = useState<Modo>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "nutricion" || raw === "consignataria") {
        setModoState(raw);
      }
    } catch {
      /* ignore */
    }
    // Escuchar cambios desde OTROS componentes con la misma key
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ key: string; value: Modo }>;
      if (e.detail?.key === storageKey) setModoState(e.detail.value);
    };
    window.addEventListener(MODO_EVENT, handler as EventListener);
    return () => window.removeEventListener(MODO_EVENT, handler as EventListener);
  }, [storageKey]);

  const setModo = useCallback(
    (m: Modo) => {
      setModoState(m);
      try {
        window.localStorage.setItem(storageKey, m);
        window.dispatchEvent(new CustomEvent(MODO_EVENT, { detail: { key: storageKey, value: m } }));
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  );

  return [modo, setModo];
}
