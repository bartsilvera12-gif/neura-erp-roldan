import { redirect } from "next/navigation";

/**
 * Devoluciones de ventas: sacadas de Ventas (pedido del cliente: «quitá lo
 * de devolución de la parte de ventas, todo»). La dirección vieja manda a
 * Caja. La pantalla anterior está en el historial de git.
 */
export default function DevolucionesVentasPage() {
  redirect("/ventas");
}
