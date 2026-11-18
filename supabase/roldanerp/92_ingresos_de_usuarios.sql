-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 92 · Desde qué computadora entra cada usuario
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Saber en qué computadora se loguea cada usuario.
--
--   El navegador no deja leer el nombre de la computadora. Lo que se guarda
--   en cada ingreso es lo que sí se puede saber:
--     - un código propio de cada equipo (se genera la primera vez que se
--       entra desde ese navegador y queda guardado ahí), para distinguir
--       una computadora de otra;
--     - el nombre que se le ponga a ese equipo ("Caja 1", "PC de Deisy");
--     - sistema operativo y navegador;
--     - la IP desde la que entró;
--     - fecha y hora.
--
--   Se ve en la ficha de cada usuario (Usuarios → el usuario → Ingresos).
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

CREATE TABLE IF NOT EXISTS roldanerp.usuario_ingresos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  usuario_id          uuid,
  auth_user_id        uuid,
  usuario_nombre      text,
  dispositivo_id      text,
  dispositivo_nombre  text,
  sistema             text,
  navegador           text,
  user_agent          text,
  ip                  text,
  sucursal_id         uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.usuario_ingresos IS
  'Cada vez que alguien entra al sistema: desde qué equipo (código propio del '
  'navegador y el nombre que se le puso), sistema, navegador, IP y cuándo.';

CREATE INDEX IF NOT EXISTS idx_usuario_ingresos_usuario
  ON roldanerp.usuario_ingresos (empresa_id, usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usuario_ingresos_dispositivo
  ON roldanerp.usuario_ingresos (empresa_id, dispositivo_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS ingresos_registrados FROM roldanerp.usuario_ingresos;
