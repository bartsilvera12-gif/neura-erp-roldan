import { redirect } from "next/navigation";

/**
 * La interfaz de cuentas por cobrar / cobros vive ahora en el módulo Cobranzas.
 * Se conserva /cobros solo como redirección por compatibilidad de enlaces.
 */
export default function CobrosRedirect() {
  redirect("/cobranzas");
}
