/**
 * Asocia pathname del App Router a slug de `modulos.slug`.
 * `null` = no aplica gate de módulo (acceso con sesión).
 */

/** Orden del menú lateral (misma idea que Sidebar): primera entrada accesible = “home” sin dashboard. */
const SIDEBAR_SLUG_HREF_ORDER: { slug: string; href: string }[] = [
  { slug: "dashboard", href: "/" },
  { slug: "conversaciones", href: "/dashboard/conversaciones" },
  { slug: "historial-omnicanal", href: "/dashboard/historial-omnicanal" },
  { slug: "conversaciones-finalizadas", href: "/dashboard/conversaciones-finalizadas" },
  { slug: "monitoreo", href: "/dashboard/monitoreo" },
  { slug: "ventas", href: "/ventas" },
  { slug: "presupuestos", href: "/presupuestos" },
  { slug: "recetas", href: "/dashboard/recetas" },
  { slug: "reposicion", href: "/inventario/reposicion" },
  { slug: "inventario", href: "/inventario" },
  { slug: "clientes", href: "/clientes" },
  { slug: "compras", href: "/compras" },
  { slug: "proveedores", href: "/proveedores" },
  { slug: "sucursales", href: "/configuracion/sucursales" },
  { slug: "gastos", href: "/gastos" },
  { slug: "reportes", href: "/reportes" },
  { slug: "productos-a-vencer", href: "/reportes/productos-a-vencer" },
  { slug: "pagos", href: "/pagos" },
  { slug: "comisiones", href: "/comisiones" },
  { slug: "notas_credito", href: "/notas-credito" },
  { slug: "usuarios", href: "/usuarios" },
  { slug: "configuracion", href: "/configuracion" },
  { slug: "planes", href: "/planes" },
  { slug: "gestion-clientes", href: "/gestion-clientes" },
  { slug: "crm", href: "/crm" },
  { slug: "marketing", href: "/marketing" },
  { slug: "marketing_ops", href: "/dashboard/marketing-ops" },
  { slug: "sorteos", href: "/sorteos" },
  { slug: "campanas", href: "/dashboard/campanas" },
  { slug: "proyectos", href: "/dashboard/proyectos" },
  { slug: "rrhh", href: "/rrhh/empleados" },
  { slug: "contabilidad", href: "/reportes/libro-diario" },
  { slug: "consignataria", href: "/consignaciones" },
];

const OMNICANAL_DASHBOARD_SLUGS = [
  "conversaciones",
  "historial-omnicanal",
  "conversaciones-finalizadas",
  "monitoreo",
] as const;

function isOmnicanalDashboardSlug(slug: string): boolean {
  return (OMNICANAL_DASHBOARD_SLUGS as readonly string[]).includes(slug);
}

/**
 * Slugs otorgados explícitamente o por alias (p. ej. `clientes` incluye gestión de cartera).
 *
 * - `inactiveSlugs` opcional: slugs presentes en `empresa_modulos` con `activo=false`. Cuando un slug
 *   está en este set, ningún alias lo re-otorga (la desactivación explícita gana sobre el paquete legacy).
 * - `strict` opcional: si es `true`, se aplica allowlist estricta — solo `grantedSlugs` otorga acceso,
 *   los alias legacy (omnicanal → sub-slugs, clientes → gestion-clientes, ventas → notas_credito) NO
 *   otorgan nada. Pensado para instancias dedicadas monocliente donde `empresa_modulos` es la única
 *   fuente de verdad. Default `false` para compatibilidad multi-tenant.
 */
export function isModuleSlugGranted(
  routeSlug: string,
  grantedSlugs: Set<string>,
  inactiveSlugs?: Set<string>,
  opts?: { strict?: boolean }
): boolean {
  if (grantedSlugs.has(routeSlug)) return true;
  if (inactiveSlugs?.has(routeSlug)) return false;
  if (opts?.strict) return false;
  // Paquete legacy: un solo permiso para todo el stack dashboard omnicanal.
  if (grantedSlugs.has("omnicanal") && isOmnicanalDashboardSlug(routeSlug)) return true;
  // Compatibilidad: quien solo tiene "conversaciones" sigue entrando a historial / finalizadas / monitoreo.
  if (
    grantedSlugs.has("conversaciones") &&
    routeSlug !== "conversaciones" &&
    isOmnicanalDashboardSlug(routeSlug)
  ) {
    return true;
  }
  if (routeSlug === "gestion-clientes" && grantedSlugs.has("clientes")) return true;
  if (routeSlug === "notas_credito" && grantedSlugs.has("ventas")) return true;
  return false;
}

/**
 * Acceso a un ítem del menú (super admin ve todo; resto según empresa_modulos ∩ usuario_modulos).
 *
 * - `inactiveSlugs` opcional: ver `isModuleSlugGranted`.
 * - `strict` opcional: ver `isModuleSlugGranted`. Permite ocultar items que no estén explícitamente
 *   activos en `empresa_modulos`, ignorando aliases legacy.
 */
export function canAccessSidebarSlug(
  slug: string,
  grantedSlugs: Set<string>,
  esSuperAdmin: boolean,
  inactiveSlugs?: Set<string>,
  opts?: { strict?: boolean }
): boolean {
  if (esSuperAdmin) return true;
  if (slug === "dashboard") return grantedSlugs.has("dashboard");
  return isModuleSlugGranted(slug, grantedSlugs, inactiveSlugs, opts);
}

/** Primera ruta de app a la que puede entrar el usuario (p. ej. tras login en `/` sin módulo dashboard). */
export function firstAccessibleHref(
  grantedSlugs: Set<string>,
  opts?: { superAdmin?: boolean; inactiveSlugs?: Set<string>; strict?: boolean }
): string {
  if (opts?.superAdmin) return "/";
  for (const { slug, href } of SIDEBAR_SLUG_HREF_ORDER) {
    if (
      canAccessSidebarSlug(slug, grantedSlugs, false, opts?.inactiveSlugs, { strict: opts?.strict })
    ) {
      return href;
    }
  }
  return "/login";
}

export function pathRequiresModuleSlug(pathname: string): string | null {
  const p = pathname.split("?")[0] ?? pathname;
  if (!p) return null;
  if (p === "/") return "dashboard";
  if (p.startsWith("/login")) return null;
  if (p.startsWith("/admin")) return null;
  if (p.startsWith("/api")) return null;
  if (p.startsWith("/usuarios")) return "usuarios";

  if (p.startsWith("/dashboard")) {
    if (p.startsWith("/dashboard/marketing-ops")) return "marketing_ops";
    if (p.startsWith("/dashboard/proyectos")) return "proyectos";
    if (p.startsWith("/dashboard/conversaciones-finalizadas")) return "conversaciones-finalizadas";
    if (p.startsWith("/dashboard/historial-omnicanal")) return "historial-omnicanal";
    if (p.startsWith("/dashboard/monitoreo")) return "monitoreo";
    if (p.startsWith("/dashboard/sorteos")) return "sorteos";
    if (p.startsWith("/dashboard/campanas")) return "campanas";
    if (p.startsWith("/dashboard/recetas")) return "recetas";
    if (p.startsWith("/dashboard/conversaciones")) return "conversaciones";
    return "conversaciones";
  }
  if (p.startsWith("/notas-credito")) return "notas_credito";
  if (p.startsWith("/presupuestos")) return "presupuestos";
  if (p.startsWith("/ventas")) return "ventas";
  // Más específico primero: Reposición es su propio módulo, no Inventario.
  if (p.startsWith("/inventario/reposicion")) return "reposicion";
  if (p.startsWith("/inventario")) return "inventario";
  if (p.startsWith("/clientes")) return "clientes";
  if (p.startsWith("/proveedores")) return "proveedores";
  if (p.startsWith("/compras")) return "compras";
  if (p.startsWith("/gastos")) return "gastos";
  // Más específico primero: el reporte de productos a vencer es su propio módulo.
  if (p.startsWith("/reportes/productos-a-vencer")) return "productos-a-vencer";
  // Libros contables: módulo Contabilidad, no Reportes operativos.
  if (
    p.startsWith("/reportes/libro-diario") ||
    p.startsWith("/reportes/libro-mayor") ||
    p.startsWith("/reportes/libro-ventas") ||
    p.startsWith("/reportes/libro-compras")
  ) {
    return "contabilidad";
  }
  if (p.startsWith("/reportes")) return "reportes";
  if (p.startsWith("/pagos")) return "pagos";
  if (p.startsWith("/comisiones")) return "comisiones";
  if (p.startsWith("/configuracion")) {
    // Las pantallas de configuración pertenecen al módulo que las usa: así un tenant
    // puede tener Sucursales o Contabilidad sin abrirle Configuración completa.
    if (p.startsWith("/configuracion/sucursales")) return "sucursales";
    if (p.startsWith("/configuracion/plan-de-cuentas")) return "contabilidad";
    if (p.startsWith("/configuracion/contable")) return "contabilidad";
    if (p.startsWith("/configuracion/rrhh")) return "rrhh";
    if (p.startsWith("/configuracion/crm")) return "crm";
    if (p.startsWith("/configuracion/canales")) return "conversaciones";
    if (p.startsWith("/configuracion/colas")) return "conversaciones";
    if (p.startsWith("/configuracion/conversaciones")) return "conversaciones";
    if (p.startsWith("/configuracion/omnicanal-")) return "conversaciones";
    if (p.startsWith("/configuracion/facturacion")) return "ventas";
    return "configuracion";
  }
  if (p.startsWith("/planes")) return "planes";
  if (p.startsWith("/gestion-clientes")) return "gestion-clientes";
  if (p.startsWith("/crm")) return "crm";
  if (p.startsWith("/marketing")) return "marketing";
  if (p.startsWith("/sorteos")) return "sorteos";
  if (p.startsWith("/consignaciones")) return "consignataria";
  return null;
}
