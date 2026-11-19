import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Cuando se cobra en la caja un presupuesto, el cliente pasa a la cartera del
 * vendedor que lo hizo, por los días de cartera configurados (30 por
 * defecto). Pedido del cliente.
 *
 * ── CUÁNDO SE ASIGNA Y CUÁNDO NO ──────────────────────────────────────────
 *   - Cliente libre en esa sucursal (sin fila, sin vendedor, liberado a mano
 *     o con el plazo vencido) → queda en la cartera del vendedor del
 *     presupuesto, con el reloj arrancando hoy.
 *   - Ya está en la cartera de ESE vendedor → se renueva el plazo.
 *   - Está en la cartera vigente de OTRO vendedor → no se toca: el cliente
 *     sigue en la cartera original (punto 4.3). La venta igual renueva el
 *     plazo de esa cartera, como cualquier venta.
 *
 * Best-effort: si algo falla, el cobro ya está hecho y no se deshace.
 */
export async function asignarCarteraPorPresupuesto(
  sb: AppSupabaseClient,
  empresaId: string,
  presupuestoId: string,
  ventaId: string
): Promise<{ asignado: boolean; motivo: string }> {
  const [pq, vq] = await Promise.all([
    sb.from("presupuestos").select("vendedor_usuario_id, vendedor_nombre, usuario_id, usuario_nombre, cliente_id, sucursal_id")
      .eq("empresa_id", empresaId).eq("id", presupuestoId).maybeSingle(),
    sb.from("ventas").select("cliente_id, sucursal_id").eq("empresa_id", empresaId).eq("id", ventaId).maybeSingle(),
  ]);
  if (pq.error || !pq.data) return { asignado: false, motivo: "sin presupuesto" };
  const p = pq.data as Record<string, unknown>;
  const v = (vq.data ?? {}) as Record<string, unknown>;
  const clienteId = String(v.cliente_id ?? p.cliente_id ?? "") || null;
  const sucursalId = String(v.sucursal_id ?? p.sucursal_id ?? "") || null;
  if (!clienteId || !sucursalId) return { asignado: false, motivo: "sin cliente o sin sucursal" };

  // El vendedor del presupuesto. Se guarda con el id de la ficha del usuario;
  // un presupuesto sin vendedor elegido trae el id de la sesión de quien lo
  // cargó, así que se busca por los dos.
  const candidato = String(p.vendedor_usuario_id ?? p.usuario_id ?? "") || null;
  if (!candidato) return { asignado: false, motivo: "presupuesto sin vendedor" };
  let vendedor: { id: string; nombre: string | null } | null = null;
  for (const col of ["id", "auth_user_id"] as const) {
    const u = await sb.from("usuarios").select("id, nombre, email").eq(col, candidato).maybeSingle();
    if (!u.error && u.data) {
      const d = u.data as { id: string; nombre?: string | null; email?: string | null };
      vendedor = { id: d.id, nombre: d.nombre ?? d.email ?? null };
      break;
    }
  }
  if (!vendedor) return { asignado: false, motivo: "vendedor no encontrado" };

  const cfg = await sb.from("comisiones_config").select("dias_cartera").eq("empresa_id", empresaId).maybeSingle();
  const dias = Number((cfg.data as { dias_cartera?: number } | null)?.dias_cartera) || 30;

  const actual = await sb.from("cliente_cartera")
    .select("vendedor_usuario_id, cartera_desde")
    .eq("empresa_id", empresaId).eq("cliente_id", clienteId).eq("sucursal_id", sucursalId)
    .maybeSingle();
  if (actual.error) return { asignado: false, motivo: actual.error.message };
  const fila = actual.data as { vendedor_usuario_id?: string | null; cartera_desde?: string | null } | null;
  const vigente = !!fila?.vendedor_usuario_id && !!fila.cartera_desde &&
    Date.now() - new Date(fila.cartera_desde).getTime() < dias * 24 * 60 * 60 * 1000;
  if (vigente && fila!.vendedor_usuario_id !== vendedor.id) {
    return { asignado: false, motivo: "en la cartera vigente de otro vendedor" };
  }

  const ahora = new Date().toISOString();
  const up = await sb.from("cliente_cartera").upsert({
    empresa_id: empresaId,
    cliente_id: clienteId,
    sucursal_id: sucursalId,
    vendedor_usuario_id: vendedor.id,
    vendedor_nombre: vendedor.nombre ?? (String(p.vendedor_nombre ?? p.usuario_nombre ?? "") || null),
    cartera_desde: ahora,
    updated_at: ahora,
  }, { onConflict: "empresa_id,cliente_id,sucursal_id" });
  if (up.error) return { asignado: false, motivo: up.error.message };
  return { asignado: true, motivo: vigente ? "renovado" : "asignado" };
}
