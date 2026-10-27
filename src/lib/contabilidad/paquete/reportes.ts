/**
 * Qué informes entran en el paquete mensual, y de dónde sale cada uno.
 *
 * ── POR QUÉ NO SE VUELVEN A ESCRIBIR LAS PLANILLAS ACÁ ────────────────────
 *   Cada informe ya tiene su export, con sus columnas, sus títulos y sus
 *   criterios de cálculo. Si el paquete armara las planillas por su cuenta
 *   habría dos definiciones del mismo informe, y a la primera corrección
 *   dirían cosas distintas: la que se baja desde la pantalla y la que viaja
 *   en el ZIP. Es la clase de diferencia que nadie nota hasta que el contador
 *   compara dos archivos y no cierran.
 *
 *   Entonces el paquete llama a los mismos handlers, en el mismo proceso, con
 *   los parámetros del mes. Lo que se baja de la pantalla y lo que sale en el
 *   ZIP es el mismo código: no se pueden desincronizar.
 *
 * ── LOS `import()` SON A PROPÓSITO ────────────────────────────────────────
 *   Los handlers se cargan recién cuando se los va a usar. Importarlos arriba
 *   ataría este módulo —y la pantalla que lo lista— al árbol de dependencias
 *   de los trece informes, con el riesgo de ciclos entre rutas que ya se
 *   importan entre ellas (el export del libro diario importa de su propia
 *   `route.ts`, por ejemplo).
 */
import type { NextRequest } from "next/server";
import { ultimoDiaMes } from "@/lib/fechas/asuncion-bounds";

type Handler = (request: NextRequest) => Promise<Response>;

export interface ReporteDelPaquete {
  /** Identificador estable: viaja en la URL y en las tildes de la pantalla. */
  id: string;
  /** Nombre del informe, como lo llama el usuario. */
  nombre: string;
  /** Una línea para la pantalla: qué contesta este informe. */
  descripcion: string;
  /** Ruta del export que lo genera, solo para registrarlo en los errores. */
  ruta: string;
  /** Número de orden dentro del ZIP: los archivos se leen en este orden. */
  orden: number;
  /** Parámetros que recibe su export, armados desde el mes del paquete. */
  params: (mes: string) => Record<string, string>;
  /** Nombre del archivo dentro del ZIP, sin extensión. */
  archivo: string;
  cargar: () => Promise<Handler>;
}

/** El mes completo, en los dos formatos que piden los distintos exports. */
function rangoDelMes(mes: string): { desde: string; hasta: string } {
  return { desde: `${mes}-01`, hasta: ultimoDiaMes(mes) };
}

export const REPORTES_DEL_PAQUETE: ReporteDelPaquete[] = [
  {
    id: "libro-ventas",
    nombre: "Libro de Ventas (IVA Ventas)",
    descripcion: "Todas las facturas emitidas con su IVA, para la declaración.",
    ruta: "/api/reportes/libro-ventas/export",
    orden: 1,
    archivo: "libro-ventas",
    params: (mes) => rangoDelMes(mes),
    cargar: async () => (await import("@/app/api/reportes/libro-ventas/export/route")).GET as Handler,
  },
  {
    id: "libro-compras",
    nombre: "Libro de Compras (IVA Compras)",
    descripcion: "Facturas de compra y gastos con su IVA, para el crédito fiscal.",
    ruta: "/api/reportes/libro-compras/export",
    orden: 2,
    archivo: "libro-compras",
    params: (mes) => rangoDelMes(mes),
    cargar: async () => (await import("@/app/api/reportes/libro-compras/export/route")).GET as Handler,
  },
  {
    id: "libro-diario",
    nombre: "Libro Diario",
    descripcion: "Los asientos del mes, en orden de fecha.",
    ruta: "/api/reportes/libro-diario/export",
    orden: 3,
    archivo: "libro-diario",
    params: (mes) => rangoDelMes(mes),
    cargar: async () => (await import("@/app/api/reportes/libro-diario/export/route")).GET as Handler,
  },
  {
    id: "libro-mayor",
    nombre: "Libro Mayor",
    descripcion: "Movimiento y saldo de cada cuenta del plan.",
    ruta: "/api/reportes/libro-mayor/export",
    orden: 4,
    archivo: "libro-mayor",
    params: (mes) => rangoDelMes(mes),
    cargar: async () => (await import("@/app/api/reportes/libro-mayor/export/route")).GET as Handler,
  },
  {
    id: "ventas",
    nombre: "Ventas del mes",
    descripcion: "Detalle de ventas e ítems vendidos, con resumen por producto.",
    ruta: "/api/reportes/ventas/export",
    orden: 5,
    archivo: "ventas",
    params: (mes) => ({ mes }),
    cargar: async () => (await import("@/app/api/reportes/ventas/export/route")).GET as Handler,
  },
  {
    id: "compras",
    nombre: "Compras del mes",
    descripcion: "Detalle de compras e ítems, con resumen por proveedor.",
    ruta: "/api/reportes/compras/export",
    orden: 6,
    archivo: "compras",
    params: (mes) => ({ mes }),
    cargar: async () => (await import("@/app/api/reportes/compras/export/route")).GET as Handler,
  },
  {
    id: "cobranzas",
    nombre: "Cobranzas",
    descripcion: "Lo cobrado en el mes, por cliente y por medio de pago.",
    ruta: "/api/reportes/cobranzas/export",
    orden: 7,
    archivo: "cobranzas",
    params: (mes) => rangoDelMes(mes),
    cargar: async () => (await import("@/app/api/reportes/cobranzas/export/route")).GET as Handler,
  },
  {
    id: "conciliacion",
    nombre: "Conciliación de cobros",
    descripcion: "Lo cobrado por medio y por entidad, para cruzar con el banco.",
    ruta: "/api/reportes/conciliacion/export",
    orden: 8,
    archivo: "conciliacion-bancaria",
    params: (mes) => ({ mes }),
    cargar: async () => (await import("@/app/api/reportes/conciliacion/export/route")).GET as Handler,
  },
  {
    id: "estado-cuenta",
    nombre: "Estado de cuenta",
    descripcion: "Ingresos, compras, gastos y resultado del mes.",
    ruta: "/api/reportes/estado-cuenta/export",
    orden: 9,
    archivo: "estado-de-cuenta",
    params: (mes) => ({ mes }),
    cargar: async () => (await import("@/app/api/reportes/estado-cuenta/export/route")).GET as Handler,
  },
  {
    id: "utilidad",
    nombre: "Utilidad por período",
    descripcion: "Ganancia y margen por rubro y por producto.",
    ruta: "/api/reportes/rentabilidad/export",
    orden: 10,
    archivo: "utilidad-por-rubro",
    // `tipo=mes` y no un rango: este informe resuelve el período con
    // `resolverPeriodo`, que lee la clave `tipo`. Con cualquier otra cosa cae
    // en su valor por omisión —el mes en curso— y el paquete de setiembre
    // traería la utilidad de octubre sin avisar.
    params: (mes) => ({ tipo: "mes", mes }),
    cargar: async () => (await import("@/app/api/reportes/rentabilidad/export/route")).GET as Handler,
  },
  {
    id: "proveedores",
    nombre: "Proveedores",
    descripcion: "Compras del mes por proveedor y última compra de cada uno.",
    ruta: "/api/reportes/proveedores/export",
    orden: 11,
    archivo: "proveedores",
    params: (mes) => ({ mes }),
    cargar: async () => (await import("@/app/api/reportes/proveedores/export/route")).GET as Handler,
  },
  {
    id: "stock-con-precios",
    nombre: "Stock con precios",
    descripcion: "Existencias con costo, precios de lista y valorizado. Es una foto de HOY, no del mes cerrado.",
    ruta: "/api/inventario/stock-con-precios/export",
    orden: 12,
    archivo: "stock-con-precios",
    params: () => ({}),
    cargar: async () => (await import("@/app/api/inventario/stock-con-precios/export/route")).GET as Handler,
  },
];

export function reportePorId(id: string): ReporteDelPaquete | undefined {
  return REPORTES_DEL_PAQUETE.find((r) => r.id === id);
}

/** Lo que la pantalla necesita saber, sin arrastrar los handlers. */
export function catalogoParaPantalla() {
  return REPORTES_DEL_PAQUETE.map(({ id, nombre, descripcion, orden }) => ({ id, nombre, descripcion, orden }));
}
