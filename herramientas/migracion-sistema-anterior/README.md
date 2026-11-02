# Migración del sistema anterior

Trae los datos reales de **`sysges_acero_metal`** (MariaDB, el sistema que usaba
el cliente hasta octubre de 2026) al ERP nuevo.

El dump de origen es un `.sql` de 275 MB con 126 tablas. **No está en el repo**:
se pasa por fuera y se apunta la constante `F` de `migrar.py` al archivo.

## Cómo se corre

```bash
export SB_URL=...        # URL de Supabase
export SB_KEY=...        # service key
python3 migrar.py catalogos    # rubros, profesiones, categorías de cliente, proveedores
python3 migrar.py articulos    # 996 productos con precio, costo, precio en dólares y stock
python3 migrar.py clientes     # 21.344 clientes
python3 migrar.py ventas       # 85.665 ventas + 187.785 líneas (~8 minutos)
python3 migrar.py compras      # 17.017 filas de compra
python3 migrar.py anticipos    # 948 anticipos
python3 verificar.py           # contrasta las dos bases
```

Se puede volver a correr cualquier fase: cada fila lleva un **UUID derivado del
código viejo** (`uuid5`), así que el artículo 1000 siempre tiene el mismo id y
una segunda corrida choca contra su propia clave primaria en vez de duplicar.
Eso es lo que permite reintentar una tanda cortada sin limpiar nada a mano.

## Decisiones que hay que conocer para leer los datos

| Qué | Cómo quedó | Por qué |
|---|---|---|
| Numeración | `HIS-000001`… | Si usara `VTA-`, el correlativo de las ventas nuevas arrancaría en 85.668 |
| Nº de factura viejo | en `observaciones` | El modelo nuevo guarda el número fiscal en `facturas`, y estas ventas no tienen factura electrónica |
| IVA | el balde de **cada línea**, no el impuesto del artículo | 187 líneas se facturaron exentas con artículos gravados: vale lo que se facturó |
| Precios | con IVA incluido | Verificado: `gravada2` = cantidad × precio, exacto |
| Total de la venta | el del sistema viejo (`venmonto`) | Es el que está en sus reportes y en el banco. En 4 de cada 10 ventas la suma de las líneas difiere 2–24 Gs. por redondeo del sistema viejo; cuando pasa, queda escrito en la observación |
| Pago mixto | medio dominante + desglose en `ventas_pagos_detalle` | El CHECK de `ventas.metodo_pago` no aceptaba `'mixto'` — ver el script 52, que arregla ese bug para las ventas nuevas |
| Anticipos | `utilizado` salvo los anulados | Son de 2019–2024; darlos por disponibles sería ofrecerle al cajero plata que el cliente ya retiró |
| Compras sin proveedor | proveedor "SIN PROVEEDOR IDENTIFICADO" | `compras.proveedor_id` es obligatoria y el sistema viejo tenía compras con proveedor `-` |
| Remarcación del rubro | en la descripción del rubro | `categorias_productos` no tiene campo de markup; el dato no se pierde |

## Lo que NO se migró, a propósito

- `auditoria` (1.008.992 filas) y `articulo_historial` (366.629): historia de
  cambios del sistema viejo. No tiene a dónde ir en el modelo nuevo.
- `inv_alafecha_detalle` (893.371): fotos del inventario a una fecha. El ERP
  nuevo las calcula solo desde los movimientos.
- `venta_pendiente` / `venta_detalle_pendiente` (96.823 / 246.165): pedidos sin
  cerrar del sistema viejo. Se puede hacer si el cliente los necesita.
- `apertura` y `aper_*`: los turnos de caja de siete años. Se puede hacer, pero
  mapear denominaciones, rendiciones y diferencias merece su propia vuelta.
- Dos ventas de Gs. 0 sin líneas (una es la fila basura `vencodigo=0`, la otra
  está anulada y comentada "factura en cero").

## Resultado de la verificación

Contrastado con `verificar.py` contra el dump:

```
FACTURACIÓN POR AÑO (ventas no anuladas)      diferencia
  2019 .. 2026                                        0
  TOTAL  Gs. 44.542.516.367                           0

STOCK: 996 SKUs comparados uno por uno        0 diferencias
CLIENTES: 21.344                              completo
ANTICIPOS: 948                                completo
VENTAS: 82.625 activas / 3.040 anuladas       faltan las 2 de Gs. 0 sin líneas
```
