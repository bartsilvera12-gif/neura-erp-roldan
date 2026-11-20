import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { describirAgente } from "@/lib/usuarios/agente";

/**
 * POST /api/me/ingreso — registra que el usuario entró, y desde qué equipo
 * (script 92, pedido del cliente). Lo llama la app una vez por inicio de
 * sesión.
 *
 * Body: { dispositivo_id, dispositivo_nombre? }. La IP y el navegador los
 * pone el servidor. Si la tabla no existe todavía, contesta bien igual: el
 * registro no tiene que molestar a nadie para entrar.
 */
export async function POST(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
    const ua = request.headers.get("user-agent") ?? "";
    // La IP real del usuario. El sistema está detrás de Cloudflare: en
    // x-forwarded-for llegaba la IP de Cloudflare (172.69.x.x) y todos los
    // ingresos figuraban desde el mismo lugar. Cloudflare manda la del
    // usuario en cf-connecting-ip.
    const ip =
      request.headers.get("cf-connecting-ip")?.trim() ||
      request.headers.get("true-client-ip")?.trim() ||
      (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const { sistema, navegador } = describirAgente(ua);
    const firma = await firmaUsuario(ctx.supabase, ctx.auth).catch(() => ({ nombre: null as string | null }));

    const ins = await ctx.supabase.from("usuario_ingresos").insert({
      empresa_id: ctx.auth.empresa_id,
      usuario_id: ctx.auth.usuarioCatalogId ?? null,
      auth_user_id: ctx.auth.user?.id ?? null,
      usuario_nombre: firma.nombre ?? null,
      dispositivo_id: txt(body.dispositivo_id, 64),
      dispositivo_nombre: txt(body.dispositivo_nombre, 80),
      sistema,
      navegador,
      user_agent: ua.slice(0, 400) || null,
      ip,
      sucursal_id: ctx.auth.sucursal_id ?? null,
    });
    if (ins.error && !/usuario_ingresos|does not exist|42P01|schema cache/i.test(ins.error.message)) {
      console.error("[/api/me/ingreso]", ins.error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/me/ingreso]", err instanceof Error ? err.message : err);
    return NextResponse.json(successResponse({ ok: false }));
  }
}
