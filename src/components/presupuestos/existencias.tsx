"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Existencias con reserva en el formulario de presupuesto (puntos 9.1 y 9.2).
 *
 * Está acá y no dentro de cada pantalla porque el alta y la edición de un
 * presupuesto son el mismo formulario escrito dos veces: el aviso de faltante
 * tiene que decir lo mismo en los dos lados, y copiado se desincroniza al
 * primer ajuste.
 */

export type Existencia = {
  producto_id: string;
  fisico: number;
  reservado: number;
  disponible: number;
};

/** Pide las existencias de los productos que están en el presupuesto. */
export function useExistencias(productoIds: (string | null)[]): Record<string, Existencia> {
  const [mapa, setMapa] = useState<Record<string, Existencia>>({});
  // La clave es el string: así el efecto no se dispara cuando cambia solo una
  // cantidad, que no mueve el stock de nadie.
  const clave = productoIds.filter(Boolean).join(",");

  useEffect(() => {
    if (!clave) { setMapa({}); return; }
    let cancel = false;
    fetchWithSupabaseSession(
      `/api/inventario/existencias?productos=${encodeURIComponent(clave)}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        const m: Record<string, Existencia> = {};
        for (const e of (j.data?.existencias ?? []) as Existencia[]) m[e.producto_id] = e;
        setMapa(m);
      })
      // Sin existencias el presupuesto se carga y se guarda igual (punto 9.1):
      // el stock nunca fue una condición para cotizar.
      .catch(() => {});
    return () => { cancel = true; };
  }, [clave]);

  return mapa;
}

/**
 * Línea chica bajo la cantidad.
 *
 * ── POR QUÉ DICE TAN POCO ─────────────────────────────────────────────────
 *   La columna de cantidad mide 80px. Tres números y dos frases ahí adentro
 *   se parten en cuatro renglones y empujan el resto de la fila hacia abajo:
 *   el aviso termina estorbando más de lo que informa.
 *
 *   Y casi siempre los tres números dicen lo mismo: sin nada reservado,
 *   disponible ES el físico. Entonces se muestra un solo dato, en un renglón
 *   que no se parte, y el desglose completo queda en el `title` para cuando
 *   alguien quiera el detalle. El desglose solo se escribe cuando hay algo
 *   reservado, que es cuando los números difieren de verdad.
 */
export function ExistenciaLinea({
  existencia,
  cantidad,
}: {
  existencia: Existencia | undefined;
  cantidad: number;
}) {
  if (!existencia) return null;
  const falta = (Number(cantidad) || 0) - existencia.disponible;
  const hayReserva = existencia.reservado > 0;

  const resumen = hayReserva
    ? `Disp. ${existencia.disponible} de ${existencia.fisico}`
    : `Stock ${existencia.fisico}`;

  const detalle =
    `Físico ${existencia.fisico} · reservado ${existencia.reservado} · ` +
    `disponible ${existencia.disponible}` +
    (falta > 0 ? `. Faltan ${falta} para entregar hoy.` : "");

  return (
    // El nowrap va en el contenedor y no en cada parte: puesto en las partes,
    // el renglón se corta igual entre una y otra.
    <div className="mt-1 whitespace-nowrap text-[10px] leading-tight" title={detalle}>
      <span className="text-slate-400">{resumen}</span>
      {falta > 0 && (
        <span className="ml-1 font-medium text-amber-600">· faltan {falta}</span>
      )}
    </div>
  );
}

/**
 * Resumen del faltante, para poner arriba del botón de guardar.
 *
 * Avisa y deja guardar. Un presupuesto es una oferta, no una entrega: lo normal
 * en una ferretería es cotizar lo que no hay, que el cliente acepte y recién
 * entonces comprarlo.
 */
export function AvisoFaltantes({
  lineas,
  existencias,
}: {
  lineas: { producto_id: string | null; producto_nombre: string; cantidad: number }[];
  existencias: Record<string, Existencia>;
}) {
  const faltantes = lineas
    .map((l) => {
      const ex = l.producto_id ? existencias[l.producto_id] : undefined;
      if (!ex) return null;
      const falta = (Number(l.cantidad) || 0) - ex.disponible;
      return falta > 0 ? { nombre: l.producto_nombre, falta } : null;
    })
    .filter((x): x is { nombre: string; falta: number } => x !== null);

  if (faltantes.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p className="font-medium">
        {faltantes.length === 1
          ? "Hay un producto sin stock suficiente para entregar hoy."
          : `Hay ${faltantes.length} productos sin stock suficiente para entregar hoy.`}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {faltantes.map((f, i) => (
          <li key={i}>· {f.nombre || "Sin descripción"}: faltan {f.falta}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs">
        El presupuesto se guarda igual. Si el cliente lo aprueba, hay que
        comprar antes de entregar.
      </p>
    </div>
  );
}
