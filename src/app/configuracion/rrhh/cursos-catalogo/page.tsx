"use client";
import { CatalogoCrud } from "../departamentos/page";
export default function CursosCatalogoPage() {
  return <CatalogoCrud
    endpoint="/api/rrhh/cursos-catalogo"
    listKey="cursos"
    itemKey="curso"
    title="Cursos y certificaciones"
    subtitle="Catálogo de cursos, certificados, habilitaciones y documentos legales."
  />;
}
