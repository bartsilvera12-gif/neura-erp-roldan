-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 65 · Facultad nueva: reabrir turnos de caja
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "El supervisor solo puede acceder a las cajas abiertas del día para
--   reabrirlas y demás; lo demás puede ver pero no editar."
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────
--   Hasta ahora reabrir un turno era exclusivo del administrador. Ahora es una
--   facultad —`reabrir_caja`— que se reparte desde Configuración → Perfiles, y
--   el corte del día lo pone el servidor: con la facultad se reabren los turnos
--   de HOY; los de otro día siguen siendo solo del administrador.
--
--   El corte es por fecha de APERTURA, no de cierre: un turno que abrió anoche
--   y cerró de madrugada es el turno de anoche.
--
-- ── POR QUÉ HACE FALTA ESTE SCRIPT SI EL 63 YA CORRIÓ ──────────────────────
--   El 63 sembró los siete perfiles con las facultades que existían entonces.
--   `reabrir_caja` no existía, así que Administrador y Supervisor quedaron sin
--   ella y el supervisor no podría reabrir nada hasta que alguien la tilde a
--   mano. Esto se la agrega una sola vez.
--
-- ── POR QUÉ NO LA VUELVE A PONER SI SE LA SACAN ────────────────────────────
--   No hay forma de distinguir "nunca la tuvo" de "se la sacaron a propósito".
--   Así que el script solo actúa si la facultad no está concedida en NINGÚN
--   perfil de la empresa, que es la única situación en la que se puede afirmar
--   que todavía no pasó por manos de nadie. Si mañana se la sacan al
--   supervisor, una nueva corrida no se la devuelve.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.perfiles_usuario') IS NULL
     OR to_regclass('roldanerp.perfil_facultades') IS NULL THEN
    RAISE EXCEPTION 'Faltan los perfiles. Correr antes el script 63.';
  END IF;
END
$guard$;

DO $semilla$
DECLARE
  emp       uuid;
  agregados int;
BEGIN
  FOR emp IN SELECT DISTINCT empresa_id FROM roldanerp.perfiles_usuario
  LOOP
    -- ¿Alguien de esta empresa ya decidió algo sobre esta facultad?
    IF EXISTS (
      SELECT 1
        FROM roldanerp.perfil_facultades pf
        JOIN roldanerp.perfiles_usuario p ON p.id = pf.perfil_id
       WHERE p.empresa_id = emp
         AND pf.facultad = 'reabrir_caja'
    ) THEN
      RAISE NOTICE 'Empresa %: ya hay perfiles con reabrir_caja. No se toca nada.', emp;
      CONTINUE;
    END IF;

    INSERT INTO roldanerp.perfil_facultades (perfil_id, facultad)
    SELECT p.id, 'reabrir_caja'
      FROM roldanerp.perfiles_usuario p
     WHERE p.empresa_id = emp
       AND p.clave IN ('administrador', 'supervisor')
    ON CONFLICT (perfil_id, facultad) DO NOTHING;

    GET DIAGNOSTICS agregados = ROW_COUNT;
    RAISE NOTICE 'Empresa %: reabrir_caja agregada a % perfiles.', emp, agregados;
  END LOOP;
END
$semilla$;

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT p.nombre                                    AS perfil,
       p.clave,
       count(pf.facultad)                          AS facultades,
       bool_or(pf.facultad = 'reabrir_caja')       AS reabre_caja
FROM roldanerp.perfiles_usuario p
LEFT JOIN roldanerp.perfil_facultades pf ON pf.perfil_id = p.id
GROUP BY p.id, p.nombre, p.clave
ORDER BY p.nombre;
