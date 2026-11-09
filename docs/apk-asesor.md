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

## Los avisos al teléfono

**Están armados de punta a punta.** Falta una sola cosa de
configuración, abajo.

Cómo funciona:

1. Entra un mensaje del cliente por el webhook de WhatsApp.
2. Si la conversación ya tiene asesor asignado, se escribe una fila en
   `agent_notification_events` con estado `pending`. **Acá no se manda el
   push**: mandarlo es hablar con Google, y si el webhook tuviera que esperar
   a eso, WhatsApp lo daría por caído y reintentaría el mensaje — el cliente
   quedaría duplicado en el chat por un problema ajeno a él.
3. El mismo proceso le pega a `/api/cron/cc-notifications-dispatch` sin
   esperar respuesta, para que el aviso salga en segundos.
4. El emisor lee los `pending`, busca los teléfonos activos de ese asesor,
   mira si está dentro del horario que configuró, y manda el push por FCM.
5. Al tocar el aviso, la app abre esa conversación (`data.route`).

Cada fila queda con en qué terminó: `sent` (Google lo aceptó, con su id),
`failed` (con el motivo), o `skipped` — que no es un error: es "no tiene la
app" o "está fuera de su horario". Cuando alguien diga "a mí no me llegó
nada", ahí está la respuesta.

Detalles que vale conocer:

- **Un teléfono que ya no existe se apaga solo.** Firebase lo dice con
  `registration-token-not-registered` y el emisor marca el token inactivo.
- **El cron es la red de contención, no el camino principal.** El empujón
  directo del paso 3 es lo que hace que el aviso salga rápido; el cron existe
  porque ese empujón se puede perder (proceso reciclado, timeout).

## Lo único que falta configurar

Una variable de entorno en Coolify, en la aplicación `neura-erp-roldan`:

```
CRON_SECRET = <una cadena larga al azar, la que quieras>
```

Protege el endpoint del emisor para que no lo pueda disparar cualquiera desde
afuera. **Sin ella no sale ningún aviso**: el empujón directo no se hace y el
endpoint rechaza todo.

Y, como red de contención, un scheduled task en Coolify cada minuto:

```
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1:3000/api/cron/cc-notifications-dispatch?limit=100
```

Para probar sin mandar nada: agregarle `&dryRun=1`, que cuenta los pendientes
y no envía.

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

`supabase/roldanerp/80_app_del_asesor.sql` y luego
`supabase/roldanerp/81_avisos_al_asesor.sql`. Las dos crean tablas nuevas y no
tocan nada de lo que ya funciona:

| Tabla | Script | Para qué |
|---|---|---|
| `agent_device_tokens` | 80 | El teléfono de cada asesor, para poder avisarle. Se llena sola. |
| `usuario_horario_notificaciones` | 80 | En qué horario quiere recibir los avisos. Sin fila, le llegan siempre. |
| `chat_conversation_attribution` | 80 | De qué anuncio salió la conversación. |
| `agent_notification_events` | 81 | La cola de avisos y en qué terminó cada uno. |

Si no se corren, la app abre y se chatea igual; lo que no anda es el aviso al
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
