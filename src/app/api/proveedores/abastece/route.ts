import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";

/**
 * Qué abastece cada proveedor.
 *
 * GET  ?proveedor_id=…   — los rubros y artículos de ese proveedor.
 * GET  ?categoria_id=…   — al revés: qué proveedores traen ese rubro.
 * PUT  { proveedor_id, categoria_ids[], producto_ids[] } — reemplaza la lista.
 *
 * ── POR QUÉ EL PUT REEMPLAZA Y NO AGREGA ───────────────────────────────────
 *   La pantalla muestra casillas: lo que queda tildado ES la lista. Si el PUT
 *   agregara, destildar no haría nada y el proveedor acumularía rubros para
 *   siempre sin forma de sacárselos.
 */

const AVISO_71 = "Falta correr el script 71: la base todavía no guarda qué abastece cada proveedor.";
const falta71 = (m: string) => /proveedor_abastece/.test(m);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;
    const proveedorId = (sp.get("proveedor_id") ?? "").trim();
    const categoriaId = (sp.get("categoria_id") ?? "").trim();

    if (!proveedorId && !categoriaId) {
      return NextResponse.json(
        errorResponse("Indicá el proveedor o el rubro."),
        { status: 400 }
      );
    }

    try {
      // ── Qué proveedores traen un rubro ─────────────────────────────────
      if (categoriaId) {
        const filas = await traerTodas<Record<string, unknown>>((d, h) =>
          ctx.supabase
            .from("proveedor_abastece")
            .select("proveedor_id")
            .eq("empresa_id", empresaId)
            .eq("categoria_id", categoriaId)
            .order("id", { ascending: true })
            .range(d, h)
        );
        const ids = [...new Set(filas.map((f) => String(f.proveedor_id ?? "")).filter(Boolean))];
        let proveedores: Array<{ id: string; nombre: string; email: string | null; contacto: string | null }> = [];
        if (ids.length > 0) {
          const q = await ctx.supabase
            .from("proveedores")
            .select("id, nombre, email, contacto")
            .eq("empresa_id", empresaId)
            .in("id", ids.slice(0, 500))
            .order("nombre");
          if (q.error) throw new Error(q.error.message);
          proveedores = ((q.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
            id: String(p.id),
            nombre: String(p.nombre ?? ""),
            email: p.email ? String(p.email) : null,
            contacto: p.contacto ? String(p.contacto) : null,
          }));
        }
        return NextResponse.json(successResponse({ proveedores }));
      }

      // ── Qué abastece un proveedor ──────────────────────────────────────
      const filas = await traerTodas<Record<string, unknown>>((d, h) =>
        ctx.supabase
          .from("proveedor_abastece")
          .select("categoria_id, producto_id")
          .eq("empresa_id", empresaId)
          .eq("proveedor_id", proveedorId)
          .order("id", { ascending: true })
          .range(d, h)
      );
      const categoriaIds = filas.map((f) => f.categoria_id).filter(Boolean).map(String);
      const productoIds = filas.map((f) => f.producto_id).filter(Boolean).map(String);

      // Los nombres de los artículos los resuelve ACÁ, que es quien tiene los
      // ids: pedirle a /api/productos un parámetro nuevo solo para esto sería
      // tocar una ruta compartida por una necesidad de una pantalla.
      let productos: Array<{ id: string; nombre: string; sku: string | null }> = [];
      if (productoIds.length > 0) {
        const q = await ctx.supabase
          .from("productos")
          .select("id, nombre, sku")
          .eq("empresa_id", empresaId)
          .in("id", productoIds.slice(0, 500))
          .order("nombre");
        if (q.error) throw new Error(q.error.message);
        productos = ((q.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: p.sku ? String(p.sku) : null,
        }));
      }

      return NextResponse.json(successResponse({
        categoria_ids: categoriaIds,
        producto_ids: productoIds,
        productos,
        disponible: true,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!falta71(msg)) throw e;
      // Sin el script 71 la pantalla se abre igual, con la lista vacía y el
      // aviso: es preferible a un error que no dice qué hacer.
      return NextResponse.json(successResponse({
        categoria_ids: [], producto_ids: [], productos: [], proveedores: [],
        disponible: false, aviso: AVISO_71,
      }));
    }
  } catch (err) {
    console.error("[/api/proveedores/abastece GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar qué abastece el proveedor."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const proveedorId = String(body.proveedor_id ?? "").trim();
    if (!proveedorId) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });

    const limpiar = (v: unknown) =>
      Array.isArray(v)
        ? [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 500)
        : [];
    const categorias = limpiar(body.categoria_ids);
    const productos = limpiar(body.producto_ids);

    try {
      // Reemplazo completo: se borra lo que había y se escribe lo que quedó
      // tildado. Es lo que espera quien destilda una casilla.
      const del = await ctx.supabase
        .from("proveedor_abastece")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("proveedor_id", proveedorId);
      if (del.error) throw new Error(del.error.message);

      const filas = [
        ...categorias.map((id) => ({ empresa_id: empresaId, proveedor_id: proveedorId, categoria_id: id, producto_id: null })),
        ...productos.map((id) => ({ empresa_id: empresaId, proveedor_id: proveedorId, categoria_id: null, producto_id: id })),
      ];
      if (filas.length > 0) {
        const ins = await ctx.supabase.from("proveedor_abastece").insert(filas);
        if (ins.error) throw new Error(ins.error.message);
      }

      return NextResponse.json(successResponse({
        ok: true, rubros: categorias.length, articulos: productos.length,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (falta71(msg)) return NextResponse.json(errorResponse(AVISO_71), { status: 503 });
      throw e;
    }
  } catch (err) {
    console.error("[/api/proveedores/abastece PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar qué abastece el proveedor."), { status: 500 });
  }
}
