/**
 * Datos de la empresa para el encabezado de los informes exportados.
 *
 * ── POR QUÉ SE LEEN DE LA BASE Y NO DEL ARCHIVO DE MEMBRETE ───────────────
 *   `src/lib/documentos/membrete.ts` tiene el nombre, el RUC y el teléfono
 *   escritos en el código, y hoy el RUC y el teléfono están vacíos porque
 *   nadie los pasó todavía. La tabla `empresas` ya tiene esas tres columnas
 *   (`nombre_empresa`, `ruc`, `telefono`): leyéndolas de ahí, el día que
 *   alguien las cargue desde la pantalla de configuración aparecen solas en
 *   todos los informes, sin tocar el código ni volver a desplegar.
 *
 *   Si la consulta falla o la fila no está, se cae al nombre del membrete:
 *   un informe sin encabezado es peor que uno con el encabezado incompleto.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

export interface DatosEmpresaInforme {
  empresa: string;
  ruc: string | null;
}

/**
 * Se guarda en memoria del proceso por unos minutos: el encabezado se pide
 * una vez por informe y el paquete mensual arma una docena de golpe. Son
 * datos que cambian una vez por año, no hace falta ir a la base trece veces.
 */
let cache: { at: number; datos: DatosEmpresaInforme } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function datosEmpresaInforme(empresaId: string): Promise<DatosEmpresaInforme> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.datos;
  const fallback: DatosEmpresaInforme = { empresa: EMPRESA_DOC.nombre, ruc: EMPRESA_DOC.ruc || null };
  try {
    const sb = createServiceRoleClient();
    const { data } = await sb
      .from("empresas")
      .select("nombre_empresa, ruc")
      .eq("id", empresaId)
      .maybeSingle();
    const datos: DatosEmpresaInforme = {
      empresa: (data?.nombre_empresa as string | null)?.trim() || fallback.empresa,
      ruc: ((data?.ruc as string | null) ?? "").trim() || fallback.ruc,
    };
    cache = { at: Date.now(), datos };
    return datos;
  } catch {
    return fallback;
  }
}

/** Nombre de una sucursal, para el encabezado. null si no se pudo resolver. */
export async function nombreSucursal(sucursalId: string | null): Promise<string | null> {
  if (!sucursalId) return null;
  try {
    const sb = createServiceRoleClient();
    const { data } = await sb.from("sucursales").select("nombre").eq("id", sucursalId).maybeSingle();
    return ((data?.nombre as string | null) ?? "").trim() || null;
  } catch {
    return null;
  }
}
