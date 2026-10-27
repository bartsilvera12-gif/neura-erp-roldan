import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";
import { valorizarAFecha, type FilaValoracion } from "@/lib/inventario/server/valoracion-pg";
import { ultimoDiaMes, normalizarMes } from "@/lib/fechas/asuncion-bounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en Paraguay (UTC−3), como YYYY-MM-DD. */
function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const COLUMNAS: ColumnaEstilada<FilaValoracion>[] = [
  { header: "Referencia", value: (r) => r.sku ?? "", width: 16 },
  { header: "Descripción", value: (r) => r.nombre, width: 46 },
  { header: "Rubro", value: (r) => r.rubro_nombre ?? "Sin rubro", width: 26 },
  { header: "Unidad", value: (r) => r.unidad ?? "", width: 10 },
  { header: "Costo unitario", value: (r) => r.costo_unitario || null, formato: "gs", width: 16 },
  { header: "Stock", value: (r) => r.cantidad, formato: "cantidad", suma: true, width: 12 },
  { header: "Valor total", value: (r) => r.valor_total || null, formato: "gs", suma: true, width: 18 },
];

/**
 * GET /api/inventario/valoracion/export?fecha=YYYY-MM-DD | ?mes=YYYY-MM
 *
 * Reemplaza el `inventario-a-la-fecha-<mes>-<año>_<SUCURSAL>.xls`.
 *
 * ── EN QUÉ SE DIFERENCIA DE "STOCK CON PRECIOS" ──────────────────────────
 *   Parecen el mismo informe y no lo son. "Stock con precios" es la foto de
 *   HOY con los precios de venta, y sirve para vender y para reponer. Éste
 *   reconstruye el stock y el costo que había A UNA FECHA, volviendo a pasar
 *   los movimientos, y sirve para cerrar el mes: es el valor que va al
 *   balance. Por eso tampoco lleva precios de venta — lo que se valoriza es
 *   lo que costó, no lo que se espera cobrar.
 *
 *   Y por eso este sí acepta un mes cerrado, mientras que el otro siempre
 *   muestra hoy.
 *
 * ── SOLO LO QUE TIENE STOCK ──────────────────────────────────────────────
 *   Se dejan afuera los artículos en cero, igual que el archivo del sistema
 *   anterior (venía con 405 filas de los 993 productos). Un inventario
 *   valorizado lista lo que hay; los agotados se miran en Reposición.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const sp = new URL(request.url).searchParams;
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    // Acepta `fecha` (la pantalla) o `mes` (el paquete mensual, que pide el
    // cierre). Con `mes` se toma el último día: el stock al cierre es el que
    // queda después del último movimiento del mes.
    const pedidaFecha = (sp.get("fecha") ?? "").trim();
    const pedidoMes = (sp.get("mes") ?? "").trim();
    let fecha: string;
    if (RE_FECHA.test(pedidaFecha)) fecha = pedidaFecha;
    else if (/^\d{4}-\d{2}$/.test(pedidoMes)) fecha = ultimoDiaMes(normalizarMes(pedidoMes));
    else fecha = hoyPy();

    // Una fecha futura daría lo mismo que hoy pero con un encabezado que miente.
    if (fecha > hoyPy()) fecha = hoyPy();

    const rubro = (sp.get("rubro") ?? "").trim() || null;
    const r = await valorizarAFecha(schema, empresaId, sucursalId, fecha, rubro);
    const [emp, suc] = await Promise.all([datosEmpresaInforme(empresaId), nombreSucursal(sucursalId)]);

    const notas = [
      "El stock y el costo se reconstruyen volviendo a pasar los movimientos hasta esa fecha; no son los valores de hoy.",
      "Solo artículos con existencia: los que están en cero no se listan.",
    ];
    if (r.indeterminados > 0) {
      notas.push(
        `${r.indeterminados} artículo(s) quedaron sin costo determinable a esa fecha: entran con costo cero y el valor total es menor al real.`
      );
    }
    if (r.truncado) {
      notas.push("El cálculo llegó a su tope de artículos: hay más que los listados.");
    }

    const buf = await buildXlsxEstilado(
      {
        nombre: "Inventario a la fecha",
        filas: r.filas,
        columnas: COLUMNAS,
        etiquetaTotales: `TOTALES (${r.filas.length} artículos)`,
      },
      { ...emp, informe: "Inventario valorizado a la fecha", periodo: `Al ${fecha}`, sucursal: suc, notas }
    );
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`inventario-a-la-fecha-${fecha}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/valoracion/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
