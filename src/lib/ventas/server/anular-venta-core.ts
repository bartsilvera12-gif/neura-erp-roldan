import { ajustarStockUbicacion } from "@/lib/multideposito/server";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Core reusable de anulación de venta:
 *   - Reintegra el stock que la venta había descontado (contraparte ENTRADA con
 *     origen='anulacion_venta' por cada SALIDA original vinculada a la venta).
 *   - Marca la CxC como 'anulado' (si existe y no tenía cobros — caller decide
 *     si esa validación bloquea o no).
 *   - Marca la venta como 'anulada' + trazabilidad (anulada_at, anulada_por, motivo).
 *
 * Usos:
 *   1) Endpoint /api/ventas/[id]/anular (venta sin factura o de operador que
 *      confirmó rollback voluntario) — verifica cobros antes de llamar.
 *   2) Endpoint /api/facturas/[id]/sifen/cancelar (cuando la factura tiene
 *      origen_venta_id) — llama best-effort DESPUÉS de que SET confirmó el
 *      DE cancelado. Si la venta ya estaba anulada, retorna alreadyAnulada:true.
 *
 * Rollback best-effort: si algún paso falla, revierte stock e inserciones
 * antes de propagar el error. NO usa transacciones PG (PostgREST).
 */

export interface AnularVentaCoreArgs {
  sb: AppSupabaseClient;
  empresaId: string;
  ventaId: string;
  motivo: string;
  /** auth.user.id — usuario que dispara la anulación. */
  userId: string;
  /** usuarioCatalogId — para trazar en movimientos_inventario.created_by. */
  movCreatedBy: string | null;
  /** email del usuario — snapshot en movimientos_inventario.usuario_nombre. */
  movUsuarioNombre: string | null;
}

export interface AnularVentaCoreResult {
  ok: true;
  alreadyAnulada: boolean;
  stockReintegrado: number;
  numeroControl: string | null;
  /** Anticipo que la venta había consumido y se le devolvió al cliente. */
  anticipoDevuelto?: number;
  /**
   * Parte del anticipo que NO se pudo devolver automáticamente. Si es > 0, hay
   * plata del cliente que quedó figurando como gastada: el caller lo registra
   * para que alguien lo arregle a mano.
   */
  anticipoSinDevolver?: number;
}

export interface AnularVentaCoreError {
  ok: false;
  message: string;
  /** true si el motivo del error es "ya estaba anulada" (409). */
  alreadyAnulada?: boolean;
  /** true si es un problema de cobros aplicados en CxC (409). */
  hasCobros?: boolean;
  status?: number;
}

interface MovimientoRow {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  cantidad: number | string;
  costo_unitario: number | string;
  tipo: string;
}

export async function anularVentaCore(
  args: AnularVentaCoreArgs
): Promise<AnularVentaCoreResult | AnularVentaCoreError> {
  const { sb, empresaId, ventaId, motivo, userId, movCreatedBy, movUsuarioNombre } = args;

  const COLS = "id, estado, numero_control, fecha, tipo_venta";
  const leerVenta = (cols: string) =>
    sb.from("ventas").select(cols).eq("id", ventaId).eq("empresa_id", empresaId).maybeSingle();
  // `anticipo_aplicado` lo agrega el script 50: sin el reintento, una base sin
  // ese script no podría anular ninguna venta.
  let ventaQ = await leerVenta(`${COLS}, anticipo_aplicado, ubicacion_id`);
  if (ventaQ.error && /anticipo_aplicado|ubicacion_id/.test(ventaQ.error.message ?? "")) {
    // Una de las dos columnas opcionales falta: se prueba solo con la otra y,
    // si tampoco, con lo mínimo. Así la anulación nunca queda bloqueada por
    // una migración pendiente.
    ventaQ = await leerVenta(`${COLS}, anticipo_aplicado`);
    if (ventaQ.error) ventaQ = await leerVenta(COLS);
  }
  if (ventaQ.error) return { ok: false, message: ventaQ.error.message, status: 400 };
  if (!ventaQ.data) return { ok: false, message: "Venta no encontrada.", status: 404 };

  const venta = ventaQ.data as unknown as {
    id: string;
    estado: string;
    numero_control: string;
    fecha: string;
    tipo_venta: string;
    anticipo_aplicado?: number | string | null;
    ubicacion_id?: string | null;
  };

  if (venta.estado === "anulada") {
    return {
      ok: true,
      alreadyAnulada: true,
      stockReintegrado: 0,
      numeroControl: venta.numero_control,
    };
  }

  // CxC — buscamos si existe; caller decide qué hacer si hay cobros aplicados
  // (venta-anular endpoint bloquea; SIFEN cancel deja pasar).
  let cxcId: string | null = null;
  let cxcTuvoCobros = false;
  if (venta.tipo_venta === "CREDITO") {
    const cxcQ = await sb
      .from("cuentas_por_cobrar")
      .select("id, saldo, total, estado")
      .eq("venta_id", ventaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (cxcQ.error) return { ok: false, message: cxcQ.error.message, status: 400 };
    if (cxcQ.data) {
      const cxc = cxcQ.data as { id: string; saldo: number | string; total: number | string };
      cxcId = cxc.id;
      const saldo = Number(cxc.saldo);
      const total = Number(cxc.total);
      cxcTuvoCobros = Number.isFinite(saldo) && Number.isFinite(total) && saldo < total;
    }
  }

  const movsQ = await sb
    .from("movimientos_inventario")
    .select("id, producto_id, producto_nombre, producto_sku, cantidad, costo_unitario, tipo")
    .eq("venta_id", ventaId)
    .eq("empresa_id", empresaId)
    .eq("tipo", "SALIDA");
  if (movsQ.error) return { ok: false, message: movsQ.error.message, status: 400 };
  const movs = (movsQ.data ?? []) as MovimientoRow[];

  const nowIso = new Date().toISOString();
  const referencia = `Anulación ${venta.numero_control}`;

  const entradasInsertadas: string[] = [];
  const stockPrevio: Array<{ producto_id: string; stock_actual: number }> = [];
  // Cantidades de lote previas a la reposición, para poder revertir si algo falla.
  const lotePrevio: Array<{ lote_id: string; cantidad: number }> = [];

  try {
    for (const m of movs) {
      const cantidad = Number(m.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

      const prodQ = await sb
        .from("productos")
        .select("id, stock_actual")
        .eq("id", m.producto_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (prodQ.error) throw new Error(prodQ.error.message);
      if (!prodQ.data) continue; // producto borrado: reintegro no aplica.
      const prod = prodQ.data as { id: string; stock_actual: number | string };
      const stockActual = Number(prod.stock_actual);
      const nuevoStock = stockActual + cantidad;

      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", m.producto_id)
        .eq("empresa_id", empresaId);
      if (upd.error) throw new Error(upd.error.message);
      stockPrevio.push({ producto_id: m.producto_id, stock_actual: stockActual });

      const ins = await sb
        .from("movimientos_inventario")
        .insert({
          empresa_id: empresaId,
          producto_id: m.producto_id,
          producto_nombre: m.producto_nombre,
          producto_sku: m.producto_sku,
          tipo: "ENTRADA",
          cantidad,
          costo_unitario: Number(m.costo_unitario) || 0,
          origen: "anulacion_venta",
          referencia,
          fecha: nowIso,
          venta_id: ventaId,
          created_by: movCreatedBy,
          usuario_nombre: movUsuarioNombre,
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      entradasInsertadas.push(String((ins.data as { id: string }).id));

      /**
       * El stock también vuelve al DEPÓSITO del que salió.
       *
       * Sin esto, anular una venta devolvía el total del producto pero dejaba
       * el desglose por depósito descontado: el sistema decía que en el
       * depósito había 6 cuando en la práctica había 10, y la diferencia no
       * aparecía en ningún lado hasta el siguiente conteo físico.
       *
       * Es best-effort a propósito: la anulación ya pasó y no se va a frenar
       * por el desglose. Si falla queda en el log y el conteo lo corrige.
       */
      if (venta.ubicacion_id) {
        try {
          const errUbi = await ajustarStockUbicacion(
            sb,
            empresaId,
            venta.ubicacion_id,
            m.producto_id,
            cantidad
          );
          if (errUbi) {
            console.error("[anular venta] no se pudo devolver stock al depósito", {
              ventaId,
              productoId: m.producto_id,
              ubicacionId: venta.ubicacion_id,
              error: errUbi,
            });
          }
        } catch (e) {
          console.error("[anular venta] excepción devolviendo stock al depósito", e);
        }
      }
    }

    // Reponer las unidades a sus lotes de origen. El stock global se repuso arriba
    // vía movimientos ENTRADA; acá devolvemos la cantidad a cada `producto_lotes`
    // usando la trazabilidad guardada en `ventas_items.lote_id`. Sin esto, el lote
    // quedaba descontado para siempre aunque la venta se anulara.
    const viLoteQ = await sb
      .from("ventas_items")
      .select("lote_id, cantidad")
      .eq("venta_id", ventaId)
      .eq("empresa_id", empresaId)
      .not("lote_id", "is", null);
    if (viLoteQ.error) throw new Error(viLoteQ.error.message);
    const reponerPorLote = new Map<string, number>();
    for (const r of (viLoteQ.data ?? []) as Array<{ lote_id: string | null; cantidad: number | string }>) {
      if (!r.lote_id) continue;
      const q = Number(r.cantidad) || 0;
      if (q <= 0) continue;
      reponerPorLote.set(r.lote_id, (reponerPorLote.get(r.lote_id) ?? 0) + q);
    }
    for (const [loteId, qty] of reponerPorLote) {
      const lq = await sb
        .from("producto_lotes")
        .select("cantidad")
        .eq("id", loteId)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (lq.error) throw new Error(lq.error.message);
      if (!lq.data) continue; // lote borrado: no se repone.
      const actual = Number((lq.data as { cantidad: number | string }).cantidad) || 0;
      const updLote = await sb
        .from("producto_lotes")
        .update({ cantidad: actual + qty })
        .eq("id", loteId)
        .eq("empresa_id", empresaId);
      if (updLote.error) throw new Error(updLote.error.message);
      lotePrevio.push({ lote_id: loteId, cantidad: actual });
    }

    // Anular CxC (si existe). El caller ya decidió si permite o no cobros.
    if (cxcId) {
      const updCxc = await sb
        .from("cuentas_por_cobrar")
        .update({ estado: "anulado", saldo: 0 })
        .eq("id", cxcId)
        .eq("empresa_id", empresaId);
      if (updCxc.error) throw new Error(updCxc.error.message);
    }

    const updVenta = await sb
      .from("ventas")
      .update({
        estado: "anulada",
        anulada_at: nowIso,
        anulada_por: userId,
        anulacion_motivo: motivo,
      })
      .eq("id", ventaId)
      .eq("empresa_id", empresaId);
    if (updVenta.error) throw new Error(updVenta.error.message);

    /**
     * Devolver el anticipo que esta venta había consumido.
     *
     * Si la venta se anula, la mercadería vuelve al stock y la plata tiene que
     * volver al cliente: si no, le queda un anticipo gastado por una venta que
     * ya no existe. Se devuelve sobre los anticipos que quedaron atados a esta
     * venta, del último al primero.
     *
     * Lo que no se pueda devolver se informa en `anticipoSinDevolver` en vez de
     * quedar en silencio. Pasa en un caso real: un anticipo que alimentó DOS
     * ventas guarda solo la última, así que al anular la primera no se lo
     * encuentra. Es raro y es plata: tiene que avisar.
     */
    let anticipoDevuelto = 0;
    let anticipoSinDevolver = 0;
    const anticipoVenta = Math.max(0, Number(venta.anticipo_aplicado) || 0);
    if (anticipoVenta > 0) {
      try {
        const aQ = await sb
          .from("anticipos")
          .select("id, monto, monto_utilizado, estado")
          .eq("empresa_id", empresaId)
          .eq("venta_id", ventaId)
          .order("fecha", { ascending: false });
        if (aQ.error) throw new Error(aQ.error.message);
        let restante = anticipoVenta;
        for (const row of (aQ.data ?? []) as Array<Record<string, unknown>>) {
          if (restante <= 0) break;
          const usado = Number(row.monto_utilizado) || 0;
          const devolver = Math.min(usado, restante);
          if (devolver <= 0) continue;
          const upd = await sb
            .from("anticipos")
            .update({
              monto_utilizado: usado - devolver,
              // Vuelve a estar disponible: el estado tiene que acompañar al saldo.
              estado: "activo",
              updated_at: nowIso,
            })
            .eq("empresa_id", empresaId)
            .eq("id", String(row.id))
            .eq("monto_utilizado", usado)
            .select("id");
          if (upd.error) throw new Error(upd.error.message);
          if (!upd.data || (upd.data as unknown[]).length === 0) continue;
          restante -= devolver;
          anticipoDevuelto += devolver;
        }
        anticipoSinDevolver = Math.max(0, restante);
      } catch (e) {
        console.error("[anular venta] no se pudo devolver el anticipo", {
          ventaId,
          anticipoVenta,
          error: e instanceof Error ? e.message : e,
        });
        anticipoSinDevolver = anticipoVenta - anticipoDevuelto;
      }
    }

    return {
      ok: true,
      alreadyAnulada: false,
      stockReintegrado: entradasInsertadas.length,
      numeroControl: venta.numero_control,
      anticipoDevuelto,
      anticipoSinDevolver,
    };
  } catch (e) {
    // Rollback best-effort: revertir stock, lotes e inserciones.
    for (const s of stockPrevio) {
      try {
        await sb
          .from("productos")
          .update({ stock_actual: s.stock_actual })
          .eq("id", s.producto_id)
          .eq("empresa_id", empresaId);
      } catch {}
    }
    for (const l of lotePrevio) {
      try {
        await sb
          .from("producto_lotes")
          .update({ cantidad: l.cantidad })
          .eq("id", l.lote_id)
          .eq("empresa_id", empresaId);
      } catch {}
    }
    if (entradasInsertadas.length > 0) {
      try {
        await sb
          .from("movimientos_inventario")
          .delete()
          .in("id", entradasInsertadas)
          .eq("empresa_id", empresaId);
      } catch {}
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Error al anular la venta.",
      hasCobros: cxcTuvoCobros,
      status: 500,
    };
  }
}

/**
 * Chequeo previo para el endpoint /api/ventas/[id]/anular: si hay cobros
 * aplicados sobre la CxC de la venta, retorna true (el caller responde 409).
 * El helper anularVentaCore por sí solo NO bloquea por esto — es el caller
 * el que decide.
 */
export async function ventaTieneCobrosAplicados(
  sb: AppSupabaseClient,
  empresaId: string,
  ventaId: string
): Promise<boolean> {
  const cxcQ = await sb
    .from("cuentas_por_cobrar")
    .select("saldo, total")
    .eq("venta_id", ventaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (cxcQ.error || !cxcQ.data) return false;
  const c = cxcQ.data as { saldo: number | string; total: number | string };
  const saldo = Number(c.saldo);
  const total = Number(c.total);
  return Number.isFinite(saldo) && Number.isFinite(total) && saldo < total;
}
