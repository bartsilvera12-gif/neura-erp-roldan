/**
 * Historial de precios de un artículo: precio en dólares, totales y variación.
 *
 * Correr:  npm run test:historial-precios
 */
import {
  precioEnDolares, totalEnDolares, totalesHistorial, variacionPorcentual,
  type FilaHistorial,
} from "../src/lib/compras/historial-precios";

let fallos = 0, ok = 0;
function check(n: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${n}`); }
  else { fallos++; console.error(`  FALLÓ ${n}\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`); }
}
const sec = (t: string) => console.log(`\n— ${t} —`);

const base: FilaHistorial = {
  numero_control: "COMP-000001", fecha: "2026-11-05", producto_id: "p1",
  producto_nombre: "VARILLA CONFORMADA 16MM", proveedor_nombre: "ACEROS ASUNCION",
  numero_factura: "003-001-0000014148", cantidad: 24,
  costo_unitario: 134178, costo_unitario_original: 20.33, moneda: "USD",
  tipo_cambio: 6600, total: 3220272,
};

sec("El precio en dólares");
check("compra en dólares: el precio que se tipeó", precioEnDolares(base), 20.33);
check("compra en guaraníes: no hay precio en dólares",
  precioEnDolares({ ...base, moneda: "PYG", costo_unitario_original: 134178, tipo_cambio: 1 }), null);
// Compras viejas que no guardaron el precio original: se deduce con su TC.
check("sin precio original se deduce con el tipo de cambio",
  precioEnDolares({ ...base, costo_unitario_original: 0, costo_unitario: 132000, tipo_cambio: 6600 }), 20);
check("sin precio original y sin TC: no se inventa",
  precioEnDolares({ ...base, costo_unitario_original: 0, tipo_cambio: 0 }), null);
check("sin ningún precio: null", precioEnDolares({ ...base, costo_unitario_original: 0, costo_unitario: 0 }), null);

sec("El total de la línea en dólares");
check("24 x 20,33 = 487,92", Number(totalEnDolares(base)?.toFixed(2)), 487.92);
check("compra en guaraníes: null", totalEnDolares({ ...base, moneda: "PYG" }), null);
check("cantidad 0 da 0", totalEnDolares({ ...base, cantidad: 0 }), 0);

sec("Los totales del pie");
const filas: FilaHistorial[] = [
  { ...base, cantidad: 24, total: 3220272 },
  { ...base, cantidad: 16, total: 2081792 },
  // Una compra en guaraníes: suma en Gs. y en cantidad, pero no en dólares.
  { ...base, moneda: "PYG", tipo_cambio: 1, costo_unitario_original: 130112, costo_unitario: 130112, cantidad: 10, total: 1301120 },
];
const t = totalesHistorial(filas);
check("total en guaraníes", t.gs, 3220272 + 2081792 + 1301120);
check("total de unidades", t.cantidad, 50);
check("cuántas compras", t.compras, 3);
check("total en dólares: solo las compras en dólares", Number(t.usd.toFixed(2)), Number((24 * 20.33 + 16 * 20.33).toFixed(2)));
const vacio = totalesHistorial([]);
check("sin compras, todo en cero", vacio, { gs: 0, usd: 0, cantidad: 0, compras: 0 });

sec("Cuánto cambió el precio respecto de la compra anterior");
// Las filas van de la más nueva a la más vieja.
const serie: FilaHistorial[] = [
  { ...base, costo_unitario: 134178 },  // la más nueva
  { ...base, costo_unitario: 130112 },
  { ...base, costo_unitario: 130112 },
];
check("subió de 130.112 a 134.178", Number(variacionPorcentual(serie, 0)?.toFixed(2)), 3.13);
check("no cambió", variacionPorcentual(serie, 1), 0);
check("la más vieja no tiene con qué comparar", variacionPorcentual(serie, 2), null);
check("una sola compra: null", variacionPorcentual([base], 0), null);
check("si el precio anterior es 0, no se divide por cero",
  variacionPorcentual([{ ...base, costo_unitario: 100 }, { ...base, costo_unitario: 0 }], 0), null);
check("una baja da negativo",
  Number(variacionPorcentual([{ ...base, costo_unitario: 90 }, { ...base, costo_unitario: 100 }], 0)?.toFixed(2)), -10);

console.log(`\n${fallos === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasaron, ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
