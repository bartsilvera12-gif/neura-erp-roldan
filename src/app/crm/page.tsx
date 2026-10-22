import CrmFunnel from "./CrmFunnel";

/**
 * Módulo CRM.
 *
 * La pantalla es `CrmFunnel`, portada de `neura-erp-sistemas-propio`, que es
 * la referencia visual que pidió el cliente: tarjetas de métricas arriba,
 * buscador, y el pipeline en columnas por etapa con el total de cada una.
 *
 * La versión anterior queda en `CrmLegacy.tsx` por si hace falta comparar;
 * no está ruteada.
 */
export default function Page() {
  return <CrmFunnel />;
}
