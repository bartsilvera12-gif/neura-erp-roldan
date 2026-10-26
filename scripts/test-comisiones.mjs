// Casos del cálculo de comisiones y cartera (puntos 4.1, 4.4, 4.5).
// Correr con:  node scripts/test-comisiones.mjs
//
// Lógica copiada de src/lib/comisiones/calculo.ts sin los tipos.

const divisorIva = (t) => (t === "10%" ? 1.1 : t === "5%" ? 1.05 : 1);
const sinIva = (m, t) => (Number(m) || 0) / divisorIva(t);

function porcentajeAplicable(reglas, tipoId, catId, base) {
  const act = reglas.filter((r) => r.activo !== false);
  const b = (t, c) => act.find((r) => r.tipo_vendedor_id === t && r.categoria_id === c);
  if (tipoId && catId) { const e = b(tipoId, catId); if (e) return e.porcentaje; }
  if (catId) { const r = b(null, catId); if (r) return r.porcentaje; }
  if (tipoId) { const r = b(tipoId, null); if (r) return r.porcentaje; }
  const g = b(null, null); if (g) return g.porcentaje;
  return Number(base) || 0;
}

function comisionDeLinea(l, reglas, tipoId, pctBase, base = "margen") {
  const cant = Number(l.cantidad) || 0, iva = l.tipo_iva;
  const facturado = sinIva(l.precio_venta, iva) * cant;
  const lista = sinIva(l.precio_venta_original, iva) * cant;
  const costo = sinIva(l.costo_unitario, iva) * cant;
  const descuento = Math.max(0, lista - facturado);
  const ganancia = facturado - costo;
  const porcentaje = porcentajeAplicable(reglas, tipoId, l.categoria_id, pctBase);
  const sobre = base === "facturacion" ? facturado : ganancia;
  return { facturado, descuento, costo, ganancia, porcentaje, comision: sobre > 0 ? (sobre * porcentaje) / 100 : 0 };
}

const enCartera = (desde, dias, ahora = new Date()) => {
  if (!desde) return false;
  const d = new Date(desde); if (isNaN(d)) return false;
  return (ahora - d) / 86400000 < dias;
};
const diasRestantes = (desde, dias, ahora = new Date()) => {
  if (!desde) return 0;
  const d = new Date(desde); if (isNaN(d)) return 0;
  return Math.max(0, Math.ceil(dias - (ahora - d) / 86400000));
};

// ── casos ──────────────────────────────────────────────────────────────────
const L = (precio, lista, costo, cant = 1, cat = null, iva = "10%") =>
  ({ categoria_id: cat, cantidad: cant, precio_venta: precio,
     precio_venta_original: lista, costo_unitario: costo, tipo_iva: iva });

const HIERROS = "cat-hierros";
const INTERNO = "tipo-interno";
const reglas = [
  { tipo_vendedor_id: null,    categoria_id: null,    porcentaje: 8  },
  { tipo_vendedor_id: null,    categoria_id: HIERROS, porcentaje: 6  },
  { tipo_vendedor_id: INTERNO, categoria_id: null,    porcentaje: 11 },
  { tipo_vendedor_id: INTERNO, categoria_id: HIERROS, porcentaje: 14 },
];

let mal = 0;
const chk = (n, ok, det = "") => { if (!ok) mal++; console.log(`${ok ? "ok  " : "MAL "} ${n}${det ? "  → " + det : ""}`); };
const cerca = (a, b) => Math.abs(a - b) < 0.5;

// 4.5 — qué regla gana
chk("gana tipo+rubro",      porcentajeAplicable(reglas, INTERNO, HIERROS, 99) === 14);
chk("gana solo rubro",      porcentajeAplicable(reglas, "otro",  HIERROS, 99) === 6);
chk("gana solo tipo",       porcentajeAplicable(reglas, INTERNO, "otra",  99) === 11);
chk("cae en la general",    porcentajeAplicable(reglas, "otro",  "otra",  99) === 8);
chk("sin reglas usa la base", porcentajeAplicable([], INTERNO, HIERROS, 7) === 7);
chk("sin reglas ni base da 0", porcentajeAplicable([], null, null, 0) === 0);
chk("una regla inactiva no cuenta",
  porcentajeAplicable([{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 50, activo: false }], null, null, 9) === 9);

// 4.4 — el descuento baja la comisión solo
// costo 110.000 c/IVA = 100.000 sin IVA; lista 165.000 c/IVA = 150.000 sin IVA
const plena = comisionDeLinea(L(165000, 165000, 110000), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0);
chk("sin descuento: ganancia 50.000, comision 5.000",
  cerca(plena.ganancia, 50000) && cerca(plena.comision, 5000),
  `ganancia=${Math.round(plena.ganancia)} comision=${Math.round(plena.comision)}`);

const conDesc = comisionDeLinea(L(148500, 165000, 110000), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0);
chk("con 10% de descuento: ganancia 35.000, comision 3.500",
  cerca(conDesc.ganancia, 35000) && cerca(conDesc.comision, 3500),
  `ganancia=${Math.round(conDesc.ganancia)} comision=${Math.round(conDesc.comision)} descuento=${Math.round(conDesc.descuento)}`);

chk("el descuento queda registrado", cerca(conDesc.descuento, 15000), `${Math.round(conDesc.descuento)}`);

// sobre facturacion el descuento casi no afecta: por eso NO es la base elegida
const facturacion = comisionDeLinea(L(148500, 165000, 110000), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0, "facturacion");
chk("sobre facturacion la comision baja mucho menos",
  Math.round(facturacion.comision) === 13500 && facturacion.comision > conDesc.comision,
  `facturacion=${Math.round(facturacion.comision)} vs margen=${Math.round(conDesc.comision)}`);

// venta a perdida
const perdida = comisionDeLinea(L(99000, 165000, 110000), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0);
chk("a perdida: comision 0, no negativa", perdida.comision === 0 && perdida.ganancia < 0,
  `ganancia=${Math.round(perdida.ganancia)} comision=${perdida.comision}`);

// el IVA no se comisiona
const exenta = comisionDeLinea(L(150000, 150000, 100000, 1, null, "EXENTA"), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0);
chk("exenta: misma ganancia que con IVA sacado", cerca(exenta.ganancia, 50000), `${Math.round(exenta.ganancia)}`);

// cantidad
const tres = comisionDeLinea(L(165000, 165000, 110000, 3), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0);
chk("por 3 unidades: comision x3", cerca(tres.comision, 15000), `${Math.round(tres.comision)}`);

// recargo: vender MAS caro que la lista no es descuento negativo
const recargo = comisionDeLinea(L(180000, 165000, 110000), [{ tipo_vendedor_id: null, categoria_id: null, porcentaje: 10 }], null, 0);
chk("vender por encima de lista: descuento 0", recargo.descuento === 0, `${recargo.descuento}`);

// 4.1 — cartera
const hoy = new Date("2026-10-26T12:00:00Z");
chk("hace 10 dias sigue en cartera",  enCartera("2026-10-16T12:00:00Z", 30, hoy) === true);
chk("hace 31 dias ya se libero",      enCartera("2026-09-25T12:00:00Z", 30, hoy) === false);
chk("sin fecha no esta en cartera",   enCartera(null, 30, hoy) === false);
chk("quedan 20 dias",                 diasRestantes("2026-10-16T12:00:00Z", 30, hoy) === 20,
  String(diasRestantes("2026-10-16T12:00:00Z", 30, hoy)));
chk("liberado: 0 dias",               diasRestantes("2026-09-25T12:00:00Z", 30, hoy) === 0);

console.log(mal === 0 ? "\nTODOS LOS CASOS OK" : `\n${mal} FALLARON`);
process.exit(mal === 0 ? 0 : 1);
