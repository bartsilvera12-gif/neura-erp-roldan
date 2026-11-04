import type { Facultad } from "@/lib/perfiles/facultades";

/**
 * Los siete perfiles con los que arranca el sistema.
 *
 * ── SON UN PUNTO DE PARTIDA, NO UNA LEY ───────────────────────────────────
 *   Se cargan una sola vez, al correr el script, y desde ahí se editan desde
 *   Configuración → Perfiles. El código no los vuelve a pisar: si alguien le
 *   saca una facultad a "Cajero", se queda sacada.
 *
 *   Están acá y no sueltos en el SQL para que el script y la pantalla digan
 *   lo mismo, y para poder leerlos de un vistazo cuando haya que discutir
 *   quién puede qué.
 *
 * ── EL CRITERIO ───────────────────────────────────────────────────────────
 *   Cada facultad se concede cuando el puesto la necesita para trabajar, no
 *   cuando "no molesta" tenerla. El mostrador cobra; el que decide cuánto se
 *   fía y a qué costo se vende es otro.
 */
export interface PerfilSemilla {
  nombre: string;
  descripcion: string;
  /** El nivel con el que se crea el usuario que tenga este perfil. */
  nivel: "administrador" | "supervisor" | "usuario";
  facultades: Facultad[];
}

export const PERFILES_SEMILLA: readonly PerfilSemilla[] = [
  {
    nombre: "Administrador",
    descripcion: "Sin límites. Configura el sistema y decide precios, crédito y anulaciones.",
    nivel: "administrador",
    facultades: [
      "anular_venta", "cambiar_medio_pago", "editar_venta", "autorizar_devolucion",
      "fijar_credito", "ver_costos", "cotizar_sin_stock", "ver_ordenes_venta",
      "reabrir_caja",
    ],
  },
  {
    nombre: "Supervisor",
    descripcion:
      "Puesto de control. Entra a los cierres de caja, reabre los turnos del " +
      "día para corregirlos, anula lo que está mal y autoriza devoluciones. " +
      "No configura, no ve costos y no toca los cierres de otros días.",
    nivel: "supervisor",
    facultades: ["anular_venta", "autorizar_devolucion", "reabrir_caja"],
  },
  {
    nombre: "Cajero",
    descripcion:
      "Cobra lo que se le presenta. No ve costos ni márgenes, no fija crédito y " +
      "no autoriza devoluciones: las arma y las confirma un supervisor.",
    nivel: "usuario",
    facultades: [],
  },
  {
    nombre: "Vendedor mostrador",
    descripcion:
      "Atiende y cotiza en el salón. Cotiza con lo que hay: prometer mercadería " +
      "que no está es asumir una compra, y eso lo decide el que compra.",
    nivel: "usuario",
    facultades: [],
  },
  {
    nombre: "Vendedor externo",
    descripcion:
      "Visita obras y clientes. Puede cotizar sin stock porque trabaja con " +
      "entregas a plazo, y ve las órdenes de venta que negocia.",
    nivel: "usuario",
    facultades: ["cotizar_sin_stock", "ver_ordenes_venta"],
  },
  {
    nombre: "Call center",
    descripcion:
      "Cotiza por teléfono. Ve las órdenes de venta para contestar por el estado " +
      "de un pedido, y cotiza sin stock porque lo que vende se entrega después.",
    nivel: "usuario",
    facultades: ["cotizar_sin_stock", "ver_ordenes_venta"],
  },
  {
    nombre: "Depósito",
    descripcion:
      "Mueve mercadería: existencias, transferencias entre depósitos y " +
      "preparación de pedidos. No cobra ni cotiza.",
    nivel: "usuario",
    facultades: [],
  },
] as const;
