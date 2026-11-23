/**
 * Rechazar un presupuesto libera la mercadería reservada.
 *
 * Correr:  npm run test:reserva-rechazado
 */
import { estadoLiberaReserva, noApartaPorEstado } from "../src/lib/presupuestos/reserva-estado";

let fallos = 0, ok = 0;
function check(n: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${n}`); }
  else { fallos++; console.error(`  FALLÓ ${n}\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`); }
}

console.log("\n— Al pasar a este estado se saca la marca de reserva —");
check("rechazado: se libera", estadoLiberaReserva("rechazado"), true);
check("aprobado: no", estadoLiberaReserva("aprobado"), false);
check("creado: no", estadoLiberaReserva("creado"), false);
check("enviado: no", estadoLiberaReserva("enviado"), false);
check("borrador: no", estadoLiberaReserva("borrador"), false);
// Convertido no: ahí el stock ya salió de verdad y la marca queda de rastro.
check("convertido: no se toca", estadoLiberaReserva("convertido"), false);
check("sin estado: no", estadoLiberaReserva(null), false);

console.log("\n— Qué presupuestos NO apartan nada, tengan la marca o no —");
check("rechazado", noApartaPorEstado("rechazado"), true);
check("anulado", noApartaPorEstado("anulado"), true);
check("convertido", noApartaPorEstado("convertido"), true);
check("aprobado sí aparta", noApartaPorEstado("aprobado"), false);
check("creado sí aparta (si tiene la marca)", noApartaPorEstado("creado"), false);
check("enviado sí aparta (si tiene la marca)", noApartaPorEstado("enviado"), false);

console.log("\n— Ya cobrado: el stock salió de verdad —");
check("aprobado pero ya convertido en venta", noApartaPorEstado("aprobado", "venta-123"), true);
check("aprobado sin venta", noApartaPorEstado("aprobado", null), false);
check("venta vacía no cuenta como cobrado", noApartaPorEstado("aprobado", ""), false);

console.log("\n— El caso que reportó el cliente —");
// Presupuesto aprobado + «Reservar»; después el cliente lo rechaza.
check("mientras está aprobado, aparta", noApartaPorEstado("aprobado"), false);
check("al rechazarlo se le saca la marca", estadoLiberaReserva("rechazado"), true);
check("y aunque le quedara la marca puesta, ya no aparta", noApartaPorEstado("rechazado"), true);

console.log(`\n${fallos === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasaron, ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
