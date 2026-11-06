import type { ReactNode } from "react";

/**
 * Las tarjetas de números que van arriba de una pantalla.
 *
 * ── POR QUÉ SE UNIFICARON ──────────────────────────────────────────────────
 *   Cada pantalla tenía las suyas, escritas a mano, y no se parecían entre sí:
 *   una en blanco, la de al lado amarilla entera y la tercera verde entera,
 *   con el título en MAYÚSCULAS y el número en tres tonos distintos. Tres
 *   bloques de color fuerte uno al lado del otro compiten entre sí y ninguno
 *   gana: la pantalla grita y no se sabe qué mirar.
 *
 * ── EL COLOR NO DICE EL DATO ───────────────────────────────────────────────
 *   Pintar la tarjeta de rojo o de verde parece que ayuda, pero el que no
 *   distingue el rojo del verde —uno de cada doce hombres— no ve ninguna
 *   diferencia. Lo medí con el validador de paletas: el par rojo/verde queda
 *   en ΔE 6,0 en deuteranopía, abajo del piso de 8.
 *
 *   Así que la tarjeta es blanca y el estado lo dice la palabra: "Vencido",
 *   "Cobrado". El color queda como refuerzo —una línea finita al costado y el
 *   número entonado— nunca como el único portador del significado.
 *
 * ── EL NÚMERO GRANDE NO LLEVA tabular-nums ─────────────────────────────────
 *   `tabular-nums` le da a cada dígito el ancho de un cero. Sirve en una
 *   columna de una tabla, donde los números tienen que alinearse; en un número
 *   grande y suelto lo único que hace es dejarlo flojo y con aire de más.
 */

export type TonoMetrica = "neutro" | "acento" | "pendiente" | "bien" | "alerta";

const TONO: Record<TonoMetrica, { valor: string; linea: string }> = {
  neutro:    { valor: "text-slate-900",  linea: "bg-slate-200" },
  acento:    { valor: "text-[#2F6F72]",  linea: "bg-[#4FAEB2]" },
  pendiente: { valor: "text-amber-700",  linea: "bg-amber-400" },
  bien:      { valor: "text-emerald-700", linea: "bg-emerald-500" },
  alerta:    { valor: "text-rose-700",   linea: "bg-rose-500" },
};

export function Metrica({
  etiqueta, valor, detalle, tono = "neutro", icono, cargando = false,
}: {
  /** En minúsculas, como una frase. Sin dos puntos al final. */
  etiqueta: string;
  valor: ReactNode;
  /** La segunda línea: el contexto que hace que el número signifique algo. */
  detalle?: ReactNode;
  tono?: TonoMetrica;
  icono?: ReactNode;
  cargando?: boolean;
}) {
  const t = TONO[tono];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
      {/* La línea de color al costado: refuerza, no informa sola. */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${t.linea}`} />
      <div className="flex items-start justify-between gap-2 pl-2">
        <p className="text-xs font-medium text-slate-500">{etiqueta}</p>
        {icono && <span className="shrink-0 text-slate-300">{icono}</span>}
      </div>
      {cargando ? (
        <div className="ml-2 mt-2 h-7 w-28 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className={`mt-1 pl-2 text-2xl font-semibold leading-tight ${t.valor}`}>{valor}</p>
      )}
      {detalle && !cargando && (
        <p className="mt-0.5 pl-2 text-[11px] leading-snug text-slate-500">{detalle}</p>
      )}
    </div>
  );
}

/**
 * La fila de tarjetas.
 *
 * Se acomoda sola: con tres entran de a tres, con cuatro de a cuatro, y en un
 * teléfono se apilan. Antes cada pantalla elegía su `sm:grid-cols-N` y con
 * cuatro tarjetas quedaba una sola abajo, desbalanceada.
 */
export function FilaDeMetricas({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
      {children}
    </div>
  );
}

export default Metrica;
