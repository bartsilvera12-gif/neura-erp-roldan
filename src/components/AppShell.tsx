"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { esAppNativa, INICIO_APP_ASESOR, rutaPermitidaEnApp } from "@/lib/app-asesor/es-app-nativa";
import Sidebar from "./layout/Sidebar";
import Header from "./layout/Header";
import MobileBottomNav from "./layout/MobileBottomNav";

const STANDALONE_ROUTES = ["/login"];
/**
 * Rutas a pantalla completa, sin la barra lateral ni el encabezado del ERP.
 *
 *   · /fichar/<token> — el kiosco de fichaje.
 *   · /m/asesor       — la app del asesor (la APK). Es un teléfono entero: el
 *                       menú del ERP le comería media pantalla al chat, y el
 *                       asesor no navega por el ERP desde ahí.
 */
const STANDALONE_PREFIXES = ["/fichar/", "/m/asesor"];

const noSuscribir = () => () => {};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // La APK del asesor es solo conversaciones. Si por cualquier camino cae en
  // otra pantalla del ERP (el login que manda a "/", un enlace, el aviso de
  // sesión vencida), se la devuelve a la lista de conversaciones.
  // useSyncExternalStore y no esAppNativa() directo: en el servidor no hay
  // window, y leerlo en el render rompería la hidratación.
  const enApp = useSyncExternalStore(noSuscribir, esAppNativa, () => false);
  const fueraDeLaApp = enApp && !!pathname && !rutaPermitidaEnApp(pathname);
  useEffect(() => {
    if (fueraDeLaApp) router.replace(INICIO_APP_ASESOR);
  }, [fueraDeLaApp, router]);

  if (fueraDeLaApp) return null;

  const isStandalone = pathname && (STANDALONE_ROUTES.includes(pathname) || STANDALONE_PREFIXES.some((p) => pathname.startsWith(p)));

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div id="neura-app-shell" className="flex h-svh min-h-0 overflow-hidden bg-[#EEF2F7]">
      <Sidebar />
      <div id="neura-main-column" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        {/* pb-20 en mobile reserva ~80px para que el contenido scrolleable no quede
            tapado por MobileBottomNav (fixed bottom). md:pb-6 vuelve al padding normal
            en desktop donde no hay barra inferior. */}
        <main
          id="neura-main-content"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 pb-20 sm:p-6 sm:pb-24 lg:pb-6"
        >
          {children}
        </main>
        {/* Bottom Navigation mobile-only (md:hidden internamente).
            Posición fixed bottom, no afecta layout de desktop. */}
        <MobileBottomNav />
      </div>
    </div>
  );
}
