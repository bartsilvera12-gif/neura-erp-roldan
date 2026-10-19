import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Botón estándar del ERP. Base blanca + acento turquesa (#4FAEB2).
 *
 * Variantes:
 *  - primary:   turquesa, acción principal.
 *  - secondary: blanco con borde suave (acción secundaria).
 *  - ghost:     sin fondo, hover sutil.
 *  - danger:    rojo suave para acciones destructivas.
 *
 * Si se pasa `href`, renderiza un <Link> con la misma apariencia.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4FAEB2]/40 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]";

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs min-h-[34px]",
  md: "px-4 py-2 text-sm min-h-[40px]",
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[#4FAEB2] text-white shadow-sm shadow-[#4FAEB2]/25 hover:bg-[#3F8E91]",
  secondary:
    "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-[#3F8E91]",
  danger:
    "border border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50",
};

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string) {
  return `${base} ${sizes[size]} ${variants[variant]} ${extra ?? ""}`.trim();
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
};

export default function Button(props: ButtonAsButton | ButtonAsLink) {
  const { variant = "primary", size = "md", className, children } = props;
  const cls = classes(variant, size, className);

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} className={cls}>
        {children}
      </Link>
    );
  }

  // Separamos los props de estilo de los props nativos del <button>.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { variant: _v, size: _s, className: _c, children: _ch, ...rest } =
    props as ButtonAsButton;
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
