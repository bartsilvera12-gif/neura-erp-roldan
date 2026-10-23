-- ============================================================================
-- Caja por sucursal — agrega sucursal_id al módulo de Caja
-- ============================================================================
-- El módulo de Caja (tablas `cajas` y `caja_movimientos`) es anterior a
-- multi-sucursal: solo tenía `empresa_id`. Resultado: una caja abierta en una
-- sucursal (ej. Casa Matriz / Central) se veía y operaba desde cualquier otra
-- sucursal (ej. Ñemby), y el índice único de "una caja activa por número"
-- impedía que dos sucursales abrieran su Caja 1 en paralelo.
--
-- Esta migración, siguiendo el mismo patrón que la Fase 1 de sucursales:
--   1) Agrega `sucursal_id` (NULLABLE, FK a sucursales) a `cajas` y
--      `caja_movimientos`, con índice.
--   2) Backfillea lo existente a la sucursal PRINCIPAL de cada empresa
--      (Casa Matriz).
--   3) Cambia el índice único de caja activa para que considere la sucursal:
--      pasa de (empresa_id, numero_caja) a (empresa_id, sucursal_id,
--      numero_caja). Así cada sucursal maneja sus propias cajas.
--
-- Idempotente: se puede correr más de una vez sin efectos adversos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columna sucursal_id (nullable) + índice
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.cajas
  ADD COLUMN IF NOT EXISTS sucursal_id uuid
    REFERENCES roldanerp.sucursales(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_cajas_sucursal
  ON roldanerp.cajas (sucursal_id);

ALTER TABLE roldanerp.caja_movimientos
  ADD COLUMN IF NOT EXISTS sucursal_id uuid
    REFERENCES roldanerp.sucursales(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_caja_movimientos_sucursal
  ON roldanerp.caja_movimientos (sucursal_id);

-- ---------------------------------------------------------------------------
-- 2) BACKFILL — todo lo existente queda en la sucursal PRINCIPAL (Casa Matriz)
-- ---------------------------------------------------------------------------
-- Se resuelve por empresa vía `sucursales.es_principal = true`, así funciona
-- aunque haya más de una empresa en el schema. Solo toca filas con
-- sucursal_id NULL (idempotente).
UPDATE roldanerp.cajas c
   SET sucursal_id = s.id
  FROM roldanerp.sucursales s
 WHERE c.sucursal_id IS NULL
   AND s.empresa_id = c.empresa_id
   AND s.es_principal = true;

UPDATE roldanerp.caja_movimientos m
   SET sucursal_id = s.id
  FROM roldanerp.sucursales s
 WHERE m.sucursal_id IS NULL
   AND s.empresa_id = m.empresa_id
   AND s.es_principal = true;

-- Respaldo: si alguna empresa no tiene sucursal principal marcada, cae en la
-- caja → a la sucursal de su movimiento hermano, si existe (coherencia interna).
UPDATE roldanerp.caja_movimientos m
   SET sucursal_id = c.sucursal_id
  FROM roldanerp.cajas c
 WHERE m.sucursal_id IS NULL
   AND c.id = m.caja_id
   AND c.sucursal_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Índice único de caja activa: ahora POR SUCURSAL
-- ---------------------------------------------------------------------------
-- Antes: a lo sumo un turno activo por (empresa, número). Eso bloqueaba que
-- dos sucursales tuvieran su Caja 1 abierta a la vez. Ahora el candado es por
-- (empresa, sucursal, número): cada sucursal abre/cierra sus cajas sin chocar
-- con las demás.
DROP INDEX IF EXISTS roldanerp.cajas_activa_por_numero;
CREATE UNIQUE INDEX IF NOT EXISTS cajas_activa_por_sucursal_numero
  ON roldanerp.cajas (empresa_id, sucursal_id, numero_caja)
  WHERE estado IN ('abierta', 'en_cierre');
