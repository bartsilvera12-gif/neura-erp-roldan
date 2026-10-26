import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Edición de una venta ya emitida (punto 2.2).
 *
 * POR QUÉ ESTO USA EL POOL PG Y NO PostgREST COMO LA CREACIÓN
 *   Crear una venta sin transacción es tolerable: si algo falla se borra la
 *   venta recién creada y no quedó nada. Editar es otra cosa — la operación
 *   devuelve al stock lo que tenía la versión vieja y recién después descuenta
 *   lo de la nueva. Si el proceso se corta en el medio, el stock queda inflado
 *   con mercadería que nunca volvió al depósito, la venta conserva sus ítems
 *   viejos, y nadie se entera hasta el próximo inventario.
 *
 *   Por eso va todo en una transacción de verdad. Si el pool directo no está
 *   disponible, la edición se rechaza: es mejor no poder editar que editar a
 *   medias.
 *
 * QUÉ SE PUEDE EDITAR
 *   Todo: ítems, cantidades, precios, IVA, cliente, tipo de venta, método de
 *   pago y plazo. Es una decisión del cliente, tomada explícitamente.
 *
 *   El número de comprobante NO cambia nunca. Editar no es emitir otro
 *   comprobante; si hiciera falta uno nuevo, eso es una venta nueva.
 *
 *   Una venta ANULADA no se edita. Anulada es un estado final: ya devolvió su
 *   stock y ya no representa una operación viva.
 *
 * SOBRE LAS VENTAS FACTURADAS
 *   No se bloquean, por pedido expreso del cliente. Queda registrado en el
 *   historial que esa venta tenía factura al momento de editarse.
 */

export interface ItemEditado {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  precio_venta_original: number;
  tipo_iva: "EXENTA" | "5%" | "10%";
  subtotal: number;
  monto_iva: number;
  total_linea: number;
}

export interface EditarVentaParams {
  schema: string;
  empresaId: string;
  sucursalId: string;
  ventaId: string;
  motivo: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  items: ItemEditado[];
  clienteId?: string | null;
  tipoVenta?: "CONTADO" | "CREDITO";
  metodoPago?: string | null;
  plazoDias?: number | null;
}

export interface Cambio {
  campo: string;
  antes: unknown;
  despues: unknown;
}

export interface ResultadoEdicion {
  ventaId: string;
  numeroControl: string;
  cambios: Cambio[];
  totalAntes: number;
  totalDespues: number;
  teniaFactura: boolean;
}

/** Error que el endpoint traduce a un 4xx con el mensaje tal cual. */
export class EdicionRechazada extends Error {
  readonly status: number;
  constructor(mensaje: string, status = 400) {
    super(mensaje);
    this.name = "EdicionRechazada";
    this.status = status;
  }
}

const TOL = 2;

/** Compara dos números con la tolerancia de redondeo a guaraníes. */
const igualNum = (a: number, b: number) => Math.abs((a || 0) - (b || 0)) <= TOL;

/** Texto corto de una línea, para el diff. */
function resumirItem(i: {
  producto_nombre: string; cantidad: number; precio_venta: number; tipo_iva: string;
}): string {
  return `${i.producto_nombre} ×${i.cantidad} a ${Math.round(i.precio_venta)} (IVA ${i.tipo_iva})`;
}

/**
 * Compara los ítems viejos con los nuevos y devuelve un cambio por producto
 * afectado, no uno por campo.
 *
 * Se agrupa por producto porque es como lo lee una persona: "TORNILLO pasó de
 * 10 a 8 unidades" se entiende; "items[2].cantidad: 10 → 8" hay que
 * descifrarlo.
 */
function diffItems(viejos: ItemEditado[], nuevos: ItemEditado[]): Cambio[] {
  const cambios: Cambio[] = [];
  const porId = (lista: ItemEditado[]) => {
    const m = new Map<string, ItemEditado>();
    for (const i of lista) {
      const prev = m.get(i.producto_id);
      // Mismo producto cargado en dos líneas: se suman para comparar.
      if (prev) {
        m.set(i.producto_id, {
          ...prev,
          cantidad: prev.cantidad + i.cantidad,
          subtotal: prev.subtotal + i.subtotal,
          monto_iva: prev.monto_iva + i.monto_iva,
          total_linea: prev.total_linea + i.total_linea,
        });
      } else {
        m.set(i.producto_id, { ...i });
      }
    }
    return m;
  };

  const a = porId(viejos);
  const b = porId(nuevos);

  for (const [id, viejo] of a) {
    const nuevo = b.get(id);
    if (!nuevo) {
      cambios.push({ campo: `Producto quitado`, antes: resumirItem(viejo), despues: null });
      continue;
    }
    if (
      viejo.cantidad !== nuevo.cantidad ||
      !igualNum(viejo.precio_venta, nuevo.precio_venta) ||
      viejo.tipo_iva !== nuevo.tipo_iva
    ) {
      cambios.push({
        campo: viejo.producto_nombre,
        antes: resumirItem(viejo),
        despues: resumirItem(nuevo),
      });
    }
  }
  for (const [id, nuevo] of b) {
    if (!a.has(id)) {
      cambios.push({ campo: `Producto agregado`, antes: null, despues: resumirItem(nuevo) });
    }
  }
  return cambios;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) {
    throw new EdicionRechazada(
      "No hay conexión directa a la base. Editar una venta mueve stock y tiene que poder deshacerse entero si algo falla, así que no se hace sin transacción.",
      503
    );
  }
  return p;
}

export async function editarVentaPg(params: EditarVentaParams): Promise<ResultadoEdicion> {
  const schema = assertAllowedChatDataSchema(params.schema);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tE = quoteSchemaTable(schema, "ventas_ediciones");

  if (!params.items.length) {
    throw new EdicionRechazada("La venta tiene que quedar con al menos un producto.");
  }
  if (!params.motivo.trim()) {
    throw new EdicionRechazada("Escribí el motivo del cambio.");
  }

  const totalDespues = params.items.reduce((s, i) => s + (Number(i.total_linea) || 0), 0);
  const subtotalDespues = params.items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0);
  const ivaDespues = params.items.reduce((s, i) => s + (Number(i.monto_iva) || 0), 0);

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // ── 1) La venta, bloqueada ────────────────────────────────────────────
    // FOR UPDATE: sin el lock, dos ediciones simultáneas revertirían el stock
    // dos veces sobre los mismos ítems viejos.
    const vQ = await client.query<{
      id: string; numero_control: string; estado: string | null; total: string;
      cliente_id: string | null; tipo_venta: string | null; metodo_pago: string | null;
      plazo_dias: number | null; factura_id: string | null;
    }>(
      `SELECT id, numero_control, estado, total, cliente_id, tipo_venta, metodo_pago,
              plazo_dias, factura_id
         FROM ${tV}
        WHERE id = $1::uuid AND empresa_id = $2::uuid AND sucursal_id = $3::uuid
        FOR UPDATE`,
      [params.ventaId, params.empresaId, params.sucursalId]
    );
    const venta = vQ.rows[0];
    if (!venta) throw new EdicionRechazada("Venta no encontrada.", 404);
    if (String(venta.estado ?? "") === "anulada") {
      throw new EdicionRechazada(
        "La venta está anulada: ya devolvió su stock y no representa una operación viva. No se puede editar.",
        409
      );
    }

    // ── 2) Ítems actuales ─────────────────────────────────────────────────
    const iQ = await client.query<{
      producto_id: string; producto_nombre: string; sku: string | null;
      cantidad: string; precio_venta: string; precio_venta_original: string | null;
      tipo_iva: string; subtotal: string; monto_iva: string; total_linea: string;
    }>(
      `SELECT producto_id::text AS producto_id, producto_nombre, sku, cantidad,
              precio_venta, precio_venta_original, tipo_iva, subtotal, monto_iva, total_linea
         FROM ${tVI}
        WHERE venta_id = $1::uuid AND empresa_id = $2::uuid
        ORDER BY created_at NULLS FIRST, id`,
      [params.ventaId, params.empresaId]
    );
    const viejos: ItemEditado[] = iQ.rows.map((r) => ({
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      sku: r.sku,
      cantidad: Number(r.cantidad) || 0,
      precio_venta: Number(r.precio_venta) || 0,
      precio_venta_original: Number(r.precio_venta_original ?? r.precio_venta) || 0,
      tipo_iva: (r.tipo_iva as ItemEditado["tipo_iva"]) ?? "10%",
      subtotal: Number(r.subtotal) || 0,
      monto_iva: Number(r.monto_iva) || 0,
      total_linea: Number(r.total_linea) || 0,
    }));

    // ── 3) Qué cambió ─────────────────────────────────────────────────────
    const cambios: Cambio[] = [];
    const totalAntes = Number(venta.total) || 0;

    if (params.clienteId !== undefined && (params.clienteId ?? null) !== (venta.cliente_id ?? null)) {
      cambios.push({ campo: "Cliente", antes: venta.cliente_id, despues: params.clienteId ?? null });
    }
    if (params.tipoVenta && params.tipoVenta !== (venta.tipo_venta ?? "CONTADO")) {
      cambios.push({ campo: "Tipo de venta", antes: venta.tipo_venta, despues: params.tipoVenta });
    }
    if (params.metodoPago !== undefined && (params.metodoPago ?? null) !== (venta.metodo_pago ?? null)) {
      cambios.push({ campo: "Método de pago", antes: venta.metodo_pago, despues: params.metodoPago ?? null });
    }
    if (params.plazoDias !== undefined && (params.plazoDias ?? null) !== (venta.plazo_dias ?? null)) {
      cambios.push({ campo: "Plazo (días)", antes: venta.plazo_dias, despues: params.plazoDias ?? null });
    }
    cambios.push(...diffItems(viejos, params.items));
    if (!igualNum(totalAntes, totalDespues)) {
      cambios.push({ campo: "Total", antes: totalAntes, despues: totalDespues });
    }

    if (cambios.length === 0) {
      throw new EdicionRechazada("No hay nada que cambiar: la venta quedó igual.");
    }

    // ── 4) Devolver al stock lo de la versión vieja ───────────────────────
    // Primero se devuelve TODO y recién después se descuenta lo nuevo. Hacerlo
    // al revés fallaría por stock insuficiente en el caso más común: editar la
    // cantidad de un producto que se llevó casi todo el stock.
    for (const v of viejos) {
      if (v.cantidad <= 0) continue;
      await client.query(
        `UPDATE ${tP} SET stock_actual = COALESCE(stock_actual,0) + $1::numeric, updated_at = now()
          WHERE id = $2::uuid AND empresa_id = $3::uuid AND COALESCE(controla_stock, true)`,
        [v.cantidad, v.producto_id, params.empresaId]
      );
      await client.query(
        `INSERT INTO ${tM} (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
                            tipo, cantidad, costo_unitario, origen, referencia, fecha,
                            created_by, usuario_nombre, venta_id)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5, 'ENTRADA', $6::numeric,
                COALESCE(p.costo_promedio, 0), 'edicion_venta_reversa',
                $7, now(), $8::uuid, $9, $10::uuid
           FROM ${tP} p WHERE p.id = $3::uuid AND p.empresa_id = $1::uuid`,
        [params.empresaId, params.sucursalId, v.producto_id, v.producto_nombre, v.sku,
         v.cantidad, `Edición de ${venta.numero_control}: devuelve la versión anterior`,
         params.usuarioId, params.usuarioNombre, params.ventaId]
      );
    }

    // ── 5) Descontar lo de la versión nueva ───────────────────────────────
    for (const n of params.items) {
      if (n.cantidad <= 0) {
        throw new EdicionRechazada(`La cantidad de "${n.producto_nombre}" tiene que ser mayor a cero.`);
      }
      const pQ = await client.query<{ stock_actual: string; controla: boolean; nombre: string }>(
        `SELECT COALESCE(stock_actual,0) AS stock_actual,
                COALESCE(controla_stock, true) AS controla, nombre
           FROM ${tP}
          WHERE id = $1::uuid AND empresa_id = $2::uuid AND sucursal_id = $3::uuid
          FOR UPDATE`,
        [n.producto_id, params.empresaId, params.sucursalId]
      );
      const prod = pQ.rows[0];
      if (!prod) {
        throw new EdicionRechazada(`"${n.producto_nombre}" no existe en esta sucursal.`);
      }
      if (prod.controla) {
        const disponible = Number(prod.stock_actual) || 0;
        if (disponible < n.cantidad) {
          throw new EdicionRechazada(
            `No alcanza el stock de "${prod.nombre}": quedan ${disponible} y la venta pide ${n.cantidad}.`
          );
        }
        await client.query(
          `UPDATE ${tP} SET stock_actual = COALESCE(stock_actual,0) - $1::numeric, updated_at = now()
            WHERE id = $2::uuid AND empresa_id = $3::uuid`,
          [n.cantidad, n.producto_id, params.empresaId]
        );
        await client.query(
          `INSERT INTO ${tM} (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
                              tipo, cantidad, costo_unitario, origen, referencia, fecha,
                              created_by, usuario_nombre, venta_id)
           SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5, 'SALIDA', $6::numeric,
                  COALESCE(p.costo_promedio, 0), 'edicion_venta',
                  $7, now(), $8::uuid, $9, $10::uuid
             FROM ${tP} p WHERE p.id = $3::uuid AND p.empresa_id = $1::uuid`,
          [params.empresaId, params.sucursalId, n.producto_id, n.producto_nombre, n.sku,
           n.cantidad, `Edición de ${venta.numero_control}: versión nueva`,
           params.usuarioId, params.usuarioNombre, params.ventaId]
        );
      }
    }

    // ── 6) Reemplazar las líneas ──────────────────────────────────────────
    await client.query(
      `DELETE FROM ${tVI} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid`,
      [params.ventaId, params.empresaId]
    );
    for (const n of params.items) {
      await client.query(
        `INSERT INTO ${tVI} (empresa_id, venta_id, producto_id, producto_nombre, sku,
                             cantidad, precio_venta, precio_venta_original, tipo_iva,
                             subtotal, monto_iva, total_linea)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::numeric, $7::numeric, $8::numeric,
                 $9, $10::numeric, $11::numeric, $12::numeric)`,
        [params.empresaId, params.ventaId, n.producto_id, n.producto_nombre, n.sku,
         n.cantidad, n.precio_venta, n.precio_venta_original, n.tipo_iva,
         n.subtotal, n.monto_iva, n.total_linea]
      );
    }

    // ── 7) Cabecera ───────────────────────────────────────────────────────
    // `numero_control` queda intacto a propósito: editar no emite otro
    // comprobante.
    await client.query(
      `UPDATE ${tV}
          SET subtotal = $1::numeric, monto_iva = $2::numeric, total = $3::numeric,
              cliente_id   = COALESCE($4::uuid, cliente_id),
              tipo_venta   = COALESCE($5, tipo_venta),
              metodo_pago  = COALESCE($6, metodo_pago),
              plazo_dias   = $7::int,
              updated_at   = now()
        WHERE id = $8::uuid AND empresa_id = $9::uuid`,
      [subtotalDespues, ivaDespues, totalDespues,
       params.clienteId ?? null, params.tipoVenta ?? null, params.metodoPago ?? null,
       params.plazoDias ?? null, params.ventaId, params.empresaId]
    );

    // ── 8) El registro de la edición ──────────────────────────────────────
    const teniaFactura = Boolean(venta.factura_id);
    await client.query(
      `INSERT INTO ${tE} (empresa_id, venta_id, venta_numero, usuario_id, usuario_nombre,
                          cambios, total_antes, total_despues, tenia_factura, motivo)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::jsonb, $7::numeric, $8::numeric, $9, $10)`,
      [params.empresaId, params.ventaId, venta.numero_control, params.usuarioId,
       params.usuarioNombre, JSON.stringify(cambios), totalAntes, totalDespues,
       teniaFactura, params.motivo.trim()]
    );

    await client.query("COMMIT");

    return {
      ventaId: params.ventaId,
      numeroControl: venta.numero_control,
      cambios,
      totalAntes,
      totalDespues,
      teniaFactura,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* la conexión ya puede estar rota */ });
    throw err;
  } finally {
    client.release();
  }
}
