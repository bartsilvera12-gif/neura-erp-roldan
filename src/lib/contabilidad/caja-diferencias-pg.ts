import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { generarAsientoEnTx } from "@/lib/contabilidad/asientos-pg";

/**
 * SOBRANTES Y FALTANTES DE CAJA → CONTABILIDAD (script 88).
 *
 * Cada diferencia de una venta en efectivo (vuelto que no se dio, o lo que se
 * aceptó de menos) es un ajuste de la caja. Además se asienta:
 *
 *   Sobrante:  Debe  Caja               / Haber  Sobrantes de caja
 *   Faltante:  Debe  Faltantes de caja  / Haber  Caja
 *
 * Las cuentas salen de Configuración → Contable. Si todavía no están
 * elegidas, el ajuste de la caja queda igual y el asiento se hace después
 * (`asentarDiferenciasPendientes`, que corre al guardar la configuración).
 *
 * Es "best effort": un problema contable nunca frena la venta ni el ajuste.
 */

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type ResultadoDiferencia =
  | { status: "contabilizado"; asientoId: string; numero: string }
  | { status: "omitido"; motivo: string }
  | { status: "error"; motivo: string };

/** El concepto que la caja le pone a estos ajustes ("Sobrante venta VTA-…"). */
export const RE_CONCEPTO_DIFERENCIA = /^(Sobrante|Faltante) venta/i;

type Cuentas = { caja: string | null; sobrantes: string | null; faltantes: string | null };

async function leerCuentas(schema: string, empresaId: string): Promise<Cuentas | null> {
  const t = quoteSchemaTable(schema, "configuracion_contable");
  try {
    const { rows } = await pool().query<{ c: string | null; s: string | null; f: string | null }>(
      `SELECT cuenta_caja_id AS c, cuenta_sobrantes_caja_id AS s, cuenta_faltantes_caja_id AS f
         FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    const r = rows[0];
    return { caja: r?.c ?? null, sobrantes: r?.s ?? null, faltantes: r?.f ?? null };
  } catch {
    return null; // falta el script 88
  }
}

/** Asienta UNA diferencia de caja (idempotente por movimiento). */
export async function contabilizarDiferenciaCaja(
  schemaRaw: string,
  empresaId: string,
  movimientoId: string,
  createdBy: string | null
): Promise<ResultadoDiferencia> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const cuentas = await leerCuentas(schema, empresaId);
  if (!cuentas) return { status: "omitido", motivo: "Falta correr el script 88." };

  const tM = quoteSchemaTable(schema, "caja_movimientos");
  const { rows } = await pool().query<{ id: string; monto: string; concepto: string; fecha: string }>(
    `SELECT id, monto::text AS monto, concepto,
            to_char((created_at AT TIME ZONE 'America/Asuncion')::date, 'YYYY-MM-DD') AS fecha
       FROM ${tM} WHERE id = $1::uuid AND empresa_id = $2::uuid AND tipo = 'ajuste'`,
    [movimientoId, empresaId]
  );
  const m = rows[0];
  if (!m || !RE_CONCEPTO_DIFERENCIA.test(m.concepto ?? "")) return { status: "omitido", motivo: "No es un sobrante ni un faltante de venta." };
  const monto = Math.round(Number(m.monto) || 0);
  if (monto === 0) return { status: "omitido", motivo: "Monto en cero." };

  const sobrante = monto > 0;
  const contra = sobrante ? cuentas.sobrantes : cuentas.faltantes;
  if (!cuentas.caja || !contra) {
    return {
      status: "omitido",
      motivo: `Falta elegir en Configuración contable la cuenta de Caja y la de ${sobrante ? "Sobrantes" : "Faltantes"} de caja.`,
    };
  }
  const importe = Math.abs(monto);
  const lineas = sobrante
    ? [
        { cuenta_contable_id: cuentas.caja, debe: importe, haber: 0, descripcion: m.concepto },
        { cuenta_contable_id: contra, debe: 0, haber: importe, descripcion: m.concepto },
      ]
    : [
        { cuenta_contable_id: contra, debe: importe, haber: 0, descripcion: m.concepto },
        { cuenta_contable_id: cuentas.caja, debe: 0, haber: importe, descripcion: m.concepto },
      ];

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const a = await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "caja_diferencia",
      origen_id: m.id,
      evento_origen: sobrante ? "sobrante_venta" : "faltante_venta",
      fecha_contable: m.fecha,
      glosa: m.concepto,
      lineas,
      createdBy,
    });
    await client.query("COMMIT");
    return { status: "contabilizado", asientoId: a.id, numero: a.numero };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    return { status: "error", motivo: e instanceof Error ? e.message : "No se pudo asentar." };
  } finally {
    client.release();
  }
}

/**
 * Asienta las diferencias que quedaron sin asiento (las de antes de elegir las
 * cuentas, o las que fallaron). Se corre al guardar la configuración contable.
 */
export async function asentarDiferenciasPendientes(
  schemaRaw: string,
  empresaId: string,
  createdBy: string | null
): Promise<{ asentadas: number; pendientes: number }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const cuentas = await leerCuentas(schema, empresaId);
  if (!cuentas?.caja || (!cuentas.sobrantes && !cuentas.faltantes)) return { asentadas: 0, pendientes: 0 };

  const tM = quoteSchemaTable(schema, "caja_movimientos");
  const tA = quoteSchemaTable(schema, "asientos_contables");
  const { rows } = await pool().query<{ id: string }>(
    `SELECT m.id FROM ${tM} m
      WHERE m.empresa_id = $1::uuid AND m.tipo = 'ajuste'
        AND (m.concepto ILIKE 'Sobrante venta%' OR m.concepto ILIKE 'Faltante venta%')
        AND NOT EXISTS (SELECT 1 FROM ${tA} a
                         WHERE a.empresa_id = m.empresa_id AND a.origen_tipo = 'caja_diferencia' AND a.origen_id = m.id)
      ORDER BY m.created_at
      LIMIT 500`,
    [empresaId]
  );
  let asentadas = 0;
  for (const r of rows) {
    const res = await contabilizarDiferenciaCaja(schema, empresaId, r.id, createdBy);
    if (res.status === "contabilizado") asentadas++;
  }
  return { asentadas, pendientes: rows.length - asentadas };
}
