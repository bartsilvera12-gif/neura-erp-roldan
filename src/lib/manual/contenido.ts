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
  "Contabilidad",
  "Personal",
  "Administración",
  "Omnicanal",
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
  "gasto-nuevo": ["Finanzas", "Gastos"],
  "flujo-caja": ["Finanzas", "Pagos → Flujo de caja"],
  bancos: ["Finanzas", "Pagos → Bancos y cajas"],
  "tipos-cambio": ["Operaciones", "Compras → Tipos de cambio"],
  "historial-ventas": ["Finanzas", "Reportes → Ventas"],
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
  "omni-bandeja": ["Omnicanal", "Conversaciones"],
  "omni-canales": ["Omnicanal", "Conversaciones → Config · Canales"],
  "omni-colas": ["Omnicanal", "Conversaciones → Config · Colas"],
  "omni-equipos": ["Omnicanal", "Conversaciones → Config · Equipos y supervisión"],
  "omni-horarios": ["Omnicanal", "Conversaciones → Config · Horarios"],
  "omni-flujos": ["Omnicanal", "Conversaciones → Flujos"],
  "factura-caja": ["Comercial", "Caja → Nueva venta"],
  sobrantes: ["Comercial", "Caja → Nueva venta"],
  depositos: ["Operaciones", "Inventario → Depósitos"],
  reposicion: ["Operaciones", "Inventario → Reposición"],
  cotizaciones: ["Operaciones", "Compras → Comparativo de cotizaciones"],
  "presupuesto-reservar": ["Comercial", "Presupuestos"],
  "gestion-cliente": ["Comercial", "Gestión Clientes"],
  rentabilidad: ["Finanzas", "Reportes → Rentabilidad"],
  modificaciones: ["Finanzas", "Reportes → Modificaciones administrativas"],
  "otros-informes": ["Finanzas", "Reportes"],
  "libro-diario": ["Finanzas", "Contabilidad → Libro diario"],
  "libro-compras": ["Finanzas", "Contabilidad → Libro de compras"],
  "plan-cuentas": ["Finanzas", "Contabilidad → Plan de cuentas"],
  "config-contable": ["Finanzas", "Contabilidad → Configuración contable"],
  "punto-equilibrio": ["Finanzas", "Contabilidad → Punto de equilibrio"],
  amonestaciones: ["Recursos Humanos", "RRHH → Empleados"],
  "tipos-empleado": ["Recursos Humanos", "RRHH → Config · Tipos de empleado"],
  "roles-descuento": ["Administración", "Configuración → RRHH · Usuarios y roles"],
  "factura-talonario": ["Administración", "Configuración → Facturación"],
  "precios-deposito": ["Operaciones", "Inventario → Precios por depósito"],
  ubicaciones: ["Operaciones", "Inventario → Ubicaciones"],
  "rubros-cliente": ["Administración", "Configuración"],
  "clientes-categorias": ["Comercial", "Clientes → Categorías"],
  planes: ["Comercial", "Planes"],
  "rrhh-config": ["Recursos Humanos", "RRHH → Config · Política de vacaciones"],
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
          "Si arriba aparece un recuadro verde que dice «Hay un presupuesto aprobado esperando cobro», tocá «Cobrar» ahí: carga todos los productos de una, también los ítems escritos a mano.",
      },
      {
        consejo:
          "Antes de confirmar, en «Documento» elegís si sale «Factura» (sobre el talonario) o «Solo ticket». Está explicado en la guía «Imprimir la factura del talonario».",
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
      {
        consejo:
          "En Proveedores → Rubros se crean los grupos de proveedores (chapas, caños, ferretería), para tenerlos ordenados y filtrarlos.",
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
          "El presupuesto no descuenta stock: se descuenta cuando se cobra en la caja. Si querés que nadie más cotice esa mercadería mientras el cliente decide, reservala (guía «Reservar la mercadería de un presupuesto»).",
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
        consejo:
          "Si cargás un gasto con el mismo concepto y monto que otro, o la misma factura del mismo proveedor, el sistema avisa antes de guardar. Si es a propósito, se puede seguir.",
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
          "Esta pantalla (Reportes → Ventas) es para buscar UNA venta: cada fila dice si fue contado o crédito, el descuento y, a quien ve costos, la utilidad. Para el año completo mes por mes, con gráfico, está Reportes → Historial de ventas.",
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
    grupo: "Contabilidad",
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
    grupo: "Contabilidad",
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
      {
        consejo:
          "En la ficha, «Datos y horario» tiene el puesto y si es mensualero o jornalero. Las pestañas de al lado guardan las vacaciones, las amonestaciones y observaciones, el historial salarial y los documentos.",
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
      {
        consejo:
          "En la misma pantalla, «Papel de la factura» define dónde cae cada dato sobre el talonario preimpreso. Ver la guía «Alinear la factura con el talonario».",
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
          { t: "Para pedir mercadería, tocá «Solicitar reposición» y cargá qué necesitás.", marca: "Solicitar reposición" },
          { t: "Para mandar algo que la otra sucursal no tiene, sin que te lo pidan, tocá «Enviar a otra sucursal».", d: "No hace falta aprobarlo: queda listo para despachar.", marca: "Enviar a otra sucursal" },
          { t: "«Remisiones realizadas» son las que mandaste o pediste vos.", marca: "Remisiones realizadas" },
          { t: "«Remisiones recibidas» son las que te llegan a vos.", marca: "Remisiones recibidas" },
          { t: "Tocá «Ver» en una fila para despacharla, recibirla o imprimir su nota de remisión." },
        ],
      },
      {
        consejo:
          "El stock se mueve de verdad recién cuando la sucursal que recibe la marca como recibida. Mientras tanto la mercadería figura en viaje, que es lo que pasa en la realidad.",
      },
    ],
  },

  // ── Caja y ventas: lo nuevo ──────────────────────────────────────────────
  {
    id: "factura-caja",
    grupo: "Caja y ventas",
    titulo: "Imprimir la factura del talonario",
    resumen: "Factura o solo ticket, y cómo sale sobre la hoja preimpresa.",
    bloques: [
      {
        img: "venta-nueva",
        alt: "Nueva venta con la opción de factura",
        texto: "La factura se imprime sobre el talonario de imprenta: el sistema escribe solo los datos de la venta en su lugar (fecha, cliente, productos y totales).",
        pasos: [
          { t: "Cargá la venta como siempre: cliente, productos y contado o crédito.", marca: "Cliente" },
          { t: "En «Documento», dejá elegida «Factura».", d: "Si el cliente no pide factura, elegí «Solo ticket».", marca: "Factura" },
          { t: "Sin cliente, la factura sale a nombre de SIN NOMBRE.", d: "Si el cliente quiere su factura con RUC, buscalo o crealo antes de confirmar.", marca: "Crear cliente" },
          { t: "Tocá «Confirmar venta».", d: "El sistema le pone a la factura el próximo número del talonario." },
          { t: "Se abre la hoja para imprimir.", d: "Poné en la impresora la próxima hoja del talonario y mandá a imprimir." },
        ],
      },
      {
        ojo:
          "El sistema anota en la venta el número que sigue en el talonario. Fijate que la hoja que ponés en la impresora sea justo la siguiente: si te salteás una, los números de la venta y del papel dejan de coincidir.",
      },
    ],
  },
  {
    id: "sobrantes",
    grupo: "Caja y ventas",
    titulo: "Sobrantes y faltantes",
    resumen: "Cuando no se da el vuelto o se acepta de menos.",
    bloques: [
      {
        img: "venta-nueva",
        alt: "Nueva venta",
        texto: "A veces el cliente paga en efectivo y no se le da el vuelto (sobra plata), o paga un poco menos y se acepta (falta). Esa diferencia se registra en la misma venta.",
        pasos: [
          { t: "Cobrá en efectivo y escribí cuánto te entregó el cliente.", d: "El sistema calcula el vuelto." },
          { t: "Si no vas a dar ese vuelto, o aceptás de menos, tildá la opción que aparece debajo del vuelto.", d: "Así la diferencia queda registrada y la caja cierra bien." },
          { t: "Confirmá la venta." },
        ],
      },
      {
        img: "caja-sobrantes",
        alt: "Tarjeta de sobrantes y faltantes en la caja",
        pasos: [
          { t: "En Caja, la tarjeta «Sobrantes y faltantes» junta todas las diferencias del período.", d: "Arriba a la derecha: cuánto sobró, cuánto faltó y el saldo.", marca: "Sobrantes y faltantes" },
          { t: "Tocala para ver el detalle de cada venta y cambiar las fechas." },
        ],
      },
      {
        consejo:
          "Cada diferencia también se asienta en la contabilidad, contra las cuentas de Sobrantes y Faltantes de caja. Esas cuentas se eligen en Contabilidad → Configuración contable.",
      },
    ],
  },

  // ── Inventario: lo nuevo ─────────────────────────────────────────────────
  {
    id: "depositos",
    grupo: "Inventario",
    titulo: "Depósitos: qué hay en cada uno",
    resumen: "El stock por depósito y cómo pasar mercadería de uno a otro.",
    bloques: [
      {
        img: "depositos",
        alt: "Depósitos",
        pasos: [
          { t: "Arriba elegí el depósito que querés mirar.", marca: "DEP-01" },
          { t: "Abajo está el stock de cada producto en ese depósito." },
          { t: "Para mover mercadería a otro depósito de la misma sucursal, tocá «Transferir» en la fila del producto.", d: "Elegís a qué depósito va y cuánto.", marca: "Transferir" },
          { t: "Las últimas transferencias quedan listadas al pie." },
        ],
      },
      {
        consejo:
          "Transferir entre depósitos no cambia el stock total del producto: lo cambia de lugar. Para mandar mercadería a OTRA sucursal se usa Transferencias entre sucursales.",
      },
    ],
  },
  {
    id: "reposicion",
    grupo: "Inventario",
    titulo: "Qué conviene comprar",
    resumen: "Reposición: cuánto se vendió, cuánto queda y cuánto pedir.",
    bloques: [
      {
        img: "reposicion",
        alt: "Reposición",
        pasos: [
          { t: "Arriba elegí cuántos días mirar para atrás y para cuántos días querés tener stock.", d: "Por ejemplo: lo vendido en los últimos 60 días, para tener stock para 30.", marca: "Analizar los últimos" },
          { t: "Las tarjetas dicen cuántos productos están sin stock, críticos y bajos, y cuánto costaría reponer." },
          { t: "En la tabla, la columna «Comprar» es la cantidad sugerida de cada producto." },
          { t: "«Actualizar todos» recalcula el stock mínimo de cada producto según lo que se vendió.", d: "Usa la mediana de los últimos meses: una venta grande de una sola vez no infla el mínimo.", marca: "Actualizar todos" },
        ],
      },
      {
        consejo:
          "Reposición mira lo que se vende. Bajo mínimo mira el mínimo cargado en la ficha. Un artículo que no se vende hace meses aparece en Bajo mínimo y no acá.",
      },
    ],
  },

  // ── Compras y pagos: lo nuevo ────────────────────────────────────────────
  {
    id: "cotizaciones",
    grupo: "Compras y pagos",
    titulo: "Comparar precios de proveedores",
    resumen: "Pedir el mismo listado a varios proveedores y elegir.",
    bloques: [
      {
        img: "cotizaciones",
        alt: "Comparativo de cotizaciones",
        pasos: [
          { t: "Tocá «Pedir cotización» y armá el listado de artículos y cantidades.", d: "Elegí a qué proveedores se lo pedís.", marca: "Pedir cotización" },
          { t: "Cuando contestan, abrí la cotización y tocá «Cargar precios».", d: "Cargás lo que pasó cada proveedor.", marca: "Cargar precios" },
          { t: "La tabla pone a los proveedores lado a lado y marca el mejor precio de cada artículo." },
          { t: "Al pie de cada proveedor, «Orden» arma la orden de compra con lo que le vas a comprar a él." },
        ],
      },
      {
        ojo:
          "El total más bajo engaña si el proveedor no cotizó todo: el que pasó dos precios de diez siempre parece el más barato. Mirá cuántos artículos cotizó cada uno.",
      },
    ],
  },

  // ── Presupuestos: lo nuevo ───────────────────────────────────────────────
  {
    id: "presupuesto-reservar",
    grupo: "Presupuestos",
    titulo: "Reservar la mercadería de un presupuesto",
    resumen: "Apartar el stock para que no se lo coticen a otro.",
    bloques: [
      {
        img: "presupuestos",
        alt: "Listado de presupuestos",
        pasos: [
          { t: "Abrí el presupuesto." },
          { t: "Tocá «Reservar mercadería».", d: "Esas cantidades quedan apartadas: no se pueden cotizar en otro presupuesto." },
          { t: "El botón pasa a decir «Reservado», con quién lo reservó." },
        ],
      },
      {
        ojo:
          "Reservar puede cualquiera; quitar la reserva, solo un administrador. Si el cliente no vuelve, pedile a un administrador que la quite para liberar el stock.",
      },
      {
        consejo:
          "Un usuario normal solo puede presupuestar al contado, salvo que el cliente esté habilitado para crédito, y no puede presupuestar sin stock: eso lo hace un administrador.",
      },
    ],
  },

  // ── Clientes: lo nuevo ───────────────────────────────────────────────────
  {
    id: "gestion-cliente",
    grupo: "Clientes",
    titulo: "Atender a un cliente",
    resumen: "Gestión Clientes: su ficha, lo que debe y cobrarle, en una pantalla.",
    bloques: [
      {
        img: "gestion-buscar",
        alt: "Gestión del cliente, buscador",
        pasos: [
          { t: "Escribí el nombre, el RUC, el teléfono o el código.", d: "Un solo buscador cubre todo. Si hay muchos resultados, bajá en la lista para ver más.", marca: "Buscar cliente" },
          { t: "Tocá el cliente en la lista." },
        ],
      },
      {
        img: "gestion-cliente",
        alt: "Ficha del cliente en gestión",
        pasos: [
          { t: "Arriba están sus datos: RUC, contacto, ciudad y condición." },
          { t: "«Tipificación» registra el motivo del contacto: un reclamo, una consulta, un pedido.", marca: "Tipificación" },
          { t: "«Historial cliente» muestra todo lo que pasó con él.", marca: "Historial cliente" },
          { t: "En «Estado de cuenta» están sus facturas: pendientes, vencidas y pagadas.", marca: "Estado de cuenta" },
          { t: "En cada factura pendiente, «Cobrar» registra el pago.", d: "Es el mismo formulario que en Pagos → Cobros a clientes." },
          { t: "«Descargar» saca el estado de cuenta para mandárselo.", marca: "Descargar" },
        ],
      },
    ],
  },

  // ── Informes: lo nuevo ───────────────────────────────────────────────────
  {
    id: "rentabilidad",
    grupo: "Informes",
    titulo: "Qué productos dejan más ganancia",
    resumen: "Rentabilidad por producto y por rubro.",
    bloques: [
      {
        img: "rentabilidad",
        alt: "Rentabilidad",
        pasos: [
          { t: "Elegí si querés verlo por producto o por rubro.", marca: "Por rubro" },
          { t: "Elegí el período: día, semana, mes, trimestre, año o un rango." },
          { t: "Las tarjetas dicen cuánto se facturó, cuánto costó lo vendido, la ganancia y el margen." },
          { t: "En la tabla, tocá el título de una columna para ordenar.", d: "Por ganancia ves qué producto aporta más plata; por margen, cuál deja más por cada venta." },
          { t: "«Exportar Excel» o «Imprimir» sacan lo que estás viendo.", marca: "Exportar Excel" },
        ],
      },
      {
        consejo:
          "Margen alto con poca venta deja menos plata que margen bajo con mucha venta. Para eso está la columna «Partic.»: qué parte de la ganancia total aporta cada producto.",
      },
    ],
  },
  {
    id: "modificaciones",
    grupo: "Informes",
    titulo: "Quién anuló o cambió algo",
    resumen: "Modificaciones administrativas: anulaciones, ediciones y cajas reabiertas.",
    bloques: [
      {
        img: "modificaciones",
        alt: "Modificaciones administrativas",
        pasos: [
          { t: "En Reportes, entrá a «Modificaciones administrativas»." },
          { t: "Poné el período y, si querés, el módulo.", marca: "Módulo" },
          { t: "Cada fila dice qué se tocó, quién lo hizo y cuándo.", d: "El detalle completo de cada cambio sigue en el historial de su módulo." },
        ],
      },
      {
        consejo:
          "Lo normal es que esta lista esté casi vacía: anular ventas o reabrir cajas no debería pasar todos los días. Si se llena, conviene preguntar por qué.",
      },
    ],
  },
  {
    id: "otros-informes",
    grupo: "Informes",
    titulo: "Los demás informes",
    resumen: "Qué contesta cada informe de Reportes.",
    bloques: [
      {
        img: "reportes",
        alt: "Reportes",
        texto: "Todos están en Reportes. Cada uno se filtra por fecha y se saca a Excel o se imprime.",
        pasos: [
          { t: "Ventas y Vendedores: cuánto se vendió y quién lo vendió." },
          { t: "Compras y Proveedores: qué se compró y a quién se le debe." },
          { t: "Estado de cuenta: lo que debe cada cliente, con el detalle de sus facturas." },
          { t: "Ingresos y egresos, y Tesorería: la plata que entró y salió de las cajas y bancos." },
          { t: "Gastos no deducibles: los gastos que no sirven para el IVA, para revisarlos antes del cierre." },
        ],
      },
    ],
  },

  // ── Contabilidad ─────────────────────────────────────────────────────────
  {
    id: "libro-diario",
    grupo: "Contabilidad",
    titulo: "El libro diario y el mayor",
    resumen: "Los asientos que hace el sistema, y el saldo de cada cuenta.",
    bloques: [
      {
        img: "libro-diario",
        alt: "Libro diario",
        pasos: [
          { t: "Poné el período.", marca: "Desde" },
          { t: "Si querés, filtrá por cuenta, por origen o por estado." },
          { t: "Tocá «Aplicar».", marca: "Aplicar" },
          { t: "Cada asiento muestra su cuenta, el debe y el haber.", d: "«Exportar Excel» lo saca para el contador.", marca: "Exportar Excel" },
          { t: "El libro mayor (Contabilidad → Libro mayor) muestra lo mismo agrupado por cuenta, con el saldo." },
        ],
      },
      {
        consejo:
          "Los asientos los hace el sistema solo: por ahora, los de compras, gastos y servicios, y los sobrantes y faltantes de caja. Para que salgan, las cuentas tienen que estar elegidas en la Configuración contable.",
      },
    ],
  },
  {
    id: "libro-compras",
    grupo: "Contabilidad",
    titulo: "El libro de compras",
    resumen: "Las facturas de proveedores y gastos, para el IVA.",
    bloques: [
      {
        img: "libro-ventas",
        alt: "Libro de ventas (el de compras es igual)",
        texto: "El libro de compras está en Contabilidad → Libro de compras y funciona igual que el de ventas.",
        pasos: [
          { t: "Poné el período." },
          { t: "Las columnas separan exento, gravado al 5 y gravado al 10, con su IVA." },
          { t: "«Exportar Excel» y se lo mandás al contador." },
        ],
      },
      {
        ojo:
          "Una compra o un gasto sin RUC, timbrado y número de factura no sirve para el crédito fiscal. Si falta alguno, completalo en la compra antes de cerrar el mes.",
      },
    ],
  },
  {
    id: "plan-cuentas",
    grupo: "Contabilidad",
    titulo: "El plan de cuentas",
    resumen: "Las cuentas contables y cómo agregar una.",
    bloques: [
      {
        img: "plan-cuentas",
        alt: "Plan de cuentas",
        pasos: [
          { t: "Las cuentas están en árbol: Activo, Pasivo, Patrimonio, Ingresos y Egresos.", d: "Tocá la flecha de cada una para abrirla." },
          { t: "Para agregar una cuenta, tocá «Nueva cuenta».", d: "Elegís de qué cuenta cuelga, el código y el nombre.", marca: "Nueva cuenta" },
          { t: "Si el contador te pasa el plan en Excel, «Importar plan de cuentas» lo carga entero.", marca: "Importar plan de cuentas" },
        ],
      },
      {
        ojo:
          "Solo las cuentas «asentables» reciben movimientos. Las agrupadoras (Activo, Caja y Bancos…) suman lo de abajo. Si necesitás una cuenta para los asientos, creala asentable debajo de la que corresponda.",
      },
    ],
  },
  {
    id: "config-contable",
    grupo: "Contabilidad",
    titulo: "Las cuentas de los asientos automáticos",
    resumen: "Qué cuenta usa el sistema para el IVA, la caja, los proveedores y las ventas.",
    bloques: [
      {
        img: "config-contable",
        alt: "Configuración contable",
        pasos: [
          { t: "En cada casilla elegí la cuenta que corresponde.", d: "Por ejemplo, en «Cuenta predeterminada de Caja», la cuenta Caja del plan.", marca: "Cuenta predeterminada de Caja" },
          { t: "Más abajo están las cuentas de ventas y la sección «Sobrantes y faltantes de caja».", d: "Ahí van la cuenta de ingreso por sobrantes y la de pérdida por faltantes." },
          { t: "Tocá «Guardar configuración»." },
        ],
      },
      {
        consejo:
          "Una casilla vacía no rompe nada: el asiento de ese tipo simplemente no se hace. Al completar las de sobrantes y faltantes, el sistema asienta solo las diferencias que habían quedado pendientes.",
      },
    ],
  },
  {
    id: "punto-equilibrio",
    grupo: "Contabilidad",
    titulo: "Cuánto hay que vender para no perder",
    resumen: "El punto de equilibrio del mes.",
    bloques: [
      {
        img: "punto-equilibrio",
        alt: "Punto de equilibrio",
        pasos: [
          { t: "Elegí el mes y el año." },
          { t: "Arriba dice cuánto hay que vender en el mes para cubrir los gastos, y cuánto va vendido." },
          { t: "Abajo explica de dónde sale: el margen y los gastos del mes anterior." },
          { t: "Si el mes pasado fue raro, cambiá el margen o los gastos a mano y el objetivo se recalcula.", marca: "Margen a usar" },
        ],
      },
      {
        ojo:
          "El costo de lo vendido es una estimación con el costo promedio de hoy. Si el margen que ves no es el que conocés, corregilo: todo el objetivo depende de ese número.",
      },
    ],
  },

  // ── Personal: lo nuevo ───────────────────────────────────────────────────
  {
    id: "amonestaciones",
    grupo: "Personal",
    titulo: "Amonestaciones y observaciones",
    resumen: "Llamadas de atención, suspensiones y reconocimientos, en la ficha.",
    bloques: [
      {
        img: "rrhh-novedades",
        alt: "Amonestaciones y observaciones del empleado",
        pasos: [
          { t: "Abrí la ficha del empleado y entrá a la pestaña «Amonestaciones y observaciones».", marca: "Amonestaciones y observaciones" },
          { t: "Tocá «Registrar».", marca: "Registrar" },
          { t: "Elegí el tipo: observación, llamada de atención, amonestación, suspensión o reconocimiento.", marca: "Amonestación" },
          { t: "Poné la fecha, el motivo y el detalle (qué pasó, testigos).", marca: "Motivo" },
          { t: "Tocá el botón de registrar.", d: "Lo que va por escrito trae su hoja para imprimir y firmar.", marca: "Registrar amonestación" },
        ],
      },
      {
        consejo:
          "Cuando vuelve la hoja firmada, marcala como firmada en el historial. Arriba queda el resumen de los últimos 12 meses por tipo; tocá un tipo para filtrar.",
      },
    ],
  },
  {
    id: "tipos-empleado",
    grupo: "Personal",
    titulo: "Tipos de empleado y departamentos",
    resumen: "Los catálogos que se eligen en la ficha de cada empleado.",
    bloques: [
      {
        img: "tipos-empleado",
        alt: "Tipos de empleado",
        texto: "Están en RRHH → Config · Tipos de empleado (y Config · Departamentos, que funciona igual).",
        pasos: [
          { t: "Escribí el nombre del tipo nuevo: gerente, ventas, chofer.", marca: "Nombre" },
          { t: "Tocá «+ Agregar».", marca: "+ Agregar" },
          { t: "Después, en la ficha del empleado, lo elegís en «Datos y horario»." },
        ],
      },
      {
        consejo:
          "Si es mensualero o jornalero se elige en la ficha del empleado, junto al salario: eso es cómo se le paga, no el tipo de puesto.",
      },
    ],
  },

  // ── Administración: lo nuevo ─────────────────────────────────────────────
  {
    id: "roles-descuento",
    grupo: "Administración",
    titulo: "Hasta cuánto puede descontar cada uno",
    resumen: "El tope de descuento en Caja y el rol de RRHH de cada usuario.",
    bloques: [
      {
        img: "roles-descuento",
        alt: "Usuarios y roles",
        texto: "Está en Configuración → RRHH · Usuarios y roles.",
        pasos: [
          { t: "En «Rol RRHH» elegí qué puede hacer cada uno en Personal.", d: "Empleado ve lo suyo; Admin RRHH maneja todo.", marca: "Rol RRHH" },
          { t: "En «Desc. máx.» tocá el porcentaje de la persona y escribí su tope.", d: "Vacío es «sin tope» y 0 es «no puede descontar».", marca: "Desc. máx." },
        ],
      },
      {
        ojo:
          "Si un artículo o su rubro tienen su propio tope, en la caja vale el más chico de los dos. Un descuento más grande se le pide a un administrador desde la venta.",
      },
    ],
  },
  {
    id: "factura-talonario",
    grupo: "Administración",
    titulo: "Alinear la factura con el talonario",
    resumen: "Dónde cae cada dato sobre la hoja preimpresa.",
    bloques: [
      {
        img: "factura-papel",
        alt: "Papel de la factura",
        texto: "Está en Configuración → Facturación, en «Papel de la factura». Se hace una vez, con la impresora que se va a usar.",
        pasos: [
          { t: "Dejá elegido «Talonario preimpreso (imprenta)».", d: "El talonario ya trae timbrado, RUC y número: el sistema escribe solo los datos de la venta." },
          { t: "Las posiciones están en milímetros desde la esquina de arriba a la izquierda de la hoja." },
        ],
      },
      {
        img: "factura-posiciones",
        alt: "Posiciones de la factura",
        pasos: [
          { t: "Tocá «Imprimir hoja de prueba» y pasala sobre una factura en blanco (o encimala a contraluz).", d: "Cada dato sale con una cruz roja en su punto.", marca: "Imprimir hoja de prueba" },
          { t: "Si todo sale corrido igual, corregí el «Corrimiento general».", d: "Por ejemplo, si todo cae 2 mm más abajo, poné -2 en y.", marca: "Corrimiento general" },
          { t: "Si se corrió un dato solo, corregí ese.", d: "En los importes, la posición es el borde derecho del número." },
          { t: "Tocá «Guardar papel y posiciones» y volvé a imprimir la prueba hasta que caiga justo.", marca: "Guardar papel y posiciones" },
        ],
      },
      {
        ojo:
          "La hoja de prueba usa lo último GUARDADO. Si cambiaste un número, guardá antes de imprimirla.",
      },
    ],
  },

  // ── Lo que faltaba ───────────────────────────────────────────────────────
  {
    id: "precios-deposito",
    grupo: "Inventario",
    titulo: "Un precio distinto en un depósito",
    resumen: "Precios por depósito: la excepción a la lista para un depósito.",
    bloques: [
      {
        img: "precios-deposito",
        alt: "Precios por depósito",
        texto: "El precio normal de cada producto es el de la lista. Acá se carga la excepción: lo que se cobra en un depósito en particular. La caja usa ese precio cuando se vende desde ese depósito.",
        pasos: [
          { t: "Elegí el depósito.", marca: "Depósito" },
          { t: "Buscá el producto por nombre o código.", marca: "Buscar" },
          { t: "Tocá «Poner precio» en su fila y escribí el precio para ese depósito.", d: "La columna «Dif.» muestra cuánto se aparta de la lista.", marca: "Poner precio" },
          { t: "Tildá «Solo los que tienen precio propio» para ver todas las excepciones juntas." },
        ],
      },
      {
        ojo:
          "Si después cambiás el precio de lista, el del depósito NO se mueve solo: es una excepción fija. Revisalas cuando hagas un estudio de precios.",
      },
    ],
  },
  {
    id: "ubicaciones",
    grupo: "Inventario",
    titulo: "Crear un depósito o una ubicación",
    resumen: "Depósitos, salones, estantes: dónde se guarda cada cosa.",
    bloques: [
      {
        img: "ubicaciones",
        alt: "Depósitos y ubicaciones",
        pasos: [
          { t: "Escribí el nombre del lugar: «Depósito central», «Salón», «Estante 3».", marca: "Nombre" },
          { t: "Elegí la sucursal a la que pertenece.", marca: "Sucursal" },
          { t: "Si está adentro de otro lugar (un estante dentro de un depósito), elegilo en «Ubicación padre».", marca: "Ubicación padre" },
          { t: "Tocá «Crear ubicación».", marca: "Crear ubicación" },
        ],
      },
      {
        consejo:
          "Cada depósito tiene su propio stock. Lo que hay en cada uno se ve en Inventario → Depósitos, y ahí mismo se pasa mercadería de uno a otro.",
      },
    ],
  },
  {
    id: "rubros-cliente",
    grupo: "Clientes",
    titulo: "Rubros de cliente y su precio",
    resumen: "Mayorista, minorista, frecuente: el porcentaje sobre la lista y el mínimo de compra.",
    bloques: [
      {
        img: "rubros-cliente",
        alt: "Rubros de cliente",
        texto: "Está en Configuración → Rubros de cliente. Cada rubro tiene un porcentaje sobre el precio de lista: al elegir un cliente en la caja o en un presupuesto, el precio se ajusta solo.",
        pasos: [
          { t: "Escribí el nombre del rubro nuevo.", marca: "Nombre" },
          { t: "Poné el porcentaje sobre la lista.", d: "Con signo: -8 es 8% menos que la lista, 5 es 5% más. Vacío o 0 es precio de lista.", marca: "% sobre lista" },
          { t: "Tocá «Crear rubro».", marca: "Crear rubro" },
          { t: "Para cambiar uno, tocá «Editar» en su fila.", d: "Ahí también se carga el mínimo mensual de compra.", marca: "Editar" },
        ],
      },
      {
        consejo:
          "Con mínimo mensual, el rubro se asigna solo: se suma lo que el cliente compró en el mes y le toca el rubro más alto que alcanza. Un rubro con el mínimo vacío se asigna a mano y el automático no lo toca: es para los acuerdos particulares.",
      },
    ],
  },
  {
    id: "clientes-categorias",
    grupo: "Clientes",
    titulo: "Por qué un cliente cambió de rubro",
    resumen: "El historial de cambios de rubro y quién dejó de comprar.",
    bloques: [
      {
        img: "clientes-categorias",
        alt: "Categorías de cliente",
        pasos: [
          { t: "Buscá un cliente, o dejalo vacío para ver a todos.", marca: "Cliente" },
          { t: "Cada fila dice en qué fecha cambió, de qué rubro a cuál, y cuánto compró ese mes." },
          { t: "Filtrá por el rubro en que quedó, si buscás a todos los que pasaron a mayorista, por ejemplo.", marca: "Quedó en" },
          { t: "«No compra» lista a los que tenían rubro y este mes no compraron nada.", marca: "No compra" },
        ],
      },
      {
        consejo:
          "El rubro sube apenas se cierra la venta que cruza el mínimo, y baja en el recálculo de fin de mes. «Recalcular» lo hace en el momento, si cambiaste los mínimos.",
      },
    ],
  },
  {
    id: "planes",
    grupo: "Clientes",
    titulo: "Planes",
    resumen: "Los servicios que se cobran todos los meses.",
    bloques: [
      {
        img: "planes",
        alt: "Planes",
        texto: "Un plan es un servicio con precio fijo que se cobra cada mes (o cada año): por ejemplo, un mantenimiento. Si el negocio no vende servicios así, esta pantalla no hace falta.",
        pasos: [
          { t: "Tocá «Nuevo plan».", marca: "Nuevo plan" },
          { t: "Poné el nombre, el precio y cada cuánto se cobra." },
          { t: "Para cambiar uno, usá el lápiz de su fila.", marca: "Editar" },
        ],
      },
    ],
  },
  {
    id: "rrhh-config",
    grupo: "Personal",
    titulo: "Vacaciones según la ley y salario mínimo",
    resumen: "La política de vacaciones y el salario mínimo para el IPS.",
    bloques: [
      {
        img: "rrhh-politica-vacaciones",
        alt: "Política de vacaciones",
        texto: "En RRHH → Config · Política de vacaciones está lo que dice la ley (12, 18 o 30 días hábiles según la antigüedad). Eso no se cambia: el sistema lo aplica solo.",
        pasos: [
          { t: "Lo único que decide la empresa es si se pueden adelantar vacaciones.", d: "Tildado, se pueden registrar más días de los disponibles; por ejemplo, antes del primer año.", marca: "Permitir adelantar vacaciones" },
          { t: "Tocá «Guardar».", marca: "Guardar" },
        ],
      },
      {
        img: "rrhh-salario-minimo",
        alt: "Salario mínimo",
        pasos: [
          { t: "En RRHH → Config · Salario mínimo, escribí el salario mínimo vigente.", d: "Es lo que se le declara al IPS por los empleados marcados «sobre el mínimo».", marca: "Salario mínimo mensual" },
          { t: "Poné desde cuándo rige.", marca: "Vigente desde" },
          { t: "Tocá «Guardar».", marca: "Guardar" },
        ],
      },
      {
        ojo:
          "El salario mínimo no viene cargado a propósito: lo fija un decreto y cambia. Cuando suba, cambialo acá y todos los empleados marcados «sobre el mínimo» quedan al día solos.",
      },
    ],
  },

  // ── Omnicanal ──────────────────────────────────────────────────────────
  {
    id: "omni-que-es",
    grupo: "Omnicanal",
    titulo: "Qué es Omnicanal",
    resumen: "Todos los WhatsApp del negocio en una sola bandeja.",
    bloques: [
      {
        texto:
          "Hoy la empresa tiene seis números de WhatsApp. Sin esto, cada uno vive en el celular de alguien: el que no está ese día se lleva los mensajes puestos, y nadie sabe qué quedó sin contestar.",
      },
      {
        img: "conversaciones",
        alt: "Bandeja de conversaciones",
        pasos: [
          { t: "Los seis números entran a la misma bandeja.", d: "Desde la computadora o desde la aplicación del celular corporativo." },
          { t: "Cada chat dice por qué número entró.", d: "El cliente le sigue escribiendo al número de siempre; cambia dónde se contesta." },
          { t: "Se ve cuáles quedaron sin responder.", d: "Eso es lo que no se puede ver cuando cada número está en un celular aparte." },
        ],
      },
      {
        consejo:
          "La configuración va en orden: primero el canal (el número), después la cola (a quién le toca), después los agentes de esa cola, y recién ahí los supervisores. Cada paso tiene su guía acá abajo.",
      },
    ],
  },
  {
    id: "omni-bandeja",
    grupo: "Omnicanal",
    titulo: "Atender la bandeja",
    resumen: "Ver lo que falta contestar y responder.",
    bloques: [
      {
        img: "conversaciones",
        alt: "Bandeja de conversaciones",
        pasos: [
          { t: "Arrancá por «Sin responder».", d: "Son los chats donde el último que habló fue el cliente.", marca: "Sin responder" },
          { t: "Tocá un chat de la lista y la conversación se abre a la derecha." },
          { t: "Escribí abajo y mandá. Le llega por WhatsApp, al número por el que escribió." },
          { t: "Si querés escribirle vos primero a alguien, «Nuevo chat».", marca: "Nuevo chat" },
          { t: "Con «Todos los canales» filtrás por número.", d: "Útil si un número es de ventas y otro de cobranzas.", marca: "Todos los canales" },
        ],
      },
      {
        ojo:
          "Abrir un chat lo marca como leído para todos. Si lo abrís para mirar y no lo vas a contestar, para el resto ya figura visto.",
      },
    ],
  },
  {
    id: "omni-canales",
    grupo: "Omnicanal",
    titulo: "Los números conectados",
    resumen: "Qué WhatsApp entra a la bandeja y cómo agregar otro.",
    bloques: [
      {
        img: "omni-canales",
        alt: "Canales y comunicación",
        texto: "Cada número es una fila. Hoy hay seis WhatsApp conectados; Facebook, Instagram, LinkedIn y correo están disponibles pero sin configurar.",
        pasos: [
          { t: "Abajo, en la lista de WhatsApp, está cada número con su estado." },
          { t: "La tilde «Operativo» es la que decide si ese número entra a la bandeja o no." },
          { t: "Para sumar otro número, «Agregar WhatsApp».", marca: "Agregar WhatsApp" },
          { t: "Para conectar otro tipo de canal, «Conectar canal».", marca: "Conectar canal" },
        ],
      },
      {
        consejo:
          "Cuando un número deja de usarse, destildá «Operativo» en vez de borrarlo. Borrándolo se pierden las conversaciones que entraron por ahí.",
      },
    ],
  },
  {
    id: "omni-colas",
    grupo: "Omnicanal",
    titulo: "Las colas",
    resumen: "A quién le toca cada chat.",
    bloques: [
      {
        img: "omni-colas",
        alt: "Colas y enrutamiento",
        texto:
          "Una cola es un grupo de gente que atiende lo mismo —ventas, cobranzas, posventa— y los números que le corresponden.",
        pasos: [
          { t: "Tocá «Nueva cola» y ponele nombre.", marca: "Nueva cola" },
          { t: "Elegí qué números entran a esa cola." },
          { t: "Agregá los agentes que la atienden." },
          { t: "Elegí cómo se reparten los chats entre ellos." },
        ],
      },
      {
        ojo:
          "Hoy no hay ninguna cola creada: por eso en la bandeja todos los chats figuran «Sin cola». Funciona igual —se ven y se contestan todos—, pero no hay reparto: nadie tiene asignado lo suyo, y entonces todos miran todo o nadie mira nada. Es lo primero que conviene armar.",
      },
    ],
  },
  {
    id: "omni-equipos",
    grupo: "Omnicanal",
    titulo: "Supervisores",
    resumen: "Quién puede ver el trabajo de quién.",
    bloques: [
      {
        img: "omni-equipos",
        alt: "Equipos y supervisión",
        pasos: [
          { t: "Elegí el supervisor.", marca: "Supervisor" },
          { t: "Elegí el agente que va a tener a cargo.", marca: "Agente a cargo" },
          { t: "Tocá «Asignar agente al supervisor».", marca: "Asignar agente al supervisor" },
        ],
      },
      {
        ojo:
          "Esta pantalla solo ofrece gente que cumple dos condiciones: el supervisor tiene que tener nivel de acceso Supervisor en Usuarios, y el agente tiene que tener nivel Usuario Y estar en alguna cola. Si la lista aparece vacía, falta una de las dos cosas: no es un error de la pantalla.",
      },
    ],
  },
  {
    id: "omni-horarios",
    grupo: "Omnicanal",
    titulo: "Horarios de atención",
    resumen: "En qué franja atiende cada asesor.",
    bloques: [
      {
        img: "omni-horarios",
        alt: "Horarios de trabajo omnicanal",
        pasos: [
          { t: "Ponele nombre a la franja.", d: "«Mañana», «Tarde», «Sábado».", marca: "Nombre" },
          { t: "Marcá los días y poné la hora de inicio y de fin.", marca: "Inicio" },
          { t: "Tocá «Crear horario».", marca: "Crear horario" },
          { t: "Después, en Usuarios, le asignás el horario a cada asesor." },
        ],
      },
      {
        consejo:
          "Sirve para dos cosas: saber quién está en turno cuando entra un mensaje, y medir los tiempos de respuesta contra el horario real y no contra las 24 horas del día.",
      },
    ],
  },
  {
    id: "omni-flujos",
    grupo: "Omnicanal",
    titulo: "El bot que contesta primero",
    resumen: "El menú automático antes de que atienda una persona.",
    bloques: [
      {
        img: "omni-flujos",
        alt: "Flujos conversacionales",
        pasos: [
          { t: "Tocá «Crear flujo» y ponele nombre.", marca: "Crear flujo" },
          { t: "Armá el menú: la pregunta y las opciones que va a ver el cliente." },
          { t: "Decidí a qué cola va a parar según lo que elija." },
        ],
      },
      {
        consejo:
          "Conviene que sea corto: dos o tres opciones y que pase a una persona. Un menú largo hace que el cliente escriba «quiero hablar con alguien» y se perdió el tiempo de los dos.",
      },
    ],
  },
  {
    id: "omni-celular",
    grupo: "Omnicanal",
    titulo: "La aplicación del asesor",
    resumen: "La misma bandeja en el celular corporativo.",
    bloques: [
      {
        img: "conversaciones",
        alt: "Bandeja de conversaciones",
        texto:
          "Los asesores tienen la bandeja en una aplicación instalada en el corporativo. Es la misma información: lo que contestan desde el celular se ve en la computadora y al revés.",
        pasos: [
          { t: "Entran con el mismo usuario y la misma contraseña del sistema." },
          { t: "Les llega un aviso al celular cuando entra un mensaje.", d: "No hace falta tener la aplicación abierta." },
          { t: "Ven los chats que les corresponden según su cola." },
        ],
      },
      {
        ojo:
          "Mientras no haya colas armadas, cada asesor ve todas las conversaciones de la empresa. Es otra razón para armarlas.",
      },
    ],
  },
];

/**
 * QUÉ MÓDULO HAY QUE TENER PARA VER CADA GUÍA.
 *
 * El Manual muestra solo las guías de las pantallas a las que el usuario
 * puede entrar, con la misma regla que el menú (módulos asignados + techo del
 * rol). Una guía de una pantalla que no ve solo confunde: busca el botón y no
 * está.
 *
 * Se decide por tema y se corrige por guía donde el tema mezcla módulos (en
 * «Compras y pagos» hay Compras, Proveedores y Pagos, que se asignan por
 * separado). `null` = la ve todo el mundo. Una lista = alcanza con uno.
 */
const MODULO_POR_GRUPO: Record<string, string | string[] | null> = {
  "Primeros pasos": null,
  "Caja y ventas": "ventas",
  Inventario: "inventario",
  "Compras y pagos": "compras",
  Presupuestos: "presupuestos",
  Clientes: "clientes",
  "Gastos y bancos": "pagos",
  Informes: "reportes",
  Contabilidad: "contabilidad",
  Personal: "rrhh",
  "Administración": "configuracion",
  Omnicanal: "conversaciones",
};

const MODULO_POR_GUIA: Record<string, string | string[] | null> = {
  proveedor: "proveedores",
  "rubros-proveedores": "proveedores",
  "pagar-proveedor": "pagos",
  "cobrar-cliente": "pagos",
  crm: "crm",
  "gestion-cliente": "gestion-clientes",
  "gasto-nuevo": "gastos",
  "tipos-cambio": "compras",
  "cierres-caja": ["reportes", "cierres-caja"],
  comisiones: "comisiones",
  "estudio-precios": "inventario",
  "usuario-nuevo": "usuarios",
  "roles-descuento": ["usuarios", "configuracion"],
  sucursales: "sucursales",
  transferencias: "reposicion",
  planes: "planes",
  "rubros-cliente": "configuracion",
};

/** Los módulos que habilitan una guía (alcanza con uno), o null si es para todos. */
export function modulosDeGuia(g: Guia): string[] | null {
  const m = g.id in MODULO_POR_GUIA ? MODULO_POR_GUIA[g.id] : MODULO_POR_GRUPO[g.grupo] ?? null;
  if (m == null) return null;
  return Array.isArray(m) ? m : [m];
}
