-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 33 · El vendedor de cada venta (punto 4.3)
-- ============================================================================
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────
--   La regla del cliente es: "se le da la venta al vendedor que cerró la
--   venta, pero el cliente se queda en la cartera del vendedor original".
--
--   La mitad del cliente estaba: una venta NO cambia de quién es la cartera.
--   La otra mitad no: `ventas.vendedor_usuario_id` existía, el informe de
--   comisiones agrupa por esa columna, y NADIE la escribía nunca. Quedaba
--   siempre en NULL, así que no había a quién acreditarle la comisión y el
--   informe salía sin vendedor.
--
--   El código ya quedó corregido: toda venta nueva guarda su vendedor. Este
--   script arregla las que ya estaban cargadas.
--
-- ── DE DÓNDE SALE EL VENDEDOR DE UNA VENTA VIEJA ──────────────────────────
--   De `usuario_id`, que sí se venía guardando: es quien operó el sistema al
--   confirmar la venta, que en esta instancia es quien la cerró. Es la mejor
--   respuesta disponible y la única que no hay que inventar.
--
--   NO se toma el vendedor del cliente. Sería la respuesta equivocada
--   justamente en el caso que el punto 4.3 describe: si un reemplazo cerró la
--   venta porque el titular faltó, atribuírsela al titular le pagaría la
--   comisión al que no estaba.
--
-- ── LO QUE NO SE PUEDE ARREGLAR ───────────────────────────────────────────
--   Las ventas sin `usuario_id` quedan sin vendedor. No hay dato: ponerles
--   cualquiera sería inventar una comisión. Se cuentan al final para que se
--   sepa cuántas son.
--
-- Idempotente: no pisa un vendedor ya cargado.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.ventas') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.ventas. Correr antes el script 01.';
  END IF;
END
$guard$;

UPDATE roldanerp.ventas v
   SET vendedor_usuario_id = v.usuario_id,
       vendedor_nombre     = COALESCE(u.nombre, v.usuario_nombre)
  FROM roldanerp.usuarios u
 WHERE u.id = v.usuario_id
   AND v.vendedor_usuario_id IS NULL
   AND v.usuario_id IS NOT NULL;

-- Las que tienen usuario_id pero ese usuario ya no está en el catálogo: se
-- guarda igual el id y el nombre que quedó en la venta. Perder la atribución
-- porque alguien se fue de la empresa sería peor que tener un id huérfano.
UPDATE roldanerp.ventas v
   SET vendedor_usuario_id = v.usuario_id,
       vendedor_nombre     = v.usuario_nombre
 WHERE v.vendedor_usuario_id IS NULL
   AND v.usuario_id IS NOT NULL;

DO $verif$
DECLARE
  v_con int;
  v_sin int;
  v_total int;
BEGIN
  SELECT count(*) FILTER (WHERE vendedor_usuario_id IS NOT NULL),
         count(*) FILTER (WHERE vendedor_usuario_id IS NULL),
         count(*)
    INTO v_con, v_sin, v_total
    FROM roldanerp.ventas;

  RAISE NOTICE '% de % ventas quedaron con vendedor.', v_con, v_total;
  IF v_sin > 0 THEN
    RAISE NOTICE '% quedaron sin vendedor porque no tienen usuario_id: no hay dato para deducirlo.', v_sin;
  END IF;
  RAISE NOTICE 'Las ventas nuevas lo guardan solas. El cliente NO cambia de cartera al venderle.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
