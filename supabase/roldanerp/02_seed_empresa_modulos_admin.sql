-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 02 · Semilla: empresa, sucursal, catálogo de módulos, módulos habilitados
--      y usuario administrador. Sin datos operativos.
-- ============================================================================
--
-- Requiere haber corrido `01_clone_schema_mexicana_to_roldanerp.sql`.
-- Solo escribe en el schema `roldanerp`. No toca `public`, `auth` ni `mexicana`.
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Identidad de la empresa (propia, distinta de la de Mexicana):
--   empresa_id = 9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23
--   nombre     = Roldán e Hijos
--   usuario    = admin@roldanehijos.com (rol `admin`)
--
-- Módulos habilitados (y nada más):
--   dashboard · ventas (caja) · inventario · sucursales · compras · proveedores
--   pagos · rrhh · contabilidad · crm · conversaciones
--
-- El login de Supabase Auth se crea aparte (ver el bloque final del archivo).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: inserta solo las columnas que existen en la tabla destino.
-- El schema clonado puede traer más o menos columnas que las que conoce este
-- script; así la semilla no se rompe por una columna de más o de menos.
-- Se elimina al final.
-- ---------------------------------------------------------------------------
CREATE FUNCTION roldanerp.__seed_insert(
  p_table    text,
  p_vals     jsonb,
  p_conflict text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_cols  text := '';
  v_vals  text := '';
  r       record;
BEGIN
  FOR r IN
    SELECT a.attname,
           format_type(a.atttypid, a.atttypmod) AS atttype
    FROM pg_attribute a
    JOIN pg_class c      ON c.oid = a.attrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp'
      AND c.relname = p_table
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attgenerated = ''
      AND p_vals ? a.attname
      AND p_vals ->> a.attname IS NOT NULL
    ORDER BY a.attnum
  LOOP
    v_cols := v_cols || CASE WHEN v_cols = '' THEN '' ELSE ', ' END || quote_ident(r.attname);
    v_vals := v_vals || CASE WHEN v_vals = '' THEN '' ELSE ', ' END ||
              format('%L::%s', p_vals ->> r.attname, r.atttype);
  END LOOP;

  IF v_cols = '' THEN
    RAISE EXCEPTION 'roldanerp.% no tiene ninguna de las columnas de la semilla.', p_table;
  END IF;

  EXECUTE format('INSERT INTO roldanerp.%I (%s) VALUES (%s) %s',
                 p_table, v_cols, v_vals, coalesce(p_conflict, ''));
END
$fn$;

-- ---------------------------------------------------------------------------
-- 0) Guardas
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'No existe el schema `roldanerp`. Correr primero 01_clone_schema_mexicana_to_roldanerp.sql.';
  END IF;
  IF EXISTS (SELECT 1 FROM roldanerp.empresas WHERE id <> '9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23') THEN
    RAISE EXCEPTION 'Hay otra empresa en `roldanerp`. Esta instancia es monocliente: revisar antes de seguir.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Empresa
-- ---------------------------------------------------------------------------
DO $empresa$
DECLARE v_id uuid := '9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roldanerp.empresas WHERE id = v_id) THEN
    PERFORM roldanerp.__seed_insert('empresas', jsonb_build_object(
      'id',             v_id::text,
      'nombre_empresa', 'Roldán e Hijos',
      'nombre',         'Roldán e Hijos',
      'data_schema',    'roldanerp',
      'estado',         'activo',
      'activo',         'true'
    ));
    RAISE NOTICE 'Empresa creada: % (Roldán e Hijos)', v_id;
  ELSE
    RAISE NOTICE 'Empresa % ya existía; no se toca.', v_id;
  END IF;

  -- El schema del tenant tiene que quedar nombrado como `roldanerp`.
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='roldanerp' AND c.relname='empresas' AND a.attname='data_schema'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    UPDATE roldanerp.empresas SET data_schema = 'roldanerp' WHERE id = v_id;
  END IF;
END
$empresa$;

-- ---------------------------------------------------------------------------
-- 2) Sucursal principal
-- ---------------------------------------------------------------------------
DO $suc$
DECLARE
  v_empresa uuid := '9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23';
  v_suc     uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='roldanerp' AND c.relname='sucursales' AND c.relkind='r'
  ) THEN
    RAISE NOTICE 'No hay tabla `sucursales` en el schema; se omite.';
    RETURN;
  END IF;

  EXECUTE 'SELECT id FROM roldanerp.sucursales WHERE empresa_id = $1 LIMIT 1'
    INTO v_suc USING v_empresa;
  IF v_suc IS NULL THEN
    BEGIN
      PERFORM roldanerp.__seed_insert('sucursales', jsonb_build_object(
        'empresa_id',       v_empresa::text,
        'codigo',           'CASA_MATRIZ',
        'nombre',           'Casa Central',
        'es_principal',     'true',
        'activa',           'true',
        'establecimiento',  '001',
        'punto_expedicion', '001'
      ));
      RAISE NOTICE 'Sucursal `Casa Central` creada.';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'No se pudo crear la sucursal (%). Crearla desde la pantalla de Sucursales.', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'La empresa ya tiene sucursal; no se toca.';
  END IF;
END
$suc$;

-- ---------------------------------------------------------------------------
-- 3) Catálogo de módulos — asegura los slugs que usa esta instancia
-- ---------------------------------------------------------------------------
DO $catalogo$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('dashboard',      'Dashboard'),
      ('ventas',         'Caja'),
      ('inventario',     'Inventario'),
      ('sucursales',     'Sucursales'),
      ('compras',        'Compras'),
      ('proveedores',    'Proveedores'),
      ('pagos',          'Pagos'),
      ('rrhh',           'Recursos Humanos'),
      ('contabilidad',   'Contabilidad'),
      ('crm',            'CRM'),
      ('conversaciones', 'Conversaciones')
    ) AS v(slug, nombre)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM roldanerp.modulos m WHERE m.slug = r.slug) THEN
      PERFORM roldanerp.__seed_insert('modulos', jsonb_build_object(
        'id',     gen_random_uuid()::text,
        'nombre', r.nombre,
        'slug',   r.slug
      ));
      RAISE NOTICE 'Módulo agregado al catálogo: % (%)', r.nombre, r.slug;
    END IF;
  END LOOP;
END
$catalogo$;

-- ---------------------------------------------------------------------------
-- 4) Módulos habilitados para la empresa — SOLO estos once
--    Con NEURA_INSTANCE_MODE=single_client esta tabla es la única fuente de
--    verdad del sidebar y del gate de rutas.
-- ---------------------------------------------------------------------------
DO $modulos$
DECLARE
  v_empresa uuid := '9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23';
  v_slugs   text[] := ARRAY[
    'dashboard', 'ventas', 'inventario', 'sucursales', 'compras', 'proveedores',
    'pagos', 'rrhh', 'contabilidad', 'crm', 'conversaciones'
  ];
  r         record;
  v_n       int;
BEGIN
  FOR r IN SELECT m.id, m.slug FROM roldanerp.modulos m WHERE m.slug = ANY(v_slugs)
  LOOP
    IF EXISTS (
      SELECT 1 FROM roldanerp.empresa_modulos em
      WHERE em.empresa_id = v_empresa AND em.modulo_id = r.id
    ) THEN
      UPDATE roldanerp.empresa_modulos SET activo = true
      WHERE empresa_id = v_empresa AND modulo_id = r.id;
    ELSE
      PERFORM roldanerp.__seed_insert('empresa_modulos', jsonb_build_object(
        'empresa_id', v_empresa::text,
        'modulo_id',  r.id::text,
        'activo',     'true'
      ));
    END IF;
  END LOOP;

  -- Cualquier otro módulo queda explícitamente desactivado (no borrado: así el
  -- gate distingue "apagado a propósito" de "no configurado").
  UPDATE roldanerp.empresa_modulos em
     SET activo = false
   WHERE em.empresa_id = v_empresa
     AND em.modulo_id IN (SELECT id FROM roldanerp.modulos WHERE NOT (slug = ANY(v_slugs)));

  SELECT count(*) INTO v_n
  FROM roldanerp.empresa_modulos
  WHERE empresa_id = v_empresa AND activo;
  RAISE NOTICE 'Módulos activos para la empresa: %', v_n;

  IF v_n <> array_length(v_slugs, 1) THEN
    RAISE EXCEPTION 'Se esperaban % módulos activos y hay %. Revisar el catálogo `modulos`.',
      array_length(v_slugs, 1), v_n;
  END IF;
END
$modulos$;

-- ---------------------------------------------------------------------------
-- 5) Usuario administrador
-- ---------------------------------------------------------------------------
DO $usuario$
DECLARE
  v_empresa uuid := '9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23';
  v_email   text := 'admin@roldanehijos.com';
  v_usuario uuid;
  v_suc     uuid;
  v_hay_suc boolean;
BEGIN
  SELECT id INTO v_usuario FROM roldanerp.usuarios WHERE lower(email) = v_email;

  -- Sucursal principal, si este schema tiene el módulo de sucursales.
  v_hay_suc := EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='roldanerp' AND c.relname='sucursales' AND c.relkind='r'
  );
  IF v_hay_suc THEN
    EXECUTE 'SELECT id FROM roldanerp.sucursales WHERE empresa_id = $1 '
            || 'ORDER BY es_principal DESC NULLS LAST LIMIT 1'
      INTO v_suc USING v_empresa;
  END IF;

  IF v_usuario IS NULL THEN
    v_usuario := gen_random_uuid();

    PERFORM roldanerp.__seed_insert('usuarios', jsonb_build_object(
      'id',                          v_usuario::text,
      'empresa_id',                  v_empresa::text,
      'nombre',                      'Administrador',
      'email',                       v_email,
      'rol',                         'admin',
      'rol_rrhh',                    'admin',
      'estado',                      'activo',
      'activo',                      'true',
      'sucursal_predeterminada_id',  v_suc::text,
      'sucursal_activa_id',          v_suc::text
    ));
    RAISE NOTICE 'Usuario % creado (rol admin, id %).', v_email, v_usuario;
  ELSE
    UPDATE roldanerp.usuarios
       SET empresa_id = v_empresa,
           rol        = 'admin',
           estado     = 'activo'
     WHERE id = v_usuario;
    RAISE NOTICE 'Usuario % ya existía; se dejó como admin activo de la empresa.', v_email;
  END IF;

  -- Acceso del usuario a la sucursal (si la tabla existe en este schema).
  IF v_suc IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='roldanerp' AND c.relname='usuario_sucursales' AND c.relkind='r'
  ) THEN
    BEGIN
      PERFORM roldanerp.__seed_insert('usuario_sucursales', jsonb_build_object(
        'usuario_id',  v_usuario::text,
        'sucursal_id', v_suc::text
      ), 'ON CONFLICT DO NOTHING');
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'No se pudo asignar la sucursal al usuario (%).', SQLERRM;
    END;
  END IF;

  -- usuario_modulos: el rol `admin` ve todos los módulos de la empresa sin
  -- necesitar estas filas, pero se cargan para que el acceso siga siendo correcto
  -- si algún día se le baja el rol.
  INSERT INTO roldanerp.usuario_modulos (usuario_id, modulo_id)
  SELECT v_usuario, em.modulo_id
  FROM roldanerp.empresa_modulos em
  WHERE em.empresa_id = v_empresa AND em.activo
    AND NOT EXISTS (
      SELECT 1 FROM roldanerp.usuario_modulos um
      WHERE um.usuario_id = v_usuario AND um.modulo_id = em.modulo_id
    );
END
$usuario$;

DROP FUNCTION roldanerp.__seed_insert(text, jsonb, text);

COMMIT;

-- ============================================================================
-- PASO MANUAL · login de Supabase Auth
-- ============================================================================
--
-- La semilla NO toca el schema `auth`. Para que `admin@roldanehijos.com` pueda
-- entrar al ERP:
--
--   1) Supabase Studio → Authentication → Users → "Add user"
--        Email:    admin@roldanehijos.com
--        Password: la que le vayas a dar al cliente
--        Marcar "Auto Confirm User".
--
--   2) Correr este UPDATE para enlazar la fila del ERP con el usuario de Auth.
--      (La app también resuelve por email, pero con `auth_user_id` cargado el
--       login es directo y no depende del JWT.)
--
-- UPDATE roldanerp.usuarios u
--    SET auth_user_id = a.id
--   FROM auth.users a
--  WHERE lower(a.email) = 'admin@roldanehijos.com'
--    AND lower(u.email) = 'admin@roldanehijos.com'
--    AND u.auth_user_id IS DISTINCT FROM a.id;
--
--   3) Verificar:
--
-- SELECT u.email, u.rol, u.estado, u.auth_user_id IS NOT NULL AS enlazado
--   FROM roldanerp.usuarios u
--  WHERE lower(u.email) = 'admin@roldanehijos.com';
-- ============================================================================
