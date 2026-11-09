/**
 * La APK del asesor de Aceros Metal Roldán e Hijos.
 *
 * ── QUÉ ES ─────────────────────────────────────────────────────────────────
 *   Una ventana. La app no trae el ERP adentro: abre `server.url` en un
 *   WebView, y ahí corre el mismo Next que ya está deployado. Por eso cada vez
 *   que se despliega el ERP, los asesores tienen la versión nueva sin volver a
 *   instalar nada: la APK solo se rehace si cambia algo de esta configuración
 *   o del envoltorio nativo.
 *
 *   El WebView entra con la cookie de sesión como cualquier navegador, así que
 *   el asesor se loguea una vez y queda.
 *
 * ── POR QUÉ ABRE /m/asesor Y NO LA RAÍZ ────────────────────────────────────
 *   Porque la app es para atender conversaciones desde el teléfono. Si abriera
 *   la raíz, el asesor caería en el ERP completo —sidebar, tablero, informes—
 *   con los dedos y una pantalla de seis pulgadas.
 *
 * ── allowNavigation ────────────────────────────────────────────────────────
 *   Los dominios a los que el WebView puede ir sin abrir el navegador del
 *   teléfono. Está acotado al ERP y al Supabase del cliente: un enlace que un
 *   cliente mande por WhatsApp se abre afuera, que es lo correcto.
 *
 * ── appId ──────────────────────────────────────────────────────────────────
 *   `py.com.neura.erp.roldan`. No se cambia después de repartir la app: el
 *   appId es la identidad de la aplicación para Android. Cambiarlo instala una
 *   segunda app al lado en vez de actualizar la que está.
 */
const config = {
  appId: "py.com.neura.erp.roldan",
  appName: "Roldán e Hijos",
  // Capacitor lo exige. Con `server.url` remoto casi no se usa: solo se mira
  // si el WebView no puede llegar al servidor.
  webDir: "public",
  server: {
    url: "https://roldanehijos.neura.com.py/m/asesor",
    cleartext: false,
    allowNavigation: [
      "roldanehijos.neura.com.py",
      "*.neura.com.py",
    ],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
