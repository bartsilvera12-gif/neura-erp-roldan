/**
 * Matriz de acceso por rol ERP a nivel de UI.
 *
 * Roles del catalogo zentra_erp.usuarios.rol (normalizados en
 * lib/usuarios/erp-rol-normalize.ts):
 *   - administrador / admin: acceso total.
 *   - supervisor: SOLO los cierres de caja (/reportes/cajas), donde ve las
 *     ventas del turno y puede anular facturas. Es un puesto de control, no
 *     un administrador con menos botones. Ver
 *     SLUGS_PERMITIDOS_ROL_SUPERVISOR.
 *   - usuario: acceso operativo minimo — Clientes, Presupuestos, Caja
 *     (ventas). Landing directa en /ventas cuando entra a "/".
 *
 * Notas:
 * - Este archivo solo define reglas de UI (sidebar + tabs). Los guards
 *   reales por endpoint viven en cada route.ts (multi-tenant + rol) o en
 *   el nuevo helper isAdminOnly usado por /api/dashboard/financial-audit.
 * - super_admin (rol de plataforma) mapea a admin para efectos de esta
 *   matriz.
 */
import { normalizeErpRolSlug } from "@/lib/usuarios/erp-rol-normalize";

/** Slugs que el rol `usuario` puede ver/usar. Todo lo demas se oculta. */
export const SLUGS_PERMITIDOS_ROL_USUARIO_LIMITADO: ReadonlySet<string> = new Set([
  // Caja / punto de venta.
  "ventas",
  // Cotizaciones comerciales.
  "presupuestos",
  // Alta y consulta de clientes.
  "clientes",
  // Recetario: TODOS los roles pueden FABRICAR desde una receta. La edición del
  // recetario (crear/editar/eliminar) queda restringida a admin/supervisor —
  // ver `puedeEditarRecetas` y los guards de /api/recetas/*.
  "recetas",
]);

/**
 * Slugs VEDADOS al rol `usuario`, aunque tenga el módulo habilitado.
 *
 * En Roldán el acceso del `usuario` se rige por los módulos que le asigna el
 * administrador, con una trampa: un usuario SIN módulos asignados hereda
 * todos los de la empresa. O sea que lo que acá no esté listado se le muestra
 * por omisión, y basta con que nadie le configure los módulos.
 *
 *   - dashboard: es el tablero de la empresa. A un `usuario` el guard ya lo
 *     saca al entrar, así que mostrarlo en el menú solo lleva a un rebote.
 *   - ordenes_venta: pedido del cliente —"las cajeras no pueden ver el orden
 *     de venta"—. La orden de venta es el compromiso comercial previo a la
 *     factura: quién le prometió qué, a qué precio y con qué plazo. La cajera
 *     cobra lo que se le presenta; no es su pantalla.
 *
 * Es un techo, no un piso: lo que esté acá no se ve ni habilitando el módulo,
 * y se arregla cambiándole el rol a la persona, que es la conversación que
 * corresponde tener.
 */
export const SLUGS_VEDADOS_ROL_USUARIO: ReadonlySet<string> = new Set([
  "dashboard",
  "ordenes_venta",
]);

/** Ruta a la que se redirige un `usuario` que entra a "/". */
export const LANDING_ROL_USUARIO_LIMITADO = "/ventas";

/**
 * Slugs que el rol `supervisor` puede ver/usar.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ───────────────────────────────────────────────
 *   "Un supervisor puede entrar solo a reportes de cierres de caja, donde
 *   pueda ver y anular las facturas."
 *
 *   O sea: el supervisor NO es un administrador con menos botones, es un
 *   puesto de control. Entra al arqueo, mira las ventas del turno y anula la
 *   que está mal. Nada más: ni rentabilidad, ni márgenes, ni configuración,
 *   ni caja para cobrar.
 *
 * ── POR QUÉ ES UNA LISTA EN EL CÓDIGO Y NO MÓDULOS POR USUARIO ────────────
 *   Los módulos por usuario (`usuario_modulos`) ya existen y sirven, pero
 *   tienen un default peligroso para esto: un usuario SIN módulos asignados
 *   hereda todos los de la empresa. Con solo módulos, un supervisor recién
 *   creado y sin configurar vería el ERP completo — exactamente lo contrario
 *   de lo pedido. Con esta lista el tope no depende de que alguien se acuerde
 *   de configurarlo.
 *
 *   El permiso sigue siendo la intersección: el supervisor ve los cierres de
 *   caja si además los tiene habilitados. Esta lista es el techo, no el piso.
 *
 *   Si mañana el supervisor tiene que ver algo más (Inventario, por ejemplo),
 *   se agrega acá y queda en un solo lugar.
 */
export const SLUGS_PERMITIDOS_ROL_SUPERVISOR: ReadonlySet<string> = new Set([
  "cierres-caja",
]);

/** Ruta a la que cae un supervisor que entra a "/". */
export const LANDING_ROL_SUPERVISOR = "/reportes/cajas";

export function esAdminErp(rol: string | null | undefined): boolean {
  const r = normalizeErpRolSlug(rol);
  return r === "administrador" || r === "admin" || r === "super_admin";
}

export function esSupervisorErp(rol: string | null | undefined): boolean {
  return normalizeErpRolSlug(rol) === "supervisor";
}

/**
 * "usuario" literal del catalogo. NO incluye vendedor/comercial/asesor
 * (esos son otro dominio y no fueron parte del pedido de restricciones).
 */
export function esUsuarioLimitadoErp(rol: string | null | undefined): boolean {
  return normalizeErpRolSlug(rol) === "usuario";
}

/** El tab "Financiero" del dashboard solo lo ve el admin. */
export function puedeVerTabFinanciero(rol: string | null | undefined): boolean {
  return esAdminErp(rol);
}

/**
 * Editar el recetario (crear / editar / eliminar recetas e insumos): solo
 * admin y supervisor. FABRICAR desde una receta lo puede hacer cualquier rol
 * (es una operación de planta, no de configuración) — no usar este helper para
 * gatear `POST /api/producciones`.
 */
export function puedeEditarRecetas(rol: string | null | undefined): boolean {
  return esAdminErp(rol) || esSupervisorErp(rol);
}

/**
 * Item del sidebar visible para el rol. Devuelve true para admin.
 * Para `supervisor`, solo los cierres de caja (ver
 * SLUGS_PERMITIDOS_ROL_SUPERVISOR).
 * Para `usuario`, solo permite slugs del set permitido.
 */
export function puedeVerSidebarSlugPorRol(
  slug: string,
  rol: string | null | undefined
): boolean {
  if (esSupervisorErp(rol)) return SLUGS_PERMITIDOS_ROL_SUPERVISOR.has(slug);
  // En Darocha el control de acceso es 100% por `usuario_modulos` (los módulos
  // que un admin asigna a cada usuario). Única excepción: el Dashboard es solo
  // para admin/supervisor — a un rol `usuario` lo redirige/saca al entrar, así
  // que se oculta del sidebar aunque tenga el slug habilitado. El resto se rige
  // por los módulos efectivos del usuario.
  if (esUsuarioLimitadoErp(rol) && SLUGS_VEDADOS_ROL_USUARIO.has(slug)) return false;
  return true;
}

/**
 * Recorta el set de módulos efectivos al techo del rol.
 *
 * Se usa en el guard de rutas (AuthGuard) para que UNA sola regla decida tres
 * cosas que antes se decidían por separado y se contradecían entre sí: qué
 * ítems muestra el menú, a qué rutas se puede entrar, y a dónde cae el
 * usuario cuando entra a "/". Si el recorte se hiciera solo en el menú, un
 * supervisor seguiría entrando a /inventario escribiendo la dirección.
 *
 * Caso del supervisor: los cierres de caja son un sub-permiso de Reportes
 * (ver `isModuleSlugGranted`), así que quien tiene `reportes` los tiene. Se
 * traduce acá para que el supervisor no arrastre el resto de la reportería.
 *
 * Si no se conoce el rol (la lectura falló), no se recorta nada: dejar a
 * alguien afuera por un error de red es peor que mostrarle un ítem de más,
 * sobre todo porque el permiso de verdad lo aplica cada endpoint.
 */
export function slugsEfectivosPorRol(
  slugs: ReadonlySet<string>,
  rol: string | null | undefined
): Set<string> {
  // El `usuario` pierde lo vedado por rol, aunque tenga el módulo: si el
  // recorte se hiciera solo en el menú, entraría igual escribiendo la
  // dirección.
  if (esUsuarioLimitadoErp(rol)) {
    const recortado = new Set<string>();
    for (const s of slugs) if (!SLUGS_VEDADOS_ROL_USUARIO.has(s)) recortado.add(s);
    return recortado;
  }
  if (!esSupervisorErp(rol)) return new Set(slugs);
  const recortado = new Set<string>();
  if (slugs.has("cierres-caja") || slugs.has("reportes")) recortado.add("cierres-caja");
  for (const s of slugs) {
    if (s !== "cierres-caja" && SLUGS_PERMITIDOS_ROL_SUPERVISOR.has(s)) recortado.add(s);
  }
  return recortado;
}
