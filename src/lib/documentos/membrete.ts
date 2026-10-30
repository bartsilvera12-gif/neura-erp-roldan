/**
 * Membrete (encabezado) común para todos los documentos imprimibles del ERP.
 * Devuelve HTML con estilos inline para no depender del CSS de cada endpoint
 * (evita duplicar el markup del encabezado en cada documento).
 *
 * SOLO presentación: no toca datos de negocio. Los datos comerciales son fijos
 * de la empresa (Roldán e Hijos).
 */

export const EMPRESA_DOC = {
  nombre: "Aceros Metal Roldán e Hijos",
  propietario: "",
  ruc: "4538617-0",
  actividad: [] as string[],
  telefono: "+595 984 792 917 / +595 984 753 986",
  email: "joaquin@acerosmetalroldanehijos.com.py",
  direccion: ["Avda. Acceso Sur c/ Primero de Marzo"],
  /** Logo del cliente. Reemplazar los archivos en /public/brand/roldan-*.png. */
  logoUrl: "/brand/roldan-doc-logo.png",
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Membrete A4: logo a la izquierda, datos comerciales a la derecha, línea divisoria.
 * `origin` opcional para URL absoluta del logo (útil al imprimir/guardar PDF).
 */
export function membreteA4(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = origin ? `${origin}${e.logoUrl}` : e.logoUrl;
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #2E7D32;padding-bottom:12px;margin-bottom:16px;">
    <div style="flex:0 0 auto;">
      <img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:180px;max-height:92px;width:auto;height:auto;object-fit:contain;display:block;" />
    </div>
    <div style="flex:1;min-width:0;text-align:right;font-size:11px;color:#374151;line-height:1.55;">
      <div style="font-size:14px;font-weight:800;color:#1f2937;">${esc(e.nombre)}</div>
      <div style="font-size:11px;font-weight:600;color:#374151;">${esc(e.propietario)}</div>
      ${e.ruc ? `<div style="font-size:12px;font-weight:700;color:#1f2937;">RUC: ${esc(e.ruc)}</div>` : ""}
      ${e.actividad.map((a) => `<div style="color:#6b7280;">${esc(a)}</div>`).join("")}
      <div style="margin-top:4px;"><strong>Tel:</strong> ${esc(e.telefono)}</div>
      ${e.email ? `<div><strong>e-Mail:</strong> ${esc(e.email)}</div>` : ""}
      <div>${e.direccion.map(esc).join(" · ")}</div>
    </div>
  </div>`;
}

/**
 * Membrete de una línea para los documentos de control internos: planilla de
 * inventario, arqueo de caja, hoja de comisiones, informes y libros de IVA
 * (requisito 11.5, "formato institucional uniforme").
 *
 * ── POR QUÉ NO EL MEMBRETE GRANDE ─────────────────────────────────────────
 *   Esos documentos son grillas densas —la planilla de conteo, el libro de IVA
 *   apaisado con trece columnas— donde un bloque de logo de 92px de alto se
 *   come un renglón de datos por hoja. El logo chico en línea con el nombre y
 *   el RUC los deja reconocibles como documentos de la empresa sin pagar ese
 *   precio, y hace que todos se vean igual entre sí.
 *
 * `extra` se imprime a la derecha: sirve para el período o la fecha del corte.
 */
export function membreteLinea(extra = "", origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = origin ? `${origin}${e.logoUrl}` : e.logoUrl;
  return `
  <div style="display:flex;align-items:center;gap:8px;border-bottom:1.5px solid #333;padding-bottom:5px;margin-bottom:8px;">
    <img src="${esc(logo)}" alt="" style="height:26px;width:auto;object-fit:contain;display:block;" />
    <div style="flex:1;min-width:0;line-height:1.3;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.04em;color:#222;">${esc(e.nombre)}</div>
      ${e.ruc || e.telefono ? `<div style="font-size:9px;color:#555;">${
        [e.ruc ? `RUC ${esc(e.ruc)}` : "", e.telefono ? `Tel. ${esc(e.telefono)}` : ""].filter(Boolean).join(" · ")
      }</div>` : ""}
    </div>
    ${extra ? `<div style="font-size:9px;color:#555;text-align:right;white-space:nowrap;">${esc(extra)}</div>` : ""}
  </div>`;
}

/**
 * Membrete compacto para ticket angosto (58/80mm): logo arriba, datos centrados.
 */
export function membreteTicket(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = origin ? `${origin}${e.logoUrl}` : e.logoUrl;
  return `
  <div style="text-align:center;padding-bottom:6px;margin-bottom:6px;border-bottom:1px dashed #000;">
    <img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:150px;max-height:72px;width:auto;height:auto;object-fit:contain;display:inline-block;margin:0 auto 4px;" />
    <div style="font-weight:700;font-size:12px;">${esc(e.nombre)}</div>
    <div style="font-size:10px;">${esc(e.propietario)}</div>
    <div style="font-size:10px;">Tel: ${esc(e.telefono)}</div>
    ${e.email ? `<div style="font-size:10px;">${esc(e.email)}</div>` : ""}
    ${e.direccion[0] ? `<div style="font-size:10px;">${esc(e.direccion[0])}</div>` : ""}
    ${e.direccion.length > 1 ? `<div style="font-size:10px;">${esc(e.direccion.slice(1).join(" · "))}</div>` : ""}
  </div>`;
}
