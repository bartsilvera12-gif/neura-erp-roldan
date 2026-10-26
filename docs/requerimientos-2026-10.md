# Requerimientos y mejoras del ERP — seguimiento

Fuente: `Requerimientos_Mejoras_ERP.pdf`, 26 de octubre de 2026. 46 puntos en 11 módulos.

Estados: ⬜ pendiente · 🟨 parcial · ✅ hecho

---

## 1. Inventario  ·  **completo**

| # | Requerimiento | Estado |
|---|---|---|
| 1.1 | Planilla de inventario: elegir rubros, imprimir con fecha, hora, código, cód. ref., artículo y **dos** columnas de control. General o por rubro. | ✅ |
| 1.2 | Stock mínimo automático: mediana de los últimos 6 meses de ventas, mostrado en Reposición y actualizado solo. | ✅ |
| 1.3 | Stock crítico configurable: cobertura en días **por rubro** (ej. 5 o 15 días). | ✅ |
| 1.4 | Historial de ajustes: listado aparte (no todos los movimientos) con código único, fecha, hora, usuario, producto, cantidad sumada/restada y motivo. Filtro por fecha. | ⬜ |
| 1.5 | Compras en dólares y costo ponderado: precio en USD, tipo de cambio vigente al cargar la factura, conservado histórico. Costo promedio ponderado por operaciones. | ✅ |
| 1.6 | Valoración de existencias: inventario y valor del stock a una fecha, por año, rubro o general; cantidades, costos unitarios, valor total, fecha y hora. | ✅ |
| 1.7 | Márgenes y remarcación visibles en Inventario y en Caja, según permisos. | ✅ |

## 2. Ventas  ·  **completo**

| # | Requerimiento | Estado |
|---|---|---|
| 2.1 | Buscar ventas por número de factura, cliente y fecha; ver historial y detalle. | ✅ |
| 2.2 | Edición controlada: solo administradores, registrando quién, cuándo y qué cambió. | ✅ |
| 2.3 | Descuentos por usuario: máximo configurable por usuario o vendedor. | ✅ |

## 3. Clientes  ·  **completo**

| # | Requerimiento | Estado |
|---|---|---|
| 3.1 | Rubros de cliente: ocasional, mayorista, minorista, frecuente, distribuidor + filtro. | ✅ |
| 3.2 | Alta desde Caja: ciudad, profesión, dirección, correo y límite de crédito. | ✅ |
| 3.3 | Historial comercial: compras históricas del cliente, filtrables desde Caja. | ✅ |

## 4. Vendedores y comisiones  ·  **completo**

| # | Requerimiento | Estado |
|---|---|---|
| 4.1 | Cartera por vendedor: vendedor responsable por cliente, 30 días, liberación automática. | ✅ |
| 4.2 | Hoja de ventas firmada: imprimible con todas las ventas del vendedor y espacio para firma. | ✅ |
| 4.3 | Sustitución temporal: otro vendedor atiende la cartera; la comisión es de quien cierra, el cliente queda en la cartera original. | ✅ |
| 4.4 | Comisión según rentabilidad: proporcional a la remarcación o margen; el descuento ajusta la comisión. | ✅ |
| 4.5 | Configuración por rubro y tipo de vendedor: porcentajes y descuentos, y alta de nuevos tipos. | ✅ |
| 4.6 | Informe de comisiones con filtros por vendedor, rubro y fechas. | ✅ |

## 5. Caja y arqueo

| # | Requerimiento | Estado |
|---|---|---|
| 5.1 | Cajas de días anteriores: consultar o reabrir, con controles y registro. | ✅ |
| 5.2 | Detalle de cierre: operaciones y motivos de anulaciones (referencia: Ferretodo). | ✅ |
| 5.3 | Resumen obligatorio: egresos, anticipos, ventas contado y crédito, dinero a rendir, retiros y diferencias. | ✅ |
| 5.4 | Arqueo por denominación: contar billetes y monedas (referencia: República); impresión A4 con ingresos, egresos y resumen. | ✅ |
| 5.5 | Diferencias de caja: sobrantes y faltantes, arqueo anterior, arrastre de la diferencia negativa al día siguiente. | ✅ |
| 5.6 | Anticipos: listado de anticipos no facturados con número único, cliente, fecha, monto, acumulado y estado; anulación con motivo y filtros. | ✅ |
| 5.7 | Egresos: tipo de egreso, opción Otros con motivo libre, notas y adjuntos de factura y recibo. | ✅ |

## 6. Compras y proveedores

| # | Requerimiento | Estado |
|---|---|---|
| 6.1 | Ingreso de precios: tipear el precio de compra y expresarlo en dólares con su tipo de cambio. | ✅ cubierto por 1.5 |
| 6.2 | Condiciones de pago por proveedor, en días. | ✅ |

## 7. Tipos de cambio

| # | Requerimiento | Estado |
|---|---|---|
| 7.1 | Indicadores editables: comprador y vendedor en el Dashboard, editables por usuarios autorizados. | ✅ |
| 7.2 | Historial por fecha y hora, con usuario responsable y filtros. No sobrescribir cotizaciones ya usadas. | ✅ |

## 8. Movimientos y sucursales

| # | Requerimiento | Estado |
|---|---|---|
| 8.1 | Transferencias entre sucursales con número único de remisión no repetible y filtros. | ✅ |
| 8.2 | Filtros: agregar filtro por usuario en Movimientos, sacar el de tipo, conservar el de fecha. | ✅ |

## 9. Presupuestos

| # | Requerimiento | Estado |
|---|---|---|
| 9.1 | Cotizar sin restricción de stock: avisar faltante sin bloquear el guardado. | ✅ |
| 9.2 | Existencias y reservas: stock físico, reservado y disponible. | ✅ |
| 9.3 | Vigencia: fecha de validez o vencimiento. | ✅ |
| 9.4 | Presentación: azul, observaciones y condiciones comerciales editables, diseño formal. | ✅ |

## 10. Informes y análisis

| # | Requerimiento | Estado |
|---|---|---|
| 10.1 | Utilidad por período: mensual y por rango, desglosado por rubro y grupo; ventas, utilidad bruta y % de margen. Diferenciar ganancia monetaria del % de margen. | ✅ |
| 10.2 | Cobranzas: cliente, cobro, fecha, importe y comprobante; filtros por cliente y fecha. | ✅ |
| 10.3 | Cuentas por cobrar: clientes con códigos y saldos, filtros amplios, cancelación o disminución de deuda por recibos, conservando historial. | ✅ |
| 10.4 | IVA Compras e IVA Ventas: totales con IVA y, en la última página, resumen de base/importe total e IVA total. | ✅ |
| 10.5 | Estudio de precios: modificar precios, margen, remarcación y comisiones por rubro, masivo y por fila; mostrar costo de compra, cantidad de artículos y filtros. | ✅ |

## 11. Requisitos generales

| # | Requerimiento | Estado |
|---|---|---|
| 11.1 | Impresión y Excel en todos los reportes, listados y documentos aplicables. | ✅ |
| 11.2 | Filtros desde/hasta en todos los módulos e informes, más filtros por cliente, vendedor, rubro u otros datos. | ✅ |
| 11.3 | Trazabilidad: usuario, fecha, hora y detalle en cambios, anulaciones, ajustes, transferencias y demás operaciones relevantes. | ✅ |
| 11.4 | Permisos: restringir tareas sensibles a los roles habilitados y controlar accesos administrativos. | 🟨 |
| 11.5 | Formato institucional uniforme en todos los archivos generados. | 🟨 falta cargar RUC, teléfono y dirección de la empresa |
