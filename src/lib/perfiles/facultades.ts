/**
 * Las facultades: qué puede HACER un usuario, no qué puede VER.
 *
 * ── POR QUÉ ESTO NO SON MÓDULOS ───────────────────────────────────────────
 *   Los módulos ya existen y contestan "¿qué pantallas ve?". No contestan
 *   "¿puede anular una factura?", y esa es la pregunta cara: ver un listado
 *   no mueve plata, anular sí. Hasta acá cada una de esas respuestas estaba
 *   cableada al nivel del usuario —administrador, supervisor, usuario— y la
 *   única forma de darle una facultad a alguien era subirle el nivel entero.
 *
 * ── LA REGLA QUE SE SIGUIÓ PARA ARMAR ESTA LISTA ──────────────────────────
 *   Cada facultad de acá tiene un guard de verdad en el servidor. No hay
 *   casillas decorativas: una casilla que no hace nada es peor que no
 *   tenerla, porque alguien la va a destildar creyendo que cerró una puerta.
 *
 *   Si mañana hace falta una facultad nueva, primero se escribe el guard y
 *   después se agrega acá.
 */

export type Facultad =
  | "anular_venta"
  | "cambiar_medio_pago"
  | "editar_venta"
  | "autorizar_devolucion"
  | "fijar_credito"
  | "ver_costos"
  | "cotizar_sin_stock"
  | "ver_ordenes_venta"
  | "reabrir_caja"
  | "autorizar_descuentos"
  | "ver_todos_presupuestos"
  | "modificar_inventario"
  | "crear_transferencias"
  | "solo_imprimir_inventario";

export interface FacultadInfo {
  clave: Facultad;
  label: string;
  /** Qué habilita, en una frase, y por qué importa. Se muestra al configurar. */
  descripcion: string;
  grupo: "Caja y ventas" | "Clientes" | "Información" | "Comercial" | "Inventario";
}

export const FACULTADES: readonly FacultadInfo[] = [
  {
    clave: "anular_venta",
    label: "Anular ventas",
    descripcion:
      "Deshacer una venta ya cobrada. El administrador puede con cualquiera; " +
      "los demás, solo mientras el turno de caja siga abierto.",
    grupo: "Caja y ventas",
  },
  {
    clave: "reabrir_caja",
    label: "Reabrir turnos de caja",
    descripcion:
      "Volver a abrir un turno ya cerrado para corregirlo. El administrador " +
      "puede con cualquiera; los demás, solo con los turnos del día. Un cierre " +
      "de la semana pasada ya se rindió y se firmó: corregirlo no es corregir, " +
      "es cambiar un número que alguien dio por bueno. Siempre pide motivo y " +
      "queda asentado.",
    grupo: "Caja y ventas",
  },
  {
    clave: "cambiar_medio_pago",
    label: "Cambiar el medio de pago",
    descripcion:
      "Pasar una venta de efectivo a transferencia o al revés. Mueve plata de " +
      "una columna del arqueo a otra sin tocar el total, así que una caja que " +
      "no cuadra puede “arreglarse” cambiando el medio en vez de buscar el error.",
    grupo: "Caja y ventas",
  },
  {
    clave: "editar_venta",
    label: "Editar ventas registradas",
    descripcion: "Cambiar cantidades o precios de una venta ya hecha. Queda registrado qué cambió.",
    grupo: "Caja y ventas",
  },
  {
    clave: "autorizar_devolucion",
    label: "Autorizar devoluciones",
    descripcion:
      "Confirmar una devolución: devuelve mercadería al stock y, si es " +
      "reembolso, saca plata del cajón. Sin esta facultad igual se puede armar " +
      "la devolución, pero no confirmarla.",
    grupo: "Caja y ventas",
  },
  {
    clave: "fijar_credito",
    label: "Fijar el crédito de un cliente",
    descripcion:
      "Cargar límite de crédito, días y condición de pago. Es la línea de " +
      "crédito de la empresa: define a quién se le fía y por cuánto.",
    grupo: "Clientes",
  },
  {
    clave: "ver_costos",
    label: "Ver costos, márgenes y dólares",
    descripcion:
      "Costo de cada artículo, utilidad bruta, margen, remarcación, el estudio " +
      "de precios y los precios en dólares. Para el mostrador el precio es el " +
      "guaraní que está en pantalla.",
    grupo: "Información",
  },
  {
    clave: "cotizar_sin_stock",
    label: "Cotizar sin stock",
    descripcion:
      "Hacer un presupuesto por más mercadería de la que hay. Es asumir una " +
      "compra y una fecha de entrega. (Facturar sin stock no lo puede nadie.)",
    grupo: "Comercial",
  },
  {
    clave: "ver_ordenes_venta",
    label: "Ver órdenes de venta",
    descripcion:
      "La lista de ventas de la Caja («Órdenes de venta») y la pantalla de " +
      "órdenes de venta. Lo que puede hacer con cada venta (anular, cambiar el " +
      "medio de pago, editar) depende de las casillas de Caja y ventas.",
    grupo: "Comercial",
  },
  {
    clave: "autorizar_descuentos",
    label: "Autorizar descuentos",
    descripcion:
      "Contestar los pedidos de descuento por encima del tope (caja y " +
      "presupuestos). Le llegan a la campana. Nadie autoriza su propio pedido.",
    grupo: "Comercial",
  },
  {
    clave: "ver_todos_presupuestos",
    label: "Ver todos los presupuestos",
    descripcion:
      "Ver los presupuestos de todos los vendedores, no solo los propios, y " +
      "filtrarlos por persona.",
    grupo: "Comercial",
  },
  {
    clave: "modificar_inventario",
    label: "Modificar inventario",
    descripcion:
      "Cargar movimientos y ajustes de stock, transferir entre depósitos, " +
      "cambiar rubros y ubicaciones, importar desde Excel, y tocar lotes, " +
      "imágenes y precios de un producto. Sin esta casilla, el módulo " +
      "Inventario queda para consultar e imprimir. (Crear o editar la ficha " +
      "de un producto sigue siendo del administrador.)",
    grupo: "Inventario",
  },
  {
    clave: "crear_transferencias",
    label: "Crear transferencias entre sucursales",
    descripcion:
      "Pedir o mandar mercadería a otra sucursal. Sin esta casilla se ven las " +
      "transferencias y se pueden despachar o recibir, pero no crearlas.",
    grupo: "Inventario",
  },
  {
    clave: "solo_imprimir_inventario",
    label: "Inventario: solo imprimir",
    descripcion:
      "Con el módulo Inventario, el menú muestra únicamente Productos (con la " +
      "planilla de conteo ciego para imprimir) y Bajo mínimo. Sin movimientos, " +
      "ajustes, valoración, reposición ni nada para modificar. Si el perfil " +
      "también tiene «Modificar inventario», esa casilla manda.",
    grupo: "Inventario",
  },
] as const;

const CLAVES = new Set<string>(FACULTADES.map((f) => f.clave));

/** ¿Es una facultad que el sistema conoce? Lo guardado puede ser más viejo que el código. */
export function esFacultad(v: string | null | undefined): v is Facultad {
  return typeof v === "string" && CLAVES.has(v);
}

/** Limpia una lista guardada: descarta lo que el código ya no reconoce y no repite. */
export function soloFacultadesConocidas(valores: readonly unknown[] | null | undefined): Facultad[] {
  const out: Facultad[] = [];
  for (const v of valores ?? []) {
    const s = typeof v === "string" ? v.trim() : "";
    if (esFacultad(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Las facultades que corresponden a un nivel, para el que todavía no tiene
 * perfil asignado.
 *
 * Es exactamente lo que el sistema hacía antes de que existieran los perfiles.
 * Sin esto, correr el script y no asignar perfiles dejaría a todo el mundo sin
 * poder hacer nada hasta que alguien configure: una migración que apaga el
 * negocio hasta que se la configure es una migración que no se corre.
 */
export function facultadesDeNivel(nivel: "administrador" | "supervisor" | "usuario"): Facultad[] {
  if (nivel === "administrador") return FACULTADES.map((f) => f.clave);
  // «Modificar inventario» NO va por nivel (pedido del cliente): quien no
  // tiene la casilla en su perfil ve e imprime, no modifica. El supervisor
  // sigue pudiendo crear transferencias como antes de la casilla.
  if (nivel === "supervisor") return ["anular_venta", "autorizar_devolucion", "reabrir_caja", "crear_transferencias"];
  return [];
}
