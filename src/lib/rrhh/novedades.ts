/**
 * Amonestaciones, observaciones y demás novedades del empleado (script 76).
 * Compartido entre la API, la ficha y la hoja para firmar.
 */

export type TipoNovedad = "observacion" | "llamada_atencion" | "amonestacion" | "suspension" | "reconocimiento";

export type Novedad = {
  id: string;
  empleado_id: string;
  tipo: TipoNovedad;
  fecha: string;
  motivo: string;
  detalle: string | null;
  dias_suspension: number | null;
  suspension_desde: string | null;
  firmada_at: string | null;
  estado: "vigente" | "anulada";
  motivo_anulacion: string | null;
  created_by_nombre: string | null;
  created_at: string;
};

export const TIPOS_NOVEDAD: Array<{
  v: TipoNovedad;
  label: string;
  ayuda: string;
  /** Se le comunica al empleado y firma. */
  seFirma: boolean;
  tono: "slate" | "amber" | "rose" | "red" | "emerald";
}> = [
  { v: "observacion", label: "Observación", ayuda: "Nota interna. No se le comunica al empleado.", seFirma: false, tono: "slate" },
  { v: "llamada_atencion", label: "Llamada de atención", ayuda: "Advertencia verbal que queda registrada.", seFirma: false, tono: "amber" },
  { v: "amonestacion", label: "Amonestación", ayuda: "Por escrito: se imprime y el empleado la firma.", seFirma: true, tono: "rose" },
  { v: "suspension", label: "Suspensión", ayuda: "Sin goce de sueldo, por los días que se indiquen. Se firma.", seFirma: true, tono: "red" },
  { v: "reconocimiento", label: "Reconocimiento", ayuda: "Felicitación o premio por un buen desempeño.", seFirma: true, tono: "emerald" },
];

export const tipoNovedad = (t: string) => TIPOS_NOVEDAD.find((x) => x.v === t) ?? TIPOS_NOVEDAD[0];
export const esTipoNovedad = (t: unknown): t is TipoNovedad => TIPOS_NOVEDAD.some((x) => x.v === t);

/** "Falta correr el script 76" cuando la tabla no existe. */
export const faltaScript76 = (m: string) => /empleado_novedades/.test(m) && /does not exist|not find|schema cache/i.test(m);
export const AVISO_76 = "Falta correr el script 76: la base todavía no tiene dónde guardar las amonestaciones.";
