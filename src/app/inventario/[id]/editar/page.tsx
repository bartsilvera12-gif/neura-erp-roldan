"use client";

import { useParams } from "next/navigation";
import EditarProductoForm from "@/components/inventario/EditarProductoForm";

/** Editar producto: la ficha completa (ver `EditarProductoForm`). */
export default function EditarProductoPage() {
  const params = useParams();
  const id = (params?.id as string) ?? "";
  return <EditarProductoForm productoId={id} />;
}
