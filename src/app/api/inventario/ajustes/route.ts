import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/inventario/ajustes — historial de ajustes de stock (punto 1.4).
 *
 * Es un listado APARTE de Movimientos: solo lo que cambió el stock sin una
 * compra ni una venta detrás. Mezclado con las ventas del día, un ajuste se
 * pierde; separado, se ve de una quién tocó el stock y por qué.
 *
 * QUÉ CUENTA COMO AJUSTE
 *   `origen = 'ajuste_manual'`, no `tipo = 'AJUSTE'`. La importación de Excel
 *   registra sus correcciones de stock como ENTRADA o SALIDA, y son ajustes
 *   igual. Filtrar por tipo las dejaría afuera.
 *
 * Parámetros, todos opcionales:
 *   desde, hasta — fechas (YYYY-MM-DD) en hora de Paraguay, inclusive ambas.
 *   q            — busca en producto, motivo, usuario o código.
 *   producto     — id de producto.
 *   categoria    — id de rubro: se resuelven primero los productos del rubro
 *                  y se filtra por esos ids, porque el movimiento guarda el
 *                  producto pero no su rubro.
 *   limit, offset
 */

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const OFFSET_PY = "-03:00";

const COLS =
  "id, numero_ajuste, fecha, tipo, origen, producto_id, producto_nombre, producto_sku, " +
  "cantidad, cantidad_delta, stock_antes, stock_despues, costo_unitario, referencia, usuario_nombre, created_by";

/** Columnas sin las que agregó el script 19, para una base todavía sin migrar. */
const COLS_VIEJAS =
  "id, fecha, tipo, origen, producto_id, producto_nombre, producto_sku, " +
  "cantidad, costo_unitario, referencia, usuario_nombre, created_by";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const desde = (sp.get("desde") ?? "").trim();
    const hasta = (sp.get("hasta") ?? "").trim();
    const q = (sp.get("q") ?? "").trim();
    const productoId = (sp.get("producto") ?? "").trim();
    const categoriaId = (sp.get("categoria") ?? "").trim();
    const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "100", 10) || 100));
    const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);

    // El rubro vive en el producto, no en el movimiento: primero se resuelven
    // los ids del rubro y después se filtra por ellos. Un `in` con los ids es
    // más barato que traer todos los ajustes y descartarlos en el navegador,
    // que además rompería la paginación.
    let idsDelRubro: string[] | null = null;
    if (categoriaId) {
      const { data: prods } = await aplicarFiltroSucursal(
        ctx.supabase
          .from("productos")
          .select("id")
          .eq("empresa_id", empresaId)
          .eq("categoria_principal_id", categoriaId)
          .limit(5000),
        sucursalId
      );
      idsDelRubro = ((prods ?? []) as Array<{ id: string }>).map((x) => x.id);
    }

    const filtros = <T,>(base: T, conCodigo: boolean): T => {
      let x = base as unknown as {
        eq(c: string, v: string): typeof x;
        gte(c: string, v: string): typeof x;
        lte(c: string, v: string): typeof x;
        or(f: string): typeof x;
        in(c: string, v: string[]): typeof x;
        order(c: string, o: { ascending: boolean }): typeof x;
        range(a: number, b: number): typeof x;
      };
      x = x.eq("origen", "ajuste_manual");
      // El día "hasta" entra entero: quien filtra 01/10 al 31/10 espera que el
      // 31 esté incluido, no que corte a la medianoche del 30.
      if (desde) x = x.gte("fecha", `${desde}T00:00:00${OFFSET_PY}`);
      if (hasta) x = x.lte("fecha", `${hasta}T23:59:59.999${OFFSET_PY}`);
      if (productoId) x = x.eq("producto_id", productoId);
      if (idsDelRubro) x = x.in("producto_id", idsDelRubro.length ? idsDelRubro : ["00000000-0000-0000-0000-000000000000"]);
      if (q) {
        const t2 = q.replace(/[(),]/g, " ").trim().replace(/[%_\\]/g, (m) => `\\${m}`);
        if (t2) {
          const campos = [
            `producto_nombre.ilike.%${t2}%`,
            `producto_sku.ilike.%${t2}%`,
            `referencia.ilike.%${t2}%`,
            `usuario_nombre.ilike.%${t2}%`,
          ];
          // Sin la migración, `numero_ajuste` no existe: nombrarla en el filtro
          // volvería a romper la consulta que justamente es el reintento.
          if (conCodigo) campos.push(`numero_ajuste.ilike.%${t2}%`);
          x = x.or(campos.join(","));
        }
      }
      return x.order("fecha", { ascending: false }).range(offset, offset + limit - 1) as unknown as T;
    };

    const base = (cols: string) =>
      aplicarFiltroSucursal(
        ctx.supabase
          .from("movimientos_inventario")
          .select(cols, { count: "exact" })
          .eq("empresa_id", empresaId),
        sucursalId
      );

    // El script 19 puede no estar corrido: se reintenta sin esas columnas en
    // vez de dejar la pantalla rota esperando una migración.
    let migrado = true;
    let r = await filtros(base(COLS), true);
    if (r.error && /numero_ajuste|cantidad_delta|stock_antes|stock_despues/.test(r.error.message ?? "")) {
      migrado = false;
      r = (await filtros(base(COLS_VIEJAS), false)) as typeof r;
    }
    if (r.error) throw new Error(r.error.message);

    const ajustes = ((r.data ?? []) as unknown as Array<Record<string, unknown>>).map((m) => {
      const cantidad = Number(m.cantidad) || 0;
      const deltaCrudo = m.cantidad_delta;
      // El delta es la fuente de verdad. Si no está (ajuste viejo con motivo
      // escrito a mano), se deduce del tipo; y si el tipo tampoco lo dice, se
      // devuelve null y la pantalla muestra que el signo se desconoce en vez
      // de inventar uno.
      const delta =
        deltaCrudo != null && Number.isFinite(Number(deltaCrudo))
          ? Number(deltaCrudo)
          : String(m.tipo) === "ENTRADA" ? cantidad
          : String(m.tipo) === "SALIDA" ? -cantidad
          : null;

      return {
        id: String(m.id),
        numero: m.numero_ajuste == null ? null : String(m.numero_ajuste),
        fecha: String(m.fecha ?? ""),
        producto_id: m.producto_id == null ? null : String(m.producto_id),
        producto_nombre: String(m.producto_nombre ?? ""),
        producto_sku: m.producto_sku == null ? null : String(m.producto_sku),
        cantidad,
        delta,
        stock_antes: m.stock_antes == null ? null : Number(m.stock_antes),
        stock_despues: m.stock_despues == null ? null : Number(m.stock_despues),
        costo_unitario: Number(m.costo_unitario) || 0,
        motivo: m.referencia == null ? "" : String(m.referencia),
        usuario: m.usuario_nombre == null ? "" : String(m.usuario_nombre),
      };
    });

    const sumaMas = ajustes.reduce((s, a) => s + (a.delta != null && a.delta > 0 ? a.delta : 0), 0);
    const sumaMenos = ajustes.reduce((s, a) => s + (a.delta != null && a.delta < 0 ? a.delta : 0), 0);

    return NextResponse.json(successResponse({
      ajustes,
      total: r.count ?? ajustes.length,
      limit,
      offset,
      migrado,
      resumen: {
        unidades_sumadas: sumaMas,
        unidades_restadas: Math.abs(sumaMenos),
        sin_signo: ajustes.filter((a) => a.delta == null).length,
      },
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/ajustes]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo cargar el historial de ajustes."),
      { status: 500 }
    );
  }
}
