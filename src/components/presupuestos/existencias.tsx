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
    <div className="mt-1 whitespace-nowrap leading-tight" title={detalle}>
      <span className="text-[10px] text-slate-400">{resumen}</span>
      {/* El faltante es lo único que obliga a hacer algo —comprar, avisar al
          cliente— y estaba del mismo tamaño y casi del mismo gris que el
          stock, así que se leía como parte del mismo dato y se pasaba por
          alto. Va más grande, en negrita y con fondo, para que salte. */}
      {falta > 0 && (
        <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
          faltan {falta}
        </span>
      )}
    </div>
  );
}

/** Las líneas que piden más de lo disponible. Vacío = alcanza para todo. */
export function lineasSinStock(
  lineas: { producto_id: string | null; producto_nombre: string; cantidad: number }[],
  existencias: Record<string, Existencia>
): { nombre: string; falta: number }[] {
  // Varias líneas del mismo producto suman: tres de 10 de la misma chapa son
  // 30, y medidas por separado cada una "entra" cuando hay 15.
  const pedido = new Map<string, { nombre: string; cantidad: number }>();
  for (const l of lineas) {
    const id = l.producto_id ? String(l.producto_id) : "";
    if (!id) continue;
    const prev = pedido.get(id);
    pedido.set(id, {
      nombre: prev?.nombre || l.producto_nombre,
      cantidad: (prev?.cantidad ?? 0) + (Number(l.cantidad) || 0),
    });
  }
  const out: { nombre: string; falta: number }[] = [];
  for (const [id, p] of pedido) {
    const ex = existencias[id];
    if (!ex) continue;
    const falta = p.cantidad - ex.disponible;
    if (falta > 0) out.push({ nombre: p.nombre, falta });
  }
  return out;
}

/**
 * Resumen del faltante, para poner arriba del botón de guardar.
 *
 * Cotizar lo que no hay sigue siendo válido —un presupuesto es una oferta, no
 * una entrega— pero prometer mercadería que no está es asumir una compra y una
 * fecha de entrega, así que lo hace un administrador. Para el resto el aviso
 * pasa de "se guarda igual" a "esto no se puede guardar", y lo dice acá, antes
 * de que el vendedor termine de cargar veinte líneas.
 */
export function AvisoFaltantes({
  lineas,
  existencias,
  puedeSinStock = true,
}: {
  lineas: { producto_id: string | null; producto_nombre: string; cantidad: number }[];
  existencias: Record<string, Existencia>;
  /** El administrador puede cotizar sin stock; el resto no. */
  puedeSinStock?: boolean;
}) {
  const faltantes = lineasSinStock(lineas, existencias);

  if (faltantes.length === 0) return null;

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${
      puedeSinStock
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-rose-800"
    }`}>
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
        {puedeSinStock
          ? "El presupuesto se guarda igual. Si el cliente lo aprueba, hay que comprar antes de entregar."
          : "Cotizar más de lo que hay lo hace un administrador, porque es asumir una compra y una fecha de entrega. Bajá las cantidades o pedile a un administrador que lo cargue."}
      </p>
    </div>
  );
}
