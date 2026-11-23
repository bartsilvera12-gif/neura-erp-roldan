/**
 * Línea de orden de compra: descuento y propuesta desde la última compra.
 *
 * Correr:  npm run test:orden-linea
 */
import {
  descuentoValido, subtotalLinea, montoDescuento, totalLinea, totalOrden, totalDescuento,
  propuestaDesdeUltimaCompra,
} from "../src/lib/compras/orden-linea";

let fallos = 0, ok = 0;
function check(n: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${n}`); }
  else { fallos++; console.error(`  FALLÓ ${n}\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`); }
}
const sec = (t: string) => console.log(`\n— ${t} —`);

sec("El descuento vale entre 0 y 100");
check("10% es 10", descuentoValido(10), 10);
check("sin descuento es 0", descuentoValido(undefined), 0);
check("texto vacío es 0", descuentoValido(""), 0);
check("texto basura es 0", descuentoValido("abc"), 0);
check("negativo se corta en 0", descuentoValido(-5), 0);
check("más de 100 se corta en 100", descuentoValido(300), 100);
check("100 está permitido", descuentoValido(100), 100);
check("decimales se respetan", descuentoValido(12.5), 12.5);

sec("La cuenta de la línea");
const l = { cantidad: 20, precio_unitario: 20.08, descuento_pct: 0 };
check("20 x 20,08 = 401,60", Number(subtotalLinea(l).toFixed(2)), 401.6);
check("sin descuento, el total es el subtotal", Number(totalLinea(l).toFixed(2)), 401.6);
check("sin descuento no se descuenta nada", montoDescuento(l), 0);

const conDesc = { cantidad: 20, precio_unitario: 20.08, descuento_pct: 10 };
check("10% de 401,60 son 40,16", Number(montoDescuento(conDesc).toFixed(2)), 40.16);
check("y queda 361,44", Number(totalLinea(conDesc).toFixed(2)), 361.44);

check("100% deja la línea en 0", totalLinea({ cantidad: 5, precio_unitario: 1000, descuento_pct: 100 }), 0);
check("cantidad 0 es 0", totalLinea({ cantidad: 0, precio_unitario: 1000, descuento_pct: 10 }), 0);
check("precio 0 es 0", totalLinea({ cantidad: 3, precio_unitario: 0, descuento_pct: 10 }), 0);
// Un descuento fuera de rango no puede dar vuelta el signo de la línea.
check("un descuento negativo no agranda la línea", totalLinea({ cantidad: 2, precio_unitario: 100, descuento_pct: -50 }), 200);
check("un descuento de 300% no deja la línea negativa", totalLinea({ cantidad: 2, precio_unitario: 100, descuento_pct: 300 }), 0);

sec("El total de la orden");
const orden = [
  { cantidad: 10, precio_unitario: 1000, descuento_pct: 0 },    // 10.000
  { cantidad: 5, precio_unitario: 2000, descuento_pct: 10 },    // 10.000 − 1.000 = 9.000
  { cantidad: 1, precio_unitario: 500, descuento_pct: 100 },    // 0
];
check("suma con los descuentos aplicados", totalOrden(orden), 19000);
check("lo descontado en total", totalDescuento(orden), 1500);
check("una orden vacía es 0", totalOrden([]), 0);

sec("Qué se propone al elegir el artículo");
check("la vez pasada 20 dólares → 20 dólares",
  propuestaDesdeUltimaCompra({ moneda: "USD", costo_unitario_original: 20.08, costo_unitario: 132528 }),
  { precio: 20.08, moneda: "USD" });
check("la vez pasada en guaraníes",
  propuestaDesdeUltimaCompra({ moneda: "PYG", costo_unitario_original: 130112, costo_unitario: 130112 }),
  { precio: 130112, moneda: "PYG" });
// Compras viejas sin el precio original: queda el de guaraníes, y entonces la
// moneda propuesta tiene que ser PYG o se propondría 130.112 dólares.
check("sin precio original cae al de guaraníes, en PYG",
  propuestaDesdeUltimaCompra({ moneda: "USD", costo_unitario_original: 0, costo_unitario: 130112 }),
  { precio: 130112, moneda: "PYG" });
check("artículo que nunca se compró: no se propone nada", propuestaDesdeUltimaCompra(null), null);
check("sin ningún precio: no se propone nada",
  propuestaDesdeUltimaCompra({ moneda: "USD", costo_unitario_original: 0, costo_unitario: 0 }), null);

console.log(`\n${fallos === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasaron, ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
