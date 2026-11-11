/**
 * El manual del sistema: una guía por tarea, de a un paso por vez.
 *
 * ── CÓMO ESTÁ PENSADO ──────────────────────────────────────────────────────
 *   No es documentación: es alguien sentado al lado explicando. Por eso cada
 *   paso es UNA frase con UNA acción, y la pantalla que se muestra es la del
 *   sistema de verdad, con el botón señalado.
 *
 *   Las capturas salieron del ERP en funcionamiento, con los datos de la
 *   empresa difuminados: se ve el menú, los botones y el lugar donde hay que
 *   tocar, pero no los nombres de los clientes ni los costos.
 *
 * ── LAS MARCAS ─────────────────────────────────────────────────────────────
 *   `marca` es el texto del botón o del campo tal como se lee en la captura.
 *   Su posición sale de `marcas.json`, medida sobre la pantalla real y
 *   guardada en porcentajes. Medida y no estimada: una marca corrida señala
 *   el botón de al lado, y entonces el manual enseña mal.
 *
 *   Un paso sin marca —o cuya marca no está medida— muestra la pantalla
 *   entera. Es mejor eso que una flecha apuntando a cualquier lado.
 */

/** t: la frase grande, una sola acción. d: la aclaración, en letra chica. */
export type Paso = { t: string; d?: string; marca?: string };

export type Bloque = {
  /** Nombre del archivo en /public/manual, sin extensión. */
  img?: string;
  alt?: string;
  pasos?: Paso[];
  /** Un párrafo suelto, cuando lo que hay que decir no es un paso. */
  texto?: string;
  consejo?: string;
  /** Lo que hay que saber ANTES de tocar, no después. */
  ojo?: string;
};

export type Guia = {
  id: string;
  grupo: string;
  titulo: string;
  resumen: string;
  bloques: Bloque[];
};

export const GRUPOS = [
  "Primeros pasos",
  "Caja y ventas",
  "Inventario",
  "Compras y pagos",
  "Presupuestos",
] as const;

/**
 * Cómo se llega a la pantalla de cada guía: la sección del menú y el ítem.
 *
 * El menú de este ERP se abre por secciones, así que alcanza con nombrarlas.
 */
export const LLEGAR: Record<string, [string, string?]> = {
  "abrir-caja": ["Comercial", "Caja"],
  vender: ["Comercial", "Caja → Nueva venta"],
  "cerrar-caja": ["Comercial", "Caja"],
  devolucion: ["Comercial", "Caja → Devoluciones"],
  anticipo: ["Comercial", "Caja → Anticipos"],
  arqueo: ["Comercial", "Caja → Arqueo mensual"],
  productos: ["Operaciones", "Inventario → Productos"],
  "producto-nuevo": ["Operaciones", "Inventario → Productos"],
  ajuste: ["Operaciones", "Inventario → Ajustes"],
  "bajo-minimo": ["Operaciones", "Inventario → Bajo mínimo"],
  rubros: ["Operaciones", "Inventario → Rubros"],
  valoracion: ["Operaciones", "Inventario → Valoración"],
  movimientos: ["Operaciones", "Inventario → Movimientos"],
  compra: ["Operaciones", "Compras"],
  "orden-compra": ["Operaciones", "Compras → Órdenes de compra"],
  proveedor: ["Operaciones", "Proveedores"],
  "pagar-proveedor": ["Finanzas", "Pagos → Pagos a proveedores"],
  "cobrar-cliente": ["Finanzas", "Pagos → Cobros a clientes"],
  presupuesto: ["Comercial", "Presupuestos"],
  "presupuesto-cobrar": ["Comercial", "Presupuestos"],
};

export const GUIAS: Guia[] = [
  // ── Primeros pasos ─────────────────────────────────────────────────────
  {
    id: "un-dia",
    grupo: "Primeros pasos",
    titulo: "Un día de trabajo",
    resumen: "El orden de las tareas, de la mañana a la noche.",
    bloques: [
      {
        texto:
          "Si recién empezás, leé esto primero. Cada paso tiene después su propia guía en este manual, con las pantallas.",
      },
      {
        img: "inicio",
        alt: "Pantalla de inicio del sistema",
        pasos: [
          { t: "A la mañana se abre la caja.", d: "Se anota con cuánto efectivo se arranca." },
          { t: "El vendedor arma el presupuesto y lo manda a cobrar." },
          { t: "En la caja se cobra.", d: "El stock baja solo: no hay que descontarlo a mano." },
          { t: "Cuando llega mercadería, se carga la factura del proveedor.", d: "El stock sube y el costo se actualiza solo." },
          { t: "Cuando un cliente paga una deuda, se registra el cobro." },
          { t: "A la noche se cuenta el efectivo y se cierra la caja.", d: "Si no coincide, el sistema pide el motivo." },
        ],
      },
      {
        consejo:
          "No hace falta hacer todo esto el primer día. Lo mínimo para arrancar es: abrir caja, vender y cerrar caja.",
      },
    ],
  },
  {
    id: "moverse",
    grupo: "Primeros pasos",
    titulo: "Moverse por el sistema",
    resumen: "El menú, el buscador y cómo cambiar de sucursal.",
    bloques: [
      {
        img: "inicio",
        alt: "Menú lateral y encabezado",
        pasos: [
          { t: "Todo está en el menú de la izquierda, agrupado por área.", d: "Comercial, Finanzas, Operaciones, y así." },
          { t: "Si no encontrás algo, escribilo en el buscador del menú.", d: "Arriba de todo, donde dice «Buscar en el menú»." },
          { t: "Arriba a la derecha se cambia de sucursal.", d: "Lo que ves —productos, ventas, stock— es el de la sucursal elegida." },
          { t: "La estrellita al lado de un ítem lo deja fijo arriba." },
        ],
      },
      {
        ojo:
          "Si cambiás de sucursal, cambia TODO lo que ves. Un producto puede existir en una sucursal y no en la otra.",
      },
    ],
  },

  // ── Caja y ventas ──────────────────────────────────────────────────────
  {
    id: "abrir-caja",
    grupo: "Caja y ventas",
    titulo: "Abrir la caja",
    resumen: "Lo primero de la mañana. Sin caja abierta no se puede cobrar.",
    bloques: [
      {
        img: "caja",
        alt: "Pantalla de caja",
        pasos: [
          { t: "Tocá «Abrir caja».", marca: "Abrir caja" },
          { t: "Poné con cuánto efectivo arrancás.", d: "Es el cambio que quedó o el que se puso hoy." },
          { t: "Confirmá." },
        ],
      },
      {
        ojo:
          "Ese número es contra el que se compara al cerrar. Si lo ponés mal, a la noche va a figurar una diferencia que no existió.",
      },
    ],
  },
  {
    id: "vender",
    grupo: "Caja y ventas",
    titulo: "Cobrar una venta",
    resumen: "Buscar los productos, elegir contado o crédito y confirmar.",
    bloques: [
      {
        img: "venta-nueva",
        alt: "Pantalla de nueva venta",
        pasos: [
          { t: "Buscá el producto por nombre o por código.", d: "Se agrega solo a la lista, no hay que apretar nada más.", marca: "Buscar producto" },
          { t: "Repetí con cada producto. Las cantidades se corrigen en la tabla." },
          { t: "Si la venta es a un cliente, buscalo arriba.", d: "Es opcional: si no ponés cliente, la venta queda sin cliente.", marca: "Cliente" },
          { t: "Elegí Contado o Crédito.", d: "Crédito significa que queda como deuda del cliente." },
          { t: "Tocá «Confirmar venta»." },
        ],
      },
      {
        consejo:
          "Si arriba aparece un recuadro verde que dice «Hay un presupuesto aprobado esperando cobro», tocá «Cobrar» ahí: carga todos los productos de una.",
      },
      {
        ojo:
          "El stock baja cuando confirmás. Si te equivocaste, no vuelvas a vender para compensar: hacé una devolución.",
      },
    ],
  },
  {
    id: "cerrar-caja",
    grupo: "Caja y ventas",
    titulo: "Cerrar la caja",
    resumen: "Contar el efectivo y dejar el turno cerrado.",
    bloques: [
      {
        img: "caja",
        alt: "Pantalla de caja",
        pasos: [
          { t: "Contá el efectivo que hay en el cajón." },
          { t: "Tocá «Cerrar caja».", marca: "Cerrar caja" },
          { t: "Escribí lo que contaste, no lo que el sistema espera." },
          { t: "Si hay diferencia, explicá por qué." },
        ],
      },
      {
        ojo:
          "Poner el número que el sistema espera, para que «dé bien», es lo peor que se puede hacer: la diferencia existe igual y se descubre después, cuando ya nadie se acuerda del día.",
      },
    ],
  },
  {
    id: "devolucion",
    grupo: "Caja y ventas",
    titulo: "Devolver mercadería",
    resumen: "El cliente trae algo de vuelta y el stock lo tiene que recuperar.",
    bloques: [
      {
        img: "devoluciones",
        alt: "Pantalla de devoluciones",
        pasos: [
          { t: "Buscá la venta original." },
          { t: "Marcá qué productos vuelven y cuántos." },
          { t: "Confirmá la devolución.", d: "El stock vuelve a subir solo." },
        ],
      },
    ],
  },
  {
    id: "anticipo",
    grupo: "Caja y ventas",
    titulo: "Recibir un anticipo",
    resumen: "El cliente deja plata a cuenta de una compra que todavía no se llevó.",
    bloques: [
      {
        img: "anticipos",
        alt: "Pantalla de anticipos",
        pasos: [
          { t: "Elegí el cliente." },
          { t: "Poné cuánto deja y cómo lo paga." },
          { t: "Confirmá." },
        ],
      },
      {
        consejo:
          "El anticipo queda a favor del cliente. Cuando venga a llevar la mercadería, se descuenta de lo que tiene que pagar.",
      },
    ],
  },
  {
    id: "arqueo",
    grupo: "Caja y ventas",
    titulo: "Ver el arqueo del mes",
    resumen: "Todas las cajas del mes, con sus diferencias.",
    bloques: [
      {
        img: "arqueo-mensual",
        alt: "Arqueo mensual",
        pasos: [
          { t: "Elegí el mes." },
          { t: "Mirá la columna de diferencias.", d: "Ahí se ve qué días no cerraron y por cuánto." },
        ],
      },
    ],
  },

  // ── Inventario ─────────────────────────────────────────────────────────
  {
    id: "productos",
    grupo: "Inventario",
    titulo: "Buscar un producto",
    resumen: "El listado, el buscador y qué significa cada columna.",
    bloques: [
      {
        img: "inventario-productos",
        alt: "Listado de productos",
        pasos: [
          { t: "Escribí el nombre o el código en el buscador.", marca: "Buscar por nombre o SKU" },
          { t: "Para ver un rubro entero, usá el filtro de al lado.", marca: "Todos los rubros" },
          { t: "Costo es lo que te sale; Precio es a cuánto lo vendés.", d: "Abajo de cada uno está el mismo monto en dólares." },
          { t: "Remarcación es cuánto le cargás encima al costo." },
        ],
      },
      {
        consejo:
          "Si alguien te pide un producto por un código viejo, escribilo igual: el sistema también busca por los códigos que el producto tenía antes.",
      },
    ],
  },
  {
    id: "producto-nuevo",
    grupo: "Inventario",
    titulo: "Cargar un producto nuevo",
    resumen: "Los datos mínimos para que se pueda vender.",
    bloques: [
      {
        img: "inventario-productos",
        alt: "Listado de productos",
        pasos: [{ t: "Tocá «Nuevo producto».", marca: "Nuevo producto" }],
      },
      {
        img: "producto-nuevo",
        alt: "Formulario de producto nuevo",
        pasos: [
          { t: "Poné el nombre como lo pide la gente.", d: "Es por donde lo van a buscar en la caja.", marca: "Nombre" },
          { t: "El código (SKU) tiene que ser único.", marca: "SKU" },
          { t: "Elegí el rubro." },
          { t: "Cargá el precio de venta.", marca: "Precio de venta" },
          { t: "Guardá.", marca: "Guardar" },
        ],
      },
      {
        ojo:
          "Un producto sin precio no se puede vender. Si todavía no sabés a cuánto, cargalo igual y ponele el precio antes de que llegue el primer cliente.",
      },
    ],
  },
  {
    id: "ajuste",
    grupo: "Inventario",
    titulo: "Corregir el stock",
    resumen: "Cuando lo que hay en el depósito no es lo que dice el sistema.",
    bloques: [
      {
        img: "inventario-ajustes",
        alt: "Pantalla de ajustes de stock",
        pasos: [
          { t: "Buscá el producto." },
          { t: "Poné la cantidad REAL, la que contaste." },
          { t: "Escribí el motivo.", d: "Rotura, faltante, error de carga. Sin motivo no se entiende después." },
          { t: "Confirmá." },
        ],
      },
      {
        ojo:
          "Todo ajuste queda registrado con quién lo hizo y cuándo. No es para esconder un faltante: es para que el stock diga la verdad.",
      },
    ],
  },
  {
    id: "bajo-minimo",
    grupo: "Inventario",
    titulo: "Ver qué hay que reponer",
    resumen: "Los productos que se están por acabar, y la orden de compra de una.",
    bloques: [
      {
        img: "inventario-bajo-minimo",
        alt: "Productos bajo mínimo",
        pasos: [
          { t: "La lista muestra lo que está por debajo del mínimo." },
          { t: "Marcá lo que querés pedir." },
          { t: "Generá la orden de compra.", d: "Se arma sola con lo que marcaste." },
        ],
      },
    ],
  },
  {
    id: "rubros",
    grupo: "Inventario",
    titulo: "Rubros",
    resumen: "Cómo se agrupan los productos.",
    bloques: [
      {
        img: "inventario-rubros",
        alt: "Pantalla de rubros",
        pasos: [
          { t: "Tocá «Nuevo rubro» para crear uno.", marca: "Nuevo rubro" },
          { t: "Un rubro puede colgar de otro.", d: "Caños → Caños cuadrados, por ejemplo." },
          { t: "El lápiz edita el rubro entero, no solo el nombre." },
        ],
      },
    ],
  },
  {
    id: "valoracion",
    grupo: "Inventario",
    titulo: "Cuánta plata hay en el depósito",
    resumen: "El valor del stock a una fecha.",
    bloques: [
      {
        img: "inventario-valoracion",
        alt: "Valoración de existencias",
        pasos: [
          { t: "Elegí la fecha." },
          { t: "El total es lo que vale la mercadería a costo, no a precio de venta." },
        ],
      },
    ],
  },
  {
    id: "movimientos",
    grupo: "Inventario",
    titulo: "Qué pasó con un producto",
    resumen: "Todas las entradas y salidas, con su motivo.",
    bloques: [
      {
        img: "inventario-movimientos",
        alt: "Movimientos de inventario",
        pasos: [
          { t: "Elegí el período.", marca: "Desde" },
          { t: "Buscá el producto." },
          { t: "Cada línea dice de dónde salió: una venta, una compra, un ajuste." },
        ],
      },
      {
        consejo:
          "Es la primera pantalla a mirar cuando el stock de algo no cuadra: ahí está el movimiento que lo descuadró.",
      },
    ],
  },

  // ── Compras y pagos ────────────────────────────────────────────────────
  {
    id: "compra",
    grupo: "Compras y pagos",
    titulo: "Cargar una factura de compra",
    resumen: "Llega mercadería: se carga la factura y el stock sube solo.",
    bloques: [
      {
        img: "compras",
        alt: "Listado de compras",
        pasos: [{ t: "Tocá «Nueva compra».", marca: "Nueva compra" }],
      },
      {
        img: "compra-nueva",
        alt: "Formulario de compra",
        pasos: [
          { t: "Elegí el proveedor.", marca: "Proveedor" },
          { t: "Cargá el número de la factura y la fecha." },
          { t: "Agregá los productos con su cantidad y su costo." },
          { t: "Si es a crédito, poné a cuántos días." },
          { t: "Guardá.", marca: "Guardar" },
        ],
      },
      {
        consejo:
          "El costo que cargás acá actualiza el costo promedio del producto, y con eso se calcula la remarcación. Vale la pena cargarlo bien.",
      },
    ],
  },
  {
    id: "orden-compra",
    grupo: "Compras y pagos",
    titulo: "Órdenes de compra",
    resumen: "Lo que se le pidió a un proveedor y todavía no llegó.",
    bloques: [
      {
        img: "ordenes-compra",
        alt: "Órdenes de compra",
        pasos: [
          { t: "La lista muestra lo pedido y en qué estado está." },
          { t: "Cuando llega la mercadería, la orden se convierte en compra." },
        ],
      },
    ],
  },
  {
    id: "proveedor",
    grupo: "Compras y pagos",
    titulo: "Cargar un proveedor",
    resumen: "Los datos para poder comprarle y pagarle.",
    bloques: [
      {
        img: "proveedores",
        alt: "Listado de proveedores",
        pasos: [
          { t: "Tocá «Nuevo proveedor».", marca: "Nuevo proveedor" },
          { t: "Nombre y RUC son lo importante." },
          { t: "Si te da plazo, cargá a cuántos días.", d: "Con eso el sistema calcula solo cuándo vence cada factura." },
        ],
      },
    ],
  },
  {
    id: "pagar-proveedor",
    grupo: "Compras y pagos",
    titulo: "Pagarle a un proveedor",
    resumen: "A quién hay que pagarle, y cómo registrar el pago.",
    bloques: [
      {
        img: "pagos-proveedores",
        alt: "Pagos a proveedores",
        pasos: [
          { t: "La pestaña «Por pagar» muestra lo que vence y lo vencido." },
          { t: "Para pagar UNA factura, usá el botón de su fila." },
          { t: "Elegí cómo se pagó y de qué banco sale.", d: "Cheque o transferencia salen de una cuenta: hay que decir cuál." },
          { t: "Subí la foto del cheque o el comprobante." },
        ],
      },
      {
        img: "pagos-proveedores",
        alt: "Armar pago",
        pasos: [
          { t: "Para pagar VARIAS facturas con un solo cheque, usá «Armar pago».", marca: "Armar pago" },
          { t: "Elegí las facturas, imprimí la orden y hacé firmar el recibo." },
        ],
      },
      {
        consejo:
          "El pago cargado con su banco aparece en el flujo de caja. Un pago que no se carga acá, para la planilla no existe.",
      },
    ],
  },
  {
    id: "cobrar-cliente",
    grupo: "Compras y pagos",
    titulo: "Cobrar una deuda",
    resumen: "Un cliente paga una venta a crédito.",
    bloques: [
      {
        img: "cobros-clientes",
        alt: "Cobros a clientes",
        pasos: [
          { t: "Buscá el cliente." },
          { t: "Marcá qué factura está pagando." },
          { t: "Poné el monto y cómo pagó." },
          { t: "Confirmá e imprimí el recibo." },
        ],
      },
    ],
  },

  // ── Presupuestos ───────────────────────────────────────────────────────
  {
    id: "presupuesto",
    grupo: "Presupuestos",
    titulo: "Hacer un presupuesto",
    resumen: "Cotizarle a un cliente y mandarle el PDF.",
    bloques: [
      {
        img: "presupuestos",
        alt: "Listado de presupuestos",
        pasos: [{ t: "Tocá «Nuevo presupuesto».", marca: "Nuevo presupuesto" }],
      },
      {
        img: "presupuesto-nuevo",
        alt: "Formulario de presupuesto",
        pasos: [
          { t: "Poné los datos del cliente.", d: "Si todavía no es cliente, se puede escribir el nombre a mano." },
          { t: "Buscá los productos y poné las cantidades.", marca: "Buscar producto" },
          { t: "Cargá la validez en días.", d: "Es hasta cuándo valen esos precios." },
          { t: "Guardá y descargá el PDF.", marca: "Guardar" },
        ],
      },
      {
        consejo:
          "El presupuesto no descuenta stock. Recién cuando se cobra en la caja se descuenta.",
      },
    ],
  },
  {
    id: "presupuesto-cobrar",
    grupo: "Presupuestos",
    titulo: "Mandar un presupuesto a cobrar",
    resumen: "El cliente aceptó: que le aparezca al cajero.",
    bloques: [
      {
        img: "presupuestos",
        alt: "Listado de presupuestos",
        pasos: [
          { t: "Abrí el presupuesto." },
          { t: "Marcalo como Aprobado." },
          { t: "Tocá «Mandar a cobrar».", d: "Le aparece al cajero en la pantalla de nueva venta." },
        ],
      },
      {
        consejo:
          "Si en la caja le cambian algo —una cantidad, un precio, una línea—, te llega el aviso con qué se cambió. El presupuesto sigue siendo tuyo.",
      },
    ],
  },
];
