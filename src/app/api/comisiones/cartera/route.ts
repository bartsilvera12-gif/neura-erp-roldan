import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { enCartera, diasRestantesCartera } from "@/lib/comisiones/calculo";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * Cuántos clientes libres se listan para asignar. El padrón tiene 21.000:
 * antes se traían los primeros 1000 por nombre (el corte de PostgREST) y con
 * eso se armaba todo —los totales decían "1000 clientes" y un cliente en
 * cartera que no cayera entre esos mil no aparecía en ningún lado—.
 *
 * Ahora: los totales se cuentan sobre el padrón entero, los clientes en
 * cartera se listan todos, y de los libres se muestran los que coinciden con
 * la búsqueda (o los primeros, sin búsqueda).
 */
const TOPE_LIBRES = 200;

/** `.in("id", ids)` con miles de ids no entra en la URL. */
const TANDA_IDS = 100;

const FALTA_64 = "Falta correr 64_cartera_por_sucursal.sql en la base.";

function esTablaFaltante(msg: string): boolean {
  return /cliente_cartera/.test(msg)
    && /does not exist|42P01|PGRST205|schema cache/i.test(msg);
}

/** El nombre de la sucursal, para que la pantalla diga de cuál es la cartera. */
async function nombreDeSucursal(
  sb: NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuthWithRol>>>["supabase"],
  empresaId: string,
  sucursalId: string
): Promise<string | null> {
  const r = await sb
    .from("sucursales")
    .select("nombre")
    .eq("empresa_id", empresaId)
    .eq("id", sucursalId)
    .maybeSingle();
  if (r.error) return null;
  const n = (r.data as { nombre?: string } | null)?.nombre;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/**
 * Cartera por vendedor (puntos 4.1 y 4.3).
 *
 * GET  → clientes con su vendedor y si siguen en cartera.
 * POST → asignar un vendedor a un cliente, o liberarlo a mano.
 *
 * ── LA LIBERACIÓN SE CALCULA, NO SE BORRA ──────────────────────────────────
 *   El pedido dice "si no concreta otra operación en ese plazo, liberarlo
 *   automáticamente". Un proceso que vacíe el vendedor a los 30 días cumpliría
 *   al pie de la letra y perdería el dato de quién lo venía atendiendo —
 *   justo lo que sirve para reasignarlo o para discutir una comisión del mes
 *   pasado.
 *
 *   Acá el cliente queda LIBRE solo cuando pasan los días, sin borrar nada. Si
 *   vuelve a comprar, vuelve a su cartera sin que nadie toque nada.
 *
 * ── SOBRE EL REEMPLAZO (4.3) ───────────────────────────────────────────────
 *   "Si un vendedor está ausente, otro puede atender su cartera. La venta y su
 *   comisión corresponden a quien cierre la operación, pero el cliente
 *   permanece en la cartera original."
 *
 *   Por eso vender a un cliente NO cambia su `vendedor_usuario_id`: la venta
 *   guarda su propio vendedor (`ventas.vendedor_usuario_id`) y de ahí sale la
 *   comisión, mientras el cliente sigue en la cartera de siempre.
 *
 *   La venta de un reemplazo SÍ renueva los días de cartera. La alternativa
 *   —que solo cuenten las ventas del titular— le haría perder la cartera por
 *   estar enfermo, que es lo contrario de lo que el punto busca.
 *
 * ── UNA CARTERA POR SUCURSAL (script 64) ───────────────────────────────────
 *   La cartera vivía en `clientes.vendedor_usuario_id`: una sola respuesta
 *   por cliente para toda la empresa. El que atiende a ese cliente en Casa
 *   Central y el que lo atiende en la otra sucursal son dos personas
 *   distintas, cada una con su comisión y su plazo corriendo por separado, y
 *   con una sola columna el segundo le pisaba la cartera al primero.
 *
 *   Ahora vive en `cliente_cartera`, con una fila por cliente y sucursal. Sin
 *   fila, el cliente está LIBRE en esa sucursal. Esta ruta trabaja siempre
 *   sobre la sucursal del usuario: nadie reasigna la cartera de otra casa sin
 *   darse cuenta.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;
    const sp = new URL(request.url).searchParams;
    const vendedorFiltro = (sp.get("vendedor") ?? "").trim();
    const soloLibres = sp.get("libres") === "1";
    const sucursalId = exigirSucursal(auth.sucursal_id);

    const cfg = await supabase
      .from("comisiones_config").select("dias_cartera")
      .eq("empresa_id", auth.empresa_id).maybeSingle();
    const diasCartera = Number((cfg.data as { dias_cartera?: number } | null)?.dias_cartera) || 30;

    const buscar = (sp.get("q") ?? "").trim().replace(/[(),]/g, " ").replace(/[%_\\]/g, (m) => `\\${m}`).trim();

    const totalQ = await supabase
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null);
    if (totalQ.error) throw new Error(totalQ.error.message);
    const totalClientes = totalQ.count ?? 0;

    /**
     * La cartera de ESTA sucursal. Sin fila, el cliente está libre acá.
     *
     * Se trae entera y se cruza en memoria en vez de con un embed: la tabla
     * tiene una fila por cliente asignado, no por cliente, así que es la
     * lista corta de las dos.
     */
    const cQ = await supabase
      .from("cliente_cartera")
      .select("cliente_id, vendedor_usuario_id, vendedor_nombre, cartera_desde")
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId);
    if (cQ.error) {
      if (esTablaFaltante(cQ.error.message)) {
        return NextResponse.json(errorResponse(FALTA_64), { status: 400 });
      }
      throw new Error(cQ.error.message);
    }
    const cartera = new Map<string, { vendedor_usuario_id: string | null; vendedor_nombre: string | null; cartera_desde: string | null }>();
    for (const f of (cQ.data ?? []) as Array<Record<string, unknown>>) {
      cartera.set(String(f.cliente_id), {
        vendedor_usuario_id: f.vendedor_usuario_id == null ? null : String(f.vendedor_usuario_id),
        vendedor_nombre: f.vendedor_nombre == null ? null : String(f.vendedor_nombre),
        cartera_desde: f.cartera_desde == null ? null : String(f.cartera_desde),
      });
    }

    const usuarios = await supabase
      .from("usuarios").select("id, nombre, email")
      .eq("empresa_id", auth.empresa_id).order("nombre");
    const nombreUsuario = new Map<string, string>();
    for (const u of (usuarios.data ?? []) as Array<Record<string, unknown>>) {
      nombreUsuario.set(String(u.id), String(u.nombre ?? u.email ?? ""));
    }

    // Clientes a listar: todos los que tienen fila de cartera acá, más los
    // libres que pide la búsqueda (o los primeros por nombre, sin búsqueda).
    type ClienteFila = Record<string, unknown>;
    const asignados: ClienteFila[] = [];
    const idsCartera = [...cartera.keys()];
    for (let i = 0; i < idsCartera.length; i += TANDA_IDS) {
      const t = await supabase
        .from("clientes")
        .select("id, nombre, empresa, nombre_contacto")
        .eq("empresa_id", auth.empresa_id)
        .is("deleted_at", null)
        .in("id", idsCartera.slice(i, i + TANDA_IDS));
      if (t.error) throw new Error(t.error.message);
      asignados.push(...((t.data ?? []) as ClienteFila[]));
    }
    let libresQ = supabase
      .from("clientes")
      .select("id, nombre, empresa, nombre_contacto")
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null);
    if (buscar) libresQ = libresQ.or(`nombre.ilike.%${buscar}%,empresa.ilike.%${buscar}%,ruc.ilike.%${buscar}%`);
    const lq = await libresQ.order("nombre").limit(TOPE_LIBRES + idsCartera.length);
    if (lq.error) throw new Error(lq.error.message);
    const libresCrudos = ((lq.data ?? []) as ClienteFila[]).filter((c) => !cartera.has(String(c.id)));

    const ahora = new Date();
    const aFila = (c: ClienteFila) => {
      const id = String(c.id);
      const en = cartera.get(id);
      const desde = en?.cartera_desde ?? null;
      const vendedorId = en?.vendedor_usuario_id ?? null;
      const activa = Boolean(vendedorId) && enCartera(desde, diasCartera, ahora);
      return {
        id,
        nombre: String(c.nombre ?? c.empresa ?? c.nombre_contacto ?? ""),
        vendedor_id: vendedorId,
        vendedor_nombre: vendedorId
          ? nombreUsuario.get(vendedorId) ?? en?.vendedor_nombre ?? ""
          : null,
        cartera_desde: desde,
        en_cartera: activa,
        dias_restantes: activa ? diasRestantesCartera(desde, diasCartera, ahora) : 0,
      };
    };
    const filasAsignadas = asignados.map(aFila);
    const coincide = (n: string) => !buscar || n.toLowerCase().includes(buscar.toLowerCase());
    const filas = [
      ...filasAsignadas.filter((f) => coincide(f.nombre)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      ...libresCrudos.slice(0, TOPE_LIBRES).map(aFila),
    ];

    const porVendedor = vendedorFiltro
      ? filas.filter((f) => f.vendedor_id === vendedorFiltro)
      : filas;
    const visibles = soloLibres ? porVendedor.filter((f) => !f.en_cartera) : porVendedor;

    return NextResponse.json(successResponse({
      clientes: visibles,
      dias_cartera: diasCartera,
      sucursal_id: sucursalId,
      sucursal_nombre: await nombreDeSucursal(supabase, auth.empresa_id, sucursalId),
      resumen: {
        // Sobre el padrón entero, no sobre lo que se lista.
        total: totalClientes,
        en_cartera: filasAsignadas.filter((f) => f.en_cartera).length,
        libres: totalClientes - filasAsignadas.filter((f) => f.en_cartera).length,
        sin_vendedor: totalClientes - filasAsignadas.filter((f) => f.vendedor_id).length,
      },
      // Hay más libres que los listados: la pantalla pide buscar.
      libres_recortados: libresCrudos.length > TOPE_LIBRES || (!buscar && totalClientes > filas.length),
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/comisiones/cartera GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la cartera."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede cambiar la cartera."),
        { status: 403 }
      );
    }
    const { auth, supabase } = ctx;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const clienteId = String(b.cliente_id ?? "").trim();
    if (!clienteId) return NextResponse.json(errorResponse("Falta el cliente."), { status: 400 });

    const sucursalId = exigirSucursal(auth.sucursal_id);

    if (b.accion === "liberar") {
      // Liberar a mano: se borra la fecha, no el vendedor. El cliente queda
      // libre ya mismo y sigue constando quién lo atendía. Solo en ESTA
      // sucursal: en la otra puede seguir en la cartera de otra persona.
      const r = await supabase.from("cliente_cartera")
        .update({ cartera_desde: null, updated_at: new Date().toISOString() })
        .eq("empresa_id", auth.empresa_id)
        .eq("cliente_id", clienteId)
        .eq("sucursal_id", sucursalId);
      if (r.error) {
        if (esTablaFaltante(r.error.message)) {
          return NextResponse.json(errorResponse(FALTA_64), { status: 400 });
        }
        throw new Error(r.error.message);
      }
      return NextResponse.json(successResponse({ ok: true }));
    }

    const vendedorId = b.vendedor_id ? String(b.vendedor_id) : null;
    let vendedorNombre: string | null = null;
    if (vendedorId) {
      const u = await supabase.from("usuarios")
        .select("id, nombre, email").eq("empresa_id", auth.empresa_id)
        .eq("id", vendedorId).maybeSingle();
      if (u.error) throw new Error(u.error.message);
      if (!u.data) return NextResponse.json(errorResponse("Vendedor no encontrado."), { status: 404 });
      const row = u.data as { nombre?: string | null; email?: string | null };
      vendedorNombre = row.nombre ?? row.email ?? null;
    }

    // Sacarle el vendedor es borrar la fila: "sin vendedor en esta sucursal"
    // es la ausencia de cartera, no una cartera de nadie. Guardado como fila
    // con vendedor en NULL habría dos formas de decir lo mismo.
    if (!vendedorId) {
      const del = await supabase.from("cliente_cartera")
        .delete()
        .eq("empresa_id", auth.empresa_id)
        .eq("cliente_id", clienteId)
        .eq("sucursal_id", sucursalId);
      if (del.error) {
        if (esTablaFaltante(del.error.message)) {
          return NextResponse.json(errorResponse(FALTA_64), { status: 400 });
        }
        throw new Error(del.error.message);
      }
      return NextResponse.json(successResponse({ ok: true }));
    }

    const r = await supabase.from("cliente_cartera")
      .upsert({
        empresa_id: auth.empresa_id,
        cliente_id: clienteId,
        sucursal_id: sucursalId,
        vendedor_usuario_id: vendedorId,
        vendedor_nombre: vendedorNombre,
        // Asignar arranca el reloj: el vendedor tiene los días configurados
        // para concretar algo antes de que el cliente vuelva a quedar libre.
        cartera_desde: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "empresa_id,cliente_id,sucursal_id" });
    if (r.error) {
      if (esTablaFaltante(r.error.message)) {
        return NextResponse.json(errorResponse(FALTA_64), { status: 400 });
      }
      throw new Error(r.error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/comisiones/cartera POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la cartera."), { status: 500 });
  }
}
