import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { DatosClientePresupuesto } from "@/lib/presupuestos/faltantes";

/**
 * El alta del cliente de un presupuesto.
 *
 * Lo que FALTA para que el presupuesto sea firme se calcula en
 * `@/lib/presupuestos/faltantes`, que es código puro y lo comparte el
 * formulario. Acá vive solo lo que toca la base.
 */

/**
 * El cliente del presupuesto, dándolo de alta si hace falta.
 *
 * Si el RUC coincide con uno que ya existe, se linkea en vez de crear otro:
 * el padrón ya tiene homónimos de sobra y un RUC repetido rompe la cuenta
 * corriente del cliente.
 *
 * Solo se llama con los datos COMPLETOS. Un borrador no abre ficha —le faltan
 * justamente los datos que el alta exige— y crear la ficha a medias es lo que
 * se quería evitar.
 */
export async function asegurarClienteDelPresupuesto(
  sb: AppSupabaseClient,
  ctx: { empresaId: string; userId: string; emailCreador: string | null },
  d: DatosClientePresupuesto & { moneda?: string }
): Promise<string> {
  if (d.cliente_id) return String(d.cliente_id);

  const ruc = (d.ruc ?? "").trim();
  if (ruc) {
    const { data: existente } = await sb
      .from("clientes")
      .select("id")
      .eq("empresa_id", ctx.empresaId)
      .eq("ruc", ruc)
      .maybeSingle();
    if (existente?.id) return String(existente.id);
  }

  const nombre = d.nombre.trim();
  const { data: nuevo, error } = await sb
    .from("clientes")
    .insert([{
      empresa_id: ctx.empresaId,
      created_by_user_id: ctx.userId,
      created_by_nombre: ctx.emailCreador,
      tipo_cliente: "empresa",
      nombre,
      nombre_contacto: nombre,
      ruc: ruc || null,
      telefono: (d.telefono ?? "").trim() || null,
      direccion: (d.direccion ?? "").trim() || null,
      ciudad: (d.ciudad ?? "").trim() || null,
      profesion: (d.profesion ?? "").trim() || null,
      moneda_preferida: d.moneda === "USD" ? "USD" : "GS",
      estado: "activo",
      usa_nota_remision: false,
    }])
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el cliente: ${error.message}`);
  return String(nuevo.id);
}
