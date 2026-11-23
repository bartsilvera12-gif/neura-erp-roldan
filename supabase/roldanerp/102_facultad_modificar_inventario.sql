-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 102 · Casilla de perfil «Modificar inventario»
-- ============================================================================
--
-- POR QUÉ
--   Pedido del cliente: con el módulo Inventario se veía y se podía cambiar
--   todo. Ahora el módulo es para ver e imprimir, y modificar (movimientos,
--   ajustes, transferencias, rubros, ubicaciones, importaciones, lotes,
--   imágenes, precios) pide la casilla «Modificar inventario» del perfil.
--
-- QUÉ HACE
--   Le da la casilla a TODOS los perfiles que ya existen, para que mañana
--   nadie se quede trabado a mitad de un trabajo. Después, en Configuración →
--   Perfiles, se le saca a los perfiles que solo tienen que mirar.
--
--   Hasta que este script corra, los usuarios CON perfil quedan solo en
--   lectura en Inventario (el administrador sigue pudiendo todo, y los
--   usuarios sin perfil siguen como antes).
--
-- Idempotente.
-- ============================================================================

INSERT INTO roldanerp.perfil_facultades (perfil_id, facultad)
SELECT p.id, 'modificar_inventario'
  FROM roldanerp.perfiles_usuario p
ON CONFLICT (perfil_id, facultad) DO NOTHING;
