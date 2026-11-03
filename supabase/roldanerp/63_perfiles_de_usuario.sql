-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 63 · Perfiles de usuario y facultades
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Crear perfiles y permisos de usuarios (7 categorías aprox.)"
--
-- ── QUÉ RESUELVE ───────────────────────────────────────────────────────────
--   Hasta acá había tres niveles —administrador, supervisor, usuario— y cada
--   facultad estaba cableada a uno de ellos. Para que alguien pudiera
--   autorizar una devolución había que hacerlo supervisor, y con eso se le
--   daba también anular ventas y entrar a los cierres de caja. No había
--   manera de dar una facultad sin dar el paquete entero.
--
--   Ahora un PERFIL es un nombre más una lista de facultades, y cada usuario
--   tiene uno. Los perfiles se editan desde Configuración → Perfiles.
--
-- ── LO QUE PASA SI NO SE ASIGNA NINGÚN PERFIL ──────────────────────────────
--   Nada. El usuario sin perfil sigue rigiéndose por su nivel, exactamente
--   como hasta hoy. Una migración que apaga el negocio hasta que alguien la
--   configure es una migración que no se corre.
--
--   Por eso este script NO le asigna perfil a nadie: crea los siete y deja
--   que se asignen a mano, mirando usuario por usuario.
--
-- ── LAS FACULTADES NO SE INVENTAN ACÁ ──────────────────────────────────────
--   Cada clave de `perfil_facultades` tiene un guard real en el servidor
--   (src/lib/perfiles/facultades.ts). No hay casillas decorativas: una
--   casilla que no hace nada es peor que no tenerla, porque alguien la va a
--   destildar creyendo que cerró una puerta.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.usuarios. Correr antes el script 01.';
  END IF;
END
$guard$;

-- ── 1) Los perfiles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roldanerp.perfiles_usuario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  -- Identidad estable de los siete de fábrica. Sirve para reconocerlos al
  -- correr el script de nuevo aunque los hayan renombrado: sin esto, un
  -- "Cajero" renombrado a "Cajero principal" hace que la próxima corrida
  -- cree otro "Cajero" al lado y queden los dos.
  -- NULL en los perfiles que crea el usuario: esos no se vuelven a sembrar.
  clave       text,
  nombre      text NOT NULL,
  descripcion text,
  -- El nivel con el que se crea el usuario que tenga este perfil. El nivel
  -- sigue existiendo porque de él dependen cosas que no son facultades
  -- (a qué pantalla cae al entrar, el techo de módulos del rol).
  nivel       text NOT NULL DEFAULT 'usuario'
              CHECK (nivel IN ('administrador', 'supervisor', 'usuario')),
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Dos perfiles con el mismo nombre en la misma empresa no se pueden
-- distinguir en el selector del usuario.
CREATE UNIQUE INDEX IF NOT EXISTS uq_perfiles_usuario_nombre
  ON roldanerp.perfiles_usuario (empresa_id, lower(nombre));

CREATE UNIQUE INDEX IF NOT EXISTS uq_perfiles_usuario_clave
  ON roldanerp.perfiles_usuario (empresa_id, clave) WHERE clave IS NOT NULL;

-- ── 2) Sus facultades ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roldanerp.perfil_facultades (
  perfil_id  uuid NOT NULL REFERENCES roldanerp.perfiles_usuario(id) ON DELETE CASCADE,
  facultad   text NOT NULL,
  PRIMARY KEY (perfil_id, facultad)
);

COMMENT ON TABLE roldanerp.perfil_facultades IS
  'Qué puede HACER el perfil. Las claves válidas las define el código en '
  'src/lib/perfiles/facultades.ts; lo que no reconozca se ignora al leer.';

-- ── 3) El perfil de cada usuario ───────────────────────────────────────────
ALTER TABLE roldanerp.usuarios
  ADD COLUMN IF NOT EXISTS perfil_id uuid REFERENCES roldanerp.perfiles_usuario(id);

COMMENT ON COLUMN roldanerp.usuarios.perfil_id IS
  'NULL = sin perfil: el usuario se rige por su nivel, como antes de los perfiles.';

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON roldanerp.usuarios (perfil_id);

-- ── 4) Los siete, una sola vez ─────────────────────────────────────────────
-- Si ya existe uno con ese nombre NO se lo pisa: puede estar editado a mano,
-- y volver a imponerle las facultades de fábrica desharía esa decisión sin
-- que nadie lo pida.
DO $semilla$
DECLARE
  emp uuid;
  p   record;
  pid uuid;
  f   text;
BEGIN
  FOR emp IN SELECT DISTINCT empresa_id FROM roldanerp.usuarios WHERE empresa_id IS NOT NULL
  LOOP
    FOR p IN
      SELECT * FROM (VALUES
        ('administrador', 'Administrador',      'administrador', 'Sin límites. Configura el sistema y decide precios, crédito y anulaciones.',
         ARRAY['anular_venta','cambiar_medio_pago','editar_venta','autorizar_devolucion','fijar_credito','ver_costos','cotizar_sin_stock','ver_ordenes_venta']),
        ('supervisor', 'Supervisor',         'supervisor',    'Puesto de control. Entra a los cierres de caja, anula lo que está mal y autoriza devoluciones. No configura ni ve costos.',
         ARRAY['anular_venta','autorizar_devolucion']),
        ('cajero', 'Cajero',             'usuario',       'Cobra lo que se le presenta. No ve costos ni márgenes, no fija crédito y no autoriza devoluciones: las arma y las confirma un supervisor.',
         ARRAY[]::text[]),
        ('vendedor_mostrador', 'Vendedor mostrador', 'usuario',       'Atiende y cotiza en el salón. Cotiza con lo que hay: prometer mercadería que no está es asumir una compra.',
         ARRAY[]::text[]),
        ('vendedor_externo', 'Vendedor externo',   'usuario',       'Visita obras y clientes. Puede cotizar sin stock porque trabaja con entregas a plazo.',
         ARRAY['cotizar_sin_stock','ver_ordenes_venta']),
        ('call_center', 'Call center',        'usuario',       'Cotiza por teléfono. Ve las órdenes de venta para contestar por el estado de un pedido.',
         ARRAY['cotizar_sin_stock','ver_ordenes_venta']),
        ('deposito', 'Depósito',           'usuario',       'Mueve mercadería: existencias, transferencias entre depósitos y preparación de pedidos. No cobra ni cotiza.',
         ARRAY[]::text[])
      ) AS t(clave, nombre, nivel, descripcion, facultades)
    LOOP
      -- Por clave primero —sobrevive a un renombre— y por nombre después,
      -- para no duplicar si alguien ya había creado uno igual a mano.
      SELECT id INTO pid
        FROM roldanerp.perfiles_usuario
       WHERE empresa_id = emp
         AND (clave = p.clave OR lower(nombre) = lower(p.nombre))
       LIMIT 1;

      IF pid IS NOT NULL THEN
        -- Existe: no se le tocan ni el nombre ni las facultades, pueden estar
        -- editados. Solo se le pone la clave si le faltaba, para que la
        -- próxima corrida lo reconozca aunque lo renombren.
        UPDATE roldanerp.perfiles_usuario
           SET clave = p.clave
         WHERE id = pid AND clave IS NULL;
        CONTINUE;
      END IF;

      INSERT INTO roldanerp.perfiles_usuario (empresa_id, clave, nombre, descripcion, nivel)
      VALUES (emp, p.clave, p.nombre, p.descripcion, p.nivel)
      RETURNING id INTO pid;

      FOREACH f IN ARRAY p.facultades LOOP
        INSERT INTO roldanerp.perfil_facultades (perfil_id, facultad)
        VALUES (pid, f)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END
$semilla$;

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT pu.nombre,
       pu.nivel,
       count(pf.facultad) AS facultades,
       (SELECT count(*) FROM roldanerp.usuarios u WHERE u.perfil_id = pu.id) AS usuarios
FROM roldanerp.perfiles_usuario pu
LEFT JOIN roldanerp.perfil_facultades pf ON pf.perfil_id = pu.id
GROUP BY pu.id, pu.nombre, pu.nivel
ORDER BY pu.nombre;
