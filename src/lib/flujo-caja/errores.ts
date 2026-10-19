/**
 * Traduce los errores de PostgREST/Postgres del módulo de flujo de caja a algo
 * accionable.
 *
 * El caso típico es que falte correr un script de `supabase/roldanerp/`: ahí el
 * error viene como "relation ... does not exist" o "Could not find the table ...
 * in the schema cache", y un mensaje genérico no le dice nada a quien lo ve.
 */

/** Objeto de base → script que lo crea. */
const CREADO_POR: Record<string, string> = {
  cheques: "07_flujo_caja_cheques.sql",
  cheque_compras: "07_flujo_caja_cheques.sql",
  flujo_caja_config: "07_flujo_caja_cheques.sql",
  agrupa_en_varios: "07_flujo_caja_cheques.sql",
  flujo_caja_saldos: "08_flujo_caja_saldos.sql",
};

export function mensajeErrorFlujo(err: unknown, contexto: string): string {
  const crudo = err instanceof Error ? err.message : String(err ?? "");

  // Tabla o columna que no existe, o que PostgREST todavía no ve.
  const faltante = Object.keys(CREADO_POR).find((obj) => crudo.includes(obj));
  if (faltante && /does not exist|schema cache|no existe/i.test(crudo)) {
    const script = CREADO_POR[faltante];
    return (
      `Falta "${faltante}" en la base. Corré supabase/roldanerp/${script} en el ` +
      `SQL editor. Si ya lo corriste, ejecutá: NOTIFY pgrst, 'reload schema';`
    );
  }

  // PostgREST cachea el esquema al arrancar: una tabla recién creada no existe
  // para la API hasta que se le avisa.
  if (/schema cache/i.test(crudo)) {
    return `La API todavía no ve las tablas nuevas. Ejecutá: NOTIFY pgrst, 'reload schema';`;
  }

  if (/permission denied/i.test(crudo)) {
    return `Sin permisos sobre las tablas del flujo. Revisá los GRANT del script 07.`;
  }

  return `${contexto}: ${crudo || "error desconocido"}`;
}
