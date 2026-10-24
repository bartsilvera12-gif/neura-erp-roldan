import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Ata un cobro o un pago al turno de caja abierto.
 *
 * POR QUÉ EXISTE
 *   Los módulos de Cobros y de Pagos a proveedores nacieron sueltos de Caja:
 *   registraban el movimiento de dinero en su propia tabla y la caja no se
 *   enteraba. Resultado: al cerrar el turno, el efectivo contado no coincidía
 *   con el esperado y el arqueo nunca cuadraba, porque faltaba justamente la
 *   plata que entró o salió por esos dos caminos.
 *
 *   El checklist del cliente lo pide explícito en el módulo 07: "cobros,
 *   pagos, cierres, CxC/CxP" tienen que ser una sola cosa.
 *
 * QUÉ HACE Y QUÉ NO
 *   - Solo escribe si hay un turno ABIERTO en la sucursal. Si no lo hay, el
 *     cobro se registra igual y esta función no hace nada: cobrar no puede
 *     depender de que alguien se haya acordado de abrir la caja.
 *   - Escribe el movimiento con su medio de pago real. El arqueo suma solo
 *     efectivo, así que una transferencia queda registrada para la trazabilidad
 *     pero no infla el efectivo esperado del cajón.
 *   - NUNCA tumba la operación que la llamó. Si falla, se loguea y se sigue:
 *     un cobro registrado sin su espejo en caja es un problema; un cobro que
 *     no se pudo registrar es uno peor.
 */

/** Medios que el arqueo cuenta como efectivo físico en el cajón. */
const MEDIOS_CAJA = ["efectivo", "tarjeta", "transferencia", "cheque", "otro"] as const;
type MedioCaja = (typeof MEDIOS_CAJA)[number];

function normalizarMedio(v: unknown): MedioCaja {
  const s = String(v ?? "").trim().toLowerCase();
  return (MEDIOS_CAJA as readonly string[]).includes(s) ? (s as MedioCaja) : "otro";
}

/** Turno abierto de la sucursal, o null si no hay ninguno. */
async function cajaAbiertaId(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string | null
): Promise<string | null> {
  try {
    let q = sb
      .from("cajas")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("estado", "abierta")
      .order("fecha_apertura", { ascending: false })
      .limit(1);
    // La caja es por sucursal: sin este filtro un cobro de una sucursal podía
    // caer en el turno de otra.
    if (sucursalId) q = q.eq("sucursal_id", sucursalId);
    const { data, error } = await q;
    if (error) return null;
    const fila = (data ?? [])[0] as { id?: string } | undefined;
    return fila?.id ? String(fila.id) : null;
  } catch {
    return null;
  }
}

export type EnlaceCajaInput = {
  empresaId: string;
  sucursalId: string | null;
  /** 'ingreso' para un cobro, 'egreso' para un pago. */
  tipo: "ingreso" | "egreso";
  concepto: string;
  monto: number;
  medioPago: unknown;
  observacion?: string | null;
  usuarioId?: string | null;
  usuarioEmail?: string | null;
  /** Referencias opcionales, para poder rastrear de dónde salió el movimiento. */
  cobroId?: string | null;
  pagoId?: string | null;
  ventaId?: string | null;
};

/**
 * Registra el movimiento en el turno abierto.
 *
 * Devuelve el id del movimiento, o null si no había caja abierta o si la
 * escritura falló (en cuyo caso ya quedó logueado).
 */
export async function enlazarConCaja(
  sb: AppSupabaseClient,
  input: EnlaceCajaInput
): Promise<string | null> {
  const monto = Math.abs(Number(input.monto) || 0);
  if (monto <= 0) return null;

  const cajaId = await cajaAbiertaId(sb, input.empresaId, input.sucursalId);
  if (!cajaId) return null;

  // Las referencias van en un objeto aparte: son columnas opcionales y no
  // todos los esquemas las tienen. Si alguna falta, se reintenta sin ellas
  // antes que perder el movimiento entero.
  const base = {
    empresa_id: input.empresaId,
    caja_id: cajaId,
    tipo: input.tipo,
    concepto: input.concepto.trim().slice(0, 200),
    monto,
    medio_pago: normalizarMedio(input.medioPago),
    usuario_id: input.usuarioId ?? null,
    usuario_email: input.usuarioEmail ?? null,
    observacion: input.observacion?.trim() || null,
  };
  const refs: Record<string, unknown> = {};
  if (input.cobroId) refs.cobro_id = input.cobroId;
  if (input.pagoId) refs.pago_id = input.pagoId;
  if (input.ventaId) refs.venta_id = input.ventaId;

  const intentar = async (fila: Record<string, unknown>) =>
    sb.from("caja_movimientos").insert(fila).select("id").single();

  let r = await intentar({ ...base, ...refs });
  if (r.error && /column .* does not exist/i.test(r.error.message)) {
    r = await intentar(base);
  }
  if (r.error) {
    console.error("[caja/enlace] no se pudo registrar el movimiento:", r.error.message);
    return null;
  }
  return String((r.data as { id: string }).id);
}
