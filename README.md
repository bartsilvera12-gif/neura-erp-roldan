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
| Caja (ventas) | `ventas` | `/ventas` |
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

Después hay que exponer el schema en Supabase: **Settings → API → Exposed schemas** incluir `roldanerp`.

## Pendientes conocidos antes de ir a producción

1. **Datos de empresa en el membrete** (`src/lib/documentos/membrete.ts`): completar `nombre`,
   `propietario`, `ruc`, `actividad`, `telefono`, `email` y `direccion` con la constancia de la empresa.
2. **Logos de la marca**: reemplazar `public/brand/roldan-logo.png`, `roldan-doc-logo.png`,
   `roldan-favicon.png` (hoy son copias del logo genérico de Zentra heredadas del repo de origen).
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
