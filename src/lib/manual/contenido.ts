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

/**
 * t: la frase grande, una sola acción. d: la aclaración, en letra chica.
 *
 * `img` sólo hace falta cuando el paso pasa en OTRA pantalla que la del
 * bloque: lo normal es que varios pasos seguidos sean de la misma pantalla y
 * la hereden.
 */
export type Paso = { t: string; d?: string; marca?: string; img?: string; alt?: string };

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
  "Clientes",
  "Gastos y bancos",
  "Informes",
  "Personal",
  "Administración",
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
  clientes: ["Comercial", "Clientes"],
  "cliente-nuevo": ["Comercial", "Clientes → Nuevo cliente"],
  crm: ["Comercial", "CRM Funnel"],
  conversaciones: ["Omnicanal", "Conversaciones"],
  "gasto-nuevo": ["Finanzas", "Gastos"],
  "flujo-caja": ["Finanzas", "Pagos → Flujo de caja"],
  bancos: ["Finanzas", "Pagos → Bancos y cajas"],
  "tipos-cambio": ["Operaciones", "Compras → Tipos de cambio"],
  "historial-ventas": ["Finanzas", "Reportes → Historial de ventas"],
  ganancias: ["Finanzas", "Reportes → Ganancias"],
  cobranzas: ["Finanzas", "Reportes → Cobranzas"],
  "cierres-caja": ["Finanzas", "Reportes → Cierres de caja"],
  comisiones: ["Comercial", "Comisiones"],
  "estudio-precios": ["Operaciones", "Inventario → Estudio de precios"],
  "paquete-mensual": ["Finanzas", "Contabilidad → Paquete mensual (ZIP)"],
  "libro-ventas": ["Finanzas", "Contabilidad → Libro de ventas"],
  empleados: ["Recursos Humanos", "RRHH → Empleados"],
  "control-horario": ["Recursos Humanos", "RRHH → Control horario"],
  vacaciones: ["Recursos Humanos", "RRHH → Vacaciones"],
  ausencias: ["Recursos Humanos", "RRHH → Feriados y ausencias"],
  salarios: ["Recursos Humanos", "RRHH → Salarios"],
  aguinaldo: ["Recursos Humanos", "RRHH → Aguinaldo"],
  "usuario-nuevo": ["Administración", "Usuarios → Nuevo usuario"],
  sucursales: ["Administración", "Sucursales"],
  facturacion: ["Administración", "Configuración → Facturación"],
  transferencias: ["Operaciones", "Transferencias entre sucursales"],
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
        /*
          Cada paso lleva SU pantalla. Antes heredaban todos la del bloque y se
          veía seis veces el Dashboard, también abajo de "En la caja se cobra":
          quien no conoce el sistema entendía que se cobra desde ahí.
        */
        pasos: [
          { t: "A la mañana se abre la caja.", d: "Se anota con cuánto efectivo se arranca.", img: "caja", alt: "Pantalla de Caja" },
          { t: "El vendedor arma el presupuesto y lo manda a cobrar.", img: "presupuesto-nuevo", alt: "Nuevo presupuesto" },
          { t: "En la caja se cobra.", d: "El stock baja solo: no hay que descontarlo a mano.", img: "venta-nueva", alt: "Nueva venta" },
          { t: "Cuando llega mercadería, se carga la factura del proveedor.", d: "El stock sube y el costo se actualiza solo.", img: "compra-nueva", alt: "Nueva compra" },
          { t: "Cuando un cliente paga una deuda, se registra el cobro.", img: "cobros-clientes", alt: "Cobros a clientes" },
          { t: "A la noche se cuenta el efectivo y se cierra la caja.", d: "Si no coincide, el sistema pide el motivo.", img: "caja", alt: "Pantalla de Caja" },
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

  // ── Clientes ───────────────────────────────────────────────────────────
  {
    id: "clientes",
    grupo: "Clientes",
    titulo: "Buscar un cliente",
    resumen: "Encontrarlo, ver su ficha y lo que debe.",
    bloques: [
      {
        img: "clientes-lista",
        alt: "Lista de clientes",
        pasos: [
          { t: "Escribí el nombre o el código en el buscador." },
          { t: "Si buscás un grupo, filtrá por rubro.", d: "Mayorista, minorista, constructora: el rubro es el que define el nivel de precio.", marca: "Todos los rubros" },
          { t: "Tocá la fila del cliente para abrir su ficha." },
          { t: "En la ficha está el estado de cuenta: qué compró y qué debe." },
        ],
      },
      {
        consejo:
          "Si tenés la lista de clientes en una planilla, «Importar Excel» los carga todos juntos en vez de uno por uno.",
      },
    ],
  },
  {
    id: "cliente-nuevo",
    grupo: "Clientes",
    titulo: "Dar de alta un cliente",
    resumen: "Los datos que importan y los que podés dejar para después.",
    bloques: [
      {
        img: "cliente-nuevo",
        alt: "Formulario de nuevo cliente",
        texto: "Lo único obligatorio es la razón social. Todo lo demás se puede completar más adelante.",
        pasos: [
          { t: "Elegí si es empresa o persona." },
          { t: "Escribí la razón social.", d: "Es el nombre con el que va a salir en la factura.", marca: "Razón social" },
          { t: "Cargá el RUC.", d: "Sin RUC la factura sale a nombre genérico.", marca: "RUC" },
          { t: "Elegí el rubro del cliente.", d: "De ahí sale el nivel de precio que le va a aparecer al cajero." },
          { t: "Si le vas a vender a crédito, poné el límite y los días." },
          { t: "Tocá «Guardar cliente»." },
        ],
      },
      {
        ojo:
          "El límite de crédito no es un adorno: cuando el cliente lo pasa, la caja avisa antes de dejar vender a cuenta.",
      },
    ],
  },
  {
    id: "crm",
    grupo: "Clientes",
    titulo: "Seguir una oportunidad",
    resumen: "El CRM: anotar al que preguntó y no perderlo de vista.",
    bloques: [
      {
        img: "crm",
        alt: "CRM Funnel",
        texto:
          "Sirve para el que todavía no compró: pidió precio, vino a preguntar, llamó. Si ya es cliente y ya compra, va en Clientes.",
        pasos: [
          { t: "Tocá «Nuevo prospecto» y cargá el nombre y el teléfono.", marca: "Nuevo prospecto" },
          { t: "Arrastrá la tarjeta de una etapa a la otra a medida que avanza.", d: "Lead, contactado, presupuestado, ganado o perdido.", marca: "Kanban" },
          { t: "Si preferís verlo como tabla, cambiá a «Lista».", marca: "Lista" },
        ],
      },
      {
        consejo:
          "Marcá los perdidos como perdidos. Un funnel lleno de tarjetas viejas que nadie va a llamar no sirve para decidir nada.",
      },
    ],
  },
  {
    id: "conversaciones",
    grupo: "Clientes",
    titulo: "Los WhatsApp del negocio",
    resumen: "La bandeja: quién escribió, qué falta contestar.",
    bloques: [
      {
        img: "conversaciones",
        alt: "Bandeja de conversaciones",
        pasos: [
          { t: "La lista de la izquierda son los chats; tocá uno para abrirlo." },
          { t: "«Sin responder» te deja solo los que esperan contestación.", d: "Es el filtro con el que conviene arrancar el día.", marca: "Sin responder" },
          { t: "Para escribirle vos primero a alguien, tocá «Nuevo chat».", marca: "Nuevo chat" },
        ],
      },
      {
        consejo:
          "Los asesores tienen esta misma bandeja en el celular, en la aplicación del corporativo, y les llega aviso cuando entra un mensaje.",
      },
    ],
  },

  // ── Gastos y bancos ────────────────────────────────────────────────────
  {
    id: "gasto-nuevo",
    grupo: "Gastos y bancos",
    titulo: "Cargar un gasto",
    resumen: "Alquiler, luz, flete: todo lo que no es mercadería.",
    bloques: [
      {
        img: "gasto-nuevo",
        alt: "Formulario de nuevo gasto",
        pasos: [
          { t: "Elegí el rubro del gasto.", d: "Alquiler, servicios, combustible, fletes." },
          { t: "Escribí a quién se le pagó.", d: "El nombre del comercio o de la empresa.", marca: "Beneficiario" },
          { t: "Cargá el RUC, el timbrado y el número de la factura.", d: "Sin esos tres datos el gasto no sirve para la declaración.", marca: "N° de factura" },
          { t: "Poné el monto en la fila del IVA que corresponda.", d: "Si la factura es toda de un tipo, cargá solo ese." },
          { t: "Tocá «Crear gasto»." },
        ],
      },
      {
        ojo:
          "La plata que sale del cajón de la caja NO se carga acá. Eso es un egreso de caja, y se ve en Reportes → Ingresos y egresos. Acá van los gastos de la empresa.",
      },
    ],
  },
  {
    id: "flujo-caja",
    grupo: "Gastos y bancos",
    titulo: "El flujo de caja del mes",
    resumen: "Qué hay que pagar cada día y si alcanza la plata.",
    bloques: [
      {
        img: "flujo-caja",
        alt: "Flujo de caja",
        texto:
          "Una columna por día del mes y una fila por proveedor: en cada cruce, lo que hay que pagarle ese día.",
        pasos: [
          { t: "Elegí el mes y el año arriba." },
          { t: "Cargá el tipo de cambio con el que querés proyectar.", d: "Conviene ponerlo un poco por encima del real, para tener colchón si sube el dólar.", marca: "Guardar" },
          { t: "En «Posición de liquidez» cargá cuánto hay en bancos, en efectivo y en mercadería." },
          { t: "Los colores de cada cheque dicen en qué está: pendiente de emisión, emitido o ya cobrado." },
        ],
      },
      {
        ojo:
          "La posición de liquidez se carga a mano. El sistema no se conecta con el banco, así que lo que diga ahí vale lo que valga lo que se cargó.",
      },
    ],
  },
  {
    id: "bancos",
    grupo: "Gastos y bancos",
    titulo: "Las cajas, bancos y tarjetas",
    resumen: "De dónde salen las opciones que ve el cajero al cobrar.",
    bloques: [
      {
        img: "bancos",
        alt: "Entidades bancarias",
        texto:
          "Cada caja, banco, tarjeta o billetera que se usa para cobrar está acá. Lo que se carga en esta pantalla es lo que al cajero le aparece como opción.",
        pasos: [
          { t: "Escribí el nombre de la entidad.", marca: "Nombre *" },
          { t: "Elegí el tipo: caja, banco, tarjeta o billetera." },
          { t: "Poné un código corto.", d: "El cajero lo tipea para encontrarla rápido, sin buscar en la lista." },
          { t: "Tocá «Crear entidad».", marca: "Crear entidad" },
        ],
      },
      {
        consejo:
          "No la borres cuando dejás de usarla: desactivala. Si la borrás, los cobros viejos quedan sin decir por dónde entró la plata.",
      },
    ],
  },
  {
    id: "tipos-cambio",
    grupo: "Gastos y bancos",
    titulo: "La cotización del dólar",
    resumen: "Cargarla y ver el historial de quién la cambió.",
    bloques: [
      {
        img: "tipos-cambio",
        alt: "Tipos de cambio",
        texto:
          "Son dos cotizaciones distintas: la compradora, para convertir lo que se cobra en dólares, y la vendedora, para costear las compras en dólares.",
        pasos: [
          { t: "La cotización del día se carga desde el Dashboard, en la tarjeta «Dólar (USD)»." },
          { t: "Acá queda el historial: la fecha, la hora y quién la cargó.", marca: "Desde" },
          { t: "Si lo necesita el contador, sale en Excel o impreso.", marca: "Excel" },
        ],
      },
      {
        ojo:
          "Una cotización vieja no se edita. Si está mal, se carga otra. Las anteriores quedan porque son las que se usaron para costear las compras de ese día: cambiarlas cambiaría el costo de mercadería que ya se vendió.",
      },
    ],
  },

  // ── Informes ───────────────────────────────────────────────────────────
  {
    id: "historial-ventas",
    grupo: "Informes",
    titulo: "Buscar una venta vieja",
    resumen: "Encontrar una factura y volver a mandarla.",
    bloques: [
      {
        img: "historial-ventas",
        alt: "Historial de ventas",
        pasos: [
          { t: "Poné el período en «Desde» y «Hasta».", marca: "Desde" },
          { t: "Si sabés de quién fue, filtrá por cliente o por vendedor.", marca: "Vendedor" },
          { t: "Tocá la fila para ver el detalle de esa venta." },
          { t: "Para mandársela al cliente, «Imprimir» o «Excel».", marca: "Imprimir" },
        ],
      },
      {
        consejo:
          "Esta pantalla es para buscar UNA venta. Si lo que querés son promedios o cuánto se vendió de cada producto, eso está en Ventas del mes.",
      },
    ],
  },
  {
    id: "ganancias",
    grupo: "Informes",
    titulo: "Cuánto se ganó",
    resumen: "Ventas, costo, gastos y lo que queda, comparado con el mes anterior.",
    bloques: [
      {
        img: "ganancias",
        alt: "Reporte de ganancias",
        pasos: [
          { t: "Elegí el período: día, semana, mes, trimestre, año o un rango a mano.", marca: "Mes" },
          { t: "La columna del medio es el período anterior, y la última cuánto cambió.", marca: "Trimestre" },
          { t: "Leé de arriba hacia abajo: ventas, costo de lo vendido, utilidad bruta, gastos y resultado." },
        ],
      },
      {
        ojo:
          "Lo que se le paga al proveedor no aparece como gasto, y está bien: esa plata ya está contada en el costo de la mercadería. Si estuviera en los dos lados, la ganancia saldría a la mitad.",
      },
    ],
  },
  {
    id: "cobranzas",
    grupo: "Informes",
    titulo: "Qué se cobró",
    resumen: "A quién, cuándo y con qué comprobante.",
    bloques: [
      {
        img: "cobranzas",
        alt: "Reporte de cobranzas",
        pasos: [
          { t: "Poné el período." },
          { t: "Filtrá por medio de pago si buscás los cheques o las transferencias.", marca: "Medio de pago" },
          { t: "«Solo vigentes» esconde los cobros anulados.", marca: "Solo vigentes" },
          { t: "Para el contador, «Exportar Excel».", marca: "Exportar Excel" },
        ],
      },
      {
        consejo:
          "Hay dos columnas parecidas y no son lo mismo: Factura es contra qué se imputó la plata, y Comprobante es con qué se demuestra que entró — el número de la transferencia, del cheque o de la boleta.",
      },
    ],
  },
  {
    id: "cierres-caja",
    grupo: "Informes",
    titulo: "Revisar los cierres de caja",
    resumen: "Un turno por fila, con la diferencia de cada uno.",
    bloques: [
      {
        img: "cierres-caja",
        alt: "Cierres de caja",
        pasos: [
          { t: "Elegí el mes.", marca: "Mes" },
          { t: "Mirá la última columna: ahí está la diferencia de cada turno." },
          { t: "Tocá la fila para ver el detalle de ese cierre." },
          { t: "Si hay que corregir algo, «Reabrir» vuelve a abrir el turno.", d: "Solo lo puede hacer un administrador.", marca: "Reabrir" },
        ],
      },
      {
        ojo:
          "El efectivo esperado cuenta solo lo que pasa por el cajón: apertura, ventas en efectivo, ingresos, egresos y retiros. Tarjeta, transferencia y cheque no entran, porque no cambian la plata que hay adentro.",
      },
    ],
  },
  {
    id: "comisiones",
    grupo: "Informes",
    titulo: "Las comisiones",
    resumen: "Cuánto vendió cada uno y cuánto le toca.",
    bloques: [
      {
        img: "comisiones",
        alt: "Vendedores y comisiones",
        pasos: [
          { t: "En «Informe» ponés el período y te sale una fila por vendedor.", marca: "Informe" },
          { t: "«Ver venta por venta» abre el detalle, para cuando alguien reclama.", marca: "Ver venta por venta" },
          { t: "«Cartera» muestra de quién es cada cliente.", marca: "Cartera" },
          { t: "En «Configuración» se fija el porcentaje por rubro y por tipo de contrato.", marca: "Configuración" },
        ],
      },
      {
        ojo:
          "La comisión se calcula sobre lo vendido SIN IVA. Las ventas anuladas no entran, y una venta a pérdida da comisión cero: nunca descuenta.",
      },
    ],
  },
  {
    id: "estudio-precios",
    grupo: "Informes",
    titulo: "Cambiar precios de todo un rubro",
    resumen: "Remarcar muchos artículos de una vez, viendo antes cómo queda.",
    bloques: [
      {
        img: "estudio-precios",
        alt: "Estudio de precios",
        pasos: [
          { t: "Elegí el rubro, o marcá los productos que querés tocar." },
          { t: "Poné el porcentaje sobre el costo." },
          { t: "Elegí a cuánto redondear.", d: "A mil, a quinientos, a cien." },
          { t: "Mirá la vista previa: producto por producto, cómo queda cada precio." },
          { t: "Recién ahí, guardá." },
        ],
      },
      {
        ojo:
          "El redondeo va siempre para arriba. Para abajo se regala margen en cada venta, y sobre cientos de artículos eso se nota a fin de mes.",
      },
    ],
  },
  {
    id: "paquete-mensual",
    grupo: "Informes",
    titulo: "Lo que se le manda al contador",
    resumen: "Todos los informes del mes en un solo ZIP.",
    bloques: [
      {
        img: "paquete-mensual",
        alt: "Paquete mensual",
        pasos: [
          { t: "Elegí el mes a cerrar.", marca: "Mes a cerrar" },
          { t: "Destildá los informes que no te pidan." },
          { t: "Tocá «Descargar ZIP».", d: "Adentro viene cada informe en su planilla, con encabezado, totales y formato para imprimir.", marca: "Descargar ZIP" },
        ],
      },
      {
        ojo:
          "El paquete sale de TU sucursal. Cada usuario ve solo la suya, así que el cierre de la otra lo tiene que bajar alguien de allá.",
      },
    ],
  },
  {
    id: "libro-ventas",
    grupo: "Informes",
    titulo: "El libro de ventas",
    resumen: "Lo que pide el IVA, por fecha de comprobante.",
    bloques: [
      {
        img: "libro-ventas",
        alt: "Libro de ventas",
        pasos: [
          { t: "Poné el período.", marca: "Desde" },
          { t: "Las columnas están separadas por tipo: exento, gravado al 5 y gravado al 10, con su IVA.", marca: "Condición" },
          { t: "«Exportar Excel» y listo para el contador.", marca: "Exportar Excel" },
        ],
      },
      {
        ojo:
          "Entran solo los comprobantes fiscales válidos, o sea las facturas con DTE aprobado. Las ventas internas sin documento fiscal no figuran. Las notas de crédito aparecen en negativo.",
      },
    ],
  },

  // ── Personal ───────────────────────────────────────────────────────────
  {
    id: "empleados",
    grupo: "Personal",
    titulo: "La ficha de cada empleado",
    resumen: "Puesto, fecha de ingreso, salario y con qué usuario entra.",
    bloques: [
      {
        img: "rrhh-empleados",
        alt: "Lista de empleados",
        pasos: [
          { t: "«Activos» son los que están trabajando hoy.", marca: "Activos" },
          { t: "«De baja» son los que ya no están, pero siguen en el sistema.", d: "Hacen falta para el aguinaldo y para los informes de años anteriores.", marca: "De baja" },
          { t: "La columna «Usuario del sistema» dice con qué cuenta entra esa persona." },
          { t: "Tocá la fila para abrir la ficha." },
        ],
      },
      {
        consejo:
          "Empleado y usuario no son lo mismo. El empleado es la persona, con su legajo y su sueldo. El usuario es la cuenta con la que entra al sistema. Una persona puede estar en RR HH sin tener usuario.",
      },
    ],
  },
  {
    id: "control-horario",
    grupo: "Personal",
    titulo: "Entrada y salida",
    resumen: "El link para que fichen desde el celular.",
    bloques: [
      {
        img: "rrhh-control-horario",
        alt: "Control horario",
        texto: "No hace falta que cada empleado tenga usuario del sistema para fichar.",
        pasos: [
          { t: "Copiá el link de arriba y mandáselo a los empleados.", d: "Lo pueden guardar en la pantalla de inicio del celular.", marca: "Copiar" },
          { t: "Ellos marcan entrada y salida tipeando su documento. No necesitan contraseña.", marca: "Link para compartir" },
          { t: "Si alguien se olvidó de fichar, lo cargás a mano acá abajo.", marca: "Guardar fichaje" },
          { t: "Las horas y la tardanza las calcula solo." },
        ],
      },
      {
        ojo:
          "«Regenerar token» cambia el link y deja de funcionar el anterior. Si lo tocás, hay que volver a mandarles el link nuevo a todos.",
      },
    ],
  },
  {
    id: "vacaciones",
    grupo: "Personal",
    titulo: "Vacaciones",
    resumen: "Cuántos días le quedan a cada uno, según la ley.",
    bloques: [
      {
        img: "rrhh-vacaciones",
        alt: "Vacaciones",
        pasos: [
          { t: "«Saldos por empleado» muestra, de cada persona, cuántos días tiene y cuántos ya se tomó.", marca: "Saldos por empleado" },
          { t: "Para cargar unas vacaciones, elegí el empleado y el período.", marca: "Empleado" },
          { t: "Tocá «Registrar».", marca: "Registrar" },
          { t: "En «Política» están los días que corresponden por antigüedad.", marca: "Política" },
        ],
      },
      {
        consejo:
          "Los días son hábiles de lunes a sábado, y el primer período se gana recién al cumplir el año. Es el artículo 218 del Código del Trabajo: el sistema ya lo cuenta así.",
      },
    ],
  },
  {
    id: "ausencias",
    grupo: "Personal",
    titulo: "Reposos, permisos y feriados",
    resumen: "Lo que no es vacaciones, y el tope de tres cada treinta días.",
    bloques: [
      {
        img: "rrhh-ausencias",
        alt: "Feriados y ausencias",
        pasos: [
          { t: "«Ausencias» son de una persona; «Feriados» son días que no trabaja nadie.", marca: "Feriados" },
          { t: "Tocá «Registrar ausencia» y elegí el empleado, el tipo y las fechas.", marca: "Registrar ausencia" },
          { t: "Queda reflejado en el control horario y descuenta donde tiene que descontar." },
        ],
      },
      {
        ojo:
          "Hasta tres ausencias por persona cada treinta días. De la cuarta en adelante el sistema avisa en rojo y marca cuál es. Igual deja registrarla: el aviso es para que alguien lo mire, no para frenar la carga.",
      },
    ],
  },
  {
    id: "salarios",
    grupo: "Personal",
    titulo: "Los recibos del mes",
    resumen: "Salario e IPS ya calculados; vos ajustás lo que cambió.",
    bloques: [
      {
        img: "rrhh-salarios",
        alt: "Salarios",
        pasos: [
          { t: "Elegí el mes arriba." },
          { t: "Tocá «Todos generados» y salen los recibos de todo el personal.", d: "Cada uno nace con el mes completo de 30 días y el IPS calculado.", marca: "Todos generados" },
          { t: "Entrá a «Revisar» en la fila del que trabajó menos días, hizo horas extra o pidió anticipo." },
          { t: "Las tarjetas de arriba te dicen el neto a pagar, el IPS a depositar y el costo total." },
        ],
      },
      {
        consejo:
          "El IPS sale solo: 9% del trabajador y 16,5% patronal sobre lo imponible. El costo total de arriba ya incluye el aporte patronal, que es lo que de verdad sale de la empresa.",
      },
    ],
  },
  {
    id: "aguinaldo",
    grupo: "Personal",
    titulo: "El aguinaldo",
    resumen: "Lo cobrado en el año dividido doce.",
    bloques: [
      {
        img: "rrhh-aguinaldo",
        alt: "Aguinaldo",
        pasos: [
          { t: "Elegí el año." },
          { t: "«Todo el año» proyecta hasta diciembre, para saber de antemano cuánto va a ser.", marca: "Todo el año" },
          { t: "La columna «Días de ausencia» es la que explica por qué a alguien le da menos." },
          { t: "«Excel» o «Imprimir» para la planilla.", marca: "Excel" },
        ],
      },
      {
        ojo:
          "Los reposos y los permisos bajan el aguinaldo. Las vacaciones no: son días pagados y cuentan como trabajados.",
      },
    ],
  },

  // ── Administración ─────────────────────────────────────────────────────
  {
    id: "usuario-nuevo",
    grupo: "Administración",
    titulo: "Crear un usuario",
    resumen: "Darle acceso al sistema a alguien, sin pisar a nadie.",
    bloques: [
      {
        img: "usuario-nuevo",
        alt: "Formulario de nuevo usuario",
        pasos: [
          { t: "Elegí la sucursal.", d: "El usuario va a ver únicamente los datos de esa sucursal.", marca: "Sucursal *" },
          { t: "Escribí el nombre y el correo de la persona.", marca: "Email *" },
          { t: "Elegí el nivel de acceso: administrador, supervisor o usuario." },
          { t: "Elegí el área: ventas, cajero, soporte, finanzas, operaciones o administración." },
          { t: "Poné una contraseña y confirmala." },
          { t: "Tocá «Guardar usuario»." },
        ],
      },
      {
        ojo:
          "Fijate bien en el correo antes de guardar. Tiene que ser el de la persona nueva, no el tuyo: si el navegador te autocompletó el que usás para entrar, estás creando un usuario con el correo de otro. El sistema ahora lo frena y te dice de quién es ese correo, pero mirarlo es más rápido que el aviso.",
      },
      {
        consejo:
          "La sucursal no se puede cambiar después desde el sistema. Si te equivocaste, se da de baja el usuario y se crea otro.",
      },
    ],
  },
  {
    id: "sucursales",
    grupo: "Administración",
    titulo: "Las sucursales",
    resumen: "Casa central, Carapeguá y quién ve cada una.",
    bloques: [
      {
        img: "sucursales",
        alt: "Sucursales",
        pasos: [
          { t: "Cada sucursal tiene su propio stock, su propia caja y sus propios informes." },
          { t: "Para agregar una, cargá el nombre y tocá «Crear sucursal».", marca: "Crear sucursal" },
          { t: "Abajo, en cada usuario, tildás a qué sucursales puede entrar." },
        ],
      },
      {
        consejo:
          "Los administradores ven todas las sucursales sin que haya que tildar nada. El tildado es para el resto.",
      },
    ],
  },
  {
    id: "facturacion",
    grupo: "Administración",
    titulo: "La numeración de las facturas",
    resumen: "Prefijo, desde qué número arranca y los días de vencimiento.",
    bloques: [
      {
        img: "facturacion",
        alt: "Configuración de facturación",
        pasos: [
          { t: "«Prefijo de factura» y «Numeración inicial» definen el número que va a salir." },
          { t: "«Días de vencimiento por defecto» es lo que se propone al vender a crédito.", d: "En cada venta se puede cambiar." },
          { t: "Guardá la configuración." },
        ],
      },
      {
        ojo:
          "Esto se toca una vez, al arrancar o cuando el SET da un timbrado nuevo. Cambiar la numeración con facturas ya emitidas rompe la correlatividad, y eso se lo preguntan a uno en una fiscalización.",
      },
    ],
  },
  {
    id: "transferencias",
    grupo: "Administración",
    titulo: "Pedirle mercadería a la otra sucursal",
    resumen: "La reposición entre Casa Central y Carapeguá.",
    bloques: [
      {
        img: "transferencias",
        alt: "Transferencias entre sucursales",
        pasos: [
          { t: "Tocá «Solicitar reposición» y cargá qué necesitás.", marca: "Solicitar reposición" },
          { t: "«Solicitudes realizadas» son las que pediste vos.", },
          { t: "«Solicitudes recibidas» son las que te pidieron a vos.", marca: "Solicitudes recibidas" },
          { t: "El estado de cada fila dice en qué anda: pedida, enviada o recibida." },
        ],
      },
      {
        consejo:
          "El stock se mueve de verdad recién cuando la sucursal que recibe la marca como recibida. Mientras tanto la mercadería figura en viaje, que es lo que pasa en la realidad.",
      },
    ],
  },
];
