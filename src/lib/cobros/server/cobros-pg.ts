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
 * Anula un cobro: lo marca como anulado, devuelve el monto al saldo de la
 * cuenta por cobrar y recalcula el estado. NO toca stock ni la venta.
 *
 * ── ANTES SE BORRABA, Y ESO ESTABA MAL (punto 10.3) ───────────────────────
 *   El requisito pide "cancelación o disminución de deuda por recibos,
 *   conservando historial". Borrar la fila hacía desaparecer el recibo: si el
 *   cliente venía con su papel en la mano, en el sistema no había nada —ni el
 *   cobro, ni quién lo había cargado, ni quién lo dio de baja—. Y el arqueo de
 *   ese día, que ya se había cerrado con esa plata adentro, dejaba de cuadrar
 *   sin que nadie pudiera explicar por qué.
 *
 *   Ahora el cobro queda, marcado con la fecha, el usuario y el motivo. Todas
 *   las lecturas que suman plata filtran `anulado_at IS NULL`; las que muestran
 *   historial lo siguen mostrando, tachado.
 *
 * El motivo es obligatorio por la misma razón que en las anulaciones de venta
 * y de anticipo: un número que se mueve sin explicación es un número que
 * alguien va a tener que explicar después, de memoria.
 */
export async function reversarCobro(
  sb: AppSupabaseClient,
  empresaId: string,
  cobroId: string,
  opciones?: {
    motivo?: string | null;
    usuarioId?: string | null;
    usuarioNombre?: string | null;
    /** Sucursal del turno abierto, para devolver la plata que el cobro metió en caja. */
    sucursalId?: string | null;
    usuarioEmail?: string | null;
  }
): Promise<{
  cuenta_id: string | null;
  saldo_nuevo: number;
  estado: string;
  /** true si la anulación también salió de la caja del turno abierto. */
  compensado_en_caja?: boolean;
}> {
  if (!cobroId) throw new CobroError("Falta el id del cobro.");
  const motivo = (opciones?.motivo ?? "").trim();
  if (!motivo) throw new CobroError("Escribí el motivo de la anulación del cobro.", 400);

  const cq = await sb
    .from("cobros_clientes")
    .select("id, cuenta_por_cobrar_id, monto, anulado_at, metodo_pago, caja_movimiento_id")
    .eq("empresa_id", empresaId)
    .eq("id", cobroId)
    .maybeSingle();
  if (cq.error) throw new CobroError(cq.error.message, 500);
  if (!cq.data) throw new CobroError("Cobro no encontrado.", 404);
  const cobro = cq.data as {
    id: string; cuenta_por_cobrar_id: string | null; monto: number | string;
    anulado_at: string | null; metodo_pago: string | null; caja_movimiento_id: string | null;
  };
  // Dos anulaciones seguidas devolverían el monto al saldo dos veces.
  if (cobro.anulado_at) throw new CobroError("Ese cobro ya está anulado.", 409);
  const monto = round2(Number(cobro.monto) || 0);

  const anu = await sb
    .from("cobros_clientes")
    .update({
      anulado_at: new Date().toISOString(),
      anulado_por_id: opciones?.usuarioId ?? null,
      anulado_por_nombre: opciones?.usuarioNombre ?? null,
      anulado_motivo: motivo,
    })
    .eq("id", cobroId)
    .eq("empresa_id", empresaId)
    // Si otro lo anuló entre la lectura y esta escritura, no se devuelve el
    // monto dos veces.
    .is("anulado_at", null)
    .select("id")
    .maybeSingle();
  if (anu.error) throw new CobroError(anu.error.message, 500);
  if (!anu.data) throw new CobroError("Ese cobro ya está anulado.", 409);

  // ── La plata que había entrado a la caja tiene que volver a salir ─────────
  //   Registrar el cobro metió un ingreso en el turno abierto. Si se anula y
  //   ese ingreso queda, al cerrar el turno va a sobrar plata que no está en
  //   el cajón.
  //
  //   Se registra un EGRESO y no se borra el ingreso: así el turno muestra las
  //   dos puntas —entró y volvió a salir— en vez de que un movimiento
  //   desaparezca de un arqueo que alguien ya miró.
  //
  //   Si no hay turno abierto, `enlazarConCaja` no escribe nada. Es lo
  //   correcto: la plata entró en un turno que ya se cerró y contó, y sacarla
  //   del turno de hoy dejaría corta la caja de hoy.
  let compensadoEnCaja = false;
  if (cobro.caja_movimiento_id) {
    const movId = await enlazarConCaja(sb, {
      empresaId,
      sucursalId: opciones?.sucursalId ?? null,
      tipo: "egreso",
      concepto: "Anulación de cobro a cliente",
      monto,
      medioPago: metodoValido(cobro.metodo_pago),
      observacion: motivo.slice(0, 200),
      usuarioId: opciones?.usuarioId ?? null,
      usuarioEmail: opciones?.usuarioEmail ?? null,
      cobroId,
    });
    compensadoEnCaja = Boolean(movId);
  }

  // Restaurar saldo de la cuenta (si el cobro tenía cuenta asociada).
  if (!cobro.cuenta_por_cobrar_id) {
    return { cuenta_id: null, saldo_nuevo: 0, estado: "pendiente", compensado_en_caja: compensadoEnCaja };
  }
  const cta = await sb
    .from("cuentas_por_cobrar")
    .select("id, total, saldo, estado")
    .eq("empresa_id", empresaId)
    .eq("id", cobro.cuenta_por_cobrar_id)
    .maybeSingle();
  if (cta.error || !cta.data) {
    return {
      cuenta_id: cobro.cuenta_por_cobrar_id, saldo_nuevo: 0, estado: "pendiente",
      compensado_en_caja: compensadoEnCaja,
    };
  }
  const c = cta.data as { id: string; total: number | string; saldo: number | string; estado: string };
  const total = round2(Number(c.total) || 0);
  const saldoNuevo = Math.min(total, round2((Number(c.saldo) || 0) + monto));
  const estadoNuevo = saldoNuevo <= 0.001 ? "pagado" : saldoNuevo < total ? "parcial" : "pendiente";
  await sb
    .from("cuentas_por_cobrar")
    .update({ saldo: saldoNuevo, estado: estadoNuevo, updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", c.id);
  return { cuenta_id: c.id, saldo_nuevo: saldoNuevo, estado: estadoNuevo, compensado_en_caja: compensadoEnCaja };
}
