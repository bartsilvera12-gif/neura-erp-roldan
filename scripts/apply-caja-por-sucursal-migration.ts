/**
 * Aplica la migración `20261023120000_caja_por_sucursal.sql` contra Supabase
 * remoto. Agrega `sucursal_id` al módulo de Caja, backfillea lo existente a la
 * sucursal principal (Casa Matriz) y cambia el índice único de caja activa a
 * (empresa_id, sucursal_id, numero_caja).
 *
 * Usa SUPABASE_DB_URL o SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL desde
 * .env.local
 *
 * npx tsx scripts/apply-caja-por-sucursal-migration.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

const MIGRATION_FILE = "20261023120000_caja_por_sucursal.sql";

function getDbUrl(): string {
  const direct = process.env.SUPABASE_DB_URL?.trim();
  if (direct) return direct;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) {
    throw new Error(
      "Falta SUPABASE_DB_URL o (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL) en .env.local"
    );
  }
  const ref = m[1];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main() {
  const migrationPath = join(process.cwd(), "supabase", "migrations", MIGRATION_FILE);
  const sql = readFileSync(migrationPath, "utf-8");

  const url = getDbUrl();
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  console.log("Conectado a Supabase. Aplicando migración de Caja por sucursal...");

  try {
    await client.query(sql);
    console.log("OK:", MIGRATION_FILE);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ERROR:", MIGRATION_FILE, msg);
    await client.end();
    process.exit(1);
  }

  // Verificación rápida: cuántas cajas/movimientos quedaron sin sucursal.
  try {
    const r1 = await client.query(
      "SELECT count(*)::int AS n FROM roldanerp.cajas WHERE sucursal_id IS NULL"
    );
    const r2 = await client.query(
      "SELECT count(*)::int AS n FROM roldanerp.caja_movimientos WHERE sucursal_id IS NULL"
    );
    console.log(`Cajas sin sucursal: ${r1.rows[0].n} · Movimientos sin sucursal: ${r2.rows[0].n}`);
    if (r1.rows[0].n > 0 || r2.rows[0].n > 0) {
      console.warn(
        "Aviso: quedaron filas sin sucursal (¿empresa sin sucursal principal marcada?). Revisá `sucursales.es_principal`."
      );
    }
  } catch {
    /* la verificación es informativa; no bloquea */
  }

  await client.end();
  console.log("Migración de Caja por sucursal aplicada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
