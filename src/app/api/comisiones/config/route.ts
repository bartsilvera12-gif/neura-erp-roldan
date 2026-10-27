import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";

/**
 * Configuración de comisiones (punto 4.5).
 *
 * GET   → tipos de vendedor, reglas por rubro y tipo, y la config general.
 * POST  → crea o actualiza un tipo, una regla, o la config general.
 * DELETE → borra un tipo o una regla.
 *
 * Todo solo admin: de acá sale lo que cobra cada vendedor.
 *
 * El POST hace de alta y de edición según venga `id`. Son la misma operación
 * desde el punto de vista de quien configura —"que este rubro pague 6%"— y
 * separarlas obligaría a la pantalla a saber si la regla ya existía.
 */

const FALTA_TABLA = "Falta correr 24_comisiones_cartera.sql en la base.";
const esTablaFaltante = (m: string) =>
  /tipos_vendedor|comisiones_reglas|comisiones_config/.test(m) &&
  /(does not exist|schema cache|PGRST205)/i.test(m) &&
  // "no existe la COLUMNA x" también nombra a la tabla. Sin esta línea, pedir
  // una columna agregada después mandaba a correr un script que ya estaba
  // corrido, y la pantalla entera quedaba en rojo por una columna opcional.
  !/column/i.test(m);

/** La columna del tope de descuento la agrega el script 34, que puede no estar. */
const faltaColumnaTope = (m: string) => /descuento_maximo_pct/.test(m);

type Ctx = NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuthWithRol>>>;

async function guard(request: NextRequest): Promise<Ctx | NextResponse> {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  if (!isAdmin(ctx.auth)) {
    return NextResponse.json(
      errorResponse("Solo un administrador puede configurar las comisiones."),
      { status: 403 }
    );
  }
  return ctx;
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;
  const { auth, supabase } = g;

  try {
    const [tipos, reglas, config, vendedores, rubros] = await Promise.all([
      supabase.from("tipos_vendedor")
        .select("id, nombre, porcentaje_base, activo, descuento_maximo_pct")
        .eq("empresa_id", auth.empresa_id).order("nombre")
        .then(async (r) => {
          // Sin el script 34 corrido se reintenta sin esa columna: el tope de
          // descuento es una función de más, no una razón para dejar sin
          // configuración de comisiones a quien todavía no migró.
          if (r.error && faltaColumnaTope(r.error.message ?? "")) {
            return await supabase.from("tipos_vendedor")
              .select("id, nombre, porcentaje_base, activo")
              .eq("empresa_id", auth.empresa_id).order("nombre");
          }
          return r;
        }),
      supabase.from("comisiones_reglas")
        .select("id, tipo_vendedor_id, categoria_id, porcentaje, activo")
        .eq("empresa_id", auth.empresa_id),
      supabase.from("comisiones_config")
        .select("dias_cartera, base_calculo")
        .eq("empresa_id", auth.empresa_id).maybeSingle(),
      supabase.from("usuarios")
        .select("id, nombre, email, tipo_vendedor_id, descuento_maximo_pct, porcentaje_comision")
        .eq("empresa_id", auth.empresa_id).order("nombre")
        .then(async (r) => {
          if (r.error && faltaColumnaTope(r.error.message ?? "")) {
            return await supabase.from("usuarios")
              .select("id, nombre, email, tipo_vendedor_id, porcentaje_comision")
              .eq("empresa_id", auth.empresa_id).order("nombre");
          }
          return r;
        }),
      supabase.from("categorias_productos")
        .select("id, nombre").eq("empresa_id", auth.empresa_id)
        .eq("activo", true).order("nombre"),
    ]);

    const primerError = [tipos, reglas, config, vendedores, rubros].find((r) => r.error)?.error;
    if (primerError && esTablaFaltante(primerError.message ?? "")) {
      return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
    }
    if (primerError) throw new Error(primerError.message);

    return NextResponse.json(successResponse({
      tipos: tipos.data ?? [],
      reglas: reglas.data ?? [],
      // Si la fila de config no existe todavía, los valores que pide el pedido.
      config: config.data ?? { dias_cartera: 30, base_calculo: "margen" },
      vendedores: vendedores.data ?? [],
      rubros: rubros.data ?? [],
    }));
  } catch (err) {
    console.error("[/api/comisiones/config GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la configuración."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;
  const { auth, supabase } = g;

  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const accion = String(b.accion ?? "");

    // ── Tipo de vendedor ──────────────────────────────────────────────────
    if (accion === "tipo") {
      const nombre = String(b.nombre ?? "").trim().toUpperCase();
      if (!nombre) return NextResponse.json(errorResponse("Poné un nombre para el tipo."), { status: 400 });
      const pct = Number(b.porcentaje_base);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return NextResponse.json(
          errorResponse("El porcentaje base tiene que estar entre 0 y 100."),
          { status: 400 }
        );
      }
      // Tope de descuento del tipo. Se distingue "no vino en el pedido" (no se
      // toca) de "vino vacío" (se borra el tope): null acá significa sin tope,
      // que no es lo mismo que cero.
      let topeDesc: number | null | undefined;
      if (b.descuento_maximo_pct !== undefined) {
        if (b.descuento_maximo_pct === null || b.descuento_maximo_pct === "") {
          topeDesc = null;
        } else {
          const d = Number(b.descuento_maximo_pct);
          if (!Number.isFinite(d) || d < 0 || d > 100) {
            return NextResponse.json(
              errorResponse("El tope de descuento tiene que estar entre 0 y 100, o vacío para sin tope."),
              { status: 400 }
            );
          }
          topeDesc = d;
        }
      }

      const fila = {
        empresa_id: auth.empresa_id,
        nombre,
        porcentaje_base: pct,
        activo: b.activo !== false,
        updated_at: new Date().toISOString(),
        ...(topeDesc !== undefined ? { descuento_maximo_pct: topeDesc } : {}),
      };
      const guardar = (f: Record<string, unknown>) =>
        b.id
          ? supabase.from("tipos_vendedor").update(f)
              .eq("empresa_id", auth.empresa_id).eq("id", String(b.id)).select("id").single()
          : supabase.from("tipos_vendedor").insert(f).select("id").single();

      let r = await guardar(fila);
      if (r.error && faltaColumnaTope(r.error.message ?? "")) {
        // Se guarda el resto y se avisa qué quedó sin aplicar, en vez de
        // perder también el cambio de nombre o de porcentaje.
        const { descuento_maximo_pct: _omitido, ...sinTope } = fila as Record<string, unknown>;
        void _omitido;
        r = await guardar(sinTope);
        if (!r.error) {
          return NextResponse.json(successResponse({
            id: (r.data as { id: string }).id,
            aviso: "Se guardó, pero el tope de descuento necesita que corras el script 34 en la base.",
          }));
        }
      }
      if (r.error) {
        if (/duplicate|unique|23505/i.test(r.error.message)) {
          return NextResponse.json(errorResponse("Ya existe un tipo con ese nombre."), { status: 409 });
        }
        if (esTablaFaltante(r.error.message)) {
          return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
        }
        throw new Error(r.error.message);
      }
      return NextResponse.json(successResponse({ id: (r.data as { id: string }).id }));
    }

    // ── Regla por rubro y tipo ────────────────────────────────────────────
    if (accion === "regla") {
      const pct = Number(b.porcentaje);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return NextResponse.json(
          errorResponse("El porcentaje tiene que estar entre 0 y 100."),
          { status: 400 }
        );
      }
      // Vacío es "cualquiera", que es lo que hace a la regla general.
      const fila = {
        empresa_id: auth.empresa_id,
        tipo_vendedor_id: b.tipo_vendedor_id ? String(b.tipo_vendedor_id) : null,
        categoria_id: b.categoria_id ? String(b.categoria_id) : null,
        porcentaje: pct,
        activo: b.activo !== false,
        updated_at: new Date().toISOString(),
      };
      const r = b.id
        ? await supabase.from("comisiones_reglas").update(fila)
            .eq("empresa_id", auth.empresa_id).eq("id", String(b.id)).select("id").single()
        : await supabase.from("comisiones_reglas").insert(fila).select("id").single();
      if (r.error) {
        if (/duplicate|unique|23505/i.test(r.error.message)) {
          return NextResponse.json(
            errorResponse("Ya hay una regla para esa combinación de tipo y rubro. Editá la que existe."),
            { status: 409 }
          );
        }
        if (esTablaFaltante(r.error.message)) {
          return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
        }
        throw new Error(r.error.message);
      }
      return NextResponse.json(successResponse({ id: (r.data as { id: string }).id }));
    }

    // ── Tipo de vendedor de un usuario ────────────────────────────────────
    if (accion === "asignar_tipo") {
      const usuarioId = String(b.usuario_id ?? "");
      if (!usuarioId) return NextResponse.json(errorResponse("Falta el usuario."), { status: 400 });
      const r = await supabase.from("usuarios")
        .update({ tipo_vendedor_id: b.tipo_vendedor_id ? String(b.tipo_vendedor_id) : null })
        .eq("empresa_id", auth.empresa_id).eq("id", usuarioId);
      if (r.error) {
        if (esTablaFaltante(r.error.message) || /tipo_vendedor_id/.test(r.error.message)) {
          return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
        }
        throw new Error(r.error.message);
      }
      return NextResponse.json(successResponse({ ok: true }));
    }

    // ── Comisión propia de una persona ────────────────────────────────────
    // El acuerdo particular con un vendedor. Le gana a la regla por rubro y al
    // porcentaje base de su tipo: si una regla pudiera ganarle, el acuerdo no
    // sería un acuerdo. Vacío = usa las reglas; 0 = no comisiona.
    if (accion === "comision_usuario") {
      const usuarioId = String(b.usuario_id ?? "");
      if (!usuarioId) return NextResponse.json(errorResponse("Falta el usuario."), { status: 400 });

      let valor: number | null = null;
      if (b.porcentaje_comision !== null && b.porcentaje_comision !== "" && b.porcentaje_comision !== undefined) {
        const d = Number(b.porcentaje_comision);
        if (!Number.isFinite(d) || d < 0 || d > 100) {
          return NextResponse.json(
            errorResponse("La comisión tiene que estar entre 0 y 100, o vacía para usar las reglas."),
            { status: 400 }
          );
        }
        valor = d;
      }

      const r = await supabase.from("usuarios")
        .update({ porcentaje_comision: valor })
        .eq("empresa_id", auth.empresa_id).eq("id", usuarioId);
      if (r.error) throw new Error(r.error.message);
      return NextResponse.json(successResponse({ ok: true }));
    }

    // ── Tope de descuento de una persona ──────────────────────────────────
    // La excepción al tope de su tipo. Vive acá y no solo en RRHH porque es la
    // misma pantalla donde se le asigna el tipo: separar las dos mitades de la
    // misma decisión obliga a acordarse de la otra.
    if (accion === "tope_usuario") {
      const usuarioId = String(b.usuario_id ?? "");
      if (!usuarioId) return NextResponse.json(errorResponse("Falta el usuario."), { status: 400 });

      let valor: number | null = null;
      if (b.descuento_maximo_pct !== null && b.descuento_maximo_pct !== "" && b.descuento_maximo_pct !== undefined) {
        const d = Number(b.descuento_maximo_pct);
        if (!Number.isFinite(d) || d < 0 || d > 100) {
          return NextResponse.json(
            errorResponse("El tope tiene que estar entre 0 y 100, o vacío para que use el de su tipo."),
            { status: 400 }
          );
        }
        valor = d;
      }

      const r = await supabase.from("usuarios")
        .update({ descuento_maximo_pct: valor })
        .eq("empresa_id", auth.empresa_id).eq("id", usuarioId);
      if (r.error) {
        if (faltaColumnaTope(r.error.message ?? "")) {
          return NextResponse.json(
            errorResponse("El tope por persona necesita que corras el script 34 en la base."),
            { status: 500 }
          );
        }
        throw new Error(r.error.message);
      }
      return NextResponse.json(successResponse({ ok: true }));
    }

    // ── Config general ────────────────────────────────────────────────────
    if (accion === "config") {
      const dias = Number(b.dias_cartera);
      if (!Number.isFinite(dias) || dias < 1 || dias > 365) {
        return NextResponse.json(
          errorResponse("Los días de cartera tienen que estar entre 1 y 365."),
          { status: 400 }
        );
      }
      const base = b.base_calculo === "facturacion" ? "facturacion" : "margen";
      const r = await supabase.from("comisiones_config")
        .upsert({
          empresa_id: auth.empresa_id,
          dias_cartera: Math.trunc(dias),
          base_calculo: base,
          updated_at: new Date().toISOString(),
        }, { onConflict: "empresa_id" });
      if (r.error) {
        if (esTablaFaltante(r.error.message)) {
          return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
        }
        throw new Error(r.error.message);
      }
      return NextResponse.json(successResponse({ ok: true }));
    }

    return NextResponse.json(errorResponse("Acción desconocida."), { status: 400 });
  } catch (err) {
    console.error("[/api/comisiones/config POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la configuración."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;
  const { auth, supabase } = g;

  try {
    const sp = new URL(request.url).searchParams;
    const tabla = sp.get("tipo") === "regla" ? "comisiones_reglas" : "tipos_vendedor";
    const id = (sp.get("id") ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });

    const r = await supabase.from(tabla).delete()
      .eq("empresa_id", auth.empresa_id).eq("id", id);
    if (r.error) {
      // Un tipo en uso por un usuario no se borra: dejaría al vendedor sin
      // porcentaje y su comisión caería a cero sin que nadie lo decida.
      if (/foreign key|23503/i.test(r.error.message)) {
        return NextResponse.json(
          errorResponse("No se puede borrar: hay vendedores con ese tipo asignado. Desactivalo o cambiales el tipo primero."),
          { status: 409 }
        );
      }
      throw new Error(r.error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/comisiones/config DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar."), { status: 500 });
  }
}
