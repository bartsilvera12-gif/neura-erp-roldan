# Flujo de caja — guía para QA

**Dónde:** Pagos → Flujo de caja

---

## Qué hace

Muestra, día por día, cuánto hay que pagarle a cada proveedor este mes, cuánto se espera cobrar, y
con cuánta plata se queda la empresa después de cada día.

Una fila por proveedor, una columna por día. Cada celda es un pago, pintada según el estado del
cheque.

Las facturas **aparecen solas**: salen de las compras ya cargadas. No se tipea nada dos veces.

---

## Las tres filas del pie

| Fila | Qué dice |
|---|---|
| **Subtotal** | Lo que se paga ese día, separado por moneda |
| **Cobranzas** | Lo que vence ese día en cuentas por cobrar. Pasá el mouse y salen los clientes |
| **Disponible** | Con cuánto queda la empresa: fondos **+ cobranzas − pagos**, arrastrado día a día |

**Disponible en rojo** = los pagos del mes superan a lo que hay más lo que entra.

### De dónde salen los fondos con que abre el mes

En este orden, y la pantalla avisa cuál usó:

1. **Posición de liquidez** del mes (bancos + efectivo). Si está cargada, manda ella.
2. **Fondos disponibles**, el monto escrito a mano arriba.
3. **Arrastre**: el Disponible con que cerró el mes anterior, igual que la caja chica abre con el
   sobrante del día. Encadena hasta doce meses hacia atrás.
4. Nada de lo anterior → arranca en cero **y lo dice**, con un cartel amarillo.

El arrastre es una **proyección**, no un extracto bancario: usa lo que estaba previsto cobrar y
pagar, no lo que de verdad pasó por el banco. Cargar la posición de liquidez es la forma de volver a
anclarlo a la plata real.

---

## Cómo se usa

1. Cargás la compra en **Compras → Nueva**, con **Tipo de pago: Crédito** y el plazo en días.
2. La factura aparece sola en la grilla, el día que vence.
3. Hacés clic en la celda y emitís el cheque. La celda cambia de color.

---

## Los colores

- 🟣 **Violeta** — hay que pagar, todavía no se hizo el cheque
- 🟢 **Verde** — cheque hecho, no cobrado
- 🟡 **Amarillo** — ya lo cobraron (no suma: la plata ya salió)
- ⚪ **Gris** — anulado (no suma)

---

## Las dos trampas

Son las dos cosas que van a hacer reportar un bug que no existe.

**1. Solo entran las compras a CRÉDITO.** En Compras → Nueva el campo viene en *Contado*. Una
compra al contado ya está pagada, no se proyecta.

**2. La celda es la fecha de PAGO, no la de la factura.**

```
fecha de pago = fecha de la factura + plazo
```

Una factura de hoy con plazo 30 cae **el mes que viene**. Es el error más común al probar.

---

## Antes de empezar

- Tablas `cheques`, `cheque_compras`, `flujo_caja_config` y `flujo_caja_saldos` creadas
- Un banco cargado en **Pagos → Bancos y cajas**
- Tipo de cambio y fondos del mes guardados, arriba en la misma pantalla

---

## Qué probar

| # | Hacer | Esperar |
|---|---|---|
| 1 | Compra a crédito, plazo 5 | Aparece una celda violeta el día `hoy + 5` |
| 2 | Compra a crédito, plazo 30 | El mes sale vacío, con un botón para ir al mes donde sí está |
| 3 | Compra al contado | No aparece |
| 4 | Clic en celda → cargar Nº de cheque, banco y "Cobrable desde" → Emitir | La celda pasa a **verde** |
| 5 | Emitir **sin** Nº de cheque | Queda **violeta**, con un botón "Cargar número" para completarlo después |
| 6 | Dos facturas del mismo proveedor el mismo día → tildar las dos → un solo cheque | Un cheque por la suma de las dos |
| 7 | "Marcar cobrado hoy" | Pasa a **amarillo** y deja de sumar |
| 8 | "Anular" | Pasa a **gris** y deja de sumar |
| 9 | Dos cheques con el mismo número en el mismo banco | Se rechaza |
| 10 | Cargar fondos y tipo de cambio | La fila *Disponible* arranca en los fondos, sube con las cobranzas y baja con cada pago. Rojo si no alcanza |
| 11 | Pasar a un mes SIN fondos cargados | Abre con el cierre del mes anterior y lo dice en un cartel gris, nombrando el mes. **No** arranca en cero |
| 12 | Venta a crédito con vencimiento este mes | Aparece en la fila *Cobranzas* el día que vence, y el Disponible sube |
| 13 | Dejar vencer una cuenta por cobrar y mirar el mes siguiente | Cartel rojo con el total vencido. Ese monto **no** está sumado en Disponible |
| 14 | Factura en **guaraníes** de un proveedor cuya moneda preferida es **dólares** → emitir | El cheque sale en **guaraníes**, no en dólares. El botón dice "Emitir por Gs." |
| 15 | Tildar una factura en Gs. y otra en US$ del mismo proveedor | No deja emitir: pide hacer un cheque para cada moneda |
| 16 | Emitir por un importe muy distinto al de las facturas | Cartel rojo y botón bloqueado si la diferencia es absurda; cartel amarillo si es un pago parcial, que sí se puede |

---

## Lo que NO es un bug

- Un cheque cobrado deja el total de la fila en `—`. Correcto: esa plata ya salió.
- Hay **dos tipos de cambio** y son distintos. El de la compra convierte esa factura. El de la
  cabecera convierte solo el total del mes, y se pone más alto a propósito, como colchón.
- La **moneda del cheque sale de las facturas**, no del proveedor. Un proveedor marcado en dólares
  con una factura en guaraníes se paga con un cheque en guaraníes.
- Los saldos de bancos, efectivo y mercadería **se cargan a mano**. No hay conciliación bancaria.
- La **mercadería no suma** a los fondos disponibles: es plata inmovilizada en stock.
- Las **cobranzas vencidas sin cobrar NO se suman** al Disponible. Van avisadas aparte, arriba de la
  grilla. Contar como disponible la plata que justamente no entró sería mentirse.
- La fila **VARIOS** junta a los proveedores chicos y no permite emitir cheques desde ahí.

---

## Si algo falla

Mandar: **mes que estabas mirando**, **tipo de pago y plazo** de la compra, **fecha de la
factura**, y el **mensaje de error textual** (nombran el script o el permiso que falta).
