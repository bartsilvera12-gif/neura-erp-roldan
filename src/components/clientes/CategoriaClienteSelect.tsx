"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Categoria = { id: string; nombre: string };

/**
 * Dropdown de categoría de cliente. Emite `null` cuando el usuario elige
 * "Sin categoría". Usado en el form de alta y edición de cliente.
 */
export default function CategoriaClienteSelect({
  value, onChange, className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const [items, setItems] = useState<Categoria[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchWithSupabaseSession("/api/categorias-cliente?solo_activas=1", { cache: "no-store" });
        const j = await r.json();
        if (alive && r.ok && j.success) setItems(j.data.categorias ?? []);
      } catch { /* silencioso */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={className}
    >
      <option value="">— Sin categoría —</option>
      {items.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
  );
}
