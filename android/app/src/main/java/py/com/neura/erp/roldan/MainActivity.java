package py.com.neura.erp.roldan;

import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * La app del asesor es solo conversaciones, aunque quien entre sea admin.
 *
 * El servidor ya redirige (middleware, por el user-agent "NeuraAsesorApp"),
 * pero eso depende de que el ERP esté desplegado. Este corral vive en la APK
 * y funciona igual contra cualquier versión del servidor: en cada página que
 * carga, inyecta un script que mira la ruta —también en la navegación interna
 * de Next, que no recarga la página— y, si no es el login ni /m/asesor,
 * vuelve a la lista de conversaciones.
 *
 * Y por si ese script no llega a inyectarse (Capacitor solo avisa "cargó" si
 * la carga llegó al 100%), Android mismo mira la dirección del WebView cada
 * segundo —getUrl() incluye la navegación interna— y hace lo mismo.
 */
public class MainActivity extends BridgeActivity {

    private static final String CORRAL_JS =
        "(function(){" +
        "  if (window.__corralAsesor) return; window.__corralAsesor = true;" +
        "  if (!/(^|\\.)neura\\.com\\.py$/.test(location.hostname)) return;" +
        "  var ok = function(p){ return p === '/login' || p === '/m/asesor' || p.indexOf('/m/asesor/') === 0; };" +
        "  var check = function(){" +
        "    if (ok(location.pathname)) return;" +
        "    document.documentElement.style.visibility = 'hidden';" +
        "    location.replace('/m/asesor');" +
        "  };" +
        "  ['pushState','replaceState'].forEach(function(k){" +
        "    var orig = history[k];" +
        "    history[k] = function(){ var r = orig.apply(this, arguments); check(); return r; };" +
        "  });" +
        "  window.addEventListener('popstate', check);" +
        "  setInterval(check, 400);" +
        "  check();" +
        "})();";

    private static final String INICIO = "https://roldanehijos.neura.com.py/m/asesor";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable vigilar = new Runnable() {
        @Override
        public void run() {
            try {
                WebView wv = bridge != null ? bridge.getWebView() : null;
                String url = wv != null ? wv.getUrl() : null;
                if (url != null && fueraDeConversaciones(url)) {
                    wv.loadUrl(INICIO);
                }
            } catch (Exception ignored) {
                // nunca tirar la app por esto
            }
            handler.postDelayed(this, 1000);
        }
    };

    static boolean fueraDeConversaciones(String url) {
        Uri u = Uri.parse(url);
        String host = u.getHost();
        if (host == null || !(host.equals("neura.com.py") || host.endsWith(".neura.com.py"))) return false;
        String path = u.getPath() == null ? "/" : u.getPath();
        return !(path.equals("/login") || path.equals("/m/asesor") || path.startsWith("/m/asesor/"));
    }

    @Override
    public void onResume() {
        super.onResume();
        handler.removeCallbacks(vigilar);
        handler.post(vigilar);
    }

    @Override
    public void onPause() {
        handler.removeCallbacks(vigilar);
        super.onPause();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                webView.evaluateJavascript(CORRAL_JS, null);
            }
        });
    }
}
