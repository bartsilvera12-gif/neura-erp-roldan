import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Las condiciones y la forma de pago de la casa (Configuración → Presupuesto),
 * listas para precargar el formulario.
 *
 * Reintenta: si el pedido salía apenas abierta la página, antes de que la
 * sesión estuviera lista, fallaba y el formulario quedaba con las condiciones
 * vacías, sin aviso. El impreso igual usaba la plantilla, pero en pantalla el
 * vendedor no veía lo que iba a firmar el cliente.
 */
export async function cargarPlantillaPresupuesto(): Promise<{ condiciones: string; formaPago: string } | null> {
  for (let intento = 0; intento < 4; intento++) {
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/presupuesto-plantilla", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      const pl = j?.data?.plantilla;
      if (r.ok && j?.success && pl) {
        const pct = Number(pl.anticipo_pct);
        return {
          condiciones: typeof pl.observaciones === "string" ? pl.observaciones : "",
          formaPago:
            typeof pl.forma_pago === "string"
              ? pl.forma_pago.replace(/\{anticipo\}/g, Number.isFinite(pct) ? String(pct) : "0")
              : "",
        };
      }
    } catch { /* se reintenta */ }
    await new Promise((res) => setTimeout(res, 800 * (intento + 1)));
  }
  return null;
}
