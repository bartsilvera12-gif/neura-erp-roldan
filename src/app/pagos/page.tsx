import { redirect } from "next/navigation";

/**
 * Pagos es lo que se les paga a los proveedores. Las cobranzas (lo que deben
 * los clientes) pasaron a su propio módulo, /cobranzas (script 90).
 */
export default function PagosRedirect() {
  redirect("/pagos/proveedores");
}
