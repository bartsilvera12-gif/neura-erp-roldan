// Casos del tope de descuento por usuario (punto 2.3).
// Correr con:  node scripts/test-descuento.mjs
//
// Lógica copiada de src/lib/ventas/server/descuento-maximo.ts sin los tipos.

const TOLERANCIA_PCT = 0.05;
const descuentoPctDeLinea = (base, final) => {
  const b = Number(base) || 0, f = Number(final) || 0;
  if (b <= 0) return 0;
  const pct = (1 - f / b) * 100;
  return pct > 0 ? pct : 0;
};
const validarTopeDescuento = (lineas, tope) => {
  if (tope == null) return null;
  for (const l of lineas) {
    const pct = descuentoPctDeLinea(l.precio_venta_original, l.precio_venta);
    if (pct > tope + TOLERANCIA_PCT) {
      const n = l.producto_nombre ? `"${l.producto_nombre}"` : "una línea";
      return tope === 0
        ? `Tu usuario no tiene permitido aplicar descuentos, y ${n} tiene ${pct.toFixed(1)}% menos que el precio de lista.`
        : `El descuento de ${n} es ${pct.toFixed(1)}% y tu tope es ${tope}%. Pedile a un administrador que lo autorice.`;
    }
  }
  return null;
};

const L = (orig, final, nombre = "ART") =>
  ({ producto_nombre: nombre, precio_venta_original: orig, precio_venta: final });

const casos = [
  ["sin tope: 50% pasa",            [L(10000, 5000)],            null, true],
  ["tope 10: sin descuento pasa",   [L(10000, 10000)],              10, true],
  ["tope 10: 10% justo pasa",       [L(10000, 9000)],               10, true],
  ["tope 10: 11% se rechaza",       [L(10000, 8900)],               10, false],
  ["tope 0: 1% se rechaza",         [L(10000, 9900)],                0, false],
  ["tope 0: sin descuento pasa",    [L(10000, 10000)],               0, true],
  ["precio SUBIDO no es descuento", [L(10000, 12000)],               0, true],
  ["sin precio de lista pasa",      [L(0, 5000)],                    0, true],
  ["la 2da linea se pasa",          [L(10000, 9500), L(10000, 7000)], 10, false],
  // Redondeo a guaraníes: 10% de 13.333 es 11.999,7 -> se guarda 12.000,
  // que mide 10,0002%. Rechazar eso seria rechazar el descuento permitido.
  ["redondeo a guaranies pasa",     [L(13333, 12000)],              10, true],
];

let mal = 0;
for (const [n, lineas, tope, debePasar] of casos) {
  const err = validarTopeDescuento(lineas, tope);
  const paso = err === null;
  const ok = paso === debePasar;
  if (!ok) mal++;
  console.log(`${ok ? "ok  " : "MAL "} ${n.padEnd(32)} ${paso ? "ACEPTA" : "RECHAZA"}${err ? "  → " + err.slice(0, 54) : ""}`);
}
console.log(mal === 0 ? `\n${casos.length}/${casos.length} correctos` : `\n${mal} FALLARON`);
