/**
 * Aplica TODAS las migraciones en supabase/migrations/ en orden alfabético
 * (o sea, cronológico por prefijo timestamp) al Postgres apuntado por
 * SUPABASE_DB_URL en .env.local.
 *
 * Pensado para bootstrapear el schema `roldanerp` en una Supabase compartida
 * donde `supabase db push` no sirve porque el tracker schema_migrations ya
 * tiene todos los timestamps registrados de otros tenants.
 *
 * NO toca `supabase_migrations.schema_migrations`. Es una aplicación pura
 * al Postgres. Toda migración debe ser idempotente (la mayoría lo son:
 * usan IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 *
 * Uso:  node scripts/apply-all-migrations-roldan.cjs
 *       node scripts/apply-all-migrations-roldan.cjs --from 20260610140000
 *       node scripts/apply-all-migrations-roldan.cjs --dry-run
 */
const fs = require("fs");
const path = require("path");
const { config } = require("dotenv");
const pg = require("pg");

config({ path: path.resolve(process.cwd(), ".env.local") });
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.error("Falta SUPABASE_DB_URL en .env.local");
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fromIdx = args.indexOf("--from");
const fromTs = fromIdx >= 0 ? args[fromIdx + 1] : null;

const migDir = path.resolve(process.cwd(), "supabase/migrations");
const files = fs
  .readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const filtered = fromTs ? files.filter((f) => f >= fromTs) : files;

console.log(`Total .sql en supabase/migrations: ${files.length}`);
console.log(`A aplicar (${fromTs ? "desde " + fromTs : "todas"}): ${filtered.length}`);
if (dryRun) {
  console.log("--- DRY RUN, no se ejecuta nada ---");
  filtered.forEach((f) => console.log("  " + f));
  process.exit(0);
}

async function main() {
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 0,
    query_timeout: 0,
  });
  await c.connect();
  try {
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < filtered.length; i++) {
      const f = filtered[i];
      const sql = fs.readFileSync(path.join(migDir, f), "utf8");
      const label = `[${i + 1}/${filtered.length}] ${f}`;
      try {
        await c.query(sql);
        okCount++;
        console.log("OK  " + label);
      } catch (e) {
        failCount++;
        console.error("ERR " + label);
        console.error("    " + String(e.message || e).slice(0, 500));
        // No abortar: seguimos con las siguientes. Después revisás manualmente
        // qué migraciones fallaron. Muchas fallas son inocuas (guards ya
        // aplicados en otros tenants); las críticas son las que crean tablas
        // en `roldanerp`.
      }
    }
    console.log(`\nResumen: ${okCount} OK · ${failCount} ERR · ${filtered.length} total`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
