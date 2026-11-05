import { redirect } from "next/navigation";

/**
 * Salarios es una sola pantalla: la de recibos del mes.
 *
 * Acá había un "resumen de nómina" de otro rubro (sumaba horas imputadas a
 * obras, que esta casa no usa) que repetía lo mismo con otros números. Pedido
 * del cliente: más sencillo, y que diga "Salarios", no "Nómina".
 */
export default function SalariosPage() {
  redirect("/rrhh/nomina/recibos");
}
