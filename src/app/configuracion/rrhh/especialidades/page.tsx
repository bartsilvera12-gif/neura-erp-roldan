"use client";
import { CatalogoCrud } from "../departamentos/page";
export default function EspecialidadesPage() {
  return <CatalogoCrud
    endpoint="/api/rrhh/especialidades"
    listKey="especialidades"
    itemKey="especialidad"
    title="Especialidades"
    subtitle="Especialidades técnicas asignables a empleados."
  />;
}
