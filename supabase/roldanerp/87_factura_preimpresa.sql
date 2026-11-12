-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 87 · Factura preimpresa: dónde va cada dato en el talonario
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Facturar sobre el talonario PREIMPRESO de imprenta (ya trae timbrado, RUC,
--   número y recuadros). El sistema solo escribe los datos variables —fecha,
--   cliente, productos, totales— cada uno en su recuadro.
--
-- ── QUÉ SE AGREGA ──────────────────────────────────────────────────────────
--   tipo_papel           'preimpresa' (talonario de imprenta, se rellena) o
--                        'autoimpresor' (hoja en blanco, se imprime todo).
--   formato_preimpreso   ubicación en milímetros de cada dato, para que caiga
--                        dentro de su recuadro. Se ajusta en Configuración →
--                        Facturación con una hoja de prueba.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.empresa_autoimpresor_config') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.empresa_autoimpresor_config (configuración de facturación).';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.empresa_autoimpresor_config
  ADD COLUMN IF NOT EXISTS tipo_papel         text NOT NULL DEFAULT 'preimpresa',
  ADD COLUMN IF NOT EXISTS formato_preimpreso jsonb;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresa_autoimpresor_tipo_papel_chk') THEN
    ALTER TABLE roldanerp.empresa_autoimpresor_config
      ADD CONSTRAINT empresa_autoimpresor_tipo_papel_chk
      CHECK (tipo_papel IN ('preimpresa', 'autoimpresor'));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.empresa_autoimpresor_config.tipo_papel IS
  'preimpresa = talonario de imprenta, el sistema rellena los datos; autoimpresor = hoja en blanco, imprime la factura entera.';
COMMENT ON COLUMN roldanerp.empresa_autoimpresor_config.formato_preimpreso IS
  'Ubicación en mm de cada dato sobre el talonario preimpreso (ver src/lib/facturacion/preimpresa.ts).';

NOTIFY pgrst, 'reload schema';

SELECT empresa_id, tipo_papel, formato_preimpreso IS NOT NULL AS tiene_formato
FROM roldanerp.empresa_autoimpresor_config;
