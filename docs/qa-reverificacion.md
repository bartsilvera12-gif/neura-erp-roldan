# Reverificación QA — Roldán e Hijos

**Versión a probar:** `db67945`
**Fecha:** 22-10-2026

Los 8 puntos que seguían fallando. Probar en este orden.

---

## Para reprobar

### #16 · Libro de Ventas daba 500

**Dónde:** Contabilidad → Libro de Ventas
**Probar:** abrir la pantalla y elegir un rango de fechas.
**Esperado:** carga. Si no hay facturas electrónicas aprobadas, sale **vacío con un aviso** — eso es correcto, no es un error.

> Causa: la consulta leía dos columnas de `clientes` que en este schema no existen.

---

### #8 · El listado no mostraba imágenes

**Dónde:** Inventario
**Probar:** mirar la columna Producto.
**Esperado:** los productos **con imagen subida** muestran la miniatura. Los que no tienen, un recuadro gris con un ícono de caja.

Hoy hay 4 productos con imagen y 1 sin (PRUEBA).

> Causa: el bucket es privado y el listado nunca firmaba la URL.

---

### #7 · El "+" de Categoría perdía el formulario

**Dónde:** Inventario → Nuevo producto
**Probar:** llenar algunos campos, apretar **+ Crear** al lado de Categoría.
**Esperado:** se abre en **otra pestaña**. Al volver, el formulario sigue completo. El botón **Recargar** trae la categoría nueva.

Probar lo mismo con el **+ Crear** de Proveedor.

---

### #21 · Llegadas tarde

**Dónde:** RRHH → Control horario
**Probar en dos pasos:**

1. Abrir la pantalla. **Esperado:** carga (antes quedaba en error).
2. En la ficha de un empleado, cargar **Hora de entrada** (ej. `08:00`) y **Tolerancia** (ej. `10`). Después fichar con entrada `08:25`.

**Esperado:** la columna **Tardanza** muestra `15 min` en rojo.

Tres estados distintos, y los tres son correctos:

| Se ve | Significa |
|---|---|
| `—` gris | El empleado no tiene horario cargado |
| `En hora` verde | Llegó dentro de la tolerancia |
| `15 min` rojo | Llegó tarde |

---

### #13 · Dos sucursales "ÑEMBY"

**Dónde:** Sucursales
**Esperado:** una sola ÑEMBY activa. La otra aparece como **"ÑEMBY (duplicada)"** e inactiva.

**Probar además:** crear una sucursal llamada `ñemby` (minúsculas). **Esperado:** se rechaza.

**Y:** editar una sucursal. **Esperado:** se pueden cambiar nombre, código, establecimiento y punto de expedición — antes solo el nombre.

---

### #19 · Correo en mayúsculas

**Dónde:** RRHH → Empleados
**Esperado:** el correo de Giuliana se ve en minúsculas.

**Probar además:** crear un empleado escribiendo el correo en MAYÚSCULAS. **Esperado:** se guarda en minúsculas.

---

## Dependen de cargar datos, no de código

### #18 · "Sin configurar" en configuración contable

Las doce cuentas **ya están asignadas** en la base. Lo anterior se probó antes de correr el script del plan de cuentas.

**Probar:** Contabilidad → Configuración contable.
**Esperado:** las doce con una cuenta elegida.

Si sigue diciendo "Sin configurar", **avisar** — ahí hay algo más.

---

### #17 · Libro diario vacío

Los asientos se generan **en el momento de cada operación**. Todas las compras y ventas actuales se cargaron cuando el plan de cuentas todavía no existía, así que no tienen asiento.

**Probar:**
1. Cargar una **compra nueva**.
2. Ir a Contabilidad → Libro Diario.

**Esperado:** aparece el asiento de esa compra.

Las operaciones viejas **no** se recalculan solas. Si hacen falta, hay un backfill aparte.

---

## Antes de probar, confirmar

Estos scripts tienen que estar corridos (los cuatro ya lo están al 22-10):

- `04_catalogos.sql` — dashboard
- `09_caja_columnas_faltantes.sql` — apertura de caja
- `10_plan_de_cuentas.sql` — plan de cuentas y config contable
- `11_llegadas_tarde.sql` — horario de entrada

---

## Qué mandar si algo falla

- **Pantalla y qué apretaste**
- **El mensaje de error completo**, no solo el código. En el navegador: F12 → pestaña Red → clic en la petición roja → Respuesta
- Si es de inventario: qué producto y qué depósito
- Si es de contabilidad: si la compra se cargó antes o después de correr el script 10

> El dato más útil es el cuerpo del error. "Da 500" no alcanza para encontrar la causa; el mensaje de Postgres la nombra directamente.
