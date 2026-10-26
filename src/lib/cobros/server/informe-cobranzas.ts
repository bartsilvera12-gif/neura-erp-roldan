import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Informe de cobranzas (punto 10.2).
 *
 * "Cobranzas: cliente, cobro, fecha, importe y comprobante; filtros por
 * cliente y fecha."
 *
 * ── QUÉ ES "EL COMPROBANTE" ────────────────────────────────────────────────
 *   Dos cosas distintas que la gente llama igual, y las dos hacen falta:
 *   · la factura que se está cobrando (el número de venta), que es contra qué
 *     se imputó la plata;
 *   · la referencia del pago (número de transferencia, de cheque, de boleta),
 *     que es con qué se demuestra que entró.
 *   Por eso el informe trae las dos columnas. Con una sola, reconciliar contra
 *   el extracto del banco obliga a abrir cobro por cobro.
 *
 * ── LOS ANULADOS SE LISTAN, PERO NO SUMAN ──────────────────────────────────
 *   Un cobro anulado sigue siendo parte de la historia del cliente: alguien lo
 *   cargó, alguien lo dio de baja y en algún lado hay un papel. Se muestra,
 *   marcado, y queda fuera de los totales.
 */

const OFFSET_PY = "-03:00";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE = 1000;

export type FiltrosCobranzas = {
  clienteId?: string | null;
  desde?: string | null;
  hasta?: string | null;
  metodo?: string | null;
  /** "activos" (por defecto), "anulados" o "todos". */
  estado?: string | null;
  /** Busca en el número de venta y en la referencia del pago. */
  q?: string | null;
};

export type FilaCobranza = {
  id: string;
  fecha_pago: string;
  cliente_id: string | null;
  cliente_nombre: string;
  numero_venta: string | null;
  monto: number;
  metodo_pago: string;
  entidad: string | null;
  referencia: string | null;
  usuario_nombre: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  anulado_por: string | null;
};

export type InformeCobranzas = {
  filas: FilaCobranza[];
  resumen: {
    cantidad: number;
    total: number;
    anulados: number;
    total_anulado: number;
    por_metodo: { metodo: string; cantidad: number; total: number }[];
    por_cliente: { cliente_id: string | null; nombre: string; cantidad: number; total: number }[];
  };
  /** true si se llegó al tope: el informe está recortado. */
  recortado: boolean;
};

export async function informeCobranzas(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  f: FiltrosCobranzas
): Promise<InformeCobranzas> {
  let qb = sb
    .from("cobros_clientes")
    .select(
      "id, cliente_id, cuenta_por_cobrar_id, venta_id, fecha_pago, monto, metodo_pago, " +
      "entidad_nombre_snapshot, referencia, usuario_nombre, anulado_at, anulado_motivo, anulado_por_nombre"
    )
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId);

  if (f.clienteId) qb = qb.eq("cliente_id", f.clienteId);
  if (f.metodo) qb = qb.eq("metodo_pago", f.metodo);
  // Paraguay es UTC−3 todo el año; el offset va escrito porque la tzdata del
  // server puede estar vieja. El día "hasta" entra entero.
  if (f.desde && RE_FECHA.test(f.desde)) qb = qb.gte("fecha_pago", `${f.desde}T00:00:00${OFFSET_PY}`);
  if (f.hasta && RE_FECHA.test(f.hasta)) qb = qb.lte("fecha_pago", `${f.hasta}T23:59:59.999${OFFSET_PY}`);

  const estado = (f.estado ?? "activos").trim();
  if (estado === "activos") qb = qb.is("anulado_at", null);
  else if (estado === "anulados") qb = qb.not("anulado_at", "is", null);

  const r = await qb.order("fecha_pago", { ascending: false }).limit(LIMITE);
  if (r.error) throw new Error(r.error.message);
  const crudas = (r.data ?? []) as unknown as Array<Record<string, unknown>>;

  // ── Nombres de cliente y números de factura ────────────────────────────
  //   Van en consultas aparte y no en un join embebido: PostgREST corta en
  //   1000 filas y un embed que falle por una relación no declarada tiraría
  //   abajo el informe entero.
  const clienteIds = [...new Set(crudas.map((c) => String(c.cliente_id ?? "")).filter(Boolean))];
  const nombres = new Map<string, string>();
  if (clienteIds.length) {
    const cq = await sb
      .from("clientes")
      .select("id, nombre, empresa, nombre_contacto, nombre_facturacion")
      .eq("empresa_id", empresaId)
      .in("id", clienteIds.slice(0, 1000));
    for (const c of (cq.data ?? []) as Array<Record<string, unknown>>) {
      nombres.set(
        String(c.id),
        String(c.nombre_facturacion ?? "") || String(c.empresa ?? "") ||
        String(c.nombre_contacto ?? "") || String(c.nombre ?? "")
      );
    }
  }

  const cuentaIds = [...new Set(crudas.map((c) => String(c.cuenta_por_cobrar_id ?? "")).filter(Boolean))];
  const numeros = new Map<string, string>();
  if (cuentaIds.length) {
    const cq = await sb
      .from("cuentas_por_cobrar")
      .select("id, numero_venta")
      .eq("empresa_id", empresaId)
      .in("id", cuentaIds.slice(0, 1000));
    for (const c of (cq.data ?? []) as Array<Record<string, unknown>>) {
      if (c.numero_venta != null) numeros.set(String(c.id), String(c.numero_venta));
    }
  }

  let filas: FilaCobranza[] = crudas.map((c) => ({
    id: String(c.id),
    fecha_pago: String(c.fecha_pago ?? ""),
    cliente_id: c.cliente_id == null ? null : String(c.cliente_id),
    cliente_nombre: nombres.get(String(c.cliente_id ?? "")) ?? "—",
    numero_venta: numeros.get(String(c.cuenta_por_cobrar_id ?? "")) ?? null,
    monto: Number(c.monto) || 0,
    metodo_pago: String(c.metodo_pago ?? "efectivo"),
    entidad: c.entidad_nombre_snapshot == null || String(c.entidad_nombre_snapshot).trim() === ""
      ? null : String(c.entidad_nombre_snapshot),
    referencia: c.referencia == null || String(c.referencia).trim() === "" ? null : String(c.referencia),
    usuario_nombre: c.usuario_nombre == null ? null : String(c.usuario_nombre),
    anulado: c.anulado_at != null,
    anulado_motivo: c.anulado_motivo == null ? null : String(c.anulado_motivo),
    anulado_por: c.anulado_por_nombre == null ? null : String(c.anulado_por_nombre),
  }));

  // La búsqueda por texto se aplica acá y no en la consulta: toca dos campos
  // que viven en tablas distintas (la referencia del cobro y el número de la
  // factura), y un `or` de PostgREST no puede cruzar esa frontera.
  const q = (f.q ?? "").trim().toLowerCase();
  if (q) {
    filas = filas.filter(
      (x) =>
        (x.numero_venta ?? "").toLowerCase().includes(q) ||
        (x.referencia ?? "").toLowerCase().includes(q) ||
        x.cliente_nombre.toLowerCase().includes(q)
    );
  }

  const activas = filas.filter((x) => !x.anulado);
  const anuladas = filas.filter((x) => x.anulado);

  const porMetodo = new Map<string, { cantidad: number; total: number }>();
  for (const x of activas) {
    const a = porMetodo.get(x.metodo_pago) ?? { cantidad: 0, total: 0 };
    a.cantidad += 1;
    a.total += x.monto;
    porMetodo.set(x.metodo_pago, a);
  }

  const porCliente = new Map<string, { nombre: string; cantidad: number; total: number }>();
  for (const x of activas) {
    const k = x.cliente_id ?? `__${x.cliente_nombre}`;
    const a = porCliente.get(k) ?? { nombre: x.cliente_nombre, cantidad: 0, total: 0 };
    a.cantidad += 1;
    a.total += x.monto;
    porCliente.set(k, a);
  }

  return {
    filas,
    resumen: {
      cantidad: activas.length,
      total: activas.reduce((s, x) => s + x.monto, 0),
      anulados: anuladas.length,
      total_anulado: anuladas.reduce((s, x) => s + x.monto, 0),
      por_metodo: [...porMetodo.entries()]
        .map(([metodo, v]) => ({ metodo, ...v }))
        .sort((a, b) => b.total - a.total),
      por_cliente: [...porCliente.entries()]
        .map(([cliente_id, v]) => ({ cliente_id: cliente_id.startsWith("__") ? null : cliente_id, ...v }))
        .sort((a, b) => b.total - a.total),
    },
    recortado: crudas.length >= LIMITE,
  };
}
