import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import {
  calcularCambio,
  resumirCambios,
  type ModoEstudio,
  type ProductoPrecio,
  type ReglaPrecio,
} from "@/lib/precios/estudio";
import { margenSobreVenta, remarcacionSobreCosto } from "@/lib/precios/margen";

/**
 * Estudio de precios (punto 10.5).
 *
 * GET  → los productos con su costo, precio, margen y remarcación, más el
 *        resumen por rubro (cuántos artículos, cuánto margen).
 * POST  → vista previa (`aplicar: false`) o aplicación de un cambio masivo.
 *
 * ── LA VISTA PREVIA NO ES UN LUJO ──────────────────────────────────────────
 *   Un cambio masivo toca cientos de precios de una vez y no hay "deshacer".
 *   Por eso el POST sin `aplicar` devuelve exactamente las filas que se van a
 *   escribir —antes, después y cuáles quedan bloqueadas— calculadas con la
 *   MISMA función que después guarda. Lo que se aprueba es lo que se guarda.
 *
 * ── SOLO ADMIN PARA APLICAR ────────────────────────────────────────────────
 *   Mirar el estudio lo puede hacer cualquiera que entre a Inventario: es
 *   información para decidir. Cambiar los precios de un rubro entero, no.
 */

const TOPE = 2000;

type FilaEstudio = {
  id: string;
  nombre: string;
  sku: string;
  costo: number;
  precio: number;
  stock: number;
  rubro_id: string | null;
  rubro: string;
  margen: number;
  remarcacion: number | null;
};

const n = (v: unknown) => Number(v) || 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const rubro = (sp.get("rubro") ?? "").trim();
    const q = (sp.get("q") ?? "").trim();
    // "sin_costo", "sin_precio", "bajo_costo" o vacío.
    const solo = (sp.get("solo") ?? "").trim();

    let qb = ctx.supabase
      .from("productos")
      .select("id, nombre, sku, costo_promedio, precio_venta, stock_actual, categoria_principal_id")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId);
    if (rubro === "__sin__") qb = qb.is("categoria_principal_id", null);
    else if (rubro) qb = qb.eq("categoria_principal_id", rubro);
    if (q) {
      const t = q.replace(/[(),]/g, " ").trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      if (t) qb = qb.or(`nombre.ilike.%${t}%,sku.ilike.%${t}%`);
    }

    const r = await qb.order("nombre", { ascending: true }).limit(TOPE);
    if (r.error) throw new Error(r.error.message);
    const crudas = (r.data ?? []) as unknown as Array<Record<string, unknown>>;

    // Nombres de rubro. Consulta aparte: la tabla de rubros es chica y un
    // embed que falle por una relación no declarada dejaría la pantalla vacía.
    const rubros = new Map<string, string>();
    const rq = await ctx.supabase
      .from("categorias_productos")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .limit(1000);
    for (const c of (rq.data ?? []) as unknown as Array<Record<string, unknown>>) {
      rubros.set(String(c.id), String(c.nombre ?? ""));
    }

    let filas: FilaEstudio[] = crudas.map((p) => {
      const costo = n(p.costo_promedio);
      const precio = n(p.precio_venta);
      const rid = p.categoria_principal_id == null ? null : String(p.categoria_principal_id);
      return {
        id: String(p.id),
        nombre: String(p.nombre ?? ""),
        sku: String(p.sku ?? ""),
        costo,
        precio,
        stock: n(p.stock_actual),
        rubro_id: rid,
        rubro: rid ? (rubros.get(rid) ?? "Sin rubro") : "Sin rubro",
        margen: margenSobreVenta(costo, precio),
        remarcacion: remarcacionSobreCosto(costo, precio),
      };
    });

    if (solo === "sin_costo") filas = filas.filter((f) => f.costo <= 0);
    else if (solo === "sin_precio") filas = filas.filter((f) => f.precio <= 0);
    // Vender por debajo del costo es el caso que hay que encontrar primero:
    // no es margen bajo, es perder plata en cada venta.
    else if (solo === "bajo_costo") filas = filas.filter((f) => f.costo > 0 && f.precio > 0 && f.precio < f.costo);

    // Resumen por rubro: cuántos artículos y con qué margen. El margen se
    // pondera por precio, no por cantidad: un tornillo no puede mover el
    // promedio igual que una chapa.
    const porRubro = new Map<string, { rubro_id: string | null; rubro: string; articulos: number; costo: number; precio: number; sin_costo: number; bajo_costo: number }>();
    for (const f of filas) {
      const k = f.rubro_id ?? "__sin__";
      const a = porRubro.get(k) ?? { rubro_id: f.rubro_id, rubro: f.rubro, articulos: 0, costo: 0, precio: 0, sin_costo: 0, bajo_costo: 0 };
      a.articulos += 1;
      a.costo += f.costo;
      a.precio += f.precio;
      if (f.costo <= 0) a.sin_costo += 1;
      if (f.costo > 0 && f.precio > 0 && f.precio < f.costo) a.bajo_costo += 1;
      porRubro.set(k, a);
    }

    return NextResponse.json(successResponse({
      filas,
      rubros: [...rubros.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      por_rubro: [...porRubro.values()]
        .map((a) => ({ ...a, margen: margenSobreVenta(a.costo, a.precio) }))
        .sort((a, b) => b.articulos - a.articulos),
      recortado: crudas.length >= TOPE,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/precios/estudio GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el estudio de precios."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const aplicar = b.aplicar === true;
    if (aplicar && !isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede cambiar precios en bloque."),
        { status: 403 }
      );
    }

    const modo = String(b.modo ?? "");
    if (modo !== "remarcacion" && modo !== "margen" && modo !== "ajuste") {
      return NextResponse.json(errorResponse("Modo desconocido."), { status: 400 });
    }
    const valor = Number(b.valor);
    if (!Number.isFinite(valor)) {
      return NextResponse.json(errorResponse("Poné el porcentaje."), { status: 400 });
    }
    const regla: ReglaPrecio = {
      modo: modo as ModoEstudio,
      valor,
      redondeo: Number.isFinite(Number(b.redondeo)) ? Number(b.redondeo) : 0,
    };

    // La selección: un rubro entero, o una lista de productos marcados.
    const ids = Array.isArray(b.producto_ids)
      ? (b.producto_ids as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, TOPE)
      : [];
    const rubro = String(b.rubro ?? "").trim();
    if (ids.length === 0 && !rubro) {
      return NextResponse.json(errorResponse("Elegí un rubro o marcá los productos."), { status: 400 });
    }

    let qb = ctx.supabase
      .from("productos")
      .select("id, nombre, sku, costo_promedio, precio_venta")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId);
    if (ids.length > 0) qb = qb.in("id", ids);
    else if (rubro === "__sin__") qb = qb.is("categoria_principal_id", null);
    else qb = qb.eq("categoria_principal_id", rubro);

    const r = await qb.limit(TOPE);
    if (r.error) throw new Error(r.error.message);
    const productos: ProductoPrecio[] = ((r.data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id),
      nombre: String(p.nombre ?? ""),
      sku: String(p.sku ?? ""),
      costo: n(p.costo_promedio),
      precio: n(p.precio_venta),
    }));

    const cambios = productos.map((p) => calcularCambio(p, regla));
    const resumen = resumirCambios(cambios);

    if (!aplicar) {
      return NextResponse.json(successResponse({ aplicado: false, cambios, resumen }));
    }

    // ── Aplicar ───────────────────────────────────────────────────────────
    //   Solo las filas que realmente cambian. Escribir un precio idéntico
    //   movería el updated_at de cientos de productos sin que nadie haya
    //   cambiado nada, y después no se sabría qué se tocó de verdad.
    const aEscribir = cambios.filter((c) => !c.bloqueo && c.precio_nuevo !== c.precio_actual);
    let escritos = 0;
    const fallidos: string[] = [];
    for (const c of aEscribir) {
      const up = await ctx.supabase
        .from("productos")
        .update({ precio_venta: c.precio_nuevo, updated_at: new Date().toISOString() })
        .eq("empresa_id", empresaId)
        .eq("id", c.id);
      if (up.error) fallidos.push(c.nombre || c.sku || c.id);
      else escritos += 1;
    }

    return NextResponse.json(successResponse({
      aplicado: true,
      escritos,
      fallidos,
      resumen,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/precios/estudio POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo procesar el cambio de precios."), { status: 500 });
  }
}
