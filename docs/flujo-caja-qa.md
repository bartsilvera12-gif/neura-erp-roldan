# Flujo de caja — guía para QA

**Dónde:** Pagos → Flujo de caja

---

## Qué hace

Muestra, día por día, cuánto hay que pagarle a cada proveedor este mes.

Una fila por proveedor, una columna por día. Cada celda es un pago, pintada según el estado del
cheque.

Las facturas **aparecen solas**: salen de las compras ya cargadas. No se tipea nada dos veces.

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

- Scripts `07_flujo_caja_cheques.sql` y `08_flujo_caja_saldos.sql` corridos
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
| 10 | Cargar fondos y tipo de cambio | La fila *Disponible* arranca en los fondos y baja con cada pago. Rojo si no alcanza |

---

## Lo que NO es un bug

- Un cheque cobrado deja el total de la fila en `—`. Correcto: esa plata ya salió.
- Hay **dos tipos de cambio** y son distintos. El de la compra convierte esa factura. El de la
  cabecera convierte solo el total del mes, y se pone más alto a propósito, como colchón.
- Los saldos de bancos, efectivo y mercadería **se cargan a mano**. No hay conciliación bancaria.
- La **mercadería no suma** a los fondos disponibles.
- Al cambiar de mes, los **fondos no se arrastran** (el tipo de cambio sí).
- La fila **VARIOS** junta a los proveedores chicos y no permite emitir cheques desde ahí.

---

## Si algo falla

Mandar: **mes que estabas mirando**, **tipo de pago y plazo** de la compra, **fecha de la
factura**, y el **mensaje de error textual** (nombran el script o el permiso que falta).
