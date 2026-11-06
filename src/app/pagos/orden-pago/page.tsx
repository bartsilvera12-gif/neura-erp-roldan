import { redirect } from "next/navigation";

/**
 * La orden de pago ahora está adentro de Pagos a proveedores (pestaña
 * "Armar pago"). Esta dirección queda para los enlaces viejos.
 */
export default async function OrdenPagoRedirect({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string }>;
}) {
  const { proveedor } = await searchParams;
  redirect(`/pagos/proveedores?tab=armar${proveedor ? `&proveedor=${encodeURIComponent(proveedor)}` : ""}`);
}
