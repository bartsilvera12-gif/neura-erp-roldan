# Guía de pruebas — Neura ERP Roldán e Hijos

Cómo probar los 46 puntos del PDF de requerimientos, uno por uno.

**Antes de empezar:**

1. Corré los scripts SQL pendientes (del 21 al 29). Si falta alguno, las pantallas
   correspondientes avisan "falta correr tal script" en vez de romperse.
2. Entrá con un usuario **administrador**. Donde haga falta probar con un usuario
   común, está aclarado.
3. Varios puntos necesitan datos cargados (ventas, compras, cobros). Si la base
   está vacía, las pantallas se ven bien pero no prueban nada: cargá primero
   dos o tres operaciones de cada tipo.

**Cómo leer cada punto:** 🟢 es lo que tiene que pasar. 🔴 es la trampa — lo que
falla si está mal hecho, y es ahí donde conviene mirar.

---

## 1 · Inventario y stock

### 1.1 · Planilla de inventario para contar
**Dónde:** Inventario → botón *Planilla de conteo*

1. Elegí uno o varios rubros y generá la planilla.
2. Mandala a imprimir (Ctrl+P) y mirá la vista previa.

🟢 Sale una hoja por rubro, con dos columnas en blanco para anotar el conteo.
🟢 El encabezado se repite en todas las hojas.
🟢 No aparece la URL ni la fecha del navegador en los bordes.
🔴 Si ves "localhost" o la fecha arriba de la hoja, el `@page` no está
aplicando: avisame.
🔴 Probá con un producto de código de barras largo (13 dígitos): tiene que
entrar completo, sin cortarse.

### 1.2 · Stock mínimo automático
**Dónde:** Inventario → Reposición

1. Mirá la columna *Mínimo* de un producto con ventas en varios meses.
2. Cambiá "Analizar los últimos" de 60 a 180 días y volvé a calcular.

🟢 El mínimo sugerido cambia al cambiar el período.
🟢 Un producto sin ventas en 6 meses sugiere mínimo 0, no un número inventado.
🔴 El cálculo usa la **mediana** de los meses cerrados, no el promedio: un mes
con una venta grande no tiene que disparar el mínimo de todo el año.

### 1.3 · Stock crítico por rubro
**Dónde:** Inventario → Rubros → editar un rubro

1. Ponele a un rubro "días críticos = 7" y guardá.
2. Volvé a Reposición y filtrá por ese rubro.

🟢 Arriba dice cuántos rubros tienen su propio umbral.
🟢 Los productos de ese rubro cambian de estado antes que los demás.
🔴 Los rubros sin umbral propio usan un tercio de la cobertura. Si ponés
cobertura 30, son 10 días.

### 1.4 · Historial de ajustes
**Dónde:** Inventario → Ajustes de stock

1. Hacé un ajuste desde la ficha de un producto (cambiá el stock a mano).
2. Entrá a Ajustes de stock.

🟢 Aparece con código (AJU-…), fecha, hora, cantidad con signo, stock antes y
después, motivo y usuario.
🟢 Filtrá por fecha y exportá a Excel.
🔴 Los ajustes **viejos**, anteriores al script 19, pueden mostrar "? 5" en la
cantidad. Eso es correcto y es a propósito: de esos no se puede saber si sumó
o restó, y preferimos decir "no sé" antes que inventar el signo.

### 1.5 · Compras en dólares
**Dónde:** Compras → Nueva compra

1. Elegí moneda USD. Se precarga la cotización vigente.
2. Cargá un producto a USD 100 y guardá.
3. Andá a la ficha de ese producto y mirá el costo promedio.

🟢 El costo quedó en guaraníes, convertido a la cotización usada.
🟢 Si comprás el mismo producto dos veces a precios distintos, el costo
promedio queda entre los dos, ponderado por cantidad.
🔴 **Prueba importante:** la conversión la rehace el servidor. Aunque el
navegador mandara un número equivocado, el costo guardado es el correcto.

### 1.6 · Valoración de existencias a una fecha
**Dónde:** Inventario → Valoración

1. Poné la fecha de hoy. Anotá el total.
2. Poné una fecha de hace un mes.

🟢 El total cambia y refleja el stock que había ese día.
🟢 Los productos marcados "aprox." son aquellos cuyo historial tiene un ajuste
del que no se puede reconstruir el costo. Es una advertencia honesta, no un
error.
🔴 Comparalo contra el valor actual del inventario: a fecha de hoy tienen que
coincidir.

### 1.7 · Márgenes y remarcación
**Dónde:** Inventario → Estudio de precios (y también en Caja al vender)

🟢 Se ven **las dos** columnas, con su nombre: *Margen* y *Remarcación*.
🔴 Verificá la relación con una calculadora: un producto con costo 100.000 y
precio 250.000 tiene **150% de remarcación** y **60% de margen**. Si en algún
lado ves un solo número rotulado "ganancia", avisame: es justo la confusión
que esto viene a evitar.

---

## 2 · Ventas

### 2.1 · Buscar ventas
**Dónde:** Ventas

1. Buscá por número de factura, por cliente y por rango de fechas.
2. Abrí el detalle de una venta.

🟢 Se ven los ítems, el cliente, el medio de pago y quién la hizo.

### 2.2 · Editar una venta
**Dónde:** Ventas → abrir una venta → *Editar* (solo administrador)

1. Cambiá la cantidad de un ítem y guardá con un motivo.
2. Mirá el stock del producto antes y después.
3. Entrá al historial de ediciones de esa venta.

🟢 El stock se ajusta por la diferencia: si pasaste de 2 a 5 unidades, salen 3 más.
🟢 Queda registrado qué cambió, quién y por qué.
🔴 **Prueba clave:** intentá editar poniendo una cantidad mayor al stock
disponible (por ejemplo 50 chapas cuando hay 3). Tiene que **rechazar la
edición entera** y dejar el stock y la venta exactamente como estaban. Si
quedan 50 vendidas o el stock queda en negativo, avisame enseguida.

### 2.3 · Descuentos con tope
**Dónde:** Usuarios → editar un usuario → *Descuento máximo* ; después Caja

1. Ponele 10% de tope a un usuario.
2. Entrá con ese usuario y hacé una venta con 25% de descuento.

🟢 El servidor rechaza la venta con un mensaje claro.
🟢 Con 10% o menos, pasa.
🔴 El tope lo aplica el **servidor**, no la pantalla: aunque alguien manipule
el navegador, la venta no entra.

---

## 3 · Clientes

### 3.1 · Rubros de cliente
**Dónde:** Clientes

🟢 Están los cinco rubros y se puede filtrar por ellos.
🔴 Si ya tenías un "Mayorista" cargado antes, **no** tiene que haberse
duplicado al correr el script 23.

### 3.2 · Alta de cliente desde Caja
**Dónde:** Caja → al cobrar → *Crear cliente*

🟢 Están profesión y límite de crédito además de los datos de siempre.
🟢 Al guardar, el cliente queda seleccionado en la venta en curso.

### 3.3 · Historial del cliente desde Caja
**Dónde:** Caja → elegir un cliente → *Ver historial*

🟢 Se ven sus compras anteriores sin salir de la venta en curso.

---

## 4 · Comisiones y cartera

> **Antes:** corré el script 24 y configurá en *Configuración → Comisiones*:
> al menos un tipo de vendedor, un porcentaje, y asignale ese tipo a un
> usuario. **Sin esto las comisiones dan cero y no estarás probando nada.**

### 4.1 y 4.3 · Cartera por vendedor
**Dónde:** Comisiones → Cartera

🟢 Cada cliente aparece asignado a quien le vendió.
🟢 Se ve cuántos días le quedan antes de liberarse.
🔴 A los 30 días sin comprar, el cliente se libera. Para probarlo sin esperar:
mirá un cliente cuya última venta sea de hace más de un mes.

### 4.2 y 4.6 · Informe y hoja de firma
**Dónde:** Comisiones → elegir período → *Informe* y *Hoja para firmar*

🟢 El informe muestra, por vendedor, cuánto vendió y cuánto le corresponde.
🟢 La hoja sale en A4 con el renglón para firmar.

### 4.4 y 4.5 · Comisión por rentabilidad
**Dónde:** Comisiones → Informe

🔴 **La prueba que vale:** hacé dos ventas del mismo producto, una sin
descuento y otra con 10% de descuento. La comisión de la segunda tiene que
bajar **más que 10%**, porque se calcula sobre la ganancia y no sobre la
facturación. En nuestras pruebas bajó un 30%. Si bajó exactamente 10%, está
calculando sobre la venta y hay que revisarlo.

---

## 5 · Caja

### 5.1 · Reabrir un turno anterior
**Dónde:** Caja → Turnos anteriores → *Reabrir* (solo administrador)

🟢 Pide motivo obligatorio.
🟢 Los números del cierre original **se conservan**: son con qué comparar.
🔴 Si la misma caja ya tiene un turno abierto ahora, tiene que rechazarlo.

### 5.2 · Detalle del cierre
**Dónde:** Caja → Turnos anteriores → ver uno cerrado

🟢 Se ven las operaciones del turno y el motivo de cada anulación.

### 5.3 · Resumen obligatorio
**Dónde:** Caja → turno abierto

🟢 Están: egresos, anticipos, ventas contado, ventas crédito, dinero a rendir,
retiros y diferencias.
🔴 Las ventas a crédito **no** suman al dinero a rendir: esa plata no entró.

### 5.4 · Arqueo por denominación
**Dónde:** Caja → Cerrar turno → contar billetes ; después *Imprimir arqueo A4*

🟢 Al cargar las cantidades por denominación, el total se calcula solo.
🟢 El A4 sale con cinco secciones separadas: ingresos, egresos, conteo,
resumen y anuladas.

### 5.5 · Arrastre de diferencias
**Dónde:** Caja → cerrar con faltante → abrir el turno siguiente

1. Cerrá un turno con menos plata de la esperada.
2. Abrí el turno siguiente.

🟢 El turno nuevo avisa que arrastra el faltante del anterior, y de cuál viene.
🔴 Un faltante que se olvida es un faltante que nadie investiga: tiene que
aparecer solo, sin que haya que ir a buscarlo.

### 5.6 · Anticipos
**Dónde:** Caja → Anticipos

1. Registrá un anticipo con el turno abierto.
2. Mirá el arqueo de ese turno.
3. Anulalo (solo administrador, con motivo).

🟢 El anticipo entra al arqueo: la plata está en el cajón.
🟢 Arriba se ve "se debe en mercadería" y el acumulado por cliente.
🟢 Anulado, **sigue apareciendo** en la lista, marcado y con su motivo.
🔴 No tiene que desaparecer: esa plata entró el día que entró, y borrarla
descuadraría el arqueo de ese día.

### 5.7 · Egresos tipificados
**Dónde:** Caja → Registrar egreso

🟢 Hay que elegir un tipo de la lista.
🔴 Si elegís *Otros*, tiene que **exigir** el motivo escrito. Si te deja
guardar "Otros" sin explicación, avisame.

---

## 6 · Compras y proveedores

### 6.1 · Precio en dólares
Ver punto 1.5.

### 6.2 · Condición de pago del proveedor
**Dónde:** Proveedores → editar uno → poner "crédito, 30 días"

1. Andá a Compras → Nueva compra y elegí ese proveedor.
2. Después mirá Pagos → Por pagar.

🟢 Al elegir el proveedor se precargan solos el tipo de pago y el plazo.
🟢 Mientras cargás, muestra la fecha de vencimiento calculada.
🟢 En el listado de proveedores hay una columna *Condición*.
🔴 Si borrás el plazo y guardás igual, el servidor lo completa con el del
proveedor. Una compra a crédito sin plazo no vence nunca y desaparece del
radar de pagos: eso es justo lo que esto evita.

---

## 7 · Tipos de cambio

### 7.1 · Indicadores en el Dashboard
**Dónde:** Dashboard (arriba del todo)

🟢 Se ven comprador y vendedor, con quién los cargó y cuándo.
🟢 Como administrador aparece *Actualizar*; con un usuario común, no.
🔴 Al abrir el formulario se precarga la cotización anterior: lo normal es
moverla unos guaraníes, no escribirla de cero.
🔴 Probá cargar vendedor **menor** que comprador: tiene que rechazarlo.

### 7.2 · Historial
**Dónde:** Compras → Tipos de cambio

🟢 Cada cotización con fecha, hora, usuario y observación. Filtros por fecha y
por usuario.
🟢 La columna *Variación* compara con la anterior y resalta los saltos
grandes (arriba del 10%), que casi siempre son un cero de más.
🔴 **No hay botón de editar ni de borrar, y es a propósito.** Una cotización
vieja es la que se usó para costear las compras de ese día; si se pudiera
corregir, el costo de esas compras cambiaría solo. Corregir es cargar otra.

---

## 8 · Movimientos y sucursales

### 8.1 · Número de remisión
**Dónde:** Inventario → Reposición entre sucursales

1. Creá una transferencia y aprobala.
2. Despachala.

🟢 Al despachar aparece el número de remisión (REM-…).
🟢 Antes de despachar, la columna *Remisión* está vacía: todavía no viajó nada.
🟢 Se puede filtrar por número de transferencia o de remisión, por estado y por
fechas.
🔴 Los números no se repiten nunca, ni aunque dos personas despachen al mismo
tiempo: lo garantiza un índice único en la base, no la aplicación.

### 8.2 · Filtros de Movimientos
**Dónde:** Inventario → Movimientos

🟢 Hay filtro por **usuario** y por fecha.
🟢 **No** hay filtro por tipo: se sacó a pedido. El tipo ya se lee en su
columna y en el signo de la cantidad.

---

## 9 · Presupuestos

### 9.1 y 9.2 · Cotizar sin stock, y reservas
**Dónde:** Presupuestos → Nuevo

1. Agregá un producto y pedí más cantidad de la que hay.

🟢 Bajo la cantidad aparece: físico, reservado y disponible.
🟢 Avisa cuánto falta, en ámbar.
🟢 **Deja guardar igual.** Cotizar lo que no hay es normal.
🔴 Para probar el *reservado*: aprobá un presupuesto con 5 unidades de un
producto y volvé a cotizar ese producto. El disponible tiene que haber bajado
en 5. Solo reservan los **aprobados** y vigentes: un presupuesto en "creado"
o "enviado" no compromete nada.
🔴 El disponible puede dar **negativo** y se muestra así. No es un error: son
unidades prometidas que no existen.

### 9.3 · Vigencia
🟢 En el listado hay columna *Vence*, y los vencidos se marcan.

### 9.4 · Presentación
**Dónde:** Presupuestos → abrir uno → *Descargar PDF*

🟢 El PDF sale en **azul**.
🟢 Están las condiciones comerciales y las observaciones, por separado.
🔴 Escribí las condiciones en **tres renglones distintos** y descargá el PDF:
tienen que salir en tres renglones, no todos pegados en un párrafo.

---

## 10 · Informes

### 10.1 · Utilidad por período
**Dónde:** Reportes → Rentabilidad

🟢 Cambiá entre *Por producto* y *Por rubro*; elegí mes o rango.
🟢 Botones de *Excel* e *Imprimir*.
🔴 **Lo que hay que mirar:** *Ganancia* está en guaraníes y *Margen* en
porcentaje; son columnas distintas. Buscá un rubro con margen alto y poca
venta: en *Partic.* tiene que aportar poco a la ganancia total. Esa es la
diferencia que el informe viene a dejar clara.

### 10.2 · Cobranzas
**Dónde:** Reportes → Cobranzas

🟢 Cliente, factura cobrada, fecha, importe, medio y comprobante.
🟢 Filtros por fecha, medio, estado y búsqueda. Exporta a Excel.
🔴 Son **dos** columnas distintas: *Factura* es contra qué se imputó la plata;
*Comprobante* es el número de transferencia o cheque con que se demuestra que
entró. Hacen falta las dos para cruzar contra el extracto del banco.

### 10.3 · Cuentas por cobrar
**Dónde:** Pagos

🟢 Cada cliente con su código (CLI-…) y su saldo.
🟢 Filtros por fecha, situación (vencidas / al día) y búsqueda por cliente,
código o factura. Dos botones de Excel: cuentas y cobros.
🔴 **La prueba más importante de todo el módulo.** Registrá un cobro, después
anulalo (solo administrador, con motivo) y fijate:
  - el saldo del cliente vuelve a subir;
  - el cobro **sigue en la lista**, tachado, con quién lo anuló y por qué;
  - si el turno sigue abierto, aparece un egreso "Anulación de cobro" en la caja;
  - ya **no** se le puede emitir recibo.
Si el cobro desaparece de la lista, avisame enseguida: eso era lo que pasaba
antes y es lo que vinimos a arreglar.

### 10.4 · Libros de IVA
**Dónde:** Reportes → Libro de Ventas (y Libro de Compras) → *Imprimir*

🟢 Sale apaisado, con los encabezados repetidos en cada hoja.
🟢 En la última página: el **resumen del período** con base gravada total,
IVA total e importe total.
🟢 En Ventas, el resumen agrega el neto facturado (facturas menos notas de
crédito).
🔴 Las notas de crédito salen en cursiva y con importes negativos, para que
nadie las sume de a dos.

### 10.5 · Estudio de precios
**Dónde:** Inventario → Estudio de precios

1. Arriba, mirá el resumen por rubro: cuántos artículos, qué margen, cuántos
   sin costo y cuántos se venden bajo el costo.
2. Elegí un rubro, poné *Remarcación 60%*, redondeo a 500, y tocá
   **Ver qué cambia**.

🟢 Muestra fila por fila el precio actual y el nuevo, y cuáles no se pueden
tocar (y por qué).
🟢 Avisa si alguno quedaría por debajo del costo.
🟢 Recién entonces aparece *Aplicar*.
🔴 **Verificá la cuenta:** costo 100.000 con remarcación 60% da 160.000.
Con *Margen objetivo 35%* da 153.846 (o 154.000 si redondeás a 500).
🔴 Siempre redondea **hacia arriba**. Hacia abajo se regala margen en cada venta.
🔴 Después de aplicar, abrí *Últimos cambios de precio*: tiene que estar el
lote con la fecha, cuántos productos, la regla usada y tu nombre.

---

## 11 · Requisitos generales

### 11.1 · Excel e impresión
Probá el botón *Excel* en: Movimientos, Ajustes, Anticipos, Pagos,
Presupuestos, Transferencias, Tipos de cambio, Estudio de precios, Reposición,
Cobranzas y Rentabilidad.

🟢 La planilla tiene el nombre de la empresa arriba y la fecha de generación.
🔴 **La prueba que importa:** poné filtros antes de exportar. La planilla tiene
que traer **exactamente** las filas que estabas viendo, ni una más.
🔴 Abrila en Excel y sumá una columna de importes: tienen que sumar. Si Excel
los trata como texto, avisame.

### 11.2 · Filtros desde/hasta
🟢 Están en todas las pantallas de documentos con fecha.
🟢 Clientes, Proveedores y Productos **no** tienen rango de fechas, a propósito:
son datos maestros, no documentos. Tienen búsqueda por texto.

### 11.3 · Trazabilidad
Verificá que quede usuario, fecha, hora y motivo en: ajustes de stock,
ediciones de venta, anulaciones (venta, compra, cobro, anticipo), reapertura
de caja, transferencias y cambios de precio.

### 11.4 · Permisos
Entrá con un **usuario común** (no administrador) y comprobá:

🟢 Puede anular una venta **de su turno abierto**.
🔴 **No** puede anular una venta de un turno ya cerrado.
🔴 **No** puede anular una compra ni un cobro.
🔴 **No** puede cambiar precios en bloque.
🔴 **No** puede cargar el tipo de cambio.
🔴 **No** puede reabrir una caja.

En todos los casos tiene que salir un mensaje que explique por qué, no un
error genérico.

### 11.5 · Formato institucional
🟢 Los documentos impresos salen con el logo y el nombre de la empresa.
🔴 **Pendiente:** hoy salen **sin RUC, sin teléfono y sin dirección**, porque
esos datos están vacíos en el sistema. Pasámelos y los cargo. Mientras tanto,
los libros de IVA y las remisiones se imprimen incompletos.

---

## Si algo falla

Anotá: en qué pantalla, qué hiciste, qué esperabas y qué pasó. Si salió un
mensaje de error, copialo tal cual. Con eso alcanza para encontrarlo.
