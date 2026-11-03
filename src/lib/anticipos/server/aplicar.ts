/**
 * Usar el anticipo de un cliente para pagar una venta.
 *
 * ── QUÉ ES ────────────────────────────────────────────────────────────────
 *   El cliente dejó plata a cuenta hace días. Hoy se lleva la mercadería y
 *   paga menos: la diferencia la cubre ese anticipo. La venta vale lo mismo
 *   —la mercadería es la misma— pero del cajón de HOY entra menos plata.
 *
 * ── LAS DOS COSAS QUE HAY QUE NO EQUIVOCAR ────────────────────────────────
 *   1. El SALDO, no el estado. Un anticipo de 500.000 usado en una venta de
 *      200.000 deja 300.000 a favor del cliente. Por eso se descuenta sobre
 *      `monto_utilizado` y el estado pasa a 'utilizado' recién cuando el
 *      saldo llega a cero.
 *
 *   2. El ARQUEO. El anticipo ya entró al cajón el día que se registró, y el
 *      arqueo de ese turno ya lo contó. Si la venta de hoy se anotara como
 *      cobrada en efectivo por el total, el arqueo de hoy esperaría una plata
 *      que no está y el cajero cerraría con faltante sin culpa. Para eso la
 *      venta guarda `anticipo_aplicado`, que el resumen de caja descuenta.
 *
 * ── POR QUÉ FIFO Y NO "ELEGÍ CUÁL" ────────────────────────────────────────
 *   Se consumen del más viejo al más nuevo, sin preguntar. Es lo que espera
 *   cualquiera ("se va gastando lo que dejó primero") y le saca una decisión
 *   de encima al cajero, que tiene al cliente enfrente. Si hace falta aplicar
 *   uno puntual, se hace desde la pantalla de Anticipos.
 */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- igual que el
   resto de las capas que hablan con PostgREST sobre un schema de tenant. */
export type AnticiposSupabase = any;

/** Un anticipo con plata todavía disponible. */
export interface AnticipoConSaldo {
  id: string;
  numero: string | null;
  fecha: string;
  monto: number;
  monto_utilizado: number;
  saldo: number;
  medio_pago: string;
}

export interface SaldoCliente {
  saldo: number;
  anticipos: AnticipoConSaldo[];
  /** Mensaje cuando la base todavía no tiene el script 50 corrido. */
  aviso: string | null;
}

const AVISO_SIN_COLUMNA =
  "Para usar anticipos en Caja falta correr 50_anticipos_aplicados.sql en la base.";

/** `true` cuando el error es "no existe la columna que agrega el script 50". */
function faltaColumna(msg: string | null | undefined): boolean {
  const m = msg ?? "";
  return /monto_utilizado|anticipo_aplicado/.test(m) && /does not exist|42703|schema cache|PGRST/i.test(m);
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Las fichas de cliente que comparten el RUC con la que se pasó.
 *
 * ── POR QUÉ ──────────────────────────────────────────────────────────────
 * El anticipo es del CLIENTE, y el cliente es el RUC, no la ficha. En el
 * padrón que vino del sistema anterior hay RUC cargados dos veces, con la
 * misma persona en dos fichas distintas. Con el anticipo atado solo a la
 * ficha, el señor deja la seña con una y al volver lo atienden con la otra:
 * el sistema le dice que no tiene nada y paga dos veces lo mismo.
 *
 * Se compara el RUC SIN separadores, porque en la base conviven `1234567-8`,
 * `1.234.567-8` y `1234567`: comparando el texto tal cual, dos fichas del
 * mismo RUC escrito distinto no se reconocerían entre sí.
 *
 * Un cliente SIN RUC no se agrupa con nadie: si lo hiciera, todas las fichas
 * sin RUC compartirían los anticipos de todas las demás.
 */
async function fichasDelMismoRuc(
  sb: AnticiposSupabase,
  empresaId: string,
  clienteId: string
): Promise<string[]> {
  try {
    const propio = await sb
      .from("clientes")
      .select("ruc")
      .eq("empresa_id", empresaId)
      .eq("id", clienteId)
      .maybeSingle();
    const ruc = String((propio.data as { ruc?: string | null } | null)?.ruc ?? "").trim();
    const digitos = ruc.replace(/[^0-9]/g, "");
    if (digitos.length < 4) return [clienteId];

    // El patrón con los dígitos intercalados encuentra el mismo número escrito
    // con puntos, con guion o pelado. Va solo contra `ruc`, que son trece
    // caracteres: un patrón así casi no tiene con qué confundirse.
    const patron = `%${digitos.split("").join("%")}%`;
    const otras = await sb
      .from("clientes")
      .select("id, ruc")
      .eq("empresa_id", empresaId)
      .ilike("ruc", patron)
      .limit(50);
    if (otras.error) return [clienteId];

    const ids = ((otras.data ?? []) as Array<{ id: string; ruc: string | null }>)
      // El ilike es laxo: se confirma que los dígitos sean EXACTAMENTE los
      // mismos, para no juntar 1234567 con 12345678.
      .filter((c) => String(c.ruc ?? "").replace(/[^0-9]/g, "") === digitos)
      .map((c) => String(c.id));
    return ids.includes(clienteId) ? ids : [clienteId, ...ids];
  } catch {
    // Si algo falla, se sigue con la ficha sola: es el comportamiento anterior.
    return [clienteId];
  }
}

/**
 * Qué tiene a favor un cliente, en esta sucursal.
 *
 * La sucursal entra en la cuenta porque la plata está en un cajón concreto:
 * un anticipo dejado en una sucursal no se puede descontar de la caja de la
 * otra sin mover plata entre las dos.
 *
 * El RUC también: se suman los anticipos de todas las fichas que comparten el
 * RUC, porque el anticipo es de la persona y no del renglón del padrón. Ver
 * `fichasDelMismoRuc`.
 */
export async function saldoDeCliente(
  sb: AnticiposSupabase,
  empresaId: string,
  sucursalId: string,
  clienteId: string
): Promise<SaldoCliente> {
  const vacio: SaldoCliente = { saldo: 0, anticipos: [], aviso: null };
  if (!clienteId) return vacio;

  const fichas = await fichasDelMismoRuc(sb, empresaId, clienteId);

  const r = await sb
    .from("anticipos")
    .select("id, numero, fecha, monto, monto_utilizado, medio_pago")
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .in("cliente_id", fichas)
    .eq("estado", "activo")
    .order("fecha", { ascending: true });

  if (r.error) {
    // Sin el script 50, Caja simplemente no ofrece anticipos: es mejor que
    // romper la pantalla de venta por una función que todavía no está.
    if (faltaColumna(r.error.message)) return { ...vacio, aviso: AVISO_SIN_COLUMNA };
    throw new Error(r.error.message);
  }

  const anticipos: AnticipoConSaldo[] = ((r.data ?? []) as Array<Record<string, unknown>>)
    .map((a) => {
      const monto = num(a.monto);
      const usado = num(a.monto_utilizado);
      return {
        id: String(a.id),
        numero: a.numero == null ? null : String(a.numero),
        fecha: String(a.fecha ?? ""),
        monto,
        monto_utilizado: usado,
        saldo: Math.max(0, monto - usado),
        medio_pago: String(a.medio_pago ?? "efectivo"),
      };
    })
    .filter((a) => a.saldo > 0);

  return {
    saldo: anticipos.reduce((s, a) => s + a.saldo, 0),
    anticipos,
    aviso: null,
  };
}

export interface ResultadoConsumo {
  ok: boolean;
  /** Lo que efectivamente se descontó. */
  aplicado: number;
  /** Anticipos tocados, para el detalle de la venta y el ticket. */
  numeros: string[];
  /** Por qué no se pudo, en palabras que se le puedan mostrar al cajero. */
  error: string | null;
}

/**
 * Descuenta `monto` del saldo del cliente, del anticipo más viejo al más
 * nuevo, y lo ata a la venta.
 *
 * Cada descuento se escribe con la condición `monto_utilizado = <lo que
 * acabamos de leer>`. Si entre la lectura y la escritura otro cajero usó el
 * mismo anticipo, la fila no matchea, no se escribe nada y se devuelve el
 * error en vez de dejar el saldo en negativo. Dos cajas sobre el mismo
 * cliente a la misma hora es raro, pero cuando pasa, pasa con plata.
 */
export async function consumirAnticipos(
  sb: AnticiposSupabase,
  empresaId: string,
  sucursalId: string,
  clienteId: string,
  monto: number,
  ventaId: string
): Promise<ResultadoConsumo> {
  const objetivo = Math.round(num(monto));
  if (objetivo <= 0) return { ok: true, aplicado: 0, numeros: [], error: null };

  const { saldo, anticipos, aviso } = await saldoDeCliente(sb, empresaId, sucursalId, clienteId);
  if (aviso) return { ok: false, aplicado: 0, numeros: [], error: aviso };
  if (saldo < objetivo) {
    return {
      ok: false,
      aplicado: 0,
      numeros: [],
      error: `El cliente tiene Gs. ${Math.round(saldo).toLocaleString("es-PY")} de anticipo y se quisieron usar Gs. ${objetivo.toLocaleString("es-PY")}.`,
    };
  }

  let restante = objetivo;
  const numeros: string[] = [];
  const ahora = new Date().toISOString();

  for (const a of anticipos) {
    if (restante <= 0) break;
    const usa = Math.min(a.saldo, restante);
    const nuevoUsado = a.monto_utilizado + usa;
    const seAgota = nuevoUsado >= a.monto;

    const upd = await sb
      .from("anticipos")
      .update({
        monto_utilizado: nuevoUsado,
        estado: seAgota ? "utilizado" : "activo",
        // Se guarda la venta que lo consumió. Si el anticipo se usa en más de
        // una venta queda la última: el rastro completo vive en la venta, que
        // es la que dice cuánto salió de anticipo.
        venta_id: ventaId,
        updated_at: ahora,
      })
      .eq("empresa_id", empresaId)
      .eq("id", a.id)
      .eq("monto_utilizado", a.monto_utilizado)
      .eq("estado", "activo")
      .select("id");

    if (upd.error) {
      return {
        ok: false,
        aplicado: objetivo - restante,
        numeros,
        error: upd.error.message,
      };
    }
    if (!upd.data || (upd.data as unknown[]).length === 0) {
      return {
        ok: false,
        aplicado: objetivo - restante,
        numeros,
        error:
          "El anticipo cambió mientras se cobraba (puede que lo esté usando otra caja). Volvé a intentar.",
      };
    }

    restante -= usa;
    if (a.numero) numeros.push(a.numero);
  }

  return { ok: restante <= 0, aplicado: objetivo - restante, numeros, error: null };
}
