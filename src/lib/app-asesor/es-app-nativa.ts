/**
 * ¿Esto corre dentro de la APK del asesor?
 *
 * La APK es un WebView de Capacitor que abre el ERP deployado; Capacitor le
 * inyecta `window.Capacitor` a la página. En un navegador no existe, así que
 * esto da `false` en la computadora y en el celular con Chrome.
 *
 * Es sincrónico a propósito: se usa para decidir a dónde mandar al usuario
 * antes de pintar nada, y un import dinámico dejaría ver el ERP un instante.
 */
export function esAppNativa(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** La pantalla de inicio de la app: la lista de conversaciones. */
export const INICIO_APP_ASESOR = "/m/asesor";

/**
 * Rutas que la app puede mostrar. Todo lo demás es el ERP de escritorio, que
 * en la app no va: la app es solo conversaciones.
 */
export function rutaPermitidaEnApp(pathname: string): boolean {
  return pathname === "/login" || pathname === INICIO_APP_ASESOR || pathname.startsWith(`${INICIO_APP_ASESOR}/`);
}
