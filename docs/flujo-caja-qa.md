# Flujo de caja — guía para QA

**Módulo:** Flujo de caja
**Ruta:** Pagos → Flujo de caja (`/pagos/flujo-caja`)
**Origen:** reunión con Joaquín Roldán del 20-10-2026. El módulo reemplaza una planilla de
Excel que hoy se carga a mano.

---

## 1. Qué hace

Proyecta, día por día, **cuánta plata hay que pagarle a cada proveedor** durante un mes, y
cuánto queda disponible después de esos pagos.

Es una grilla: **una fila por proveedor, una columna por día del mes**. Cada celda muestra el
monto a pagar ese día, pintado según el estado del cheque.

La diferencia con la planilla de Excel es que **las facturas caen solas**: salen de las compras
ya cargadas en el ERP, no se tipean de nuevo.

---

## 2. Antes de probar

Estos pasos son precondición. Sin ellos la pantalla se ve vacía y no es un bug.

| # | Qué | Dónde |
|---|---|---|
| 1 | Scripts SQL `07_flujo_caja_cheques.sql` y `08_flujo_caja_saldos.sql` ejecutados | SQL editor de Supabase |
| 2 | Al menos un **banco** cargado | Pagos → Bancos y cajas |
| 3 | Al menos un **proveedor** | Proveedores → Nuevo |
| 4 | Al menos una **compra a crédito** | Compras → Nueva |
| 5 | **Tipo de cambio** y **Fondos disponibles** del mes guardados | Cabecera de la propia pantalla |

> Si falta el punto 1, la pantalla muestra un error que nombra el script que falta.

---

## 3. Conceptos que hay que tener claros

### 3.1 Solo entran las compras a crédito

En Compras → Nueva, el campo **Tipo de pago** viene en *Contado* por defecto. Una compra al
contado ya está pagada, así que **no se proyecta**. Para que aparezca en el flujo hay que
ponerla en **Crédito** y cargarle el **plazo en días**.

Joaquín lo confirmó en la reunión: *"como trabajamos a crédito con nuestros proveedores,
generalmente en 30 días"*.

### 3.2 La fecha de la celda es la fecha de pago, no la de la factura

```
fecha de pago = fecha de la factura + plazo en días
```

Una factura cargada el 21 de octubre con plazo 30 cae el **20 de noviembre**. Es el error más
común al probar: se carga la compra y se la busca en el mes equivocado.

La pantalla ahora lo avisa sola: si el mes está vacío pero hay facturas en otro mes, muestra
botones para saltar directo a ese mes.

### 3.3 Hay dos tipos de cambio y no se pisan

| | Dónde se carga | Para qué sirve |
|---|---|---|
| **De la factura** | Compras → Nueva | Convierte **esa compra**. Queda guardado con la factura y no cambia nunca más. |
| **Del mes** | Cabecera del flujo | Convierte **el total del mes** a guaraníes, solo para la fila "Disponible". |

El del mes se pone **más alto que el real, a propósito**. Joaquín: *"tomamos un tipo de cambio
más alto que el que corresponde realmente... por un tema de colchón financiero"*.

**No es un bug que sean distintos.** El monto de cada celda usa el de la factura; el de la
cabecera nunca toca una factura.

### 3.4 Cheques diferidos: dos fechas distintas

Un cheque tiene **fecha de pago** (cuándo vence la factura) y **fecha de cobro** (desde cuándo el
banco deja cobrarlo). No coinciden.

Ejemplo de la reunión: factura que vence el 6 de octubre, cheque emitido para cobrarse el 10.

### 3.5 Un cheque cubre varias facturas

Pero **siempre del mismo proveedor**. Al emitir se tildan las facturas que ese cheque paga.

### 3.6 La fila VARIOS

Los proveedores chicos se agrupan en una fila llamada **VARIOS**, que va siempre al final y
**siempre en guaraníes**. Se marca con el campo `agrupa_en_varios` del proveedor.

Desde la fila VARIOS **no se puede emitir cheque** (junta varios proveedores). Hay que entrar
por la fila del proveedor.

---

## 4. Los colores

| Color | Estado | ¿Suma al flujo? |
|---|---|---|
| 🟣 Violeta | Pendiente de emisión — hay que pagar, no se hizo el cheque | Sí |
| 🟢 Verde | Emitido — cheque hecho, todavía no cobrado | Sí |
| 🟡 Amarillo | Cobrado — ya salió del banco | **No** |
| ⚪ Gris | Anulado | **No** |

Que un cheque cobrado deje el total de la fila en `—` **es correcto**, no un bug.

---

## 5. Casos de prueba

### CP-01 · Una factura a crédito aparece sola en la grilla
1. Compras → Nueva. Proveedor cualquiera, **Tipo de pago: Crédito**, **Plazo: 5**, un producto.
2. Guardar.
3. Ir a Pagos → Flujo de caja, mes = el de hoy.

**Esperado:** aparece una fila con el proveedor y una celda violeta en el día `hoy + 5`, con el
monto de la factura.

---

### CP-02 · La factura cae en el mes correcto
1. Cargar una compra a crédito con **plazo 30**.
2. Abrir el flujo en el mes actual.

**Esperado:** el mes aparece vacío, con el mensaje *"Hay 1 factura a crédito, pero su pago cae
en otro mes"* y un botón con el mes siguiente. Al apretarlo, la factura está ahí.

---

### CP-03 · Una compra al contado NO aparece
1. Cargar una compra con **Tipo de pago: Contado**.
2. Abrir el flujo.

**Esperado:** no aparece. Si no hay ninguna compra a crédito, el mensaje dice *"Hay N compras
cargadas, pero ninguna está a crédito"*.

---

### CP-04 · Emitir un cheque
1. Clic en una celda violeta.
2. Tildar una o más facturas de la lista.
3. Cargar **Nº de cheque**, elegir **Banco** y una fecha en **Cobrable desde**.
4. Apretar *Emitir por …*.

**Esperado:** la celda pasa a **verde**. Al pasar el mouse por encima, el detalle muestra las 4
cosas: Nº de factura, Nº de carga, Nº de cheque y fecha de cobro.

---

### CP-05 · Un cheque sin número queda pendiente
1. Repetir CP-04 **sin cargar el Nº de cheque**.

**Esperado:** la celda queda **violeta** (pendiente de emisión). Al abrirla aparece el botón
**"Cargar número"**, que abre Nº + Banco + Cobrable desde. Al guardarlo pasa a verde.

> Este es el flujo real: Joaquín marca los pagos del mes y después, el día que se sienta a hacer
> los cheques, los carga uno por uno.

---

### CP-06 · Un cheque cubre varias facturas
1. Cargar **dos** compras a crédito del **mismo proveedor** que caigan el **mismo día**.
2. Abrir la celda, tildar **las dos**, emitir un solo cheque.

**Esperado:** un solo cheque por la suma de las dos. Las dos facturas quedan cubiertas y no
aparecen más como pendientes.

---

### CP-07 · Marcar cobrado
1. Sobre un cheque verde, apretar **"Marcar cobrado hoy"**.

**Esperado:** pasa a **amarillo**, deja de sumar al total de la fila y al subtotal del día, y el
Disponible de los días siguientes sube.

---

### CP-08 · Anular
1. Sobre cualquier cheque, apretar **Anular**.

**Esperado:** pasa a **gris** y deja de sumar. Las facturas que cubría **no** vuelven a aparecer
como pendientes (el cheque sigue existiendo, anulado).

---

### CP-09 · Número de cheque duplicado
1. Emitir un cheque Nº `1234` en el Banco X.
2. Emitir otro cheque Nº `1234` en el **mismo** Banco X.

**Esperado:** se rechaza con *"Ya existe un cheque con ese número en ese banco."*
El mismo número en **otro** banco sí se permite.

---

### CP-10 · Disponible y acumulado
1. Cargar **Fondos disponibles** (ej. `19000000000`) y **Tipo de cambio** (ej. `6400`). Guardar.

**Esperado:** la fila *Disponible Gs.* arranca en los fondos y **baja** con cada pago proyectado.
Pasa a **rojo** si los pagos del mes superan los fondos.
*Disponible US$* es el mismo número dividido por el tipo de cambio del mes.

> En la planilla de Excel este número se llevaba **en negativo**. Acá es positivo mientras quede
> plata. Es un cambio deliberado, no un error de signo.

---

### CP-11 · El mes sin fondos cargados
1. Cambiar a un mes que nunca se configuró.

**Esperado:** un aviso ámbar dice que el mes no tiene fondos cargados y que por eso Disponible da
cero. El **tipo de cambio sí se hereda** del último mes que lo tenga; los fondos no.

---

### CP-12 · Posición de liquidez
1. Apretar **Editar** en el panel *Posición de liquidez*.
2. Cargar un saldo de tipo **Banco** y uno de tipo **Efectivo en caja**. Guardar.

**Esperado:** *Disponible al inicio* pasa a ser la suma de esos dos (convertidos a guaraníes con
el tipo de cambio del mes) y **deja de usar** el monto manual de arriba.
Un saldo de tipo **Mercadería** se muestra **pero no suma**: no es plata disponible. Joaquín lo
dijo así: *"también solemos agregar el valor de mercadería, pero eso aparte"*.

---

### CP-13 · Subtotal en dólares excluye VARIOS
1. Marcar un proveedor con `agrupa_en_varios`.
2. Cargarle una compra a crédito en el mismo día que otra de un proveedor en USD.

**Esperado:** el *Subtotal US$* del día **no** incluye lo de VARIOS; eso va al *Subtotal Gs.*
Replica la fórmula del Excel: `=SUMA(C5:C15)-C14`.

---

### CP-14 · Proveedor en USD con una factura en guaraníes
1. A un proveedor marcado en USD, cargarle una compra en **PYG**.

**Esperado:** la columna *Total* de esa fila muestra **dos renglones**, uno en US$ y otro en Gs.
No los suma entre sí.

---

### CP-15 · Vista compacta
1. Abrir un mes con pagos en pocos días.

**Esperado:** la grilla muestra **solo los días con pagos**, y arriba a la derecha dice cuántos
días se ocultan, con el botón **"Ver el mes completo"**. El botón alterna entre las dos vistas.

---

## 6. Limitaciones conocidas (no reportar como bug)

1. **No hay conciliación bancaria.** Los saldos de bancos, efectivo y mercadería se cargan a
   mano. El ERP no los lee de ningún lado.
2. **La mercadería no suma** a los fondos disponibles. Es informativa.
3. **Los fondos no se arrastran** de un mes al otro. El tipo de cambio sí.
4. **Las compras al contado nunca aparecen**, por diseño.
5. **Una factura sin plazo** cae en la fecha de la propia factura.
6. **La fila VARIOS no permite emitir cheques.**
7. El plazo se cuenta desde la **fecha de la factura**, no desde la recepción de la mercadería.
   Está pendiente de confirmar con el cliente.
8. **El flujo vive dentro del módulo Pagos.** Cualquiera con acceso a Pagos ve los saldos
   bancarios. Está pendiente definir si va como módulo aparte.

---

## 7. Qué reportar

Si algo falla, incluir en el reporte:

- **Mes y año** que estabas mirando.
- **Tipo de pago y plazo** de la compra involucrada.
- **Fecha de la factura** (no la de carga).
- **Moneda y tipo de cambio** de la compra.
- Captura de la grilla **y** de la pantalla de la compra.

Los mensajes de error de esta pantalla nombran el script SQL o el permiso que falta — copiarlos
textuales ayuda mucho más que "no carga".
