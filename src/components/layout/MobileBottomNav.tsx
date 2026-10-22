"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingCart, Users, Utensils, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { useBoot } from "@/components/BootContext";
import { canAccessSidebarSlug } from "@/lib/modulos/route-slug-map";
import { getModuleAccessCached, peekModuleAccessCache } from "@/lib/modulos/module-access-cache";

/**
 * Barra de navegación inferior — solo visible en mobile (md:hidden).
 *
 * Patrón estándar de apps mobile (Instagram, WhatsApp, etc.): los 4-5 destinos
 * más usados accesibles a 1 tap desde cualquier pantalla. El botón "Más" abre
 * el sidebar drawer existente con todos los módulos.
 *
 * Visible solo en mobile. En desktop la navegación va por el sidebar lateral.
 * El padding bottom del <main> en mobile se ajusta con pb-20 para que el
 * contenido scrollee por arriba de la barra sin quedar tapado.
 *
 * Safe-area: usa pb-[env(safe-area-inset-bottom)] para evitar que el notch
 * inferior de iPhone tape los iconos.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  matchPrefixes?: string[]; // si la ruta empieza con cualquiera, marcamos activo
  /** Módulo que habilita el ítem. Sin slug, siempre visible. */
  slug?: string;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home, matchPrefixes: ["/"] },
  { href: "/ventas", label: "Ventas", icon: ShoppingCart, matchPrefixes: ["/ventas"], slug: "ventas" },
  { href: "/dashboard/proyectos", label: "Pedidos", icon: Utensils, matchPrefixes: ["/dashboard/proyectos"], slug: "proyectos" },
  { href: "/clientes", label: "Clientes", icon: Users, matchPrefixes: ["/clientes", "/gestion-clientes"], slug: "clientes" },
];

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  // Caso especial Inicio "/" — solo activo si pathname es exactamente "/" (sin esto matchea todo).
  if (item.href === "/") return pathname === "/";
  if (!item.matchPrefixes) return pathname === item.href;
  return item.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { setMobileSidebarOpen } = useBoot();

  // Esta barra no filtraba por módulo, así que mostraba "Pedidos" aunque la
  // empresa no tuviera el módulo: el tap terminaba en "Módulo no habilitado".
  // Usa el mismo acceso que el sidebar de escritorio.
  const [acceso, setAcceso] = useState(() => peekModuleAccessCache());
  useEffect(() => {
    let vivo = true;
    void getModuleAccessCached().then(({ ok, data }) => {
      if (vivo && ok) setAcceso(data);
    });
    return () => { vivo = false; };
  }, []);

  const visibles = ITEMS.filter((item) => {
    if (!item.slug) return true;
    // Hasta que llega la respuesta no escondemos nada que ya estuviera en
    // cache; si no hay cache, mostramos solo lo que no depende de módulo.
    if (!acceso) return false;
    return canAccessSidebarSlug(
      item.slug,
      new Set(acceso.slugs ?? []),
      acceso.superAdmin === true,
      new Set(acceso.inactiveSlugs ?? []),
    );
  });

  return (
    <nav
      // Fijo en la parte inferior, full-width, solo mobile.
      // z-40 para quedar arriba del contenido pero por debajo de modales (z-100+).
      className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm lg:hidden"
      aria-label="Navegación principal mobile"
    >
      {/* +1 por el botón "Más". Las columnas siguen a los ítems visibles:
          con `grid-cols-5` fijo, ocultar uno dejaba un hueco. */}
      <div
        className="mx-auto grid max-w-3xl"
        style={{ gridTemplateColumns: `repeat(${visibles.length + 1}, minmax(0, 1fr))` }}
      >
        {visibles.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors active:bg-slate-100 sm:min-h-[64px] sm:text-[11px] ${
                active ? "text-[#4FAEB2]" : "text-slate-500 hover:text-slate-800"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={`h-5 w-5 ${active ? "text-[#4FAEB2]" : "text-slate-500"}`} aria-hidden />
              <span className="leading-none">{item.label}</span>
            </Link>
          );
        })}
        {/* Botón "Más" — abre el sidebar drawer con todos los módulos */}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-slate-500 transition-colors hover:text-slate-800 active:bg-slate-100 sm:min-h-[64px] sm:text-[11px]"
          aria-label="Abrir menú completo"
        >
          <Menu className="h-5 w-5 text-slate-500" aria-hidden />
          <span className="leading-none">Más</span>
        </button>
      </div>
    </nav>
  );
}
