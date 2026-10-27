import { NextRequest, NextResponse } from "next/server";
import { firmarProductoImagenes } from "@/lib/inventario/imagen-storage";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperCodigoBarras } from "@/lib/text/normalize";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { requireAdminProductos } from "@/lib/productos/require-admin-productos";
import { applyTokenSearch } from "@/lib/productos/token-search";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * GET/POST de productos via PostgREST (sin pool PG directo) — compatible Hostinger.
 */

const PRODUCTO_COLS =
  "id, empresa_id, nombre, sku, costo_promedio, precio_venta, stock_actual, stock_minimo, " +
  "unidad_medida, metodo_valuacion, activo, created_at, updated_at, " +
  "codigo_barras, codigo_barras_interno, imagen_path, imagen_url, " +
  "categoria_principal_id, ubicacion_principal_id, proveedor_principal_id, " +
  "es_vendible, es_insumo, controla_stock, valorizado, unidad_compra, unidad_receta, " +
  "factor_compra_receta, tiempo_prep_minutos, descripcion, precio_mayorista, cantidad_minima_mayorista, precio_distribuidor, modo_receta, tipo_iva, controla_lote, " +
  // Ficha en dolares y descuentos (script 32).
  "costo_usd, markup_pct, descuento_pct, " +
  // Precio de lista en dolares (script 37).
  "precio_usd";

/**
 * Las mismas columnas, sin las que agregan los scripts que pueden no estar
 * corridos todavía.
 *
 * ── POR QUÉ EXISTE ESTO ───────────────────────────────────────────────────
 *   Pedir una columna que la base no tiene no devuelve esa columna en null:
 *   PostgREST rechaza la consulta entera. Y como de esta ruta cuelga todo el
 *   inventario —Caja, Presupuestos, Compras, Transferencias—, nombrar acá una
 *   columna de un script sin correr deja al sistema sin un solo producto, con
 *   un "no se encontraron productos" que parece que se borró el catálogo.
 *
 *   Pasó: se agregó `precio_usd` y, hasta correr el 37, no se veía nada en
 *   ninguna pantalla. Una función nueva no puede costar el inventario entero.
 */
const PRODUCTO_COLS_BASE =
  "id, empresa_id, nombre, sku, costo_promedio, precio_venta, stock_actual, stock_minimo, " +
  "unidad_medida, metodo_valuacion, activo, created_at, updated_at, " +
  "codigo_barras, codigo_barras_interno, imagen_path, imagen_url, " +
  "categoria_principal_id, ubicacion_principal_id, proveedor_principal_id, " +
  "es_vendible, es_insumo, controla_stock, valorizado, unidad_compra, unidad_receta, " +
  "factor_compra_receta, tiempo_prep_minutos, descripcion, precio_mayorista, cantidad_minima_mayorista, precio_distribuidor, modo_receta, tipo_iva, controla_lote";

/** ¿El error es "falta una columna de un script que no se corrió"? */
function esColumnaFaltante(msg: string): boolean {
  return /column .* does not exist|42703/i.test(msg)
    && /costo_usd|markup_pct|descuento_pct|precio_usd/.test(msg);
}

function toNumber(v: unknown): unknown {
  return typeof v === "string" ? Number(v) : v;
}
function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rowToApi(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    costo_promedio: toNumber(r.costo_promedio),
    precio_venta: toNumber(r.precio_venta),
    stock_actual: toNumber(r.stock_actual),
    stock_minimo: toNumber(r.stock_minimo),
    factor_compra_receta: toNumber(r.factor_compra_receta),
    precio_mayorista: r.precio_mayorista != null ? toNumber(r.precio_mayorista) : null,
    cantidad_minima_mayorista: r.cantidad_minima_mayorista != null ? toNumber(r.cantidad_minima_mayorista) : null,
    precio_distribuidor: r.precio_distribuidor != null ? toNumber(r.precio_distribuidor) : null,
    costo_usd: r.costo_usd != null ? toNumber(r.costo_usd) : null,
    markup_pct: r.markup_pct != null ? toNumber(r.markup_pct) : null,
    descuento_pct: r.descuento_pct != null ? toNumber(r.descuento_pct) : 0,
  };
}

async function existsId(
  sb: AppSupabaseClient,
  table: "categorias_productos" | "inventario_ubicaciones" | "proveedores",
  empresaId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * GET /api/productos
 *
 * Productos de la sucursal del usuario. Soporta paginación y filtros server-side:
 *  - q=<text>          Búsqueda por tokens (cada palabra, en cualquier orden) sobre nombre o sku
 *  - categoria=<uuid>  Filtra por categoria_principal_id. "__sin__" = sin rubro.
 *  - limit=<n>         Tamaño de página (max 500). 0 o ausente = sin paginar.
 *  - offset=<n>        Offset de paginación.
 *
 * Respuesta: { productos: [...], total, limit, offset }
 */
/**
 * Completa `imagen_url` con una URL firmada a partir de `imagen_path`.
 *
 * El bucket de imágenes es privado, así que la columna `imagen_url` queda en
 * null a propósito y la URL se firma al momento de mostrarla. El listado no lo
 * hacía: todos los productos salían sin miniatura aunque tuvieran la imagen
 * subida.
 */
async function conImagenesFirmadas(
  supabase: Parameters<typeof firmarProductoImagenes>[0],
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const firmas = await firmarProductoImagenes(
    supabase,
    rows.map((r) => (typeof r.imagen_path === "string" ? r.imagen_path : null))
  );
  if (firmas.size === 0) return rows;
  return rows.map((r) => {
    if (r.imagen_url) return r;
    const path = typeof r.imagen_path === "string" ? r.imagen_path : null;
    const url = path ? firmas.get(path) : null;
    return url ? { ...r, imagen_url: url } : r;
  });
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { searchParams } = new URL(request.url);

    const q = searchParams.get("q")?.trim() ?? "";
    const categoria = searchParams.get("categoria");
    // Default sin paginar para no romper a los callers que esperan la lista
    // completa (ventas, compras, recetas); el listado de inventario pide límite.
    const limitParam = searchParams.get("limit");
    const limitRaw = limitParam !== null ? parseInt(limitParam, 10) : 0;
    const offsetRaw = parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(0, limitRaw), 500) : 0;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    /** Se re-arma por cada chunk: los builders de supabase-js no se reutilizan
     *  una vez ejecutados. El filtro de sucursal va siempre. */
    const buildBase = (cols: string = PRODUCTO_COLS) => {
      let base = aplicarFiltroSucursal(
        ctx.supabase
          .from("productos")
          // `planned` devuelve la ESTIMACIÓN del planner de Postgres, no el
          // conteo real: en tablas chicas o recién cargadas (sin ANALYZE) da
          // cualquier número, y la pantalla mostraba "Mostrando 1-1 de 1"
          // teniendo 5 productos a la vista. `exact` cuenta de verdad.
          .select(cols, { count: "exact" })
          .eq("empresa_id", ctx.auth.empresa_id)
          .eq("activo", true),
        exigirSucursal(ctx.auth.sucursal_id)
      );
      if (q) base = applyTokenSearch(base, q, ["nombre", "sku"]);
      if (categoria === "__sin__") base = base.is("categoria_principal_id", null);
      else if (categoria) base = base.eq("categoria_principal_id", categoria);
      return base.order("nombre");
    };

    if (limit > 0) {
      let { data, error, count } = await buildBase().range(offset, offset + limit - 1);
      if (error && esColumnaFaltante(error.message ?? "")) {
        ({ data, error, count } = await buildBase(PRODUCTO_COLS_BASE).range(offset, offset + limit - 1));
      }
      if (error) throw new Error(error.message);
      const rows = await conImagenesFirmadas(
        ctx.supabase,
        ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToApi)
      );
      return NextResponse.json(
        successResponse({ productos: rows, total: count ?? 0, limit, offset })
      );
    }

    // Sin paginar: PostgREST corta en 1000 filas aunque se pida un range mayor,
    // así que se traen lotes hasta agotar.
    const CHUNK = 1000;
    const MAX_TOTAL = 100_000;
    const allRows: Record<string, unknown>[] = [];
    let totalCount = 0;
    let cols = PRODUCTO_COLS;
    for (let from = 0; from < MAX_TOTAL; from += CHUNK) {
      let { data, error, count } = await buildBase(cols).range(from, from + CHUNK - 1);
      if (error && esColumnaFaltante(error.message ?? "")) {
        cols = PRODUCTO_COLS_BASE;
        ({ data, error, count } = await buildBase(cols).range(from, from + CHUNK - 1));
      }
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      if (batch.length === 0) break;
      allRows.push(...batch);
      if (count != null) totalCount = count;
      if (batch.length < CHUNK) break;
    }
    const rows = await conImagenesFirmadas(ctx.supabase, allRows.map(rowToApi));
    return NextResponse.json(
      successResponse({ productos: rows, total: totalCount || rows.length, limit, offset })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/productos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los productos."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Crear productos: solo administradores. El personal de sucursal tiene
    // acceso de lectura (GET), pero no puede dar de alta productos.
    const guard = await requireAdminProductos(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;
    const empresaId = ctx.auth.empresa_id;
    const sb = ctx.supabase;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const nombre = normalizeUpperText(body.nombre);
    let sku = normalizeUpperText(body.sku);
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });

    // SKU es opcional: si no viene, auto-generamos según el tipo (REV/MEN/MP).
    if (!sku) {
      const tg = typeof body.tipo_gastro === "string" ? body.tipo_gastro.toLowerCase() : "";
      const esInsumoBody = tg === "materia" || body.es_insumo === true;
      const esMenuBody = tg === "menu" || (body.modo_receta && String(body.modo_receta).toLowerCase() !== "ninguno");
      const prefijo = esInsumoBody ? "MP" : esMenuBody ? "MEN" : "REV";
      const { data: existentes } = await aplicarFiltroSucursal(
        sb.from("productos").select("sku").eq("empresa_id", empresaId).ilike("sku", `${prefijo}-%`),
        exigirSucursal(ctx.auth.sucursal_id)
      );
      let maxN = 0;
      for (const r of (existentes ?? []) as Array<{ sku: string | null }>) {
        const m = r.sku ? /^([A-Z]+)-(\d+)$/.exec(r.sku) : null;
        if (m && m[1] === prefijo) maxN = Math.max(maxN, parseInt(m[2], 10) || 0);
      }
      sku = `${prefijo}-${String(maxN + 1).padStart(4, "0")}`;
    }

    const codigoBarras = normalizeUpperCodigoBarras(body.codigo_barras);
    const codigoBarrasInterno = codigoBarras != null && body.codigo_barras_interno === true;
    const stockActual = Number(body.stock_actual ?? 0) || 0;
    const costoPromedio = Number(body.costo_promedio ?? 0) || 0;
    const stockMinimo = Number(body.stock_minimo ?? 0) || 0;
    const precioVenta = Number(body.precio_venta ?? 0) || 0;
    const unidadMedida = normalizeUpperText(body.unidad_medida) || "UNIDAD";
    const metodoValuacion =
      body.metodo_valuacion === "FIFO" || body.metodo_valuacion === "LIFO"
        ? (body.metodo_valuacion as "FIFO" | "LIFO")
        : "CPP";

    const categoriaPrincipalId = body.categoria_principal_id ? String(body.categoria_principal_id) : null;
    const ubicacionPrincipalId = body.ubicacion_principal_id ? String(body.ubicacion_principal_id) : null;
    const proveedorPrincipalId = body.proveedor_principal_id ? String(body.proveedor_principal_id) : null;

    // `tipo_gastro` (opcional) — si viene, es AUTORITATIVO sobre los flags
    // es_vendible/es_insumo/controla_stock. Blinda el clasificador para que el
    // producto aparezca en la pestaña correcta del listado (Reventa / Menú /
    // Materia prima) sin depender de que el cliente sincronice los flags.
    const tipoGastro = typeof body.tipo_gastro === "string" ? body.tipo_gastro.toLowerCase() : "";
    let esVendible = typeof body.es_vendible === "boolean" ? body.es_vendible : undefined;
    let esInsumo = typeof body.es_insumo === "boolean" ? body.es_insumo : undefined;
    let controlaStock = typeof body.controla_stock === "boolean" ? body.controla_stock : undefined;
    if (tipoGastro === "reventa") {
      esVendible = true; esInsumo = false; controlaStock = true;
    } else if (tipoGastro === "menu") {
      esVendible = true; esInsumo = false; controlaStock = false;
    } else if (tipoGastro === "materia") {
      esVendible = false; esInsumo = true; controlaStock = true;
    }
    const controlaLote = typeof body.controla_lote === "boolean" ? body.controla_lote : undefined;
    const valorizado = typeof body.valorizado === "boolean" ? body.valorizado : undefined;
    const unidadCompra =
      typeof body.unidad_compra === "string"
        ? body.unidad_compra.trim() || null
        : body.unidad_compra === null
        ? null
        : undefined;
    const unidadReceta =
      typeof body.unidad_receta === "string"
        ? body.unidad_receta.trim() || null
        : body.unidad_receta === null
        ? null
        : undefined;
    const factorCompraReceta =
      typeof body.factor_compra_receta === "number" && body.factor_compra_receta > 0
        ? body.factor_compra_receta
        : undefined;
    const tiempoPrepMinutos =
      typeof body.tiempo_prep_minutos === "number" && body.tiempo_prep_minutos >= 0
        ? Math.floor(body.tiempo_prep_minutos)
        : undefined;

    // Validar ownership de relaciones opcionales
    if (categoriaPrincipalId && !(await existsId(sb, "categorias_productos", empresaId, categoriaPrincipalId))) {
      return NextResponse.json(errorResponse("El rubro seleccionado no existe."), { status: 400 });
    }
    if (ubicacionPrincipalId && !(await existsId(sb, "inventario_ubicaciones", empresaId, ubicacionPrincipalId))) {
      return NextResponse.json(errorResponse("La ubicación seleccionada no existe."), { status: 400 });
    }
    if (proveedorPrincipalId && !(await existsId(sb, "proveedores", empresaId, proveedorPrincipalId))) {
      return NextResponse.json(errorResponse("El proveedor seleccionado no existe."), { status: 400 });
    }

    // Insert principal
    const insertPayload: Record<string, unknown> = {
      empresa_id: empresaId,
      sucursal_id: exigirSucursal(ctx.auth.sucursal_id),
      nombre,
      sku,
      costo_promedio: costoPromedio,
      precio_venta: precioVenta,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      unidad_medida: unidadMedida,
      metodo_valuacion: metodoValuacion,
      codigo_barras: codigoBarras,
      codigo_barras_interno: codigoBarras ? codigoBarrasInterno : false,
      categoria_principal_id: categoriaPrincipalId,
      ubicacion_principal_id: ubicacionPrincipalId,
      proveedor_principal_id: proveedorPrincipalId,
    };
    if (esVendible !== undefined) insertPayload.es_vendible = esVendible;
    if (esInsumo !== undefined) insertPayload.es_insumo = esInsumo;
    if (controlaStock !== undefined) insertPayload.controla_stock = controlaStock;
    if (controlaLote !== undefined) insertPayload.controla_lote = controlaLote;
    if (valorizado !== undefined) insertPayload.valorizado = valorizado;
    if (unidadCompra !== undefined) insertPayload.unidad_compra = unidadCompra;
    if (unidadReceta !== undefined) insertPayload.unidad_receta = unidadReceta;
    if (factorCompraReceta !== undefined) insertPayload.factor_compra_receta = factorCompraReceta;
    if (tiempoPrepMinutos !== undefined) insertPayload.tiempo_prep_minutos = tiempoPrepMinutos;
    const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim() || null : (body.descripcion === null ? null : undefined);
    if (descripcion !== undefined) insertPayload.descripcion = descripcion;
    insertPayload.precio_mayorista = toNumberOrNull(body.precio_mayorista);
    insertPayload.cantidad_minima_mayorista = toNumberOrNull(body.cantidad_minima_mayorista);
    insertPayload.precio_distribuidor = toNumberOrNull(body.precio_distribuidor);
    // Ficha en dolares y descuentos. El costo en dolares queda null cuando no
    // se carga: un 0 pasaria el CHECK de la base como si fuera un costo real.
    insertPayload.costo_usd = toNumberOrNull(body.costo_usd);
    insertPayload.markup_pct = toNumberOrNull(body.markup_pct);
    insertPayload.descuento_pct = toNumberOrNull(body.descuento_pct) ?? 0;
    if (body.modo_receta === "produccion_previa" || body.modo_receta === "preparado_al_vender") {
      insertPayload.modo_receta = body.modo_receta;
    }
    if (body.tipo_iva === "EXENTA" || body.tipo_iva === "5%" || body.tipo_iva === "10%") {
      insertPayload.tipo_iva = body.tipo_iva;
    }

    // Mismo respaldo que en el GET: si faltan las columnas de los scripts
    // 32/37, se da de alta el producto sin ellas en vez de no dejar crear
    // ninguno hasta que alguien corra una migración.
    let ins = await sb.from("productos").insert(insertPayload).select(PRODUCTO_COLS).single();
    if (ins.error && esColumnaFaltante(ins.error.message ?? "")) {
      const sinNuevas = { ...insertPayload };
      for (const k of ["costo_usd", "markup_pct", "descuento_pct", "precio_usd"]) delete sinNuevas[k];
      ins = await sb.from("productos").insert(sinNuevas).select(PRODUCTO_COLS_BASE).single();
    }
    if (ins.error) {
      const msg = ins.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        if (/sku/i.test(msg)) {
          return NextResponse.json(errorResponse("Ya existe un producto con ese SKU."), { status: 409 });
        }
        if (/codigo_barras|barras/i.test(msg)) {
          return NextResponse.json(errorResponse("Ya existe un producto con ese código de barras."), {
            status: 409,
          });
        }
        return NextResponse.json(errorResponse("Ya existe un producto con datos únicos en conflicto."), {
          status: 409,
        });
      }
      console.error("[/api/productos POST] insert", msg);
      return NextResponse.json(errorResponse("No se pudo guardar el producto."), { status: 500 });
    }
    const row = ins.data as unknown as Record<string, unknown>;
    const productoId = String(row.id);

    // Movimiento de inventario inicial — solo si controla_stock=true Y stock>0
    let movWarning: string | null = null;
    const controlaStockFinal = row.controla_stock !== false;
    if (stockActual > 0 && controlaStockFinal) {
      // `fecha` y la firma del usuario van explícitas: el listado de movimientos
      // ordena por `fecha`, así que sin ella la entrada inicial no aparecía
      // arriba y parecía que el historial no se actualizaba al dar de alta un
      // producto con stock.
      const firma = await firmaUsuario(sb, ctx.auth);
      const movIns = await sb.from("movimientos_inventario").insert({
        empresa_id: empresaId,
        sucursal_id: exigirSucursal(ctx.auth.sucursal_id),
        producto_id: productoId,
        producto_nombre: nombre,
        producto_sku: sku,
        tipo: "ENTRADA",
        cantidad: stockActual,
        costo_unitario: costoPromedio,
        origen: "inventario_inicial",
        referencia: "Stock inicial del alta del producto",
        fecha: new Date().toISOString(),
        created_by: firma.id,
        usuario_nombre: firma.nombre,
      });
      if (movIns.error) {
        console.error("[/api/productos POST] inventario_inicial", movIns.error.message);
        movWarning = "El producto se guardó pero no se pudo registrar el movimiento inicial de stock.";
      }
    }

    // Rubro principal: insertar en puente producto_categorias
    if (categoriaPrincipalId) {
      const pc = await sb.from("producto_categorias").insert({
        empresa_id: empresaId,
        sucursal_id: exigirSucursal(ctx.auth.sucursal_id),
        producto_id: productoId,
        categoria_id: categoriaPrincipalId,
        es_principal: true,
      });
      if (pc.error) {
        console.error("[/api/productos POST] producto_categorias", pc.error.message);
      }
    }

    // Stock por ubicación (solo si aplica)
    if (ubicacionPrincipalId && stockActual > 0 && controlaStockFinal) {
      const su = await sb.from("inventario_stock_ubicacion").insert({
        empresa_id: empresaId,
        producto_id: productoId,
        ubicacion_id: ubicacionPrincipalId,
        stock_actual: stockActual,
        es_principal: true,
      });
      if (su.error) {
        console.error("[/api/productos POST] inventario_stock_ubicacion", su.error.message);
      }
    }

    return NextResponse.json(successResponse({ producto: rowToApi(row), warning: movWarning }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/productos POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo guardar el producto. Revisá los datos e intentá nuevamente."),
      { status: 500 }
    );
  }
}
