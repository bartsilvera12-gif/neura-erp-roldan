import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { EMPRESA_DOC, type EmpresaDoc } from "@/lib/documentos/membrete";

/**
 * Los datos del membrete para un documento emitido en una sucursal.
 *
 * Si la sucursal tiene dirección o teléfono cargados (script 91, en
 * Configuración → Sucursales), salen esos; si no, los de la casa central.
 * Pedido del cliente: los documentos de Carapeguá con la dirección de
 * Carapeguá. Si algo falla, sale el membrete de siempre: un documento no se
 * deja de imprimir por la dirección.
 */
export async function empresaDocDeSucursal(
  sb: AppSupabaseClient,
  sucursalId: string | null | undefined
): Promise<EmpresaDoc> {
  if (!sucursalId) return EMPRESA_DOC;
  try {
    const r = await sb.from("sucursales").select("direccion, telefono").eq("id", sucursalId).maybeSingle();
    if (r.error || !r.data) return EMPRESA_DOC;
    const d = r.data as { direccion?: string | null; telefono?: string | null };
    const dir = (d.direccion ?? "").trim();
    const tel = (d.telefono ?? "").trim();
    if (!dir && !tel) return EMPRESA_DOC;
    return {
      ...EMPRESA_DOC,
      direccion: dir ? [dir] : EMPRESA_DOC.direccion,
      telefono: tel || EMPRESA_DOC.telefono,
    };
  } catch {
    return EMPRESA_DOC;
  }
}

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Pone la dirección y el teléfono de la sucursal en un documento HTML ya
 * armado con el membrete de la casa central. Más simple y seguro que pasar
 * la sucursal por cada función que arma el HTML: el membrete es el mismo
 * texto en todos los documentos.
 */
export function conMembreteDeSucursal(html: string, emp: EmpresaDoc): string {
  if (emp === EMPRESA_DOC) return html;
  let out = html;
  const dirCentral = EMPRESA_DOC.direccion.map(escHtml).join(" · ");
  const dirSuc = emp.direccion.map(escHtml).join(" · ");
  if (dirCentral && dirSuc !== dirCentral) out = out.split(dirCentral).join(dirSuc);
  const telCentral = escHtml(EMPRESA_DOC.telefono);
  const telSuc = escHtml(emp.telefono);
  if (telCentral && telSuc !== telCentral) out = out.split(telCentral).join(telSuc);
  return out;
}

/** Atajo: el HTML con el membrete de la sucursal indicada. */
export async function htmlConSucursal(
  sb: AppSupabaseClient,
  sucursalId: string | null | undefined,
  html: string
): Promise<string> {
  return conMembreteDeSucursal(html, await empresaDocDeSucursal(sb, sucursalId));
}
