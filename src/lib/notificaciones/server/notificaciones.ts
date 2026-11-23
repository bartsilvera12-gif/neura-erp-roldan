import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { canalesQrCaidos, textoEstadoQr } from "@/lib/chat/baileys-health";

/**
 * Las notificaciones de la campana, según el puesto (pedido del cliente).
 *
 *   Cajero         presupuestos para cobrar · cuentas que vencen en 2 días ·
 *                  clientes cerca del límite de crédito
 *   Vendedor       presupuestos que le cambiaron en la caja · clientes suyos
 *                  cerca del límite
 *   Administrativo clientes cerca del límite · falta de stock (va a
 *                  Reposición) · sobrepedido (material de presupuestos sin
 *                  stock) · pedidos de descuento
 *   Administrador  todo, y puede marcar como leído
 *
 * Administrador y administrativo además reciben el aviso de WhatsApp por QR
 * desvinculado: el número deja de recibir y contestar chats, y antes eso solo
 * se notaba entrando a la pantalla de conexión del canal.
 *
 * Solo el administrador recibe las órdenes de compra marcadas «Recibido» que
 * esperan su «Aceptar»: la recepción la confirman dos personas (script 100).
 *
 * «Cerca del límite» = le quedan 5.000.000 o menos de crédito disponible.
 *
 * Cada aviso tiene una CLAVE estable. Cuando la persona entra a verlo, la
 * clave queda leída (script 96) y el aviso deja de salir. Los que dependen de
 * una situación (el stock, el límite) llevan el estado en la clave: si la
 * situación cambia, el aviso vuelve.
 */

export type Puesto = "admin" | "cajero" | "vendedor" | "administrativo";

export interface Notificacion {
  clave: string;
  tipo: "cobrar" | "vence" | "limite" | "cambio" | "stock" | "sobrepedido" | "descuento" | "whatsapp" | "recepcion";
  titulo: string;
  detalle: string | null;
  href: string | null;
  fecha: string | null;
}

export const LIMITE_CERCA = 5_000_000;

const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
const n = (v: unknown) => Number(v) || 0;

/** Qué puesto tiene la persona, por el nombre de su perfil. */
export async function puestoDe(
  sb: AppSupabaseClient,
  auth: { empresa_id: string; usuarioCatalogId?: string | null },
  esAdmin: boolean
): Promise<Puesto> {
  if (esAdmin) return "admin";
  const id = auth.usuarioCatalogId;
  if (!id) return "vendedor";
  try {
    const u = await sb.from("usuarios").select("perfil_id").eq("empresa_id", auth.empresa_id).eq("id", id).maybeSingle();
    const pid = (u.data as { perfil_id?: string | null } | null)?.perfil_id;
    if (!pid) return "vendedor";
    const p = await sb.from("perfiles_usuario").select("nombre").eq("id", pid).maybeSingle();
    const nombre = String((p.data as { nombre?: string } | null)?.nombre ?? "").toLowerCase();
    if (/cajer/.test(nombre)) return "cajero";
    if (/administrativ/.test(nombre)) return "administrativo";
    if (/administrador/.test(nombre)) return "admin";
    return "vendedor";
  } catch {
    return "vendedor";
  }
}

function hoyPy(offsetDias = 0): string {
  const d = new Date(Date.now() - 3 * 3600_000 + offsetDias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function notificacionesDe(
  sb: AppSupabaseClient,
  ctx: {
    empresaId: string;
    sucursalId: string | null;
    puesto: Puesto;
    /** Los ids de la persona (de la ficha y de la sesión). */
    mios: string[];
  }
): Promise<Notificacion[]> {
  const { empresaId, puesto, mios } = ctx;
  const todo = puesto === "admin";
  const out: Notificacion[] = [];
  const tareas: Promise<void>[] = [];

  // ── Cajero: presupuestos para cobrar ─────────────────────────────────────
  if (todo || puesto === "cajero") {
    tareas.push((async () => {
      const q = await sb.from("presupuestos")
        .select("id, numero_control, cliente_nombre, total, enviado_a_caja_at")
        .eq("empresa_id", empresaId).eq("estado", "aprobado")
        .not("enviado_a_caja_at", "is", null).is("convertido_venta_id", null)
        .order("enviado_a_caja_at", { ascending: false }).limit(50);
      if (q.error) return;
      for (const p of (q.data ?? []) as Array<Record<string, unknown>>) {
        out.push({
          clave: `cobrar:${p.id}`,
          tipo: "cobrar",
          titulo: `Presupuesto ${p.numero_control ?? ""} para cobrar`,
          detalle: `${p.cliente_nombre ?? "Cliente"} · ${gs(n(p.total))}`,
          href: `/ventas/nueva?presupuesto_id=${p.id}`,
          fecha: (p.enviado_a_caja_at as string) ?? null,
        });
      }
    })());

    // Cuentas que vencen en los próximos 2 días (estado de cuenta).
    tareas.push((async () => {
      const q = await sb.from("cuentas_por_cobrar")
        .select("id, cliente_id, numero_venta, fecha_vencimiento, saldo, estado")
        .eq("empresa_id", empresaId).in("estado", ["pendiente", "parcial"])
        .gte("fecha_vencimiento", hoyPy()).lte("fecha_vencimiento", hoyPy(2))
        .limit(100);
      if (q.error) return;
      const filas = (q.data ?? []) as Array<Record<string, unknown>>;
      const nombres = await nombresClientes(sb, empresaId, filas.map((f) => String(f.cliente_id ?? "")));
      for (const c of filas) {
        const fv = String(c.fecha_vencimiento ?? "");
        out.push({
          clave: `vence:${c.id}`,
          tipo: "vence",
          titulo: `Vence el ${fv.split("-").reverse().join("/")}: ${nombres.get(String(c.cliente_id)) ?? "cliente"}`,
          detalle: `Venta ${c.numero_venta ?? ""} · saldo ${gs(n(c.saldo))}`,
          href: c.cliente_id ? `/clientes/${c.cliente_id}?tab=estado-cuenta` : null,
          fecha: fv || null,
        });
      }
    })());
  }

  // ── Todos: clientes cerca del límite de crédito ──────────────────────────
  tareas.push((async () => {
    const cq = await sb.from("clientes")
      .select("id, nombre_facturacion, empresa, nombre_contacto, nombre, limite_credito, vendedor_usuario_id")
      .eq("empresa_id", empresaId).gt("limite_credito", 0).is("deleted_at", null).limit(2000);
    if (cq.error) return;
    let clientes = (cq.data ?? []) as Array<Record<string, unknown>>;
    if (puesto === "vendedor") {
      // El vendedor, solo los suyos: los asignados en la ficha o en su cartera.
      const cartera = new Set<string>();
      if (mios.length > 0) {
        const kq = await sb.from("cliente_cartera").select("cliente_id").eq("empresa_id", empresaId).in("vendedor_usuario_id", mios);
        for (const r of (kq.data ?? []) as Array<{ cliente_id: string }>) cartera.add(String(r.cliente_id));
      }
      clientes = clientes.filter((c) => cartera.has(String(c.id)) || mios.includes(String(c.vendedor_usuario_id ?? "")));
    }
    if (clientes.length === 0) return;
    const deuda = new Map<string, number>();
    const ids = clientes.map((c) => String(c.id));
    for (let i = 0; i < ids.length; i += 100) {
      const dq = await sb.from("cuentas_por_cobrar").select("cliente_id, saldo")
        .eq("empresa_id", empresaId).in("estado", ["pendiente", "parcial"]).in("cliente_id", ids.slice(i, i + 100));
      for (const r of (dq.data ?? []) as Array<{ cliente_id: string; saldo: number | string }>) {
        deuda.set(String(r.cliente_id), (deuda.get(String(r.cliente_id)) ?? 0) + Math.max(0, n(r.saldo)));
      }
    }
    for (const c of clientes) {
      const d = deuda.get(String(c.id)) ?? 0;
      if (d <= 0) continue;
      const disp = n(c.limite_credito) - d;
      if (disp > LIMITE_CERCA) continue;
      const nombre = String(c.nombre_facturacion || c.empresa || c.nombre_contacto || c.nombre || "Cliente");
      out.push({
        // El estado en la clave: si la deuda sube otro millón, vuelve a avisar.
        clave: `limite:${c.id}:${Math.floor(d / 1_000_000)}`,
        tipo: "limite",
        titulo: disp <= 0 ? `${nombre} llegó al límite de crédito` : `${nombre} está cerca del límite de crédito`,
        detalle: `Debe ${gs(d)} de ${gs(n(c.limite_credito))} · le quedan ${gs(Math.max(0, disp))}`,
        href: `/clientes/${c.id}`,
        fecha: null,
      });
    }
  })());

  // ── Vendedor: presupuestos que le cambiaron en la caja ───────────────────
  if (todo || puesto === "vendedor") {
    tareas.push((async () => {
      let q = sb.from("presupuesto_cambios")
        .select("id, presupuesto_id, presupuesto_numero, venta_numero, cobrado_por_nombre, vendedor_nombre, created_at, visto_at")
        .eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(50);
      if (!todo) {
        if (mios.length === 0) return;
        q = q.in("vendedor_usuario_id", mios).is("visto_at", null);
      }
      const r = await q;
      if (r.error) return;
      for (const c of (r.data ?? []) as Array<Record<string, unknown>>) {
        out.push({
          clave: `cambio:${c.id}`,
          tipo: "cambio",
          titulo: `Le cambiaron el presupuesto ${c.presupuesto_numero ?? ""} al cobrarlo`,
          detalle: `Venta ${c.venta_numero ?? ""}${c.cobrado_por_nombre ? ` · cobró ${c.cobrado_por_nombre}` : ""}${todo && c.vendedor_nombre ? ` · de ${c.vendedor_nombre}` : ""}`,
          href: `/presupuestos/${c.presupuesto_id}`,
          fecha: (c.created_at as string) ?? null,
        });
      }
    })());
  }

  // ── Administrativo: stock, sobrepedido y descuentos ──────────────────────
  if (todo || puesto === "administrativo") {
    tareas.push((async () => {
      let bajo = 0;
      for (let desde = 0; desde < 20_000; desde += 1000) {
        const q = await sb.from("productos").select("stock_actual, stock_minimo, controla_stock")
          .eq("empresa_id", empresaId).gt("stock_minimo", 0).range(desde, desde + 999);
        if (q.error) return;
        const filas = (q.data ?? []) as Array<{ stock_actual: number | string | null; stock_minimo: number | string | null; controla_stock?: boolean | null }>;
        for (const p of filas) if (p.controla_stock !== false && n(p.stock_actual) < n(p.stock_minimo)) bajo++;
        if (filas.length < 1000) break;
      }
      if (bajo > 0) {
        out.push({
          clave: `stock:${hoyPy()}:${bajo}`,
          tipo: "stock",
          titulo: `Falta de stock: ${bajo} ${bajo === 1 ? "producto" : "productos"} bajo el mínimo`,
          detalle: "Ver qué reponer (Bajo mínimo)",
          href: "/inventario/bajo-minimo",
          fecha: null,
        });
      }
    })());

    tareas.push((async () => {
      const r = await sobrepedido(sb, empresaId);
      if (r.length > 0) {
        out.push({
          clave: `sobrepedido:${hoyPy()}:${r.length}`,
          tipo: "sobrepedido",
          titulo: `Sobrepedido: ${r.length} ${r.length === 1 ? "material" : "materiales"} de presupuestos sin stock`,
          detalle: r.slice(0, 3).map((x) => x.producto_nombre).join(", ") + (r.length > 3 ? "…" : ""),
          href: "/presupuestos/sobrepedido",
          fecha: null,
        });
      }
    })());

    tareas.push((async () => {
      const q = await sb.from("solicitudes_descuento").select("id, producto_nombre, descuento_pct, solicitante_nombre, motivo, created_at")
        .eq("empresa_id", empresaId).eq("estado", "pendiente").gt("expira_at", new Date().toISOString()).limit(30);
      if (q.error) return;
      for (const s of (q.data ?? []) as Array<Record<string, unknown>>) {
        out.push({
          clave: `descuento:${s.id}`,
          tipo: "descuento",
          titulo: `${s.solicitante_nombre ?? "Un vendedor"} pide ${s.descuento_pct}% de descuento`,
          detalle: String(s.motivo ?? s.producto_nombre ?? ""),
          href: null,
          fecha: (s.created_at as string) ?? null,
        });
      }
    })());

    // WhatsApp por QR desvinculado. El estado no está en la base: lo informa
    // el puente, así que esto puede no saberse (puente inalcanzable cuenta
    // como caído; si falla la consulta entera, no avisa nada en vez de
    // inventar). La clave lleva el estado y el día: si se arregla y se vuelve
    // a caer, el aviso vuelve, y si sigue caído mañana también.
    tareas.push((async () => {
      try {
        const caidos = await canalesQrCaidos(empresaId);
        for (const c of caidos) {
          out.push({
            clave: `whatsapp:${c.channelId}:${c.connection}:${hoyPy()}`,
            tipo: "whatsapp",
            titulo: `WhatsApp desconectado: ${c.nombre}`,
            // Corto a propósito: en la campana el detalle va en una línea con
            // truncate, así que una frase larga se corta justo donde importa.
            detalle: `${textoEstadoQr(c)} · escaneá el QR de nuevo`,
            href: `/configuracion/canales/${c.channelId}`,
            fecha: null,
          });
        }
      } catch {
        /* sin aviso: preferimos no avisar que avisar de más */
      }
    })());
  }

  // ── Solo administrador: recepciones de compra esperando su «Aceptar» ─────
  // La mercadería se da por recibida con DOS confirmaciones: alguien marca
  // «Recibido» y el administrador acepta. Sin este aviso, la primera
  // confirmación quedaba esperando sin que nadie se enterara.
  if (todo) {
    tareas.push((async () => {
      const q = await sb.from("ordenes_compra")
        .select("id, numero_control, proveedor_nombre, recibida_por_1_nombre, recibida_por_1_at")
        .eq("empresa_id", empresaId)
        .not("recibida_por_1_at", "is", null)
        .is("recibida_por_2_at", null)
        .neq("estado", "anulada")
        .order("recibida_por_1_at", { ascending: false })
        .limit(50);
      // Sin el script 100 las columnas no existen y esto falla: no hay doble
      // confirmación todavía, así que no hay nada que avisar.
      if (q.error) return;
      for (const o of (q.data ?? []) as Array<Record<string, unknown>>) {
        out.push({
          clave: `recepcion:${o.id}:${hoyPy()}`,
          tipo: "recepcion",
          titulo: `Aceptar recepción de la orden ${o.numero_control ?? ""}`,
          detalle: `${o.proveedor_nombre ?? "Proveedor"}${o.recibida_por_1_nombre ? ` · lo marcó ${o.recibida_por_1_nombre}` : ""}`,
          href: "/compras",
          fecha: (o.recibida_por_1_at as string) ?? null,
        });
      }
    })());
  }

  await Promise.all(tareas);
  const orden: Record<Notificacion["tipo"], number> = { whatsapp: -1, recepcion: 0, descuento: 0, cobrar: 1, cambio: 2, vence: 3, limite: 4, sobrepedido: 5, stock: 6 };
  return out.sort((a, b) => orden[a.tipo] - orden[b.tipo] || String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
}

async function nombresClientes(sb: AppSupabaseClient, empresaId: string, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const u = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < u.length; i += 100) {
    const q = await sb.from("clientes").select("id, nombre_facturacion, empresa, nombre_contacto, nombre").eq("empresa_id", empresaId).in("id", u.slice(i, i + 100));
    for (const c of (q.data ?? []) as Array<Record<string, unknown>>) {
      m.set(String(c.id), String(c.nombre_facturacion || c.empresa || c.nombre_contacto || c.nombre || "Cliente"));
    }
  }
  return m;
}

export interface FilaSobrepedido {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  pedido: number;
  stock: number;
  falta: number;
  presupuestos: Array<{ id: string; numero: string | null; cliente: string | null; cantidad: number }>;
}

/**
 * Sobrepedido: el material que piden los presupuestos vigentes (creados,
 * enviados o aprobados, sin cobrar) y que no alcanza con el stock. Es lo que
 * hay que comprar para poder cumplirlos.
 */
export async function sobrepedido(sb: AppSupabaseClient, empresaId: string): Promise<FilaSobrepedido[]> {
  const pq = await sb.from("presupuestos")
    .select("id, numero_control, cliente_nombre, estado, convertido_venta_id")
    .eq("empresa_id", empresaId).in("estado", ["creado", "enviado", "aprobado"])
    .is("convertido_venta_id", null).limit(1000);
  if (pq.error) return [];
  const presus = (pq.data ?? []) as Array<{ id: string; numero_control: string | null; cliente_nombre: string | null }>;
  if (presus.length === 0) return [];
  const porId = new Map(presus.map((p) => [p.id, p]));

  const pedido = new Map<string, FilaSobrepedido>();
  const ids = presus.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 100) {
    const iq = await sb.from("presupuesto_items").select("*")
      .in("presupuesto_id", ids.slice(i, i + 100));
    if (iq.error) return [];
    for (const it of (iq.data ?? []) as Array<Record<string, unknown>>) {
      const pid = it.producto_id ? String(it.producto_id) : "";
      if (!pid) continue;
      const fila = pedido.get(pid) ?? {
        producto_id: pid, producto_nombre: String(it.producto_nombre ?? ""), sku: (it.sku as string) ?? null,
        pedido: 0, stock: 0, falta: 0, presupuestos: [],
      };
      const cant = n(it.cantidad);
      fila.pedido += cant;
      const p = porId.get(String(it.presupuesto_id));
      fila.presupuestos.push({ id: String(it.presupuesto_id), numero: p?.numero_control ?? null, cliente: p?.cliente_nombre ?? null, cantidad: cant });
      pedido.set(pid, fila);
    }
  }
  const prodIds = [...pedido.keys()];
  for (let i = 0; i < prodIds.length; i += 100) {
    const q = await sb.from("productos").select("id, stock_actual, controla_stock").eq("empresa_id", empresaId).in("id", prodIds.slice(i, i + 100));
    for (const p of (q.data ?? []) as Array<{ id: string; stock_actual: number | string | null; controla_stock?: boolean | null }>) {
      const f = pedido.get(String(p.id));
      if (!f) continue;
      if (p.controla_stock === false) { pedido.delete(String(p.id)); continue; }
      f.stock = n(p.stock_actual);
    }
  }
  const out: FilaSobrepedido[] = [];
  for (const f of pedido.values()) {
    f.falta = Math.round((f.pedido - f.stock) * 100) / 100;
    if (f.falta > 0) out.push(f);
  }
  return out.sort((a, b) => b.falta - a.falta);
}

/** Las claves que ya leyó. Sin el script 96, ninguna (la pantalla recuerda las suyas). */
export async function clavesLeidas(sb: AppSupabaseClient, empresaId: string, usuarioId: string | null): Promise<{ claves: Set<string>; tabla: boolean }> {
  if (!usuarioId) return { claves: new Set(), tabla: false };
  const q = await sb.from("notificaciones_leidas").select("clave").eq("empresa_id", empresaId).eq("usuario_id", usuarioId)
    .order("leida_at", { ascending: false }).limit(5000);
  if (q.error) return { claves: new Set(), tabla: false };
  return { claves: new Set(((q.data ?? []) as Array<{ clave: string }>).map((r) => r.clave)), tabla: true };
}
