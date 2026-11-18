/**
 * Qué reportes ve cada usuario (pedido del cliente, script 90).
 *
 * La administración ve todos. El resto ve solo los que el administrador le
 * tildó en su ficha; sin ninguno tildado no ve ninguno (decisión del cliente).
 *
 * Los Cierres de caja no están acá: son su propio permiso (`cierres-caja`).
 * La reportería contable (libros, punto de equilibrio, paquete mensual) es
 * del módulo Contabilidad, y el Reporte de cobranzas del módulo Cobranzas.
 *
 * La clave es el tramo de la ruta: /reportes/<clave>.
 */

export interface ReporteInfo {
  clave: string;
  nombre: string;
}

export const REPORTES: readonly ReporteInfo[] = [
  { clave: "historial-ventas", nombre: "Ventas" },
  { clave: "ventas", nombre: "Historial de ventas (anual)" },
  { clave: "vendedores", nombre: "Ventas por vendedor" },
  { clave: "ganancias", nombre: "Ganancias" },
  { clave: "rentabilidad", nombre: "Rentabilidad" },
  { clave: "compras", nombre: "Compras" },
  { clave: "proveedores", nombre: "Proveedores" },
  { clave: "flujo-caja", nombre: "Flujo de caja" },
  { clave: "estado-cuenta", nombre: "Estado de cuenta" },
  { clave: "tesoreria", nombre: "Tesorería por cuenta" },
  { clave: "conciliacion", nombre: "Conciliación bancaria" },
  { clave: "ingresos-egresos", nombre: "Ingresos y egresos" },
  { clave: "gastos-no-deducibles", nombre: "Gastos sin factura" },
  { clave: "modificaciones", nombre: "Modificaciones administrativas" },
] as const;

const CLAVES = new Set(REPORTES.map((r) => r.clave));

export function esReporteConPermiso(clave: string | null | undefined): clave is string {
  return typeof clave === "string" && CLAVES.has(clave);
}

/** Limpia una lista guardada: solo claves conocidas, sin repetir. */
export function soloReportesConocidos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x ?? "").trim()).filter((x) => CLAVES.has(x)))];
}

/** La clave del reporte de una ruta de pantalla (/reportes/<clave>/…), o null. */
export function claveDeRutaReporte(pathname: string | null | undefined): string | null {
  const m = /^\/reportes\/([^/?#]+)/.exec(String(pathname ?? ""));
  return m && CLAVES.has(m[1]) ? m[1] : null;
}

/**
 * ¿Lo puede ver?
 *
 * `permitidos === "todos"` es la administración, o una base sin el script 90
 * (sin la columna no hay dónde configurarlo, y dejar a todos afuera de los
 * reportes sin forma de arreglarlo sería peor).
 */
export function puedeVerReporte(clave: string, permitidos: readonly string[] | "todos" | null | undefined): boolean {
  if (permitidos === "todos") return true;
  if (!esReporteConPermiso(clave)) return true;
  return Array.isArray(permitidos) && permitidos.includes(clave);
}
