/**
 * Lo que se le debe a cada proveedor, ordenado como se paga.
 *
 * ── POR QUÉ SE REESCRIBIÓ ESTA PANTALLA ────────────────────────────────────
 *   "pagos a proveedores se ve raro porque no se entiende."
 *
 *   Tenía razón, y por dos motivos distintos que se tapaban entre sí:
 *
 *   1. ESTABA MEZCLADO CON LOS COBROS. La pantalla de Pagos tenía una tercera
 *      pestaña naranja con las facturas de proveedores, al lado de las cuentas
 *      por cobrar, y las dos tenían un botón que decía "Registrar pago". El
 *      mismo texto para cobrarle a un cliente y para pagarle a un proveedor.
 *
 *   2. EL NÚMERO NO ERA REAL. En la base hay 14.592 facturas a crédito en
 *      estado 'registrada' —o sea, sin pagar— por Gs. 42.355.932.033, y van
 *      de 2019 a 2026 repartidas casi parejo: 706 son de 2019. Nadie le debe
 *      a un proveedor una factura de hace siete años. Lo que pasó es que la
 *      migración no trajo el estado de pago, así que todo entró como impago.
 *
 *      Una pantalla que dice "debés 42 mil millones" y que al abrir un
 *      proveedor despliega 3.050 facturas no se entiende porque no hay nada
 *      que entender ahí. Por eso acá el histórico se separa y se nombra: lo
 *      viejo se cuenta aparte, con el aviso de que es la migración, y la
 *      pantalla muestra la ventana en la que sí se trabaja.
 *
 * ── CÓMO SE ORDENA ─────────────────────────────────────────────────────────
 *   Primero el que tiene algo vencido, de mayor a menor. Es el orden en que se
 *   decide a quién pagarle cuando no alcanza para todos.
 */

export interface FacturaProveedor {
  numero_control: string;
  numero_factura: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string;
  fecha_factura: string | null;
  vencimiento: string | null;
  plazo_dias: number | null;
  estado: string;
  total: number;
  metodo_pago?: string | null;
  referencia_pago?: string | null;
  fecha_pago?: string | null;
  recibo_storage_path?: string | null;
  recibo_nombre?: string | null;
}

export type EstadoFactura = "pagada" | "vencida" | "por_vencer";

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/** Días entre dos fechas ISO (b − a). Ambas son fechas, sin hora. */
export function diasEntre(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Hoy en Paraguay (UTC−3): a las 21:00 la fecha UTC ya es la de mañana. */
export function hoyParaguay(ahora: number = Date.now()): string {
  return new Date(ahora - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Resta días a una fecha ISO. */
export function restarDias(iso: string, dias: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t - dias * 86_400_000).toISOString().slice(0, 10);
}

const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Una fecha que el sistema pueda usar. En la base hay una factura con el año
 * 9858 —un dedazo al cargar— y sin este filtro esa sola fila manda el
 * "próximo vencimiento" de su proveedor al año 9858 y lo deja último para
 * siempre.
 */
export function fechaUsable(iso: string | null | undefined): string | null {
  if (!iso || !FECHA_OK.test(iso)) return null;
  const anio = Number(iso.slice(0, 4));
  return anio >= 2000 && anio <= 2100 ? iso : null;
}

export interface FacturaClasificada extends FacturaProveedor {
  estado_calc: EstadoFactura;
  /** Días hasta el vencimiento. Negativo = vencida hace tantos días. */
  dias: number | null;
  /** Vencimiento, solo si es una fecha creíble. */
  vence: string | null;
}

export function clasificarFactura(f: FacturaProveedor, hoyISO: string): FacturaClasificada {
  const vence = fechaUsable(f.vencimiento);
  const pagada = f.estado === "pagada";
  const dias = vence ? diasEntre(hoyISO, vence) : null;
  return {
    ...f,
    vence,
    dias,
    estado_calc: pagada ? "pagada" : dias != null && dias < 0 ? "vencida" : "por_vencer",
  };
}

export interface ProveedorDeuda {
  proveedor_id: string | null;
  proveedor_nombre: string;
  /** Lo que se debe en la ventana de trabajo. */
  pendiente: number;
  vencido: number;
  por_vencer: number;
  cantidad: number;
  cantidad_vencida: number;
  /** El vencimiento más próximo de lo que está sin pagar. */
  proximo_vencimiento: string | null;
  /** Hace cuántos días venció la más vieja sin pagar. 0 si no hay vencidas. */
  dias_mas_vieja: number;
  /** Las facturas de la ventana, la más urgente primero. */
  facturas: FacturaClasificada[];
  /** Lo anterior a la ventana, contado y no listado. */
  historico_cantidad: number;
  historico_monto: number;
}

export interface ResumenDeuda {
  proveedores: ProveedorDeuda[];
  /** Totales de la ventana de trabajo. */
  pendiente: number;
  vencido: number;
  cantidad: number;
  /** Totales de lo anterior a la ventana, que es casi todo migración. */
  historico_cantidad: number;
  historico_monto: number;
  /** La fecha a partir de la cual se considera actual. */
  corte: string;
}

/**
 * Agrupa por proveedor separando la ventana de trabajo del histórico.
 *
 * `diasAtras` define la ventana: una factura cuyo vencimiento es anterior a
 * `hoy − diasAtras` se cuenta como histórica. Con `diasAtras: null` no hay
 * corte y entra todo, que es lo que hace el botón "Ver todo el histórico".
 */
export function agruparDeuda(
  facturas: FacturaProveedor[],
  opts: { hoy?: string; diasAtras?: number | null } = {}
): ResumenDeuda {
  const hoy = opts.hoy ?? hoyParaguay();
  const diasAtras = opts.diasAtras === undefined ? 120 : opts.diasAtras;
  const corte = diasAtras == null ? "" : restarDias(hoy, diasAtras);

  const porProv = new Map<string, ProveedorDeuda>();

  for (const cruda of facturas) {
    const f = clasificarFactura(cruda, hoy);
    if (f.estado_calc === "pagada") continue; // pagada no es deuda

    const clave = f.proveedor_id ?? `nombre:${f.proveedor_nombre}`;
    const acc = porProv.get(clave) ?? {
      proveedor_id: f.proveedor_id,
      proveedor_nombre: f.proveedor_nombre,
      pendiente: 0, vencido: 0, por_vencer: 0,
      cantidad: 0, cantidad_vencida: 0,
      proximo_vencimiento: null, dias_mas_vieja: 0,
      facturas: [],
      historico_cantidad: 0, historico_monto: 0,
    };

    // Sin vencimiento usable no se puede decir si es vieja: entra en la
    // ventana para que alguien la vea y la corrija, no al histórico donde
    // nadie la mira.
    const esHistorica = corte !== "" && f.vence != null && f.vence < corte;
    if (esHistorica) {
      acc.historico_cantidad += 1;
      acc.historico_monto += n(f.total);
    } else {
      acc.cantidad += 1;
      acc.pendiente += n(f.total);
      if (f.estado_calc === "vencida") {
        acc.vencido += n(f.total);
        acc.cantidad_vencida += 1;
        acc.dias_mas_vieja = Math.max(acc.dias_mas_vieja, -(f.dias ?? 0));
      } else {
        acc.por_vencer += n(f.total);
      }
      if (f.vence && (acc.proximo_vencimiento == null || f.vence < acc.proximo_vencimiento)) {
        acc.proximo_vencimiento = f.vence;
      }
      acc.facturas.push(f);
    }
    porProv.set(clave, acc);
  }

  const proveedores = [...porProv.values()];
  for (const p of proveedores) {
    // La más urgente primero: la que venció hace más tiempo. Sin vencimiento
    // van al final, que es donde se las revisa.
    p.facturas.sort((a, b) => {
      if (a.vence == null) return b.vence == null ? 0 : 1;
      if (b.vence == null) return -1;
      return a.vence.localeCompare(b.vence);
    });
  }

  // Primero el que tiene algo vencido, de mayor a menor; después por lo que
  // se le debe. Un proveedor que solo figura con histórico queda último.
  proveedores.sort((a, b) =>
    b.vencido - a.vencido ||
    b.pendiente - a.pendiente ||
    a.proveedor_nombre.localeCompare(b.proveedor_nombre, "es")
  );

  return {
    proveedores,
    pendiente: proveedores.reduce((s, p) => s + p.pendiente, 0),
    vencido: proveedores.reduce((s, p) => s + p.vencido, 0),
    cantidad: proveedores.reduce((s, p) => s + p.cantidad, 0),
    historico_cantidad: proveedores.reduce((s, p) => s + p.historico_cantidad, 0),
    historico_monto: proveedores.reduce((s, p) => s + p.historico_monto, 0),
    corte,
  };
}

/** "vencida hace 12 días", "vence hoy", "vence en 5 días". */
export function textoVencimiento(dias: number | null): string {
  if (dias == null) return "sin fecha de vencimiento";
  if (dias < 0) return `vencida hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"}`;
  if (dias === 0) return "vence hoy";
  return `vence en ${dias} ${dias === 1 ? "día" : "días"}`;
}
