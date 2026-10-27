import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";
import { getAnticiposDelMes, type AnticipoRow } from "@/lib/reportes/server/mes-detalle-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anticipos del mes. Reemplaza el `anticipo-<mes>-<año>_<SUCURSAL>.xls` que
 * el cliente sacaba del sistema anterior.
 *
 * El importe no se totaliza: el detalle incluye los anticipos anulados, que
 * no son plata. El resumen de lo cobrado va en el informe de Cobranzas.
 */
/** Hora de Paraguay (UTC−3) de un timestamp, como HH:MM. */
function horaPy(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

const COLUMNAS: ColumnaEstilada<AnticipoRow>[] = [
  { header: "Número", value: (r) => r.numero ?? "", width: 12 },
  { header: "Fecha", value: (r) => (r.fecha ? new Date(r.fecha) : ""), formato: "fecha", width: 12 },
  // Como texto y no como hora de Excel: en una columna con formato de hora,
  // un valor vacío se muestra como 00:00, que se lee como medianoche.
  { header: "Hora", value: (r) => horaPy(r.fecha), width: 9 },
  { header: "Cód. cliente", value: (r) => r.cliente_codigo ?? "", width: 13 },
  { header: "Cliente", value: (r) => r.cliente_nombre ?? "", width: 34 },
  { header: "RUC", value: (r) => r.cliente_ruc ?? "", width: 15 },
  { header: "Importe", value: (r) => Number(r.monto) || 0, formato: "gs", width: 17 },
  { header: "Medio de pago", value: (r) => r.medio_pago ?? "", width: 15 },
  { header: "Estado", value: (r) => r.estado ?? "", width: 13 },
  { header: "Factura liquidada", value: (r) => r.factura ?? "", width: 18 },
  { header: "Caja", value: (r) => r.caja ?? "", width: 10 },
  { header: "Recibió", value: (r) => r.usuario_nombre ?? "", width: 22 },
  { header: "Observación", value: (r) => r.observacion ?? "", width: 34 },
  { header: "Anulado", value: (r) => (r.anulado ? "SÍ" : ""), width: 10 },
  { header: "Motivo de anulación", value: (r) => r.anulado_motivo ?? "", width: 34 },
];

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const b = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const filas = await getAnticiposDelMes(schema, ctx.auth.empresa_id, sucursalId, b);
    const [emp, suc] = await Promise.all([
      datosEmpresaInforme(ctx.auth.empresa_id),
      nombreSucursal(sucursalId),
    ]);

    const buf = await buildXlsxEstilado(
      { nombre: "Anticipos", filas, columnas: COLUMNAS, totales: false },
      {
        ...emp, informe: "Anticipos de clientes", periodo: mesLabelLargo(mes), sucursal: suc,
        notas: ["Incluye los anulados, marcados en su columna; por eso el importe no se totaliza."],
      }
    );
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`anticipos-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/anticipos/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
