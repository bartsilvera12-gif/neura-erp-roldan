/**
 * Aviso de WhatsApp por QR desconectado (campana).
 *
 * Levanta un puente Baileys de mentira y comprueba la clasificación del
 * estado: conectado no avisa, y cada forma de estar caído (sesión cerrada,
 * esperando QR, puente arrancando, HTTP de error, JSON raro, timeout, puerto
 * cerrado) se reconoce como "no está atendiendo", con su texto.
 *
 * Correr:  npx tsx scripts/test-whatsapp-qr-aviso.ts
 */
import http from "node:http";
import {
  consultarPuenteQr,
  esCanalQr,
  textoEstadoQr,
  type ConexionQr,
} from "../src/lib/chat/baileys-bridge-status";

const SECRET = "secreto-de-prueba";
let fallos = 0;
let ok = 0;

function check(nombre: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallos++;
    console.error(`  FALLÓ ${nombre}\n        esperado: ${b}\n        real:     ${a}`);
  }
}

/** Puente de mentira. `modo` decide qué contesta /status. */
function puente(modo: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith("/status")) {
      res.writeHead(404).end();
      return;
    }
    // El puente real exige el secreto compartido.
    if (req.headers["x-bridge-secret"] !== SECRET) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (modo === "http500") {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "boom" }));
      return;
    }
    if (modo === "basura") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ connection: "vaya_a_saber" }));
      return;
    }
    if (modo === "sin_campo") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ hola: 1 }));
      return;
    }
    if (modo === "cuelga") {
      // Nunca contesta: tiene que cortar el timeout, no quedarse colgado.
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ connection: modo }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

async function estado(modo: string, timeoutMs = 2500) {
  const p = await puente(modo);
  try {
    return await consultarPuenteQr(p.url, SECRET, timeoutMs);
  } finally {
    await p.close();
  }
}

async function main() {
  console.log("\n— Qué dice el puente → cómo lo leemos —");

  check("open = conectado, no se avisa", await estado("open"), { connection: "open", detalle: null });
  check("close = sesión cerrada", await estado("close"), { connection: "close", detalle: null });
  check("qr = esperando escaneo", await estado("qr"), { connection: "qr", detalle: null });
  check("starting = arrancando", await estado("starting"), { connection: "starting", detalle: null });

  check("HTTP 500 del puente", await estado("http500"), {
    connection: "unknown",
    detalle: "El puente respondió 500.",
  });
  check("estado desconocido", await estado("basura"), { connection: "unknown", detalle: null });
  check("respuesta sin el campo", await estado("sin_campo"), { connection: "unknown", detalle: null });

  // El caso que importa para la campana: el puente no contesta y la consulta
  // igual tiene que volver, no colgar /api/notificaciones.
  const t0 = Date.now();
  check("puente colgado corta por timeout", await estado("cuelga", 300), {
    connection: "unknown",
    detalle: "No se pudo contactar al puente.",
  });
  const ms = Date.now() - t0;
  check("…y vuelve rápido (< 2s)", ms < 2000, true);
  console.log(`       (tardó ${ms} ms)`);

  // Puerto cerrado: nadie escuchando.
  check("puente apagado", await consultarPuenteQr("http://127.0.0.1:1", SECRET, 1000), {
    connection: "unknown",
    detalle: "No se pudo contactar al puente.",
  });

  // El secreto equivocado NO se confunde con "conectado".
  const p = await puente("open");
  check("secreto equivocado no da por conectado", await consultarPuenteQr(p.url, "otro", 1000), {
    connection: "unknown",
    detalle: "El puente respondió 401.",
  });
  await p.close();

  console.log("\n— Qué canales se consultan —");
  const cfg = { baileys_bridge_url: "http://x" };
  check("canal QR activo: sí", esCanalQr({ provider: "baileys", activo: true, config: cfg }), true);
  check("canal QR apagado: no", esCanalQr({ provider: "baileys", activo: false, config: cfg }), false);
  check("canal QR sin URL de puente: no", esCanalQr({ provider: "baileys", activo: true, config: {} }), false);
  check("canal QR con URL vacía: no", esCanalQr({ provider: "baileys", activo: true, config: { baileys_bridge_url: "   " } }), false);
  check("canal de Meta: no", esCanalQr({ provider: "meta", activo: true, config: cfg }), false);
  check("canal de YCloud: no", esCanalQr({ provider: "ycloud", activo: true, config: cfg }), false);
  check("provider en mayúsculas igual cuenta", esCanalQr({ provider: "Baileys", activo: true, config: cfg }), true);
  check("sin provider: no", esCanalQr({ activo: true, config: cfg }), false);

  console.log("\n— Texto del aviso —");
  const txt = (c: ConexionQr, d: string | null = null) => textoEstadoQr({ connection: c, detalle: d });
  check("close", txt("close"), "Se cerró la sesión del número");
  check("qr", txt("qr"), "Está esperando que escaneen el QR");
  check("starting", txt("starting"), "El puente está arrancando");
  check("unknown con detalle", txt("unknown", "No se pudo contactar al puente."), "No se pudo contactar al puente.");
  check("unknown sin detalle", txt("unknown"), "No se sabe el estado del puente");

  console.log(`\n${fallos === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasaron, ${fallos} fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
