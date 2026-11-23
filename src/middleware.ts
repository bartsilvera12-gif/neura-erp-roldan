import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { BLOQUEO_PAGO_MENSAJE, BLOQUEO_PAGO_PATH, erpBloqueadoPorFaltaDePago } from "@/lib/bloqueo-pago";
import { esUserAgentDeLaApp, INICIO_APP_ASESOR, rutaPermitidaEnApp } from "@/lib/app-asesor/es-app-nativa";

/**
 * Refresca la sesión Supabase en cookies antes de Route Handlers / RSC.
 * Solo NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (sin db.schema en getUser).
 */
export async function middleware(request: NextRequest) {
  // ===== Acceso suspendido por falta de pago (sistema de Neura, por dominio) =====
  // Va primero: un ERP suspendido se bloquea incluso para la APK del asesor.
  if (await erpBloqueadoPorFaltaDePago(request.headers)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: BLOQUEO_PAGO_MENSAJE }, { status: 402 });
    }
    if (request.nextUrl.pathname !== BLOQUEO_PAGO_PATH) {
      const bloqueoUrl = request.nextUrl.clone();
      bloqueoUrl.pathname = BLOQUEO_PAGO_PATH;
      bloqueoUrl.search = "";
      return NextResponse.redirect(bloqueoUrl, 307);
    }
    return NextResponse.next({ request });
  }
  if (request.nextUrl.pathname === BLOQUEO_PAGO_PATH) {
    const inicio = request.nextUrl.clone();
    inicio.pathname = "/";
    inicio.search = "";
    return NextResponse.redirect(inicio, 307);
  }

  // La APK del asesor es solo conversaciones, aunque entre un admin: cualquier
  // pantalla del ERP pedida desde la app vuelve a la lista. Las /api siguen
  // abiertas porque las pantallas de la app las usan, igual que los archivos.
  const { pathname } = request.nextUrl;
  if (
    esUserAgentDeLaApp(request.headers.get("user-agent")) &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    !/\.[a-z0-9]+$/i.test(pathname) && // archivos de public/ (sonidos, manifest…)
    !rutaPermitidaEnApp(pathname)
  ) {
    const destino = request.nextUrl.clone();
    destino.pathname = INICIO_APP_ASESOR;
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

/**
 * Excluir `/api/webhooks/*`: Meta hace GET sin cookies para verificar el webhook;
 * no debe pasar por refresh de sesión Supabase (y queda listo para proxies estrictos).
 */
export const config = {
  matcher: [
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
