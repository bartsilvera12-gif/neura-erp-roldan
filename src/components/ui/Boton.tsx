import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Los botones de la aplicación. Tres, y nada más.
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 *   Contando sobre el código había 144 combinaciones distintas de clases con
 *   el color de la marca: el mismo botón con una esquina y con otra,
 *   en `font-medium` y en `font-semibold`, con sombra y sin, uno con degradé,
 *   anillo y un salto al apretarlo. Dos pantallas hermanas no se parecían.
 *
 * ── LAS TRES ───────────────────────────────────────────────────────────────
 *   primario    el color lleno. UNO por pantalla: si hay dos, hay uno de más.
 *   secundario  blanco con borde. Cancelar, exportar, imprimir.
 *   fantasma    solo texto. Lo que casi nunca se usa.
 *
 *   `peligro` existe aparte porque borrar y anular no son "otro secundario":
 *   tienen que verse distintos antes de leerse.
 */

export type VarianteBoton = "primario" | "secundario" | "fantasma" | "peligro";
export type TamanoBoton = "sm" | "md";

const VARIANTE: Record<VarianteBoton, string> = {
  primario:
    "bg-[#4FAEB2] text-white hover:bg-[#3F8E91] disabled:hover:bg-[#4FAEB2]",
  secundario:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  fantasma:
    "text-slate-600 hover:bg-slate-100",
  peligro:
    "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
};

const TAMANO: Record<TamanoBoton, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-[38px] gap-1.5 px-4 text-sm",
};

const BASE =
  "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function clasesBoton(
  variante: VarianteBoton = "primario",
  tamano: TamanoBoton = "md",
  extra = ""
): string {
  return `${BASE} ${TAMANO[tamano]} ${VARIANTE[variante]} ${extra}`.trim();
}

interface Comun {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  className?: string;
  children: ReactNode;
}

export default function Boton({
  variante = "primario", tamano = "md", className = "", children,
  type = "button", ...resto
}: Comun & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={clasesBoton(variante, tamano, className)} {...resto}>
      {children}
    </button>
  );
}

/** El mismo botón, cuando lleva a otra pantalla. */
export function BotonLink({
  variante = "primario", tamano = "md", className = "", children, href, ...resto
}: Comun & { href: string } & Omit<React.ComponentProps<typeof Link>, "className" | "children" | "href">) {
  return (
    <Link href={href} className={clasesBoton(variante, tamano, className)} {...resto}>
      {children}
    </Link>
  );
}
