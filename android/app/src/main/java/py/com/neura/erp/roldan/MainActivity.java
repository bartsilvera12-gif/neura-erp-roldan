package py.com.neura.erp.roldan;

import android.os.Bundle;
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
