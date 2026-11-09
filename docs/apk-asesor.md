# La app del asesor (APK)

Una app Android para que los asesores atiendan las conversaciones de WhatsApp
desde el teléfono corporativo.

## Qué es, en una línea

Una ventana. La app **no trae el ERP adentro**: abre
`https://roldanehijos.neura.com.py/m/asesor` en un WebView y ahí corre el mismo
Next que ya está deployado.

Consecuencia práctica, y es la buena: **cada despliegue del ERP llega solo al
teléfono de todos**. La APK se vuelve a compilar únicamente si cambia algo del
envoltorio nativo — la URL, el nombre, el icono, los permisos, los plugins—, no
cuando se arregla una pantalla.

El WebView entra con la misma cookie de sesión que el navegador, así que el
asesor se loguea una vez y queda.

## Qué ve el asesor

- **La lista** de sus conversaciones asignadas, con filtro por cola y por canal.
- **El chat**: texto, fotos, audios, documentos, stickers, reacciones con
  emoji, responder citando un mensaje, plantillas de WhatsApp, la ficha del
  contacto, transferir a otro asesor y finalizar con tipificación.
- La franja del anuncio de Facebook o Instagram del que salió la conversación,
  cuando salió de uno.

No trae el resto del ERP: no hay ventas, ni inventario, ni informes. Para eso
está la computadora.

## Lo que NO hace todavía

**No avisa todavía cuando entra un mensaje**, pero ya falta poco. Lo que está
hecho:

- Firebase configurado (proyecto `neura-erp-roldan`). El
  `google-services.json` está en `android/app/` y versionado.
- La app registra el aparato al arrancar y lo manda a
  `POST /api/cc/agent/device-token`.
- El horario en que cada uno quiere recibir avisos.
- Al tocar el aviso, la app abre el chat de esa conversación.

Lo que falta es **el emisor**: algo del lado del servidor que, cuando entra un
mensaje, lea `agent_device_tokens` y dispare el push por FCM respetando
`usuario_horario_notificaciones`. El aviso tiene que llevar
`data.route = "/m/asesor/chat/<id>"`, que es lo que la app abre al tocarlo.

Mientras tanto el asesor ve los mensajes nuevos al abrir la app.

## Armar la APK

Hace falta: Node, Java 21, Gradle y el Android SDK (plataforma 35 y
build-tools 35).

```bash
npx cap sync android
cd android
echo "sdk.dir=/ruta/al/android-sdk" > local.properties
./gradlew assembleDebug
# queda en android/app/build/outputs/apk/debug/app-debug.apk
```

Se instala pasando el archivo al teléfono y abriéndolo. Android va a pedir
permiso para instalar apps de origen desconocido: es lo normal para una app que
no viene de Play Store.

> **Es una APK de prueba (debug).** Sirve para repartir a mano y funciona
> igual, pero no se puede reemplazar después por una firmada sin desinstalar
> primero. Cuando se decida repartirla en serio, conviene pasar a una firmada
> con su propio keystore —y guardar ese keystore, porque sin él no se puede
> actualizar la app encima.

## Qué hay que correr en la base

`supabase/roldanerp/80_app_del_asesor.sql`. Crea tres tablas nuevas y no toca
nada de lo que ya funciona:

| Tabla | Para qué |
|---|---|
| `agent_device_tokens` | El teléfono de cada asesor, para poder avisarle. Se llena sola. |
| `usuario_horario_notificaciones` | En qué horario quiere recibir los avisos. Sin fila, le llegan siempre. |
| `chat_conversation_attribution` | De qué anuncio salió la conversación. |

Si no se corre, la app abre y se chatea igual; lo que no anda es el aviso al
teléfono y la franja del anuncio.

## Firebase

Proyecto **`neura-erp-roldan`**, app Android con el package
**`py.com.neura.erp.roldan`**.

El `google-services.json` está en `android/app/` y **va versionado a
propósito**: no es una contraseña, viaja adentro de la APK y lo tiene cualquiera
que instale la app. Versionarlo es lo que permite recompilar en cualquier
momento sin volver a bajarlo de la consola.

El `build.gradle` aplica el plugin de Google solo si el archivo está, así que
el proyecto compila con o sin él.

El SHA-1 del certificado no hace falta: eso es para iniciar sesión con Google y
Dynamic Links, no para las notificaciones.

## Cosas que conviene saber

- **El `appId` no se cambia** una vez repartida la app. Cambiarlo instala una
  segunda app al lado en vez de actualizar la que está.
- **`allowNavigation`** está acotado al ERP. Un enlace que mande un cliente por
  WhatsApp se abre en el navegador del teléfono, que es lo correcto.
- **Los dos tildes de entrega en la lista** no se ven: el inbox de este ERP no
  trae el estado del último mensaje. Adentro del chat sí se ven, porque ahí
  cada mensaje trae el suyo.
- **Transferir** ofrece los mismos destinos que transferir desde la
  computadora, a propósito: si cada una tuviera su lista, un chat podría
  derivarse desde el celular a alguien que en el ERP no figura como destino
  válido.
