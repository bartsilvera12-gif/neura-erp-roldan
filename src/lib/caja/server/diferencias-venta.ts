import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { generarAsientoEnTx } from "@/lib/contabilidad/asientos-pg";

/**
 * Al anular una venta (o devolverla entera), su sobrante o faltante de caja
 * deja de existir (pedido del cliente: «si anulo o devuelvo se debería
 * reflejar acá también»).
 *
 * El «Sobrante venta VTA-…» es lo que el cliente dejó de más al pagar (no se
 * le dio el vuelto); el «Faltante», lo que se le aceptó de menos. Si la venta
 * se deshace, esa plata vuelve con el resto: el ajuste se anula (no se borra:
 * queda con quién, cuándo y por qué) y, si estaba contabilizado, se le hace
 * el asiento inverso.
 *
 * Best-effort: si algo falla, la anulación de la venta ya está hecha.
 */
export async function anularDiferenciasDeVenta(params: {
  schemaRaw: string;
  empresaId: string;
  ventaNumero: string;
  motivo: string;
  usuarioId: string | null;
}): Promise<{ anuladas: number }> {
  const pool = getChatPostgresPool();
  if (!pool || !params.ventaNumero) return { anuladas: 0 };
  const schema = assertAllowedChatDataSchema(params.schemaRaw);
  const tM = quoteSchemaTable(schema, "caja_movimientos");
  const tA = quoteSchemaTable(schema, "asientos_contables");
  const tAD = quoteSchemaTable(schema, "asientos_contables_detalles");

  const client = await pool.connect();
  try {
    // El número va exacto al final: «VTA-000030» no tiene que tocar «VTA-0000301».
    const { rows } = await client.query<{ id: string }>(
      `UPDATE ${tM}
          SET anulado_at = now(), anulado_por_id = $3, anulado_motivo = $4
        WHERE empresa_id = $1::uuid AND tipo = 'ajuste' AND anulado_at IS NULL
          AND concepto ~* ('^(Sobrante|Faltante) venta ' || $2 || '$')
        RETURNING id`,
      [params.empresaId, params.ventaNumero.replace(/[^A-Za-z0-9-]/g, ""), params.usuarioId, params.motivo.slice(0, 500)]
    );

    // El asiento inverso de los que ya estaban contabilizados. Cada uno en su
    // transacción: si uno no se puede (período cerrado, por ejemplo), el
    // ajuste igual queda anulado y los demás siguen.
    for (const r of rows) {
     try {
      await client.query("BEGIN");
      let original: { id: string; fecha: string; glosa: string } | undefined;
      try {
        const a = await client.query<{ id: string; fecha: string; glosa: string }>(
          `SELECT id, to_char(fecha_contable, 'YYYY-MM-DD') AS fecha, glosa FROM ${tA}
            WHERE empresa_id = $1::uuid AND origen_tipo = 'caja_diferencia' AND origen_id = $2::uuid
              AND NOT EXISTS (SELECT 1 FROM ${tA} x WHERE x.asiento_original_id = ${tA}.id)
            LIMIT 1`,
          [params.empresaId, r.id]
        );
        original = a.rows[0];
      } catch { original = undefined; }
      if (!original) { await client.query("ROLLBACK").catch(() => null); continue; }
      const det = await client.query<{ cuenta_contable_id: string; debe: string; haber: string; descripcion: string | null }>(
        `SELECT cuenta_contable_id, debe::text, haber::text, descripcion FROM ${tAD} WHERE asiento_id = $1::uuid`,
        [original.id]
      );
      if (det.rows.length === 0) { await client.query("ROLLBACK").catch(() => null); continue; }
      const hoy = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
      await generarAsientoEnTx(client, schema, params.empresaId, {
        origen_tipo: "reversion",
        origen_id: r.id,
        evento_origen: "anulacion_venta",
        fecha_contable: hoy,
        glosa: `Reversa: ${original.glosa} (${params.motivo})`.slice(0, 500),
        lineas: det.rows.map((d) => ({
          cuenta_contable_id: d.cuenta_contable_id,
          debe: Number(d.haber) || 0,
          haber: Number(d.debe) || 0,
          descripcion: d.descripcion ?? original!.glosa,
        })),
        createdBy: params.usuarioId,
        asiento_original_id: original.id,
      });
      await client.query("COMMIT");
     } catch (e) {
      await client.query("ROLLBACK").catch(() => null);
      console.warn("[diferencias-venta] reversa del asiento:", e instanceof Error ? e.message : e);
     }
    }
    return { anuladas: rows.length };
  } catch (e) {
    console.warn("[diferencias-venta]", e instanceof Error ? e.message : e);
    return { anuladas: 0 };
  } finally {
    client.release();
  }
}
