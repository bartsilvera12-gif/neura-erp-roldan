import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { FACULTADES, soloFacultadesConocidas } from "@/lib/perfiles/facultades";

/**
 * Los perfiles de usuario y sus facultades.
 *
 * GET  → los perfiles con sus facultades, el catálogo de facultades y cuántos
 *        usuarios tiene cada uno.
 * POST → crea un perfil.
 * PUT  → cambia nombre, descripción, nivel y facultades de uno.
 *
 * ── POR QUÉ SOLO ADMINISTRADOR, Y NO UNA FACULTAD MÁS ─────────────────────
 *   Repartir facultades es la facultad que reparte todas las demás: quien la
 *   tenga puede dárselas todas a sí mismo. Darla por perfil sería dejar que
 *   el sistema se abra solo.
 */
export const dynamic = "force-dynamic";

const FALTA_TABLA = "Falta correr 63_perfiles_de_usuario.sql en la base.";

function esTablaFaltante(msg: string): boolean {
  return /perfiles_usuario|perfil_facultades/.test(msg)
    && /does not exist|42P01|PGRST205|schema cache/i.test(msg);
}

type PerfilRow = { id: string; clave: string | null; nombre: string; descripcion: string | null; nivel: string; activo: boolean };

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const pQ = await ctx.supabase
      .from("perfiles_usuario")
      .select("id, clave, nombre, descripcion, nivel, activo")
      .eq("empresa_id", empresaId)
      .order("nombre");
    if (pQ.error) {
      if (esTablaFaltante(pQ.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
      }
      throw new Error(pQ.error.message);
    }
    const perfiles = (pQ.data ?? []) as PerfilRow[];
    const ids = perfiles.map((p) => p.id);

    const porPerfil = new Map<string, string[]>();
    if (ids.length > 0) {
      const fQ = await ctx.supabase
        .from("perfil_facultades")
        .select("perfil_id, facultad")
        .in("perfil_id", ids);
      if (fQ.error) throw new Error(fQ.error.message);
      for (const r of (fQ.data ?? []) as Array<{ perfil_id: string; facultad: string }>) {
        const l = porPerfil.get(r.perfil_id) ?? [];
        l.push(r.facultad);
        porPerfil.set(r.perfil_id, l);
      }
    }

    // Cuántos usuarios tiene cada perfil: sacarle una facultad a uno vacío no
    // es lo mismo que sacársela al que usan cuatro personas.
    const conteo = new Map<string, number>();
    const uQ = await ctx.supabase
      .from("usuarios")
      .select("perfil_id")
      .eq("empresa_id", empresaId)
      .not("perfil_id", "is", null);
    if (!uQ.error) {
      for (const r of (uQ.data ?? []) as Array<{ perfil_id: string | null }>) {
        if (!r.perfil_id) continue;
        conteo.set(r.perfil_id, (conteo.get(r.perfil_id) ?? 0) + 1);
      }
    }

    return NextResponse.json(successResponse({
      perfiles: perfiles.map((p) => ({
        ...p,
        facultades: soloFacultadesConocidas(porPerfil.get(p.id)),
        usuarios: conteo.get(p.id) ?? 0,
      })),
      catalogo: FACULTADES,
      puede_editar: isAdmin(ctx.auth),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (esTablaFaltante(msg)) return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
    console.error("[/api/configuracion/perfiles GET]", msg || err);
    return NextResponse.json(errorResponse("No se pudieron cargar los perfiles."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Crear perfiles lo hace un administrador: define quién puede qué."),
        { status: 403 }
      );
    }
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = String(b.nombre ?? "").trim();
    if (nombre.length < 2) {
      return NextResponse.json(errorResponse("Poné un nombre al perfil."), { status: 400 });
    }

    const ins = await ctx.supabase
      .from("perfiles_usuario")
      .insert({
        empresa_id: ctx.auth.empresa_id,
        nombre,
        descripcion: typeof b.descripcion === "string" ? b.descripcion.slice(0, 500) : null,
        nivel: nivelValido(b.nivel),
      })
      .select("id")
      .single();
    if (ins.error) {
      if (/duplicate|23505/i.test(ins.error.message)) {
        return NextResponse.json(errorResponse(`Ya hay un perfil llamado "${nombre}".`), { status: 409 });
      }
      if (esTablaFaltante(ins.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
      }
      throw new Error(ins.error.message);
    }

    const perfilId = String((ins.data as { id: string }).id);
    await guardarFacultades(ctx.supabase, perfilId, soloFacultadesConocidas(b.facultades as unknown[]));
    return NextResponse.json(successResponse({ id: perfilId }));
  } catch (err) {
    console.error("[/api/configuracion/perfiles POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear el perfil."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Cambiar las facultades de un perfil lo hace un administrador."),
        { status: 403 }
      );
    }
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta el perfil."), { status: 400 });

    // Que sea de esta empresa: sin esto, un uuid a mano edita el perfil de otro
    // tenant.
    const actual = await ctx.supabase
      .from("perfiles_usuario")
      .select("id")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (actual.error) throw new Error(actual.error.message);
    if (!actual.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.nombre === "string" && b.nombre.trim().length >= 2) patch.nombre = b.nombre.trim();
    if (typeof b.descripcion === "string") patch.descripcion = b.descripcion.slice(0, 500) || null;
    if (b.nivel !== undefined) patch.nivel = nivelValido(b.nivel);
    if (b.activo !== undefined) patch.activo = b.activo === true;

    const upd = await ctx.supabase
      .from("perfiles_usuario")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (upd.error) {
      if (/duplicate|23505/i.test(upd.error.message)) {
        return NextResponse.json(errorResponse("Ya hay otro perfil con ese nombre."), { status: 409 });
      }
      throw new Error(upd.error.message);
    }

    if (Array.isArray(b.facultades)) {
      await guardarFacultades(ctx.supabase, id, soloFacultadesConocidas(b.facultades));
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/configuracion/perfiles PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar el perfil."), { status: 500 });
  }
}

function nivelValido(v: unknown): "administrador" | "supervisor" | "usuario" {
  return v === "administrador" || v === "supervisor" ? v : "usuario";
}

/**
 * Reemplaza las facultades del perfil por las que vinieron.
 *
 * Borra y vuelve a insertar en vez de calcular la diferencia: son ocho filas,
 * la diferencia sería más código para ahorrar nada, y el borrón deja el
 * estado final igual a lo que muestra la pantalla sin depender de que el
 * cálculo esté bien.
 */
async function guardarFacultades(
  sb: Awaited<ReturnType<typeof getTenantSupabaseFromAuthWithRol>> extends null ? never
    : NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuthWithRol>>>["supabase"],
  perfilId: string,
  facultades: string[]
): Promise<void> {
  const del = await sb.from("perfil_facultades").delete().eq("perfil_id", perfilId);
  if (del.error) throw new Error(del.error.message);
  if (facultades.length === 0) return;
  const ins = await sb
    .from("perfil_facultades")
    .insert(facultades.map((f) => ({ perfil_id: perfilId, facultad: f })));
  if (ins.error) throw new Error(ins.error.message);
}
