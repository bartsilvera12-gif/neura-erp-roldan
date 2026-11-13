import "server-only";

/**
 * ÍTEMS ESCRITOS A MANO EN UNA VENTA.
 *
 * Un presupuesto puede tener líneas que no son productos del inventario
 * ("Ítem manual": un corte especial, un flete, algo que todavía no se cargó).
 * Al pasarlo a Caja esas líneas se descartaban, porque la venta exige un
 * producto por línea, y el cobro salía de menos.
 *
 * Ahora cada línea a mano se vende con un producto genérico de la sucursal,
 * "ÍTEM A MANO": no controla stock (no descuenta nada ni se queda sin) y está
 * inactivo, así que no aparece en el catálogo ni en el buscador. La línea
 * conserva su propia descripción, que es la que sale en el ticket y la
 * factura.
 *
 * En el navegador la línea viaja con `producto_id = "manual:<n>"`.
 */

export const SKU_ITEM_MANUAL = "ITEM-A-MANO";
export const esIdManual = (id: unknown) => typeof id === "string" && (id === "" || id.startsWith("manual:"));

type Sb = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function productoItemManual(sb: Sb, empresaId: string, sucursalId: string): Promise<string> {
  const { data: ya } = await sb
    .from("productos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .eq("sku", SKU_ITEM_MANUAL)
    .limit(1);
  const existente = (ya as Array<{ id: string }> | null)?.[0]?.id;
  if (existente) return existente;

  const { data, error } = await sb
    .from("productos")
    .insert({
      empresa_id: empresaId,
      sucursal_id: sucursalId,
      nombre: "ÍTEM A MANO",
      sku: SKU_ITEM_MANUAL,
      descripcion: "Producto genérico para las líneas escritas a mano en presupuestos y ventas. No borrar.",
      precio_venta: 0,
      costo_promedio: 0,
      stock_actual: 0,
      controla_stock: false,
      activo: false,
      tipo_iva: "10%",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo preparar el ítem a mano: ${error?.message ?? "sin respuesta"}`);
  return String((data as { id: string }).id);
}
