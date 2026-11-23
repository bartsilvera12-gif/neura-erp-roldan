/**
 * «Recibido» de una orden de compra con DOBLE CONFIRMACIÓN.
 *
 * Prueba la regla sola (sin base de datos): quién puede confirmar, quién
 * puede aceptar, que la misma persona no pueda hacer las dos, qué estado
 * queda, quién puede deshacer, y que las órdenes marcadas con la regla
 * anterior sigan contando como recibidas.
 *
 * Correr:  npm run test:recepcion-doble
 */
import {
  accionesRecepcion,
  confirmarRecepcion,
  deshacerRecepcion,
  esperandoSegunda,
  type OrdenRecepcion,
} from "../src/lib/compras/recepcion";
import { estadoOrden, entregaAtrasada } from "../src/lib/compras/orden-estado";

const AHORA = "2026-11-23T12:00:00.000Z";
const DEPOSITERO = { usuarioId: "u-deposito", nombre: "Ramón", esAdmin: false };
const OTRO = { usuarioId: "u-otro", nombre: "Lucía", esAdmin: false };
const ADMIN = { usuarioId: "u-admin", nombre: "Karen", esAdmin: true };
const ADMIN2 = { usuarioId: "u-admin2", nombre: "Bart", esAdmin: true };

let fallos = 0;
let ok = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log(`  ok   ${nombre}`); }
  else { fallos++; console.error(`  FALLÓ ${nombre}\n        esperado: ${b}\n        real:     ${a}`); }
}
function seccion(t: string) { console.log(`\n— ${t} —`); }

const nueva: OrdenRecepcion = { estado: "pendiente" };

seccion("El camino normal: dos personas");

// 1ª confirmación: la hace quien recibe la mercadería.
const r1 = confirmarRecepcion(nueva, DEPOSITERO, AHORA);
check("el depositero puede marcar «Recibido»", r1.ok, true);
if (r1.ok) {
  check("…y queda anotado quién y cuándo", r1.patch, {
    recibida_por_1: "u-deposito",
    recibida_por_1_nombre: "Ramón",
    recibida_por_1_at: AHORA,
  });
  check("…es el paso 1", r1.paso, 1);
  check("…NO la deja en estado recibida", Object.prototype.hasOwnProperty.call(r1.patch, "estado"), false);
}

const paso1: OrdenRecepcion = {
  estado: "pendiente",
  recibida_por_1: "u-deposito",
  recibida_por_1_nombre: "Ramón",
  recibida_por_1_at: AHORA,
};
check("con una sola confirmación el estado es «por confirmar»", estadoOrden(paso1), "por_confirmar");
check("y figura como esperando la segunda", esperandoSegunda(paso1), true);

// 2ª confirmación: el administrador.
const r2 = confirmarRecepcion(paso1, ADMIN, "2026-11-23T13:00:00.000Z");
check("el administrador puede aceptar", r2.ok, true);
if (r2.ok) {
  check("…queda anotado y recién ahí es recibida", r2.patch, {
    recibida_por_2: "u-admin",
    recibida_por_2_nombre: "Karen",
    recibida_por_2_at: "2026-11-23T13:00:00.000Z",
    recibida_at: "2026-11-23T13:00:00.000Z",
    estado: "recibida",
  });
  check("…es el paso 2", r2.paso, 2);
}

const paso2: OrdenRecepcion = { ...paso1, estado: "recibida", recibida_por_2: "u-admin", recibida_por_2_at: "2026-11-23T13:00:00.000Z" };
check("con las dos confirmaciones el estado es «recibida»", estadoOrden(paso2), "recibida");
check("ya no espera a nadie", esperandoSegunda(paso2), false);

seccion("Lo que el control tiene que impedir");

const soloEl = confirmarRecepcion(paso1, DEPOSITERO, AHORA);
check("el mismo que marcó NO puede volver a confirmar", soloEl.ok, false);
if (!soloEl.ok) check("…y le dice que falta el administrador", soloEl.status, 403);

const adminQueMarco: OrdenRecepcion = { estado: "pendiente", recibida_por_1: "u-admin", recibida_por_1_at: AHORA };
const seAceptaSolo = confirmarRecepcion(adminQueMarco, ADMIN, AHORA);
check("un administrador NO se puede aceptar a sí mismo", seAceptaSolo.ok, false);
if (!seAceptaSolo.ok) {
  check("…y el motivo es que lo marcó él", seAceptaSolo.error, "Tiene que aceptarlo otra persona: esta orden la marcaste vos.");
  check("…status 409", seAceptaSolo.status, 409);
}
check("otro administrador SÍ puede aceptarla", confirmarRecepcion(adminQueMarco, ADMIN2, AHORA).ok, true);

const noAdmin = confirmarRecepcion(paso1, OTRO, AHORA);
check("otra persona que no es administrador no puede aceptar", noAdmin.ok, false);
if (!noAdmin.ok) check("…status 403", noAdmin.status, 403);

const yaEsta = confirmarRecepcion(paso2, ADMIN2, AHORA);
check("no se puede confirmar una orden ya confirmada dos veces", yaEsta.ok, false);
if (!yaEsta.ok) check("…status 409", yaEsta.status, 409);

const anulada = confirmarRecepcion({ estado: "anulada" }, ADMIN, AHORA);
check("una orden anulada no se puede recibir", anulada.ok, false);
if (!anulada.ok) check("…status 409", anulada.status, 409);

const sinUsuario = confirmarRecepcion(nueva, { usuarioId: null, nombre: null, esAdmin: true }, AHORA);
check("sin usuario identificado no se confirma nada", sinUsuario.ok, false);
if (!sinUsuario.ok) check("…status 400", sinUsuario.status, 400);

seccion("Volver a «En tránsito»");

check("quien marcó puede deshacer su propia confirmación", deshacerRecepcion(paso1, DEPOSITERO).ok, true);
check("un administrador también", deshacerRecepcion(paso1, ADMIN).ok, true);
const ajena = deshacerRecepcion(paso1, OTRO);
check("otra persona no puede deshacer la confirmación ajena", ajena.ok, false);
if (!ajena.ok) check("…status 403", ajena.status, 403);

const confirmadaPorNoAdmin = deshacerRecepcion(paso2, DEPOSITERO);
check("ya confirmada por los dos: un no-administrador no la deshace", confirmadaPorNoAdmin.ok, false);
if (!confirmadaPorNoAdmin.ok) check("…status 403", confirmadaPorNoAdmin.status, 403);
const deshaceAdmin = deshacerRecepcion(paso2, ADMIN);
check("ya confirmada: el administrador sí", deshaceAdmin.ok, true);
if (deshaceAdmin.ok) {
  check("…y limpia las dos confirmaciones", deshaceAdmin.patch, {
    recibida_por_1: null, recibida_por_1_nombre: null, recibida_por_1_at: null,
    recibida_por_2: null, recibida_por_2_nombre: null, recibida_por_2_at: null,
    recibida_at: null, estado: "pendiente",
  });
}

seccion("Órdenes de antes del cambio (regla vieja, un solo click)");

const vieja: OrdenRecepcion = { estado: "recibida" };
check("siguen contando como recibidas", estadoOrden(vieja), "recibida");
check("no aparecen esperando confirmación", esperandoSegunda(vieja), false);
check("solo un administrador las vuelve a tránsito", deshacerRecepcion(vieja, DEPOSITERO).ok, false);
check("…el administrador sí", deshacerRecepcion(vieja, ADMIN).ok, true);

seccion("Los caminos que salteaban el control, ya cerrados");

check("la fecha de entrega pasada YA NO la da por recibida",
  estadoOrden({ estado: "pendiente", fecha_entrega: "2020-01-01" }), "en_transito");
check("…pero se marca como atrasada",
  entregaAtrasada({ estado: "pendiente", fecha_entrega: "2020-01-01" }), true);
check("una orden en fecha no está atrasada",
  entregaAtrasada({ estado: "pendiente", fecha_entrega: "2099-01-01" }), false);
check("una ya confirmada no se marca atrasada", entregaAtrasada({ ...paso2, fecha_entrega: "2020-01-01" }), false);
check("cargar la factura la deja «facturada», no «recibida»",
  estadoOrden({ estado: "pendiente", compra_numero: "C-000001" }), "facturada");

seccion("Qué botón ve cada uno");

check("orden nueva, cualquiera: «Recibido»", accionesRecepcion(nueva, DEPOSITERO),
  { confirmar: true, aceptar: false, deshacer: false, esperandoOtro: false });
check("por confirmar, el que marcó: deshacer y esperar", accionesRecepcion(paso1, DEPOSITERO),
  { confirmar: false, aceptar: false, deshacer: true, esperandoOtro: true });
check("por confirmar, otro no-admin: solo esperar", accionesRecepcion(paso1, OTRO),
  { confirmar: false, aceptar: false, deshacer: false, esperandoOtro: true });
check("por confirmar, el administrador: «Aceptar»", accionesRecepcion(paso1, ADMIN),
  { confirmar: false, aceptar: true, deshacer: true, esperandoOtro: false });
check("por confirmar, el admin que la marcó: no puede aceptar", accionesRecepcion(adminQueMarco, ADMIN),
  { confirmar: false, aceptar: false, deshacer: true, esperandoOtro: true });
check("ya recibida, no-admin: ningún botón", accionesRecepcion(paso2, DEPOSITERO),
  { confirmar: false, aceptar: false, deshacer: false, esperandoOtro: false });
check("ya recibida, admin: puede volver a tránsito", accionesRecepcion(paso2, ADMIN),
  { confirmar: false, aceptar: false, deshacer: true, esperandoOtro: false });
check("anulada: ningún botón", accionesRecepcion({ estado: "anulada" }, ADMIN),
  { confirmar: false, aceptar: false, deshacer: false, esperandoOtro: false });

console.log(`\n${fallos === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasaron, ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
