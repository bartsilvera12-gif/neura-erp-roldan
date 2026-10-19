# Neura ERP · Roldán e Hijos

Instancia dedicada monocliente para **Roldán e Hijos**.

Copia independiente de `neura-erp-mexicana` (mismo código base, otro tenant: otro schema, otra empresa, otro deploy). No comparte historia git, ni schema, ni datos con el repo de origen.

- **Schema Postgres**: `roldanerp` (fijo — se puede overridear con `NEURA_CLIENT_SCHEMA`).
- **URL**: `http://roldanehijos.neura.com.py` (HTTP a propósito: el TLS lo termina Cloudflare).
- **Deploy**: Coolify + Dockerfile. `vercel.json` residual, no se usa.
- **Regla**: 1 repo = 1 deploy = 1 empresa. La creación de empresas queda deshabilitada (`/api/admin/crear-empresa` responde 410).
- **Usuario admin**: `admin@roldanehijos.com`.

## Variables de entorno (Coolify)

Ver `.env.example`. Las mínimas para arrancar:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
SUPABASE_DB_URL=
NEURA_CLIENT_SCHEMA=roldanerp
NEURA_CLIENT_NAME=Roldán e Hijos
NEURA_INSTANCE_MODE=single_client
SIFEN_SECRETS_KEY=
```

`NEURA_INSTANCE_MODE=single_client` activa la **allowlist estricta de módulos**: lo que ve el ERP es
exactamente lo que está en `roldanerp.empresa_modulos` con `activo = true`, sin aliases legacy.

## Módulos habilitados

Esta instancia arranca con estos doce módulos y nada más (ver `supabase/roldanerp/02_seed_empresa_modulos_admin.sql`):

| Módulo | Slug | Ruta |
|---|---|---|
| Dashboard | `dashboard` | `/` |
| Caja (ventas) | `ventas` | `/ventas` (turnos de caja, arqueo y movimientos) |
| Inventario | `inventario` | `/inventario` (productos, movimientos, categorías, ubicaciones, depósitos) |
| Clientes | `clientes` | `/clientes` |
| Sucursales | `sucursales` | `/configuracion/sucursales` |
| Compras | `compras` | `/compras` |
| Proveedores | `proveedores` | `/proveedores` |
| Pagos | `pagos` | `/pagos` |
| Recursos Humanos | `rrhh` | `/rrhh/empleados` |
| Contabilidad | `contabilidad` | `/reportes/libro-diario` |
| CRM | `crm` | `/crm` |
| Conversaciones | `conversaciones` | `/dashboard/conversaciones` |

El resto del código del ERP sigue en el repo pero **no es accesible**: el sidebar oculta el ítem y el
gate de rutas devuelve "sin acceso". Para habilitar un módulo más alcanza con insertar su fila en
`roldanerp.empresa_modulos` (no hace falta tocar código ni redeployar):

```sql
INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT '<empresa_id>', m.id, true FROM roldanerp.modulos m WHERE m.slug = 'usuarios'
ON CONFLICT (empresa_id, modulo_id) DO UPDATE SET activo = true;
```

## Base de datos

El schema `roldanerp` se crea como **clon estructural del schema `mexicana` sin datos**.
Los scripts están en `supabase/roldanerp/` y se pegan en el SQL editor de Supabase en orden:

1. `01_clone_schema_mexicana_to_roldanerp.sql` — crea el schema y clona tipos, secuencias, tablas,
   índices, constraints, FKs, vistas, funciones, triggers, políticas RLS, grants y comments. **Sin filas.**
2. `02_seed_empresa_modulos_admin.sql` — empresa Roldán e Hijos (UUID propio), catálogo de módulos,
   `empresa_modulos` acotado a los 12 módulos de arriba y usuario `admin@roldanehijos.com`.
3. `03_verificacion.sql` — chequeos de aislamiento (nada en `public`, nada de otros tenants, 0 filas).
4. `04_catalogos.sql` — catálogos que el clon deja vacíos y el ERP necesita con filas
   desde el arranque: vistas del tablero (`dashboard_views`) y etapas del CRM (`crm_etapas`).
   Sin esto el Dashboard muestra "Sin vistas asignadas" aunque el usuario sea admin.
5. `05_modulo_caja.sql` — tablas del módulo Caja (`cajas`, `caja_movimientos`) y la columna
   `ventas.caja_id`. El schema de origen no tiene sistema de caja; sin este script la pantalla
   de Caja no abre turno y las ventas se bloquean.
6. `06_habilitar_modulo.sql` — habilita un módulo que no vino en el set inicial. Tal como está
   habilita **Planes** (lo pide el CRM para cargar servicios de interés en un lead); para otro,
   se cambia `v_slug`. No hace falta tocar código ni redeployar.
7. `07_flujo_caja_cheques.sql` — módulo de flujo de caja de proveedores: `cheques`,
   `cheque_compras`, `flujo_caja_config` y `proveedores.agrupa_en_varios`.
8. `08_flujo_caja_saldos.sql` — posición de liquidez del flujo: saldos por banco y moneda,
   efectivo en caja y valor de mercadería (`flujo_caja_saldos`).

Después hay que exponer el schema en Supabase: **Settings → API → Exposed schemas** incluir `roldanerp`.

## Flujo de caja de proveedores

Reemplaza la planilla que se llevaba a mano (`/pagos/flujo-caja`). Una fila por proveedor,
una columna por día del mes.

- Una factura de compra **a crédito** cae sola en `fecha_factura + plazo_dias`.
- Un **cheque** es de un solo proveedor y puede cubrir varias de sus facturas.
- Estados y colores: `pendiente_emision` (lila) → `emitido` (verde) → `cobrado` (amarillo).
  Un cheque cobrado ya salió del banco y **deja de sumar** al flujo.
- Los proveedores chicos o locales se marcan con `proveedores.agrupa_en_varios` y no llevan
  fila propia: se suman en **VARIOS**, en guaraníes.
- El **tipo de cambio** lo fija la empresa por mes (suelen usar uno por encima del real como
  colchón), junto con los **fondos disponibles** con los que arranca el mes.
- Lo que antes iba en los comentarios de Excel —nº de factura, nº de carga, nº de cheque y
  fecha de cobro— sale de los datos y se arma solo en el tooltip de cada celda.

### Posición de liquidez

Arriba de la grilla, informativa: **bancos** (una fila por cuenta, cada una con su moneda),
**efectivo en caja** y **valor de mercadería**. Se cargan a mano — el ERP no tiene
conciliación bancaria — y no alimentan la proyección de pagos, que sale sola de las compras.

Lo único que sí sale de ahí son los **fondos con los que arranca el mes**: la suma de
bancos + efectivo, convertida al tipo de cambio del mes. La **mercadería queda afuera**
porque no es plata disponible. Si no se carga ninguna cuenta, vale el monto manual de
`flujo_caja_config.fondos_disponibles`.

Diferencia con la planilla: ahí el acumulado se llevaba en negativo. Acá se muestra como
**Disponible**, positivo mientras quede plata y en rojo si los pagos superan los fondos.

## Módulo Caja

La venta se imputa a un **turno de caja** (`ventas.caja_id`), no a la fecha calendario: el cierre
agrupa por turno. Reglas, heredadas de `neura-erp-hierros`:

- Sin turno abierto **no se puede registrar una venta**. Se abre desde `/ventas`.
- Se admiten varias cajas abiertas en paralelo (Caja 1, Caja 2, …). Si hay más de una, el cajero
  elige en `/ventas/nueva`; la elección se recuerda por navegador.
- El arqueo de cierre compara lo contado contra lo esperado. **El cheque no entra al cajón**: va a
  su propio total y no suma al efectivo esperado.
- Para dejar de bloquear la venta cuando no hay caja abierta, el guard está en
  `src/lib/ventas/server/create-venta-pg.ts` (resolución de `cajaIdActual`).

## Pendientes conocidos antes de ir a producción

1. **Datos de empresa en el membrete** (`src/lib/documentos/membrete.ts`): completar `nombre`,
   `propietario`, `ruc`, `actividad`, `telefono`, `email` y `direccion` con la constancia de la empresa.
2. **Logos de la marca**: reemplazar `public/brand/roldan-logo.png`, `roldan-doc-logo.png`,
   `roldan-favicon.png`. Hoy son el logo genérico de Zentra, puesto como placeholder: los
   archivos que venían del repo de origen eran el logo registrado de Tortillería La Mexicana
   y no podían quedar en esta instancia. `roldan-doc-logo.png` es el que sale impreso en
   presupuestos, comprobantes y el membrete de los documentos.
3. **SIFEN**: cargar en DB (`empresa_sifen_config`) el timbrado, RUC, certificado + password,
   actividad económica y fecha de inicio de vigencia.
4. **Auth**: crear el usuario `admin@roldanehijos.com` en Supabase → Authentication → Users y correr el
   bloque de enlace de `02_seed_empresa_modulos_admin.sql` para completar `usuarios.auth_user_id`.

## Cómo verificar que el schema quedó bien aislado

```sql
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT IN ('public','information_schema','pg_catalog','pg_toast');
-- debe listar 'roldanerp' además de los schemas que ya existían; ninguno de ellos modificado.
```
