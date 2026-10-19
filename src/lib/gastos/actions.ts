import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getEmpresaId, getSucursalId } from "@/lib/db/empresa";
import { ymdInicioFinMesLocal } from "@/lib/fechas/calendario";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";

export type MetodoPagoGasto = "efectivo" | "transferencia" | "tarjeta";

/** Tipo de IVA del gasto (IVA incluido en el monto). Para el desglose contable. */
export type TipoIvaGasto = "exenta" | "5" | "10";
/** Cuando una misma factura tiene montos con distinto IVA. */
export type TipoIvaGastoStore = TipoIvaGasto | "mixto";

/** IVA contenido en un monto con IVA incluido, según el tipo. */
export function ivaDeMontoGasto(monto: number, tipoIva: TipoIvaGasto): number {
  const m = Number(monto) || 0;
  if (tipoIva === "5") return m - m / 1.05;
  if (tipoIva === "10") return m - m / 1.1;
  return 0;
}

/**
 * Desglose de IVA de una factura con montos mixtos. Recibe los tres montos con
 * IVA INCLUIDO (exenta, gravado al 10%, gravado al 5%) y devuelve las bases, los
 * IVAs, el total y el tipo resultante ('mixto' si hay más de uno).
 */
export function desgloseIvaGasto(incExenta: number, inc10: number, inc5: number) {
  const ex = Math.max(0, Number(incExenta) || 0);
  const m10 = Math.max(0, Number(inc10) || 0);
  const m5 = Math.max(0, Number(inc5) || 0);
  const gravado10 = m10 > 0 ? m10 / 1.1 : 0;
  const iva10 = m10 - gravado10;
  const gravado5 = m5 > 0 ? m5 / 1.05 : 0;
  const iva5 = m5 - gravado5;
  const monto = ex + m10 + m5;
  const usados = [ex > 0 ? "exenta" : "", m10 > 0 ? "10" : "", m5 > 0 ? "5" : ""].filter(Boolean);
  const tipo_iva: TipoIvaGastoStore = usados.length > 1 ? "mixto" : ((usados[0] as TipoIvaGasto) ?? "exenta");
  return {
    monto,
    monto_exenta: ex,
    gravado_10: gravado10,
    iva_10: iva10,
    gravado_5: gravado5,
    iva_5: iva5,
    monto_iva: iva10 + iva5,
    tipo_iva,
  };
}

export type Gasto = {
  id: string;
  empresa_id: string;
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  created_at: string;
  /** Nombre del comercio o empresa a la que se le hizo el pago. */
  beneficiario?: string | null;
  /** Cómo se pagó. NULL para gastos históricos sin ese dato. */
  metodo_pago?: MetodoPagoGasto | null;
  /** Tipo de IVA (IVA incluido en el monto). Para el desglose del contador. */
  tipo_iva?: TipoIvaGastoStore;
  /** IVA contenido en el monto (suma de iva_5 + iva_10). */
  monto_iva?: number;
  /** Desglose por tipo de IVA (facturas mixtas). Bases + IVAs. */
  monto_exenta?: number;
  gravado_5?: number;
  iva_5?: number;
  gravado_10?: number;
  iva_10?: number;
  /** Unidad de negocio a la que pertenece el gasto: 'nutricion' | 'consignataria'. */
  unidad_negocio?: UnidadNegocioGasto;
  /** Datos fiscales del comprobante del proveedor (para el registro del contador). */
  proveedor_ruc?: string | null;
  nro_timbrado?: string | null;
  numero_factura?: string | null;
};

/** Unidad de negocio del gasto. */
export type UnidadNegocioGasto = "nutricion" | "consignataria";

export type GastoInput = {
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  beneficiario?: string | null;
  metodo_pago?: MetodoPagoGasto | null;
  tipo_iva?: TipoIvaGasto;
  unidad_negocio?: UnidadNegocioGasto;
  /** Datos fiscales del comprobante del proveedor (para el registro del contador). */
  proveedor_ruc?: string | null;
  nro_timbrado?: string | null;
  numero_factura?: string | null;
  /** Desglose de IVA de una factura mixta (montos con IVA INCLUIDO). Si alguno
   * es > 0, mandan sobre `monto`/`tipo_iva`. */
  inc_exenta?: number;
  inc_10?: number;
  inc_5?: number;
};

function mapRow(r: Record<string, unknown>): Gasto {
  const mp = r.metodo_pago;
  const metodo_pago: MetodoPagoGasto | null =
    mp === "efectivo" || mp === "transferencia" || mp === "tarjeta" ? mp : null;
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string,
    categoria: (r.categoria as string) ?? "",
    descripcion: (r.descripcion as string) ?? "",
    monto: Number(r.monto) ?? 0,
    tipo: (r.tipo as "fijo" | "variable") ?? "variable",
    recurrente: Boolean(r.recurrente),
    frecuencia: r.frecuencia as string | undefined,
    fecha: (r.fecha as string) ?? "",
    created_at: (r.created_at as string) ?? "",
    beneficiario: r.beneficiario == null || String(r.beneficiario).trim() === "" ? null : String(r.beneficiario),
    metodo_pago,
    tipo_iva: r.tipo_iva === "5" || r.tipo_iva === "10" || r.tipo_iva === "mixto" ? (r.tipo_iva as TipoIvaGastoStore) : "exenta",
    monto_iva: Number(r.monto_iva) || 0,
    monto_exenta: Number(r.monto_exenta) || 0,
    gravado_5: Number(r.gravado_5) || 0,
    iva_5: Number(r.iva_5) || 0,
    gravado_10: Number(r.gravado_10) || 0,
    iva_10: Number(r.iva_10) || 0,
    unidad_negocio: r.unidad_negocio === "consignataria" ? "consignataria" : "nutricion",
    proveedor_ruc: r.proveedor_ruc == null || String(r.proveedor_ruc).trim() === "" ? null : String(r.proveedor_ruc),
    nro_timbrado: r.nro_timbrado == null || String(r.nro_timbrado).trim() === "" ? null : String(r.nro_timbrado),
    numero_factura: r.numero_factura == null || String(r.numero_factura).trim() === "" ? null : String(r.numero_factura),
  };
}

/** Obtiene todos los gastos de la empresa, ordenados por fecha desc. */
export async function getGastos(): Promise<Gasto[]> {
  if (typeof window !== "undefined") {
    const res = await fetchWithSupabaseSession("/api/gastos", { cache: "no-store" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || `Error ${res.status}`);
    }
    const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown>[] };
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data.map(mapRow);
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .eq("empresa_id", await getEmpresaId())
    .eq("sucursal_id", await getSucursalId())
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Obtiene los gastos del mes actual (para Dashboard). RLS filtra por empresa. */
export async function getGastosMesActual(): Promise<Gasto[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const hoy = new Date();
  const { inicioYmd: inicioMes, finYmd: finMes } = ymdInicioFinMesLocal(hoy);

  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .eq("empresa_id", await getEmpresaId())
    .eq("sucursal_id", await getSucursalId())
    .gte("fecha", inicioMes)
    .lte("fecha", finMes)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Calcula el desglose (buckets si vienen; si no, del monto+tipo simple). */
function resolverDesglose(input: Partial<Pick<GastoInput, "monto" | "tipo_iva" | "inc_exenta" | "inc_10" | "inc_5">>) {
  const usaBuckets =
    (Number(input.inc_exenta) || 0) > 0 || (Number(input.inc_10) || 0) > 0 || (Number(input.inc_5) || 0) > 0;
  if (usaBuckets) return desgloseIvaGasto(input.inc_exenta ?? 0, input.inc_10 ?? 0, input.inc_5 ?? 0);
  // Modo simple: un solo tipo de IVA sobre `monto`.
  const monto = Number(input.monto) || 0;
  const t = input.tipo_iva ?? "exenta";
  return desgloseIvaGasto(t === "exenta" ? monto : 0, t === "10" ? monto : 0, t === "5" ? monto : 0);
}

export async function createGasto(input: GastoInput): Promise<Gasto> {
  const d = resolverDesglose(input);
  if (d.monto <= 0) throw new Error("El monto debe ser mayor a 0");

  const supabase = await getBrowserSupabaseForEmpresaData();
  const empresa_id = await getEmpresaId();
  const sucursal_id = await getSucursalId();

  const { data, error } = await supabase
    .from("gastos")
    .insert({
      empresa_id,
      sucursal_id,
      categoria: input.categoria.trim() || null,
      descripcion: input.descripcion.trim() || null,
      monto: d.monto,
      tipo: input.tipo,
      recurrente: input.recurrente,
      frecuencia: input.frecuencia?.trim() || null,
      fecha: input.fecha,
      beneficiario: input.beneficiario?.trim() || null,
      metodo_pago: input.metodo_pago ?? null,
      tipo_iva: d.tipo_iva,
      monto_iva: d.monto_iva,
      monto_exenta: d.monto_exenta,
      gravado_5: d.gravado_5,
      iva_5: d.iva_5,
      gravado_10: d.gravado_10,
      iva_10: d.iva_10,
      unidad_negocio: input.unidad_negocio ?? "nutricion",
      proveedor_ruc: input.proveedor_ruc?.trim() || null,
      nro_timbrado: input.nro_timbrado?.trim() || null,
      numero_factura: input.numero_factura?.trim() || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function updateGasto(id: string, input: Partial<GastoInput>): Promise<Gasto> {
  if (input.monto !== undefined && input.monto <= 0) throw new Error("El monto debe ser mayor a 0");

  const supabase = await getBrowserSupabaseForEmpresaData();
  const update: Record<string, unknown> = {};
  if (input.categoria !== undefined) update.categoria = input.categoria.trim() || null;
  if (input.descripcion !== undefined) update.descripcion = input.descripcion.trim() || null;
  if (input.tipo !== undefined) update.tipo = input.tipo;
  if (input.recurrente !== undefined) update.recurrente = input.recurrente;
  if (input.frecuencia !== undefined) update.frecuencia = input.frecuencia?.trim() || null;
  if (input.fecha !== undefined) update.fecha = input.fecha;
  if (input.beneficiario !== undefined) update.beneficiario = input.beneficiario?.trim() || null;
  if (input.metodo_pago !== undefined) update.metodo_pago = input.metodo_pago ?? null;
  if (input.proveedor_ruc !== undefined) update.proveedor_ruc = input.proveedor_ruc?.trim() || null;
  if (input.nro_timbrado !== undefined) update.nro_timbrado = input.nro_timbrado?.trim() || null;
  if (input.numero_factura !== undefined) update.numero_factura = input.numero_factura?.trim() || null;
  if (input.unidad_negocio !== undefined) update.unidad_negocio = input.unidad_negocio;
  // Recalcular el desglose de IVA si el form mandó monto/tipo o buckets (siempre
  // los manda al editar). Actualiza monto + bases + IVAs + tipo.
  if (
    input.monto !== undefined || input.tipo_iva !== undefined ||
    input.inc_exenta !== undefined || input.inc_10 !== undefined || input.inc_5 !== undefined
  ) {
    const d = resolverDesglose(input);
    update.monto = d.monto;
    update.tipo_iva = d.tipo_iva;
    update.monto_iva = d.monto_iva;
    update.monto_exenta = d.monto_exenta;
    update.gravado_5 = d.gravado_5;
    update.iva_5 = d.iva_5;
    update.gravado_10 = d.gravado_10;
    update.iva_10 = d.iva_10;
  }

  const { data, error } = await supabase
    .from("gastos")
    .update(update)
    .eq("empresa_id", await getEmpresaId())
    .eq("sucursal_id", await getSucursalId())
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function deleteGasto(id: string): Promise<void> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  // Antes era .delete().eq("id", id) a secas: podia borrar el gasto de otra
  // empresa o sucursal si se conocia el UUID.
  const { error } = await supabase
    .from("gastos")
    .delete()
    .eq("empresa_id", await getEmpresaId())
    .eq("sucursal_id", await getSucursalId())
    .eq("id", id);

  if (error) throw new Error(error.message);
}
