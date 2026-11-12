import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { formatoPreimpreso, type FormatoPreimpreso } from "@/lib/facturacion/preimpresa";

export type TipoPapel = "preimpresa" | "autoimpresor";

/**
 * Tipo de papel y formato del talonario (script 87). Sin el script: se asume
 * talonario preimpreso con el formato por defecto, que es lo que usa el cliente.
 */
export async function leerPreimpresa(schemaRaw: string, empresaId: string): Promise<{ tipo_papel: TipoPapel; formato: FormatoPreimpreso; falta_script: boolean }> {
  const pool = getChatPostgresPool();
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!pool) return { tipo_papel: "preimpresa", formato: formatoPreimpreso(null), falta_script: false };
  try {
    const t = quoteSchemaTable(schema, "empresa_autoimpresor_config");
    const r = await pool.query(`SELECT tipo_papel, formato_preimpreso FROM ${t} WHERE empresa_id = $1::uuid`, [empresaId]);
    const row = r.rows[0] as { tipo_papel?: string; formato_preimpreso?: unknown } | undefined;
    return {
      tipo_papel: row?.tipo_papel === "autoimpresor" ? "autoimpresor" : "preimpresa",
      formato: formatoPreimpreso(row?.formato_preimpreso ?? null),
      falta_script: false,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/tipo_papel|formato_preimpreso/.test(m)) return { tipo_papel: "preimpresa", formato: formatoPreimpreso(null), falta_script: true };
    throw e;
  }
}

export async function guardarPreimpresa(schemaRaw: string, empresaId: string, tipo: TipoPapel, formato: FormatoPreimpreso): Promise<void> {
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Sin conexión a la base.");
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "empresa_autoimpresor_config");
  const r = await pool.query(
    `UPDATE ${t} SET tipo_papel = $2, formato_preimpreso = $3::jsonb, updated_at = now() WHERE empresa_id = $1::uuid`,
    [empresaId, tipo, JSON.stringify(formato)]
  );
  if ((r.rowCount ?? 0) === 0) throw new Error("Primero guardá los datos del timbrado.");
}
