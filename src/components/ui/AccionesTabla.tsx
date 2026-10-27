"use client";

import ExportarTablaButton, { type CeldaExport } from "@/components/ui/ExportarTablaButton";
import ImprimirTablaButton from "@/components/ui/ImprimirTablaButton";

/**
 * Los dos botones de un listado: Excel e Imprimir (requisito general 11.1,
 * "todo se debe poder imprimir y exportar en Excel").
 *
 * Van juntos en un componente porque reciben exactamente lo mismo —las filas
 * que la pantalla ya tiene cargadas y filtradas— y porque así no puede pasar
 * que una pantalla termine con uno de los dos: el pedido es que estén los dos
 * en todos lados.
 */
export default function AccionesTabla({
  titulo,
  archivo,
  subtitulo,
  columnas,
  filas,
  sumar,
  labelExcel,
  labelImprimir,
  className = "",
}: {
  titulo: string;
  archivo: string;
  subtitulo?: string;
  columnas: string[];
  filas: CeldaExport[][];
  /** Índices de columna que se totalizan al pie de la hoja impresa. */
  sumar?: number[];
  /** Para pantallas con dos tablas, donde "Excel" a secas no alcanza. */
  labelExcel?: string;
  labelImprimir?: string;
  className?: string;
}) {
  return (
    <span className="inline-flex items-start gap-2">
      <ExportarTablaButton
        titulo={titulo}
        archivo={archivo}
        subtitulo={subtitulo}
        columnas={columnas}
        filas={filas}
        label={labelExcel}
        className={className}
      />
      <ImprimirTablaButton
        titulo={titulo}
        subtitulo={subtitulo}
        columnas={columnas}
        filas={filas}
        sumar={sumar}
        label={labelImprimir}
        className={className}
      />
    </span>
  );
}
