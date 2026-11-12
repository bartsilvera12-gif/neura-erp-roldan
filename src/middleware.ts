import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { esUserAgentDeLaApp, INICIO_APP_ASESOR, rutaPermitidaEnApp } from "@/lib/app-asesor/es-app-nativa";

/**
 * Refresca la sesión Supabase en cookies antes de Route Handlers / RSC.
 * Solo NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (sin db.schema en getUser).
 */
export async function middleware(request: NextRequest) {
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
