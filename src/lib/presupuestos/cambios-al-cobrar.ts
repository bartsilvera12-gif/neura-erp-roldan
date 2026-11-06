/**
 * Qué se le cambió al presupuesto en la caja.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "sistema manda notificación a la vendedora si al cobrar se modifica el
 *    presupuesto… que salga la modificación del presupuesto a la hora de
 *    cobrar en alguna parte de presupuesto."
 *
 * ── POR QUÉ IMPORTA ────────────────────────────────────────────────────────
 *   La vendedora arma el presupuesto, lo manda a cobrar y ahí lo pierde de
 *   vista: en la caja se le puede sacar una línea, bajar un precio o cambiar
 *   una cantidad, y ella se entera —si se entera— cuando el cliente le
 *   reclama algo que ella no ofreció, o cuando le llega una comisión que no
 *   cierra con lo que vendió.
 *
 *   El que cobra casi nunca cambia las cosas por capricho: faltó mercadería,
 *   el cliente se llevó menos, se arregló un precio. El problema no es el
 *   cambio, es que no se avise.
 *
 * ── POR QUÉ SE COMPARA EN EL SERVIDOR ──────────────────────────────────────
 *   Las dos puntas se leen de la base: las líneas del presupuesto y las de la
 *   venta. Si la comparación la mandara la pantalla de caja, quien cobra
 *   estaría contando lo que él mismo cambió.
 */

export interface LineaComparable {
  producto_id: string | null;
  producto_nombre: string;
  cantidad: number;
  precio_unitario: number;
}

export type TipoCambio = "quitado" | "agregado" | "cantidad" | "precio";

export interface Cambio {
  tipo: TipoCambio;
  producto_nombre: string;
  /** Lo que decía el presupuesto. */
  antes: number | null;
  /** Lo que se cobró. */
  despues: number | null;
}

export interface CambiosAlCobrar {
  hay: boolean;
  cambios: Cambio[];
  total_presupuesto: number;
  total_cobrado: number;
  /** Positivo = se cobró más que lo presupuestado. */
  diferencia: number;
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/**
 * La clave con la que se parean las líneas.
 *
 * Por producto, no por posición: en la caja se puede borrar una línea y
 * agregar otra, y comparar "la tercera con la tercera" diría que cambiaron
 * dos cosas cuando cambió una. Los ítems sin producto —escritos a mano— se
 * parean por nombre, que es lo único que tienen.
 */
const clave = (l: LineaComparable): string =>
  l.producto_id ? `id:${l.producto_id}` : `nombre:${l.producto_nombre.trim().toUpperCase()}`;

const total = (ls: LineaComparable[]): number =>
  ls.reduce((s, l) => s + n(l.cantidad) * n(l.precio_unitario), 0);

/**
 * Compara lo presupuestado con lo cobrado.
 *
 * Un precio o una cantidad que no se tocaron no generan nada: la lista son
 * los cambios, no el detalle entero. Si no cambió nada, `hay` es false y no
 * se le avisa a nadie: avisar de lo que no cambió entrena a ignorar los
 * avisos.
 */
export function compararAlCobrar(
  delPresupuesto: LineaComparable[],
  loCobrado: LineaComparable[]
): CambiosAlCobrar {
  const antes = new Map<string, LineaComparable>();
  for (const l of delPresupuesto) antes.set(clave(l), l);
  const despues = new Map<string, LineaComparable>();
  for (const l of loCobrado) despues.set(clave(l), l);

  const cambios: Cambio[] = [];

  for (const [k, a] of antes) {
    const d = despues.get(k);
    if (!d) {
      cambios.push({ tipo: "quitado", producto_nombre: a.producto_nombre, antes: n(a.cantidad), despues: null });
      continue;
    }
    if (n(a.cantidad) !== n(d.cantidad)) {
      cambios.push({ tipo: "cantidad", producto_nombre: a.producto_nombre, antes: n(a.cantidad), despues: n(d.cantidad) });
    }
    // Los guaraníes no tienen centavos: una diferencia de menos de un guaraní
    // es del redondeo, no una decisión de nadie.
    if (Math.abs(n(a.precio_unitario) - n(d.precio_unitario)) >= 1) {
      cambios.push({ tipo: "precio", producto_nombre: a.producto_nombre, antes: n(a.precio_unitario), despues: n(d.precio_unitario) });
    }
  }

  for (const [k, d] of despues) {
    if (!antes.has(k)) {
      cambios.push({ tipo: "agregado", producto_nombre: d.producto_nombre, antes: null, despues: n(d.cantidad) });
    }
  }

  const tp = Math.round(total(delPresupuesto));
  const tc = Math.round(total(loCobrado));
  return {
    hay: cambios.length > 0 || tp !== tc,
    cambios,
    total_presupuesto: tp,
    total_cobrado: tc,
    diferencia: tc - tp,
  };
}

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;

/** Una línea en castellano, para el aviso y para la pantalla. */
export function textoCambio(c: Cambio): string {
  switch (c.tipo) {
    case "quitado":
      return `Se sacó ${c.producto_nombre}`;
    case "agregado":
      return `Se agregó ${c.producto_nombre}${c.despues ? ` (${c.despues})` : ""}`;
    case "cantidad":
      return `${c.producto_nombre}: ${c.antes} → ${c.despues}`;
    case "precio":
      return `${c.producto_nombre}: ${gs(c.antes ?? 0)} → ${gs(c.despues ?? 0)}`;
  }
}

/**
 * El resumen de una línea que se le muestra a la vendedora.
 *
 * Primero cuánto cambió el total, porque es lo que se mira: de ahí sale la
 * comisión y es lo que el cliente terminó pagando.
 */
export function resumirCambios(r: CambiosAlCobrar): string {
  if (!r.hay) return "Se cobró tal cual se presupuestó.";
  const partes: string[] = [];
  if (r.diferencia !== 0) {
    partes.push(
      r.diferencia > 0
        ? `Se cobró ${gs(r.diferencia)} más de lo presupuestado`
        : `Se cobró ${gs(-r.diferencia)} menos de lo presupuestado`
    );
  }
  const q = r.cambios.length;
  if (q > 0) partes.push(`${q} ${q === 1 ? "cambio" : "cambios"} en los productos`);
  return partes.join(" · ");
}
