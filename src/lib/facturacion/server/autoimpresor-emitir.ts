import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * FACTURA AUTOIMPRESOR: la que se imprime desde el sistema con un timbrado de
 * la SET para "autoimpresores" (no electrónica).
 *
 * Toma el próximo número del rango autorizado y crea la factura de la venta,
 * todo en UNA transacción con la configuración bloqueada: dos cajas que
 * facturan a la vez no pueden sacar el mismo número, y si algo falla el
 * número no se consume (no quedan huecos en la numeración, que la SET pide
 * correlativa).
 *
 * Controla lo que haría rechazar la factura: autoimpresor activo, timbrado
 * cargado y vigente hoy, y que el número no pase del final del rango.
 */

export class AutoimpresorError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Consumidor final, como lo pide la SET cuando el cliente no da RUC. */
export const SIN_NOMBRE = { razon_social: "SIN NOMBRE", ruc: "44444401-7" };

const hoyPy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export function formatoNumeroFactura(est: string, pto: string, numero: number): string {
  return `${est.padStart(3, "0")}-${pto.padStart(3, "0")}-${String(numero).padStart(7, "0")}`;
}

export async function emitirFacturaAutoimpresor(params: {
  schemaRaw: string;
  empresaId: string;
  sucursalId: string | null;
  ventaId: string;
}): Promise<{ factura_id: string; numero_factura: string; ya_existia: boolean }> {
  const pool = getChatPostgresPool();
  if (!pool) throw new AutoimpresorError(500, "Sin conexión a la base.");
  const schema = assertAllowedChatDataSchema(params.schemaRaw);
  const tCfg = quoteSchemaTable(schema, "empresa_autoimpresor_config");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tF = quoteSchemaTable(schema, "facturas");
  const tFI = quoteSchemaTable(schema, "factura_items");
  const tC = quoteSchemaTable(schema, "clientes");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vq = await client.query(
      `SELECT id, cliente_id, tipo_venta, total, moneda, observaciones, fecha, factura_id, estado
         FROM ${tV} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [params.ventaId, params.empresaId]
    );
    const v = vq.rows[0] as Record<string, unknown> | undefined;
    if (!v) throw new AutoimpresorError(404, "Venta no encontrada.");
    if (String(v.estado ?? "") === "anulada") throw new AutoimpresorError(409, "La venta está anulada.");

    // Ya facturada: se devuelve esa (reimprimir no saca otro número).
    if (v.factura_id) {
      const f = await client.query(`SELECT id, numero_factura FROM ${tF} WHERE id = $1::uuid`, [v.factura_id]);
      await client.query("COMMIT");
      const fr = f.rows[0] as { id: string; numero_factura: string } | undefined;
      if (fr) return { factura_id: fr.id, numero_factura: fr.numero_factura, ya_existia: true };
    }

    const cq = await client.query(`SELECT * FROM ${tCfg} WHERE empresa_id = $1::uuid FOR UPDATE`, [params.empresaId]);
    const cfg = cq.rows[0] as Record<string, unknown> | undefined;
    if (!cfg || cfg.activo !== true) {
      throw new AutoimpresorError(409, "El autoimpresor no está activo. Se configura en Configuración → Facturación.");
    }
    const est = String(cfg.establecimiento_codigo ?? "").trim();
    const pto = String(cfg.punto_expedicion_codigo ?? "").trim();
    if (!cfg.timbrado_numero || !est || !pto) {
      throw new AutoimpresorError(409, "Falta cargar el timbrado, el establecimiento o el punto de expedición en Configuración → Facturación.");
    }
    const hoy = hoyPy();
    const ini = cfg.timbrado_inicio_vigencia ? String(cfg.timbrado_inicio_vigencia).slice(0, 10) : null;
    const fin = cfg.timbrado_fin_vigencia ? String(cfg.timbrado_fin_vigencia).slice(0, 10) : null;
    if ((ini && hoy < ini) || (fin && hoy > fin)) {
      throw new AutoimpresorError(409, `El timbrado ${cfg.timbrado_numero} no está vigente hoy (${ini ?? "?"} a ${fin ?? "?"}).`);
    }
    // "N° actual" de la configuración es el PRÓXIMO número a emitir (así lo
    // valida la pantalla: no puede ser menor al inicial). Se usa ese y se
    // deja guardado el siguiente.
    const inicial = n(cfg.numero_inicial || 1);
    const siguiente = cfg.numero_actual == null ? inicial : Math.max(n(cfg.numero_actual), inicial);
    if (cfg.numero_final != null && siguiente > n(cfg.numero_final)) {
      throw new AutoimpresorError(409, `Se terminó el rango del timbrado (último número ${cfg.numero_final}). Hay que pedir uno nuevo.`);
    }
    const numeroFactura = formatoNumeroFactura(est, pto, siguiente);

    // Cliente: razón social y RUC del momento. Sin cliente, consumidor final.
    let razon = SIN_NOMBRE.razon_social, ruc = SIN_NOMBRE.ruc;
    if (v.cliente_id) {
      const cl = await client.query(`SELECT * FROM ${tC} WHERE id = $1::uuid AND empresa_id = $2::uuid`, [v.cliente_id, params.empresaId]);
      const c = cl.rows[0] as Record<string, unknown> | undefined;
      if (c) {
        razon = String(c.nombre_facturacion || c.empresa || c.nombre || c.nombre_contacto || razon).trim() || razon;
        ruc = String(c.ruc || c.documento || ruc).trim() || ruc;
      }
    }

    const esCredito = String(v.tipo_venta ?? "").toUpperCase() === "CREDITO";
    const total = n(v.total);
    const fecha = String(v.fecha ?? hoy).slice(0, 10);

    const fi = await client.query(
      `INSERT INTO ${tF} (empresa_id, sucursal_id, cliente_id, numero_factura, fecha, fecha_vencimiento,
                          monto, saldo, estado, tipo, moneda, cliente_razon_social, cliente_ruc,
                          observaciones, origen_venta_id)
       VALUES ($1::uuid, $2, $3, $4, $5::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid)
       RETURNING id`,
      [
        params.empresaId, params.sucursalId, v.cliente_id ?? null, numeroFactura, fecha,
        total, esCredito ? total : 0, esCredito ? "Pendiente" : "Pagado", esCredito ? "credito" : "contado",
        String(v.moneda ?? "") === "USD" ? "USD" : "GS", razon, ruc,
        `Autoimpresor · Timbrado ${cfg.timbrado_numero}${v.observaciones ? ` · ${String(v.observaciones)}` : ""}`.slice(0, 1000),
        params.ventaId,
      ]
    );
    const facturaId = String((fi.rows[0] as { id: string }).id);

    const items = await client.query(
      `SELECT producto_nombre, cantidad, precio_venta, subtotal, monto_iva, tipo_iva, total_linea
         FROM ${tVI} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid`,
      [params.ventaId, params.empresaId]
    );
    for (const it of items.rows as Array<Record<string, unknown>>) {
      await client.query(
        `INSERT INTO ${tFI} (empresa_id, factura_id, descripcion, cantidad, precio_unitario, subtotal, iva, tipo_iva, total)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
        [
          params.empresaId, facturaId, String(it.producto_nombre ?? "Producto"), n(it.cantidad) || 1,
          n(it.precio_venta), n(it.subtotal), n(it.monto_iva), String(it.tipo_iva ?? "10%"), n(it.total_linea),
        ]
      );
    }

    await client.query(`UPDATE ${tV} SET factura_id = $1::uuid WHERE id = $2::uuid AND empresa_id = $3::uuid`, [facturaId, params.ventaId, params.empresaId]);
    await client.query(`UPDATE ${tCfg} SET numero_actual = $1, updated_at = now() WHERE empresa_id = $2::uuid`, [siguiente + 1, params.empresaId]);

    await client.query("COMMIT");
    return { factura_id: facturaId, numero_factura: numeroFactura, ya_existia: false };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}
