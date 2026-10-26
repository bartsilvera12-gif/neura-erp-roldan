import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Stock físico, reservado y disponible (punto 9.2).
 *
 * ── QUÉ CUENTA COMO RESERVADO ──────────────────────────────────────────────
 *   La mercadería comprometida en presupuestos que el cliente ya APROBÓ y que
 *   todavía no se convirtieron en venta.
 *
 *   No cuentan los presupuestos en estado "creado" ni "enviado": cotizar es
 *   gratis y una cotización que nadie aceptó no compromete nada. Si contaran,
 *   el disponible bajaría cada vez que alguien pide un precio y el mostrador
 *   terminaría ignorando el número.
 *
 *   Tampoco cuentan los vencidos. Un presupuesto aprobado con validez de 15
 *   días que quedó sin convertir hace dos meses no tiene por qué seguir
 *   tapando mercadería: el precio ya no rige, así que la reserva tampoco.
 *
 * ── POR QUÉ SE CALCULA Y NO SE GUARDA ──────────────────────────────────────
 *   Una columna `stock_reservado` en productos habría que mantener al día en
 *   cada aprobación, cada conversión, cada vencimiento y cada edición de
 *   presupuesto. El primer camino que se olvide deja el número mintiendo para
 *   siempre, y un reservado que miente es peor que no tenerlo. Calculado desde
 *   los presupuestos no se puede desincronizar.
 *
 *   El costo es una consulta más al abrir el formulario. Es un precio barato
 *   por un número que siempre dice la verdad.
 */

/** Estados que comprometen mercadería. */
const ESTADOS_QUE_RESERVAN = ["aprobado"] as const;

const CHUNK = 500;

export type ReservaProducto = {
  producto_id: string;
  /** Unidades comprometidas en presupuestos aprobados vigentes. */
  reservado: number;
  /** Cuántos presupuestos la comprometen (para poder explicar el número). */
  presupuestos: number;
};

/** Hoy en Paraguay (UTC−3), sin depender de la tzdata del server. */
function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Unidades reservadas por producto. Si no se pasan `productoIds`, devuelve
 * todos los productos con reserva.
 */
export async function reservasPorProducto(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string | null,
  productoIds?: string[]
): Promise<Map<string, ReservaProducto>> {
  const out = new Map<string, ReservaProducto>();

  // 1) Los presupuestos que reservan: aprobados, no convertidos y vigentes.
  let qb = sb
    .from("presupuestos")
    .select("id, fecha_vencimiento, convertido_venta_id")
    .eq("empresa_id", empresaId)
    .in("estado", ESTADOS_QUE_RESERVAN as unknown as string[]);
  if (sucursalId) qb = qb.eq("sucursal_id", sucursalId);

  const pres = await qb.limit(1000);
  if (pres.error) throw new Error(pres.error.message);

  const hoy = hoyPy();
  const ids = ((pres.data ?? []) as Array<Record<string, unknown>>)
    // Un presupuesto ya convertido en venta no reserva: el stock se descontó
    // de verdad al facturar, contarlo de nuevo lo restaría dos veces.
    .filter((p) => p.convertido_venta_id == null)
    .filter((p) => {
      const v = p.fecha_vencimiento == null ? null : String(p.fecha_vencimiento).slice(0, 10);
      return v == null || v >= hoy;
    })
    .map((p) => String(p.id));

  if (ids.length === 0) return out;

  // 2) Sus ítems. PostgREST corta en 1000 filas por consulta, así que los
  //    presupuestos van por tandas.
  for (let i = 0; i < ids.length; i += CHUNK) {
    const tanda = ids.slice(i, i + CHUNK);
    let iq = sb
      .from("presupuesto_items")
      .select("presupuesto_id, producto_id, cantidad")
      .eq("empresa_id", empresaId)
      .in("presupuesto_id", tanda);
    if (productoIds && productoIds.length > 0) iq = iq.in("producto_id", productoIds);

    const items = await iq.limit(1000);
    if (items.error) throw new Error(items.error.message);

    const vistos = new Map<string, Set<string>>();
    for (const it of (items.data ?? []) as Array<Record<string, unknown>>) {
      const pid = it.producto_id == null ? "" : String(it.producto_id);
      // Una línea escrita a mano, sin producto del catálogo, no reserva nada:
      // no hay stock al que descontárselo.
      if (!pid) continue;
      const cant = Number(it.cantidad) || 0;
      if (cant <= 0) continue;

      const act = out.get(pid) ?? { producto_id: pid, reservado: 0, presupuestos: 0 };
      act.reservado += cant;
      out.set(pid, act);

      // Dos líneas del mismo producto en el mismo presupuesto cuentan como un
      // presupuesto, no como dos.
      const set = vistos.get(pid) ?? new Set<string>();
      set.add(String(it.presupuesto_id ?? ""));
      vistos.set(pid, set);
    }
    for (const [pid, set] of vistos) {
      const act = out.get(pid);
      if (act) act.presupuestos += set.size;
    }
  }

  return out;
}

export type ExistenciaProducto = {
  producto_id: string;
  nombre: string;
  sku: string;
  /** Lo que hay en el depósito. */
  fisico: number;
  /** Comprometido en presupuestos aprobados vigentes. */
  reservado: number;
  /** físico − reservado. Puede dar negativo: ver abajo. */
  disponible: number;
};

/**
 * Físico / reservado / disponible de una lista de productos.
 *
 * EL DISPONIBLE PUEDE SER NEGATIVO Y SE DEJA ASÍ A PROPÓSITO
 *   Si hay 10 en el depósito y 14 comprometidos, el disponible es −4. Cortarlo
 *   en cero mostraría "0 disponible", que suena a "no queda nada" cuando el
 *   problema real es otro: hay cuatro unidades prometidas que no existen y
 *   alguien las va a venir a buscar. El número negativo es el aviso.
 */
export async function existenciasConReserva(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string | null,
  productoIds: string[]
): Promise<ExistenciaProducto[]> {
  if (productoIds.length === 0) return [];

  const reservas = await reservasPorProducto(sb, empresaId, sucursalId, productoIds);

  const filas: ExistenciaProducto[] = [];
  for (let i = 0; i < productoIds.length; i += CHUNK) {
    const tanda = productoIds.slice(i, i + CHUNK);
    let pq = sb
      .from("productos")
      .select("id, nombre, sku, stock_actual")
      .eq("empresa_id", empresaId)
      .in("id", tanda);
    if (sucursalId) pq = pq.eq("sucursal_id", sucursalId);

    const prods = await pq.limit(1000);
    if (prods.error) throw new Error(prods.error.message);

    for (const p of (prods.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(p.id);
      const fisico = Number(p.stock_actual) || 0;
      const reservado = reservas.get(id)?.reservado ?? 0;
      filas.push({
        producto_id: id,
        nombre: String(p.nombre ?? ""),
        sku: String(p.sku ?? ""),
        fisico,
        reservado,
        disponible: fisico - reservado,
      });
    }
  }
  return filas;
}
