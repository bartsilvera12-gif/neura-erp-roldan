# Fixes aplicados — Neura ERP (Roldán e Hijos)
Rama de trabajo: local sobre `4349723`. 23 archivos modificados, `tsc --noEmit` limpio, `eslint` sin errores.

## Arreglado en código

| Bug | Qué pasaba | Qué cambié |
|---|---|---|
| **017** Fechas un día antes | Cada pantalla tenía su propio `fmtFecha` con `new Date("2026-10-21")`, que JS parsea como medianoche **UTC**; al formatear en UTC−3 caía el día anterior. | Helpers únicos `formatFecha` / `formatFechaHora` / `aFechaCalendario` en `src/lib/fecha/asuncion.ts`: una fecha calendario se imprime tal cual, un instante se baja al día de Paraguay. Reemplacé las **9** implementaciones locales (clientes, estado de cuenta, vacaciones, control horario, presupuestos ×2, pedidos de caja, devoluciones a proveedor, dashboard móvil). También arreglé `asuncionYmd`, que tenía el mismo defecto. |
| **001** Libro de Ventas 500 | Si al schema del tenant le falta alguna tabla de facturación electrónica, la consulta reventaba y el endpoint devolvía 500 con un mensaje genérico. | La consulta ahora chequea qué tablas existen y arma solo las ramas posibles: sin `factura_electronica` devuelve **200 con libro vacío + aviso**; sin `empresa_sifen_config` el timbrado va vacío; la rama de notas de crédito es opcional. El `catch` loguea `code/table/column/detail/hint` de Postgres en vez de perderlos. |
| **002** Stock editable sin movimiento | `PATCH /api/productos/[id]` escribía `stock_actual` directo: el kardex no registraba nada (por eso 163 entradas vs stock 1). | El PATCH ya no escribe stock. Si piden cambiarlo, genera un **movimiento AJUSTE** con el delta, el motivo y el usuario, y recién ahí actualiza el stock. Si el movimiento falla, el stock no se toca. |
| **026** Costo promedio inconsistente | El panel "Proveedores y costos" promediaba costos unitarios **sin ponderar por cantidad**. | Pasa a `Σ(costo × cantidad) / Σ cantidad`. (El CPP de compras ya era correcto; el desvío venía del stock pisado a mano.) |
| **021** Pago rechazado en silencio | El modal de pago en la ficha del cliente descartaba el resultado de `apiCreatePago` y se cerraba igual: ante un 400 el cajero creía haber cobrado. | Valida monto > 0 y monto ≤ saldo antes de enviar, y si el backend rechaza deja el modal abierto con el motivo en rojo. |
| **022** "Composición del período" en 0 | Sumaba `saldo` en vez de `monto`: una factura ya cobrada quedaba en 0 y desaparecía, así que el dashboard mostraba "Facturado Gs. 100.000" y "Total emitido Gs. 0". | Suma `monto` (emisión), que es lo que dice el propio texto del widget. |
| **023** Dashboard ignora `?tab=` | Carrera con la carga del rol: mientras no llegaba, `financiero` no figuraba permitido y el efecto redirigía y reescribía la URL. | El efecto espera a `rolLoaded`. |
| **031** "Mostrando 1-1 de 1" | `/api/productos` usaba `count: "planned"`, que devuelve la **estimación del planner**, no el conteo real. | `count: "exact"`. |
| **007** Nómina: octubre terminaba el 30 | `new Date(Date.UTC(y, m, 0)).getDate()` lee el día en hora **local**: en UTC−3 devolvía el anterior. | `getUTCDate()`. Además el listado formatea el período con el helper. |
| **033** Salida anterior a la entrada | Se guardaba y `calcHoras` devolvía 0, sin aviso. | 400 con mensaje, sugiriendo cargar dos fichajes si el turno cruza la medianoche. |
| **034** El fichaje pisaba el del día en silencio | Upsert mudo: equivocarse de fecha borraba horas reales. | El API devuelve **409 + `requiere_confirmacion`** con los datos del fichaje existente; la UI pide confirmación antes de reemplazar. |
| **016** Venta de producto sin stock | Se podía agregar al carrito y recién fallaba al confirmar. | La opción queda deshabilitada, en gris y con "Sin stock" en lugar de "Agregar". |
| **013** Compra anulada con "Editar" | Editarla reaplicaría cantidades de un documento que ya revirtió stock. | El botón solo aparece si la compra no está anulada. |
| **024** Stock mínimo 0 → "Crítico" | Un producto sin mínimo definido aparecía en la lista de reposición. | Solo clasifica como bajo/crítico lo que tiene `stock_minimo > 0`. |
| **011** Menú a módulo deshabilitado | La barra inferior móvil no filtraba por módulo y mostraba "Pedidos" aunque la empresa no lo tuviera. | Usa el mismo `canAccessSidebarSlug` + `module-access` que el sidebar; la grilla se adapta a los ítems visibles. |
| **005** Texto de otro cliente | "La clasificación de huevos ingresa siempre a Casa Central". | Reemplazado por el texto correcto sobre depósito principal. |
| **008** Normativa de España | "Referencia España (convenio general): 22 laborables ≈ 30 naturales". | Referencia Paraguay, Código Laboral art. 218 (12 / 18 / 30 días hábiles según antigüedad). |
| **012** "Sí Sí" en el toggle | Texto visible + `sr-only` con el mismo "Sí". | El `sr-only` describe el estado y el texto visible queda `aria-hidden`. |

## No es código: hay que correr una migración

**BUG-014 (bloqueante).** `GET /api/caja/estado` → `column caja_movimientos.anulado_at does not exist`.
La migración **ya existe en el repo**: `supabase/roldanerp/09_caja_columnas_faltantes.sql`. Nunca se corrió contra la base.
Es idempotente: pegarla en Supabase → SQL Editor → Run. Agrega `venta_id`, `usuario_email`, `anulado_at`,
`anulado_por_id`, `anulado_motivo` y habilita `cheque` como medio de pago.
Hasta que no se corra, **no se puede vender nada** y el dashboard financiero sigue en Gs. 0.

## Pendientes que no toqué (necesitan decisión tuya)

- **BUG-003** Stock por depósito en 0: la causa es que ningún producto tiene "Depósito principal" asignado.
  Hay que decidir si se exige al crear el producto o si "Automático" cae al depósito por defecto de la sucursal,
  y hace falta un backfill de los movimientos ya registrados.
- **BUG-030** Libro de Compras usa el correlativo interno (COMP-000007) como número de comprobante y el
  N° de factura del proveedor es opcional. Es un cambio de reglas fiscales, conviene definirlo con contabilidad.
- **BUG-029** `/pagos` no muestra cobros de facturas al contado. Hay que definir si esa pantalla es solo
  cuentas por cobrar a crédito (y entonces cambiarle el título) o si debe incluir todo.
- **BUG-004 / 010** Depósitos y sucursales duplicados: falta validación de unicidad, pero además hay que
  limpiar los registros ya duplicados en la base.
- **BUG-006** Plan de cuentas vacío: es carga de datos, no código.
- **BUG-009** Formato de moneda inconsistente (`Gs 0,00` en nómina): conviene un formateador único, es un barrido aparte.
- **BUG-019 / 020 / 025 / 027 / 028 / 032 / 035 / 036**: menores, los dejo listados en el informe de QA.
