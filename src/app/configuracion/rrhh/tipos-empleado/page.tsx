"use client";
import { CatalogoCrud } from "../departamentos/page";
export default function TiposEmpleadoPage() {
  return <CatalogoCrud
    endpoint="/api/rrhh/tipos-empleado-catalogo"
    listKey="tipos"
    itemKey="tipo"
    title="Tipos de empleado"
    subtitle="Catálogo de tipos: administrativo, operario, chofer, etc."
  />;
}
