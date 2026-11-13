import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

const CONFIG_FIELDS = [
  // Compras
  "cuenta_iva_credito_5_id",
  "cuenta_iva_credito_10_id",
  "cuenta_proveedores_id",
  "cuenta_caja_id",
  "cuenta_banco_id",
  // Ventas (Fase 0)
  "cuenta_iva_debito_5_id",
  "cuenta_iva_debito_10_id",
  "cuenta_ventas_gravadas_id",
  "cuenta_ventas_exentas_id",
  "cuenta_ventas_servicios_id",
  "cuenta_clientes_id",
  "cuenta_anticipos_clientes_id",
  // Caja (script 88): sobrantes y faltantes de las ventas en efectivo.
  "cuenta_sobrantes_caja_id",
  "cuenta_faltantes_caja_id",
] as const;
type ConfigField = (typeof CONFIG_FIELDS)[number];

/** Campos que llegan con un script posterior: si la columna no está, se omiten. */
const CAMPOS_OPCIONALES: readonly ConfigField[] = ["cuenta_sobrantes_caja_id", "cuenta_faltantes_caja_id"];

/** Los campos que existen como columna en este tenant. */
async function camposDisponibles(schema: string): Promise<ConfigField[]> {
  const { rows } = await pool().query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'configuracion_contable'`,
    [schema]
  );
  const hay = new Set(rows.map((r) => r.column_name));
  return CONFIG_FIELDS.filter((f) => !CAMPOS_OPCIONALES.includes(f) || hay.has(f));
}

/** ¿Falta correr el script 88 (cuentas de sobrantes y faltantes)? */
export async function faltaScriptSobrantes(schemaRaw: string): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  return !(await camposDisponibles(schema)).includes("cuenta_sobrantes_caja_id");
}

const EMPTY_CONFIG: ConfigContableView = {
  cuenta_iva_credito_5_id: null, cuenta_iva_credito_10_id: null, cuenta_proveedores_id: null,
  cuenta_caja_id: null, cuenta_banco_id: null,
  cuenta_iva_debito_5_id: null, cuenta_iva_debito_10_id: null, cuenta_ventas_gravadas_id: null,
  cuenta_ventas_exentas_id: null, cuenta_ventas_servicios_id: null, cuenta_clientes_id: null,
  cuenta_anticipos_clientes_id: null,
  cuenta_sobrantes_caja_id: null, cuenta_faltantes_caja_id: null,
};

export type ConfigContableView = Record<ConfigField, string | null>;

export async function getConfigView(schemaRaw: string, empresaId: string): Promise<ConfigContableView> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "configuracion_contable");
  const cols = (await camposDisponibles(schema)).join(", ");
  const { rows } = await pool().query<ConfigContableView>(
    `SELECT ${cols} FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  return { ...EMPTY_CONFIG, ...(rows[0] ?? {}) };
}

/** Guarda la configuración; valida que cada cuenta elegida sea activa + asentable. */
export async function saveConfig(schemaRaw: string, empresaId: string, body: Record<string, unknown>, userId: string | null): Promise<ConfigContableView> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "configuracion_contable");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");

  const values: Record<ConfigField, string | null> = { ...EMPTY_CONFIG };
  const idsToValidate: string[] = [];
  for (const f of CONFIG_FIELDS) {
    const v = body[f];
    const s = v == null || String(v).trim() === "" ? null : String(v).trim();
    values[f] = s;
    if (s) idsToValidate.push(s);
  }
  if (idsToValidate.length > 0) {
    const uniq = Array.from(new Set(idsToValidate));
    const { rows } = await pool().query<{ id: string }>(
      `SELECT id FROM ${tPC} WHERE empresa_id = $1::uuid AND activo = true AND asentable = true AND id = ANY($2::uuid[])`,
      [empresaId, uniq]
    );
    const ok = new Set(rows.map((r) => r.id));
    if (uniq.some((id) => !ok.has(id))) {
      throw new ContabilidadError("Solo se pueden elegir cuentas activas y asentables (no agrupadoras). Creá una subcuenta asentable en el Plan de Cuentas si hace falta.");
    }
  }

  // INSERT/UPDATE dinámico sobre todos los campos (compras + ventas).
  // $1 = empresa_id; $2..$(n+1) = campos; $(n+2) = updated_by.
  const campos = await camposDisponibles(schema);
  const cols = campos.join(", ");
  const insertVals = campos.map((_, i) => `$${i + 2}::uuid`).join(", ");
  const updateSet = campos.map((f) => `${f} = EXCLUDED.${f}`).join(", ");
  const params = [empresaId, ...campos.map((f) => values[f]), userId];
  await pool().query(
    `INSERT INTO ${t} (empresa_id, ${cols}, updated_by)
     VALUES ($1::uuid, ${insertVals}, $${campos.length + 2}::uuid)
     ON CONFLICT (empresa_id) DO UPDATE SET
       ${updateSet},
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    params
  );
  return getConfigView(schema, empresaId);
}

export interface PeriodoRow {
  id: string; anio: number; mes: number; fecha_desde: string; fecha_hasta: string;
  estado: string; cerrado_at: string | null;
}

export async function listPeriodos(schemaRaw: string, empresaId: string): Promise<PeriodoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "periodos_contables");
  const { rows } = await pool().query<PeriodoRow>(
    `SELECT id, anio, mes, fecha_desde, fecha_hasta, estado, cerrado_at
       FROM ${t} WHERE empresa_id = $1::uuid ORDER BY anio DESC, mes DESC`,
    [empresaId]
  );
  return rows;
}

/** Crea/actualiza el período (anio, mes) con el estado dado (abierto|cerrado). */
export async function upsertPeriodo(schemaRaw: string, empresaId: string, anio: number, mes: number, estado: "abierto" | "cerrado", userId: string | null): Promise<PeriodoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ContabilidadError("Año/mes inválido.");
  }
  if (estado !== "abierto" && estado !== "cerrado") throw new ContabilidadError("Estado de período inválido.");
  const t = quoteSchemaTable(schema, "periodos_contables");
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const hastaDay = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(hastaDay).padStart(2, "0")}`;
  const cerrado = estado === "cerrado";
  const { rows } = await pool().query<PeriodoRow>(
    `INSERT INTO ${t} (empresa_id, anio, mes, fecha_desde, fecha_hasta, estado, cerrado_by, cerrado_at)
     VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6, $7::uuid, ${cerrado ? "now()" : "NULL"})
     ON CONFLICT (empresa_id, anio, mes) DO UPDATE SET
       estado = EXCLUDED.estado,
       cerrado_by = CASE WHEN EXCLUDED.estado='cerrado' THEN $7::uuid ELSE NULL END,
       cerrado_at = CASE WHEN EXCLUDED.estado='cerrado' THEN now() ELSE NULL END,
       updated_at = now()
     RETURNING id, anio, mes, fecha_desde, fecha_hasta, estado, cerrado_at`,
    [empresaId, anio, mes, desde, hasta, estado, userId]
  );
  return rows[0];
}
