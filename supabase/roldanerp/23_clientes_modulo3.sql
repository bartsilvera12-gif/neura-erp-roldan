-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 23 · Módulo 3 · Clientes
-- ============================================================================
--
-- PUNTO 3.1 — Rubros de cliente
--   Se cargan los cinco que pide el pedido: ocasional, mayorista, minorista,
--   frecuente y distribuidor.
--
--   Los que ya existen NO se tocan. Hoy hay tres rubros genéricos
--   ("CATEGORIA 1/2/3") que quedaron de las pruebas, y uno de ellos tiene un
--   cliente asignado. Renombrarlos cambiaría en silencio a qué rubro pertenece
--   ese cliente, y con eso qué precio se le aplica en Caja. Se agregan los
--   cinco al lado; los genéricos se desactivan desde la pantalla cuando sus
--   clientes estén reasignados.
--
-- PUNTO 3.2 — Campos que faltaban en la ficha
--   `clientes` ya tenía ciudad, dirección y email. Faltaban `profesion` y
--   `limite_credito`.
--
--   `limite_credito` es NULL cuando no se definió, y eso NO es lo mismo que
--   cero: cero significa "este cliente no se lleva nada a crédito", que es una
--   decisión tomada. NULL significa que nadie la tomó todavía.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.clientes') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.clientes`.';
  END IF;
  IF to_regclass('roldanerp.categorias_cliente') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.categorias_cliente`.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 3.2 · Campos nuevos
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.clientes
  ADD COLUMN IF NOT EXISTS profesion      text    NULL,
  ADD COLUMN IF NOT EXISTS limite_credito numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'clientes_limite_credito_chk'
       AND conrelid = 'roldanerp.clientes'::regclass
  ) THEN
    -- Un límite negativo no significa nada y rompería cualquier comparación
    -- de "cuánto le queda disponible".
    ALTER TABLE roldanerp.clientes
      ADD CONSTRAINT clientes_limite_credito_chk
      CHECK (limite_credito IS NULL OR limite_credito >= 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.clientes.profesion IS
  'Punto 3.2. Profesion u oficio del cliente (albanil, electricista, herrero...). Sirve para segmentar.';
COMMENT ON COLUMN roldanerp.clientes.limite_credito IS
  'Punto 3.2. Tope de deuda en guaranies. NULL = sin definir; 0 = no se le vende a credito, que es una decision distinta.';

-- ---------------------------------------------------------------------------
-- 3.1 · Los cinco rubros de cliente
-- ---------------------------------------------------------------------------
-- Comparación en mayúsculas para no duplicar uno que ya exista escrito
-- distinto ("Mayorista" vs "MAYORISTA"). Ninguno de los cinco lleva acento,
-- así que no hace falta normalizarlos.
INSERT INTO roldanerp.categorias_cliente (empresa_id, nombre, orden, activa)
SELECT e.id, v.nombre, v.orden, true
  FROM roldanerp.empresas e
  CROSS JOIN (VALUES
      ('OCASIONAL',    10),
      ('MINORISTA',    20),
      ('MAYORISTA',    30),
      ('FRECUENTE',    40),
      ('DISTRIBUIDOR', 50)
  ) AS v(nombre, orden)
 WHERE NOT EXISTS (
   SELECT 1 FROM roldanerp.categorias_cliente c
    WHERE c.empresa_id = e.id
      AND upper(btrim(c.nombre)) = v.nombre
 );

COMMIT;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_falta text;
  v_n     int;
BEGIN
  FOR v_falta IN
    SELECT c FROM unnest(ARRAY['profesion','limite_credito']) c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='roldanerp' AND table_name='clientes' AND column_name=c)
  LOOP
    RAISE EXCEPTION 'Falta la columna clientes.%', v_falta;
  END LOOP;

  SELECT count(*) INTO v_n
    FROM roldanerp.categorias_cliente
   WHERE upper(btrim(nombre)) IN ('OCASIONAL','MINORISTA','MAYORISTA','FRECUENTE','DISTRIBUIDOR');

  RAISE NOTICE 'Modulo 3 listo: clientes.profesion y .limite_credito creadas; % de los 5 rubros presentes.', v_n;
END
$check$;

NOTIFY pgrst, 'reload schema';
