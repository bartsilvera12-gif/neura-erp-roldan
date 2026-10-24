import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { enlazarConCaja } from "@/lib/caja/enlace-movimientos";

export type MetodoPagoCobro = "efectivo" | "transferencia" | "tarjeta" | "otro";

export interface RegistrarCobroInput {
  cuenta_por_cobrar_id: string;
  monto: number;
  metodo_pago: MetodoPagoCobro;
  entidad_bancaria_id?: string | null;
  referencia?: string | null;
  titular?: string | null;
  observaciones?: string | null;
  fecha_pago?: string | null;
  usuario_id?: string | null;
  usuario_nombre?: string | null;
  entidad_nombre_snapshot?: string | null;
  /** Sucursal del turno de caja al que atar el cobro. */
  sucursal_id?: string | null;
  /** Correo de quien cobra, para el listado de movimientos del turno. */
  usuario_email?: string | null;
}

export class CobroError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CobroError";
    this.status = status;
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function metodoValido(m: unknown): MetodoPagoCobro {
  return m === "transferencia" || m === "tarjeta" || m === "otro" ? m : "efectivo";
}

/**
 * Registra un cobro contra una cuenta por cobrar: inserta en `cobros_clientes`,
 * descuenta el saldo y recalcula el estado (pendiente|parcial|pagado).
 * No permite cobrar más que el saldo. NO toca stock ni ventas.
 */
export async function registrarCobro(
  sb: AppSupabaseClient,
  empresaId: string,
  input: RegistrarCobroInput
): Promise<{ cobro_id: string; saldo_nuevo: number; estado: string; caja_movimiento_id: string | null }> {
  const monto = round2(Number(input.monto) || 0);
  if (!(monto > 0)) throw new CobroError("El monto del cobro debe ser mayor a cero.");
  if (!input.cuenta_por_cobrar_id) throw new CobroError("Falta la cuenta por cobrar.");

  const cq = await sb
    .from("cuentas_por_cobrar")
    .select("id, cliente_id, venta_id, total, saldo, estado")
    .eq("empresa_id", empresaId)
    .eq("id", input.cuenta_por_cobrar_id)
    .maybeSingle();
  if (cq.error) throw new CobroError(cq.error.message, 500);
  if (!cq.data) throw new CobroError("Cuenta por cobrar no encontrada.", 404);
  const cxc = cq.data as {
    id: string;
    cliente_id: string;
    venta_id: string;
    total: number | string;
    saldo: number | string;
    estado: string;
  };

  if (cxc.estado === "anulado") throw new CobroError("La cuenta está anulada; no admite cobros.", 409);
  if (cxc.estado === "pagado") throw new CobroError("La cuenta ya está pagada.", 409);

  const saldoActual = round2(Number(cxc.saldo) || 0);
  const total = round2(Number(cxc.total) || 0);
  if (monto > saldoActual + 0.001) {
    throw new CobroError(`El monto (${monto}) supera el saldo pendiente (${saldoActual}).`);
  }

  const fechaPago =
    typeof input.fecha_pago === "string" && input.fecha_pago.trim() ? input.fecha_pago : new Date().toISOString();

  // 1) Insertar el cobro.
  const ins = await sb
    .from("cobros_clientes")
    .insert({
      empresa_id: empresaId,
      cliente_id: cxc.cliente_id,
      cuenta_por_cobrar_id: cxc.id,
      venta_id: cxc.venta_id,
      fecha_pago: fechaPago,
      monto,
      metodo_pago: metodoValido(input.metodo_pago),
      entidad_bancaria_id: input.entidad_bancaria_id || null,
      entidad_nombre_snapshot: input.entidad_nombre_snapshot?.trim() || null,
      referencia: input.referencia?.trim() || null,
      titular: input.titular?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
      usuario_id: input.usuario_id || null,
      usuario_nombre: input.usuario_nombre?.trim() || null,
    })
    .select("id")
    .single();
  if (ins.error) throw new CobroError(ins.error.message, 500);
  const cobroId = String((ins.data as { id: string }).id);

  // 2) Recalcular saldo + estado.
  const saldoNuevo = round2(saldoActual - monto);
  const estadoNuevo = saldoNuevo <= 0.001 ? "pagado" : saldoNuevo < total ? "parcial" : "pendiente";
  const upd = await sb
    .from("cuentas_por_cobrar")
    .update({ saldo: saldoNuevo < 0 ? 0 : saldoNuevo, estado: estadoNuevo, updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", cxc.id);
  if (upd.error) {
    // Rollback best-effort del cobro para no descuadrar el saldo.
    try {
      await sb.from("cobros_clientes").delete().eq("id", cobroId).eq("empresa_id", empresaId);
    } catch {}
    throw new CobroError(upd.error.message, 500);
  }

  // 3) Espejo en la caja abierta.
  //
  //    Hasta acá el cobro quedaba solo en `cobros_clientes` y la caja no se
  //    enteraba: al cerrar el turno faltaba justamente esa plata y el arqueo
  //    no cuadraba. `enlazarConCaja` no tumba el cobro si falla ni exige que
  //    haya un turno abierto; si no lo hay, simplemente no escribe nada.
  const cajaMovimientoId = await enlazarConCaja(sb, {
    empresaId,
    sucursalId: input.sucursal_id ?? null,
    tipo: "ingreso",
    concepto: "Cobro a cliente",
    monto,
    medioPago: input.metodo_pago,
    observacion: input.referencia?.trim() || input.observaciones?.trim() || null,
    usuarioId: input.usuario_id ?? null,
    usuarioEmail: input.usuario_email ?? null,
    cobroId,
    ventaId: cxc.venta_id ?? null,
  });

  return {
    cobro_id: cobroId,
    saldo_nuevo: saldoNuevo < 0 ? 0 : saldoNuevo,
    estado: estadoNuevo,
    caja_movimiento_id: cajaMovimientoId,
  };
}

/**
 * Reversa (elimina) un cobro: lo borra de `cobros_clientes` y devuelve el monto
 * al saldo de la cuenta por cobrar, recalculando el estado. Permite luego anular
 * la venta. NO toca stock ni la venta.
 */
export async function reversarCobro(
  sb: AppSupabaseClient,
  empresaId: string,
  cobroId: string
): Promise<{ cuenta_id: string | null; saldo_nuevo: number; estado: string }> {
  if (!cobroId) throw new CobroError("Falta el id del cobro.");

  const cq = await sb
    .from("cobros_clientes")
    .select("id, cuenta_por_cobrar_id, monto")
    .eq("empresa_id", empresaId)
    .eq("id", cobroId)
    .maybeSingle();
  if (cq.error) throw new CobroError(cq.error.message, 500);
  if (!cq.data) throw new CobroError("Cobro no encontrado.", 404);
  const cobro = cq.data as { id: string; cuenta_por_cobrar_id: string | null; monto: number | string };
  const monto = round2(Number(cobro.monto) || 0);

  // Borrar el cobro.
  const del = await sb.from("cobros_clientes").delete().eq("id", cobroId).eq("empresa_id", empresaId);
  if (del.error) throw new CobroError(del.error.message, 500);

  // Restaurar saldo de la cuenta (si el cobro tenía cuenta asociada).
  if (!cobro.cuenta_por_cobrar_id) return { cuenta_id: null, saldo_nuevo: 0, estado: "pendiente" };
  const cta = await sb
    .from("cuentas_por_cobrar")
    .select("id, total, saldo, estado")
    .eq("empresa_id", empresaId)
    .eq("id", cobro.cuenta_por_cobrar_id)
    .maybeSingle();
  if (cta.error || !cta.data) return { cuenta_id: cobro.cuenta_por_cobrar_id, saldo_nuevo: 0, estado: "pendiente" };
  const c = cta.data as { id: string; total: number | string; saldo: number | string; estado: string };
  const total = round2(Number(c.total) || 0);
  const saldoNuevo = Math.min(total, round2((Number(c.saldo) || 0) + monto));
  const estadoNuevo = saldoNuevo <= 0.001 ? "pagado" : saldoNuevo < total ? "parcial" : "pendiente";
  await sb
    .from("cuentas_por_cobrar")
    .update({ saldo: saldoNuevo, estado: estadoNuevo, updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", c.id);
  return { cuenta_id: c.id, saldo_nuevo: saldoNuevo, estado: estadoNuevo };
}
