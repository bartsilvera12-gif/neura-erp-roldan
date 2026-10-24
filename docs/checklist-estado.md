# Checklist contractual — estado real

**Contra:** `a173f98` · 24-10-2026
Verificado contra el código y contra la base, no de memoria.

**Resumen: 6 de 10 módulos están completos. Faltan 4 cosas para el 10/10, y 3 de las 4 son del módulo 07.**

---

## Los 10 módulos

### ✅ 01 · Inventario
Artículos, categorías, unidades, costo, precio, depósitos, entradas, salidas, ajustes e historial.

Todo existe. Durante el QA se corrigió: la salida ya no puede superar el stock, el ajuste exige motivo, y el historial muestra siempre el mismo usuario.

### ✅ 02 · Sucursales
Depósitos por sucursal y transferencias con origen, destino, responsable y stock sin duplicaciones.

La transferencia entre depósitos se construyó durante el QA (no existía). Guarda origen, destino, cantidad, motivo y quién la hizo. La unicidad de sucursales y depósitos también se agregó: antes se podían crear dos "ÑEMBY" y `dep-01` convivía con `DEP-01`.

### ✅ 03 · Compras
Proveedores; compras con cantidades, costos y comprobantes; actualización de stock, deuda e historial.

Completo. El RUC duplicado de proveedor ahora se rechaza de verdad.

### ⚠️ 04 · Ventas
Clientes, venta con varios ítems, descuentos, forma de cobro, factura/comprobante y saldo.

Funciona todo **menos la factura electrónica**, que no está configurada. Hoy se emite comprobante A4, no factura con timbrado ante SIFEN.

→ **Hay que definir si el alcance incluye facturación electrónica.** Si incluye, falta configurar SIFEN; si no, conviene dejarlo por escrito.

### ⚠️ 05 · IVA
Crédito fiscal de compras, débito fiscal de ventas, resúmenes por tasa/período y proyección.

El Libro de Compras y el Libro de Ventas ya separan exento / 5% / 10% por período. **Falta la proyección**, que no existe en ninguna pantalla.

### ❌ 06 · Reposición
Rotación/consumo histórico, mínimos, alertas y sugerencia de reposición configurable.

**No existe.** Hay una pantalla llamada `/inventario/reposicion`, pero es otra cosa: solicitudes de transferencia entre sucursales (solicitar → aprobar → despachar → recibir). El módulo tampoco está habilitado.

Lo que pide el checklist —calcular consumo, comparar contra mínimos y sugerir cuánto comprar— hay que construirlo.

### ❌ 07 · Caja y cuentas
Cobros, pagos, cierres, CxC/CxP; cambio de medio real de cobro y arqueo mensual neto.

Las piezas sueltas existen (caja con turnos y arqueo diario, cuentas por cobrar, cuentas por pagar). **Faltan tres cosas, y son las tres contractuales:**

**a) Los cobros y pagos no impactan la caja.** Verificado: registrar un cobro a cliente o un pago a proveedor **no genera movimiento de caja**. Por eso al cerrar el turno no cuadra. Es la falla más grave de la lista: rompe el arqueo todos los días.

**b) CJ-01 · Cambiar el medio real de cobro.** No existe. El checklist lo pide con detalle: factura prevista en efectivo que se cobra por transferencia, reclasificar sin modificar ni anular la factura, sin doble ingreso, guardando usuario, fecha, motivo y comprobante. Y si la caja ya cerró, ajuste auditable con autorización.

**c) CJ-02 · Arqueo mensual neto.** No existe. Pide guardar cada diferencia diaria con signo y compensarlas en el mes, mostrando faltantes y sobrantes por separado más el neto, sin tocar el historial diario.

> El reporte de **Cierres de caja** que se agregó durante el QA ya muestra faltantes y sobrantes separados por turno. Es la mitad del CJ-02: falta la consolidación mensual.

### ✅ 08 · Recursos humanos
Personal, cargos, sucursales, asistencia/novedades y resumen de remuneraciones.

Completo. Durante el QA se agregaron las llegadas tarde (horario de entrada y tolerancia por empleado) y la edición de solicitudes de vacaciones.

### ⚠️ 09 · Contabilidad
Registros relacionados con compras, ventas, cobros y pagos; informes por período.

El plan de cuentas está cargado (46 cuentas) y la configuración contable completa. Los libros Diario y Mayor existen.

**Pero `asientos_contables` está vacío.** Los asientos se generan al registrar cada operación, y todo lo cargado hasta ahora es anterior al plan de cuentas. Falta:
1. Confirmar que una operación nueva genere el asiento.
2. Correr el backfill para las anteriores.

### ✅ 10 · CRM
Contactos/prospectos, oportunidades, etapas, responsables, seguimiento y vínculo con venta.

Completo. La cadena de trazabilidad existe: `crm_prospectos` → `clientes.prospecto_id` → `ventas.cliente_id`. La pantalla se rehízo con el diseño de referencia del cliente.

---

## Lo que falta para firmar el 10/10

| # | Qué | Módulo |
|---|---|---|
| 1 | Que cobros y pagos generen movimiento de caja | 07 |
| 2 | CJ-01 · Cambiar medio real de cobro | 07 |
| 3 | CJ-02 · Arqueo mensual neto | 07 |
| 4 | Reposición: consumo, mínimos, alertas y sugerencia | 06 |

Y dos que dependen de una definición, no de desarrollo:

| | Qué hay que definir |
|---|---|
| 04 | ¿El alcance incluye facturación electrónica ante SIFEN? |
| 05 | ¿Qué se entiende por "proyección" de IVA? |

Más uno operativo:

| | |
|---|---|
| 09 | Backfill de asientos para las operaciones ya cargadas |

---

## Pendientes del propio checklist (sección 5)

Estos los marca como "Cliente / PM", no como desarrollo:

- Definir cantidad de sucursales, depósitos, usuarios y permisos
- Acordar medios de pago, rendición de repartidores y autorizaciones de ajustes en caja
- Confirmar reglas de IVA, facturación habilitada y acceso a datos de prueba
- Definir reglas de RR. HH. y profundidad de informes contables
- Formalizar CJ-01 y CJ-02 como observaciones de aceptación del módulo 07

El último es el que más conviene cerrar primero: **CJ-01 y CJ-02 son dos de los cuatro faltantes**, y el checklist dice que deben quedar confirmados por escrito para formar parte del alcance.

---

## Datos que faltan para los comprobantes

No son del checklist pero salen impresos en documentos que recibe el cliente:

- **RUC de la empresa** — vacío. Mientras lo esté, esa línea no se imprime.
- Dirección, teléfono y email del membrete — vacíos.
