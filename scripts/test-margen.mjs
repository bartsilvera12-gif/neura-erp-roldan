// Casos de margen y remarcación (punto 1.7).
// Correr con:  node scripts/test-margen.mjs
//
// Lógica copiada de src/lib/precios/margen.ts sin los tipos, para correrla
// con node pelado. Si se toca aquella, traer el cambio acá.

const margenSobreVenta = (costo, precio) => {
  const p = Number(precio) || 0;
  if (p <= 0) return 0;
  return ((p - (Number(costo) || 0)) / p) * 100;
};
const remarcacionSobreCosto = (costo, precio) => {
  const c = Number(costo) || 0;
  if (c <= 0) return null;
  return (((Number(precio) || 0) - c) / c) * 100;
};
const precioDesdeRemarcacion = (costo, pct) => (Number(costo) || 0) * (1 + (Number(pct) || 0) / 100);

const casos = [
  // [nombre, costo, precio, margen esperado, remarcacion esperada]
  ["el caso que se confunde",   100000, 150000,  33.333,   50],
  ["remarcacion 100%",          100000, 200000,  50,      100],
  ["se vende al costo",         100000, 100000,   0,        0],
  ["se vende a perdida",        100000,  80000, -25,      -20],
  ["sin costo cargado",              0,  50000, 100,     null],
  ["precio cero",               100000,      0,   0,     -100],
  ["caso real del taladro",     300000, 450000,  33.333,   50],
];
let mal = 0;
for (const [n, c, p, em, er] of casos) {
  const m = margenSobreVenta(c, p);
  const r = remarcacionSobreCosto(c, p);
  const okM = Math.abs(m - em) < 0.01;
  const okR = er === null ? r === null : (r != null && Math.abs(r - er) < 0.01);
  if (!okM || !okR) mal++;
  console.log(`${okM && okR ? "ok  " : "MAL "} ${n.padEnd(26)} costo=${String(c).padStart(7)} precio=${String(p).padStart(7)}  margen=${m.toFixed(2)}%  remarcacion=${r === null ? "—" : r.toFixed(2) + "%"}`);
}

// La remarcacion y el precio tienen que ser inversas exactas.
const ida = precioDesdeRemarcacion(100000, 60);
const vuelta = remarcacionSobreCosto(100000, ida);
const okIV = Math.abs(vuelta - 60) < 1e-9;
if (!okIV) mal++;
console.log(`${okIV ? "ok  " : "MAL "} ${"ida y vuelta 60%".padEnd(26)} costo=100000 -> precio=${ida} -> remarcacion=${vuelta.toFixed(2)}%`);

console.log(mal === 0 ? `\n${casos.length + 1}/${casos.length + 1} correctos` : `\n${mal} FALLARON`);
