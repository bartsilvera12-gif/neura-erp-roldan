/**
 * El correo con el que se le manda la orden de compra al vendedor.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Que se pueda mandar un email a cada uno de los vendedores de las órdenes
 *   de compra."
 *
 * ── POR QUÉ LA ORDEN VA EN EL CUERPO Y NO ADJUNTA ──────────────────────────
 *   El que recibe esto es el vendedor del proveedor, que lo va a abrir en el
 *   teléfono, en el depósito, para empezar a preparar el pedido. Un adjunto lo
 *   obliga a descargar algo antes de saber qué se le está pidiendo, y en
 *   muchos clientes de correo ese paso se pospone y se olvida.
 *
 *   Igual se le deja el link a la hoja imprimible, para cuando necesita el
 *   papel con membrete.
 *
 * ── TODO ESTO ES TEXTO, SIN BASE DE DATOS NI RED ───────────────────────────
 *   Armar el mensaje y mandarlo son dos cosas distintas y se prueban distinto:
 *   el contenido se puede verificar con casos a mano, el envío no.
 */

export interface ItemOrdenEmail {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
}

export interface OrdenParaEmail {
  numero_control: string;
  proveedor_nombre: string;
  /** El vendedor del proveedor, si está cargado. Se usa para el saludo. */
  contacto?: string | null;
  fecha: string;
  moneda: string;
  observaciones?: string | null;
  items: ItemOrdenEmail[];
}

export interface DatosEmisor {
  /** Nombre de la empresa que hace el pedido. */
  empresa: string;
  /** Quién lo manda, para firmar. */
  firmante?: string | null;
  /** Link a la hoja imprimible, si se puede dar uno. */
  linkImprimir?: string | null;
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

const miles = (v: number) => Math.round(v).toLocaleString("es-PY");

/** Símbolo de la moneda, para no escribir "PYG" en un correo a un proveedor. */
export function simbolo(moneda: string): string {
  return String(moneda).toUpperCase() === "USD" ? "US$" : "Gs.";
}

export function totalDeOrden(items: ItemOrdenEmail[]): number {
  return items.reduce((s, i) => s + n(i.cantidad) * n(i.precio_unitario), 0);
}

/** `true` si la orden lleva precios. Sin ellos, el correo no los menciona. */
export function tienePrecios(items: ItemOrdenEmail[]): boolean {
  return items.some((i) => n(i.precio_unitario) > 0);
}

export function asuntoDeOrden(orden: OrdenParaEmail, empresa: string): string {
  return `Orden de compra ${orden.numero_control} — ${empresa}`;
}

/**
 * El saludo.
 *
 * Con el nombre del vendedor cargado, se lo saluda a él. Sin él, se saluda a
 * la empresa — nunca "Estimado/a" a secas, que delata un correo automático.
 */
export function saludo(orden: OrdenParaEmail): string {
  const c = (orden.contacto ?? "").trim();
  if (c) return `Hola ${c},`;
  return `Buen día, ${orden.proveedor_nombre}:`;
}

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Versión en texto plano. Algunos clientes de correo solo muestran esta. */
export function cuerpoTexto(orden: OrdenParaEmail, emisor: DatosEmisor): string {
  const sim = simbolo(orden.moneda);
  const conPrecio = tienePrecios(orden.items);
  const lineas = orden.items.map((i) => {
    const base = `- ${i.descripcion}: ${miles(n(i.cantidad))} ${i.unidad}`;
    return conPrecio && n(i.precio_unitario) > 0
      ? `${base} — ${sim} ${miles(n(i.precio_unitario))} c/u`
      : base;
  });

  const partes = [
    saludo(orden),
    "",
    `Les pasamos la orden de compra ${orden.numero_control}, del ${fechaLegible(orden.fecha)}:`,
    "",
    ...lineas,
  ];

  if (conPrecio) {
    partes.push("", `Total estimado: ${sim} ${miles(totalDeOrden(orden.items))}`);
  }
  if ((orden.observaciones ?? "").trim()) {
    partes.push("", orden.observaciones!.trim());
  }
  if (emisor.linkImprimir) {
    partes.push("", `Hoja imprimible: ${emisor.linkImprimir}`);
  }
  partes.push(
    "",
    "Quedamos a la espera de la confirmación y el plazo de entrega.",
    "",
    emisor.firmante ? `${emisor.firmante}` : "",
    emisor.empresa
  );

  return partes.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}

/** Versión HTML, que es la que se ve en la mayoría de los clientes. */
export function cuerpoHtml(orden: OrdenParaEmail, emisor: DatosEmisor): string {
  const sim = simbolo(orden.moneda);
  const conPrecio = tienePrecios(orden.items);

  const filas = orden.items.map((i) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${esc(i.descripcion)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${miles(n(i.cantidad))} ${esc(i.unidad)}</td>
        ${conPrecio ? `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${n(i.precio_unitario) > 0 ? `${sim} ${miles(n(i.precio_unitario))}` : "—"}</td>` : ""}
      </tr>`).join("");

  const total = conPrecio
    ? `<tr>
        <td style="padding:8px 10px;font-weight:600">Total estimado</td>
        <td style="padding:8px 10px"></td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;white-space:nowrap">${sim} ${miles(totalDeOrden(orden.items))}</td>
      </tr>`
    : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
  <p>${esc(saludo(orden))}</p>
  <p>Les pasamos la orden de compra <strong>${esc(orden.numero_control)}</strong>, del ${esc(fechaLegible(orden.fecha))}:</p>
  <table style="border-collapse:collapse;width:100%;max-width:560px;margin:12px 0">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="padding:6px 10px;text-align:left">Artículo</th>
        <th style="padding:6px 10px;text-align:right">Cantidad</th>
        ${conPrecio ? '<th style="padding:6px 10px;text-align:right">Precio</th>' : ""}
      </tr>
    </thead>
    <tbody>${filas}${total}</tbody>
  </table>
  ${(orden.observaciones ?? "").trim() ? `<p style="color:#475569">${esc(orden.observaciones)}</p>` : ""}
  ${emisor.linkImprimir ? `<p><a href="${esc(emisor.linkImprimir)}">Ver la hoja imprimible</a></p>` : ""}
  <p>Quedamos a la espera de la confirmación y el plazo de entrega.</p>
  <p style="margin-top:18px;color:#475569">
    ${emisor.firmante ? `${esc(emisor.firmante)}<br/>` : ""}${esc(emisor.empresa)}
  </p>
</div>`;
}

/**
 * Link `mailto:` con todo escrito, para cuando no hay servidor de correo
 * configurado.
 *
 * No es un consuelo: abre el correo de la persona con el destinatario, el
 * asunto y el cuerpo ya puestos, y ella aprieta enviar. Sale desde su propia
 * casilla, así que la respuesta del proveedor le llega a ella — que es lo que
 * quiere el que hace el pedido.
 */
export function mailtoDeOrden(
  orden: OrdenParaEmail,
  emisor: DatosEmisor,
  email: string
): string {
  const asunto = encodeURIComponent(asuntoDeOrden(orden, emisor.empresa));
  const cuerpo = encodeURIComponent(cuerpoTexto(orden, emisor));
  return `mailto:${encodeURIComponent(email)}?subject=${asunto}&body=${cuerpo}`;
}

/** 2026-11-04 → 04/11/2026. Un proveedor no lee fechas ISO. */
export function fechaLegible(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

/** Validación mínima: que haya una arroba con algo de cada lado y un punto. */
export function emailValido(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
