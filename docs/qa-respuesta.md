# Respuesta al QA — Roldán e Hijos

**Versión:** `db67945` · 22-10-2026
Qué encontramos en cada punto y qué se hizo.

---

## Caja

**1 · La caja no abría.** Error: `column caja_movimientos.anulado_at does not exist`.

La tabla se creó con las columnas del formulario, pero el módulo usa cinco más: `anulado_at`, `anulado_por_id`, `anulado_motivo`, `venta_id` y `usuario_email`. `anulado_at` se consulta justo al abrir el turno, por eso fallaba ahí y no en otro lado.

→ Script `09`. Agrega las cinco y habilita `cheque` como medio de pago, que el CHECK viejo rechazaba.

---

## Inicio

**2 · Dashboard en blanco.** El catálogo `dashboard_views` estaba vacío.

El script que lo cargaba usaba `ON CONFLICT (slug)`, que exige un índice único sobre esa columna. El clon no lo tenía, el INSERT fallaba, y como todo estaba en una transacción se revertía entero. **El script que venía a arreglarlo lo estaba causando.**

→ Script `04` reescrito sin `ON CONFLICT`. Carga 4 vistas.

---

## Inventario

**3 · Salidas y ajustes daban error con stock suficiente.** No era falta de stock: el producto tenía 250 en total pero **nunca se había repartido por depósito**. Sin fila en `inventario_stock_ubicacion`, cualquier salida se rechazaba.

→ Ahora distingue dos casos: si no hay desglose, lo inicializa con el stock global; si el stock está en otro depósito, falla con un mensaje que lo dice.

**4 · Había que elegir el producto dos veces.** Eran dos controles: un buscador y un `<select>` desplegado. El clic en la lista no seleccionaba porque era el `<select>`, no el buscador.

→ Un solo control: se escribe, se hace un clic, el producto queda fijado con un botón "Cambiar".

**5 · Columna "Usuario" inconsistente.** Cada endpoint resolvía el usuario a su manera, o no lo guardaba.

→ Un solo criterio (`firmaUsuario`): nombre del usuario, y si no tiene, el correo. El listado lo resuelve contra `usuarios`, así las filas viejas también salen parejas.

**6 · Editar el stock no generaba movimiento.** El PATCH escribía `stock_actual` directo y el kardex no se enteraba — por eso había 163 unidades de entradas contra stock 1.

→ Ahora genera un **movimiento de AJUSTE** con el delta, el motivo y el usuario. Si el movimiento falla, el stock no se toca.

**7 · El "+" de Categoría perdía el formulario.** Era un link que navegaba en la misma pestaña. Había **dos**: Categoría y Proveedor.

→ Los dos abren en otra pestaña, con un botón "Recargar".

**8 · El listado no mostraba imágenes.** Los productos **sí tienen imagen**: cuatro con `imagen_path` cargado. El bucket es privado, así que `imagen_url` queda en null a propósito y la URL se firma al pedirla. **El listado nunca firmaba.**

→ Firma todas las rutas en una sola llamada.

**9 · Depósitos no editables ni eliminables, y duplicables.**

→ Se pueden editar y eliminar. El borrado se rechaza si el depósito tiene stock, ubicaciones adentro o movimientos — ahí se desactiva, no se borra. Y `"dep-01"` ya no convive con `"DEP-01"`.

**10 · No existía la transferencia entre depósitos.** La pantalla decía que se hacía con Notas de Remisión, módulo que esta instancia no tiene habilitado. El stock quedaba atrapado donde se hubiera cargado.

→ Botón **Transferir** en cada fila. Deja dos movimientos en el kardex (salida y entrada) que se compensan; el stock total no cambia. Si la entrada al destino falla, la salida se revierte.

**11 · "Emitir nota de remisión" llevaba a un módulo deshabilitado.**

→ Botón eliminado, reemplazado por la transferencia.

---

## Sucursales

**12 · Al editar solo se podía cambiar el nombre.**

→ También código, establecimiento y punto de expedición.

**13 · Dos "Ñemby".** La validación no existía.

→ Validación de nombre y código sin distinguir mayúsculas. La duplicada que ya estaba cargada quedó inactiva como "ÑEMBY (duplicada)" — **no se borró**: podía tener ventas colgando.

---

## Ventas

**14 y 15 · Lista de precios A/B/C y porcentajes fijos.** Los tres botones de descuento eran `0 / -3 / -5 %`, valores que no corresponden a ningún acuerdo comercial de esta empresa. Y A/B/C eran etiquetas heredadas del fork de ferretería.

→ Se quitó la lista A/B/C. En lugar de los tres botones, un **campo de descuento por ítem** donde se escribe el porcentaje que haga falta.

---

## Reportes y contabilidad

**16 · Libro de Ventas daba 500.** `clientes` en este schema no tiene `razon_social` ni `ruc_factura`, y la consulta las leía: `column cl.razon_social does not exist`.

→ Ahora consulta qué columnas existen y arma el nombre y el RUC con las que haya.

**17 · Libro diario y mayor vacíos.** `plan_cuentas` estaba vacío y `configuracion_contable` no apuntaba a ninguna cuenta, así que el generador de asientos no tenía contra qué imputar.

→ Script `10`: 46 cuentas y la configuración resuelta.

**Importante:** los asientos se generan **en el momento de cada operación**. Las compras y ventas ya cargadas no se recalculan solas — para ésas hay un backfill aparte.

**18 · Configuración contable "no habilitada".** Las doce cuentas **ya están asignadas**, verificado contra la base. Se probó antes de correr el script `10`.

---

## RR. HH.

**19 · Correo en mayúsculas.**

→ Se guarda en minúsculas, y los ya cargados se normalizaron.

**20 · Vacaciones no editables y columnas desparejas.** La API solo aceptaba cambiar el estado: una solicitud con la fecha equivocada había que cancelarla y volver a cargarla.

→ Se pueden editar fechas, tipo y observación; los días se recalculan solos. Las columnas llevan ancho fijo.

**21 · No se registraban las llegadas tarde.** No había contra qué comparar: ningún empleado tenía horario previsto.

→ Script `11`: hora de entrada y tolerancia por empleado. La tardanza se guarda **calculada en el momento del fichaje**, no deducida al mostrar — si mañana le cambian el horario, el historial tiene que seguir diciendo lo que pasó aquel día.

La columna tiene **tres estados** y los tres son correctos: `—` (sin horario cargado), `En hora`, y los minutos en rojo.

---

## CRM

**22 · El formulario de nuevo prospecto se veía chico.**

→ De `max-w-2xl` a `max-w-5xl`, y la grilla se adapta al ancho de la pantalla.

---

## Hallazgos que el QA no reportó

Aparecieron al cruzar el código contra la base:

- **Toda venta terminaba en 404 al imprimir.** El botón abría `/api/ventas/[id]/comprobante-a4`, una ruta que no existía en esta repo. Se portó, y se le sacó la ciudad hardcodeada, que era la de otra empresa.
- **Tres botones apuntaban a rutas inexistentes**, rotos en todos los forks: "Imprimir factura" en ventas, e "Importar feriados ES" y "Reporte PDF" en RRHH. Este último importaba feriados **de España** en un ERP paraguayo.
- **Las fechas se mostraban un día antes.** Nueve pantallas tenían su propia función de formato con el mismo defecto de zona horaria.
- **`/ventas/cierre`** seguía existiendo sin ningún link entrante desde que el arqueo lo hace el módulo de caja.

---

## Scripts SQL

Los cuatro ya están corridos:

| | Para qué |
|---|---|
| `04_catalogos` | Dashboard |
| `09_caja_columnas_faltantes` | Apertura de caja |
| `10_plan_de_cuentas` | Plan de cuentas y config contable |
| `11_llegadas_tarde` | Horario de entrada por empleado |

Todos probados contra un PostgreSQL local e idempotentes.

---

## Pendiente

- **El logo.** Hoy se usa el genérico de Zentra, en el header, el comprobante de venta y el recibo de cobro.
- **Establecimiento y punto de expedición** de dos sucursales. Son datos fiscales que asigna la DNIT, no se inventan.
- **Asientos de las operaciones viejas**, si se los quiere.
