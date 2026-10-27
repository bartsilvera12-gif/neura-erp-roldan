import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";
import { getStockConPrecios, type StockConPreciosRow } from "@/lib/inventario/server/stock-con-precios-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const n = (v: string | number | null) => {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) && x !== 0 ? x : null;
};

/**
 * Columnas de la planilla "Stock con precios".
 *
 * El orden sigue al del archivo que el cliente venía armando con el sistema
 * viejo (código, referencia, descripción, rubro, costos, precios, existencia)
 * para que no tenga que reaprender dónde mirar. Lo que cambia son los
 * títulos, que ahí eran nombres de columna de base de datos, y el formato de
 * los números.
 *
 * Las columnas en dólares aparecen solo si hay una cotización cargada: una
 * columna de ceros se lee como "estos productos valen cero", que es peor que
 * no tenerla.
 */
function columnas(cotizacion: number | null, filasConCostoUsd: number): ColumnaEstilada<StockConPreciosRow>[] {
  const cols: ColumnaEstilada<StockConPreciosRow>[] = [
    { header: "Código", value: (r) => r.codigo ?? "", width: 14 },
    { header: "Referencia", value: (r) => r.sku, width: 16 },
    { header: "Descripción", value: (r) => r.nombre, width: 46 },
    { header: "Rubro", value: (r) => r.rubro ?? "Sin rubro", width: 26 },
  ];
  cols.push(
    { header: "Unidad", value: (r) => r.unidad, width: 10 },
    { header: "Costo Gs.", value: (r) => n(r.costo_gs), formato: "gs", width: 15 }
  );
  // El costo en dólares cargado a mano manda sobre el convertido: es el de la
  // factura del proveedor. El convertido es una estimación que se rehace con
  // la cotización de hoy, así que para mercadería importada miente apenas se
  // mueve el dólar. La columna sale si hay alguna de las dos cosas.
  const hayCostoUsdCargado = filasConCostoUsd > 0;
  if (cotizacion || hayCostoUsdCargado) {
    cols.push({
      header: "Costo US$",
      value: (r) => {
        const guardado = n(r.costo_usd);
        if (guardado != null) return guardado;
        const c = n(r.costo_gs);
        return c == null || !cotizacion ? null : c / cotizacion;
      },
      formato: "usd", width: 13,
    });
  }
  cols.push(
    { header: "Precio minorista", value: (r) => n(r.precio_minorista), formato: "gs", width: 17 },
    { header: "Precio mayorista", value: (r) => n(r.precio_mayorista), formato: "gs", width: 17 },
    { header: "Precio distribuidor", value: (r) => n(r.precio_distribuidor), formato: "gs", width: 18 }
  );
  if (cotizacion) {
    cols.push({
      header: "Precio US$",
      value: (r) => { const p = n(r.precio_minorista); return p == null ? null : p / cotizacion; },
      formato: "usd", width: 13,
    });
  }
  cols.push(
    { header: "Existencia", value: (r) => Number(r.existencia) || 0, formato: "cantidad", suma: true, width: 12 },
    { header: "Stock mínimo", value: (r) => Number(r.stock_minimo) || 0, formato: "cantidad", width: 14 },
    { header: "Descuento", value: (r) => { const d = n(r.descuento_pct); return d == null ? null : d / 100; }, formato: "porcentaje", width: 12 },
    { header: "Valorizado Gs.", value: (r) => n(r.valorizado_gs), formato: "gs", suma: true, width: 18 }
  );
  return cols;
}

/**
 * GET /api/inventario/stock-con-precios/export
 *
 * Reemplaza el `stockconprecio-<mes>-<año>_<SUCURSAL>.xls` que el cliente
 * armaba a mano.
 *
 * ── POR QUÉ NO HAY CONSOLIDADO DE TODAS LAS SUCURSALES ────────────────────
 *   Sería lo natural para valorizar el inventario completo, pero el modelo de
 *   sucursales de esta instancia no lo permite: cada usuario pertenece a una
 *   sucursal y ve solo lo de ella, sin excepción para el administrador (ver
 *   `src/lib/sucursales/filtro.ts`, que lo deja escrito como decisión del
 *   cliente). Un consolidado acá sería la forma de saltear ese límite.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);

    const { filas, cotizacion } = await getStockConPrecios(schema, ctx.auth.empresa_id, sucursalId);
    const conCostoUsd = filas.filter((f) => n(f.costo_usd) != null).length;
    const [emp, suc] = await Promise.all([
      datosEmpresaInforme(ctx.auth.empresa_id),
      nombreSucursal(sucursalId),
    ]);

    const notas = [
      "La celda de costo vacía es un producto sin costo cargado, no un costo de cero.",
      "Valorizado = existencia × costo promedio.",
    ];
    notas.push(
      cotizacion
        ? `Columnas en dólares convertidas a ${new Intl.NumberFormat("es-PY").format(cotizacion)} Gs. por dólar (última cotización cargada).`
        : "Sin cotización cargada en Tipos de cambio: no se puede convertir."
    );
    if (conCostoUsd > 0) {
      notas.push(
        `${conCostoUsd} producto(s) tienen su costo en dólares cargado a mano: ahí se usa ese, no el convertido.`
      );
    }

    const buf = await buildXlsxEstilado(
      {
        nombre: "Stock con precios",
        filas,
        columnas: columnas(cotizacion, conCostoUsd),
        etiquetaTotales: `TOTALES (${filas.length} productos)`,
      },
      {
        ...emp,
        informe: "Stock con precios",
        sucursal: suc,
        notas,
      }
    );

    const sufijo = (suc ?? "sucursal").replace(/\s+/g, "-").toUpperCase();
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`stock-con-precios_${sufijo}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/stock-con-precios/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
