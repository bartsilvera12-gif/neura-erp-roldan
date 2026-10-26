// Casos de la valoración de existencias (punto 1.6).
//
// Correr con:  node scripts/test-valoracion.mjs
//
// La lógica está copiada de src/lib/inventario/server/valoracion.ts sin los
// tipos, para poder correrla con node pelado. Si se toca aquella, hay que
// traer el cambio acá y volver a correr esto.

function deltaDe(m){
  if (m.cantidad_delta != null && Number.isFinite(m.cantidad_delta)) {
    return Number(m.cantidad_delta);
  }
  const abs = Math.abs(Number(m.cantidad) || 0);
  if (m.tipo === "ENTRADA") return abs;
  if (m.tipo === "SALIDA") return -abs;
  // AJUSTE sin delta: el sistema viejo guardaba solo el valor absoluto.
  // Adivinar el signo acá daría una valoración con pinta de exacta y mal.
  return null;
}

/**
 * Replay de los movimientos de UN producto, en orden cronológico.
 * Los movimientos tienen que venir ya filtrados por fecha y ordenados.
 */
function reconstruirProducto(movs){
  let stock = 0;
  let costo = 0;
  let indeterminados = 0;
  let resincronizaciones = 0;

  for (const m of movs) {
    const costoMov = Number(m.costo_unitario) || 0;
    const origen = String(m.origen ?? "");
    const fijado =
      m.stock_despues != null && Number.isFinite(Number(m.stock_despues))
        ? Number(m.stock_despues)
        : null;
    const delta = deltaDe(m);

    // ── Anulación de compra: deshace el promedio que esa compra formó ──────
    if (origen === "anulacion_compra") {
      const cant = Math.abs(Number(m.cantidad) || 0);
      const queda = stock - cant;
      if (queda > 0 && costoMov > 0) {
        const previo = (stock * costo - cant * costoMov) / queda;
        // Un costo negativo significa que faltan movimientos antes de este;
        // dejarlo pasar valuaría el stock en negativo.
        costo = previo > 0 ? previo : costo;
      } else if (queda <= 0) {
        costo = 0;
      }
      stock = queda > 0 ? queda : 0;
      continue;
    }

    // ── Anulación de venta: la mercadería vuelve como salió ───────────────
    if (origen === "anulacion_venta") {
      stock += Math.abs(Number(m.cantidad) || 0);
      continue;
    }

    const entraron =
      delta != null && delta > 0
        ? delta
        : fijado != null && fijado > stock
          ? fijado - stock
          : 0;

    if (entraron > 0 && costoMov > 0) {
      if (origen === "ajuste_manual") {
        // Un ajuste que suma unidades NO promedia: esas unidades aparecieron
        // en un conteo, no se compraron, y no hay precio real que mezclar.
        // Es además lo que hace el sistema en vivo.
        //
        // La excepción es el producto que todavía no tiene costo: ahí el del
        // ajuste es el único dato que existe, y descartarlo dejaría la
        // mercadería valuada en cero.
        if (costo <= 0) costo = costoMov;
      } else {
        // Entrada comprada: recalcula el promedio ponderado. Sin costo
        // informado no se toca el costo — mezclarlo con un cero bajaría el
        // promedio como si la mercadería hubiera entrado gratis.
        const total = stock + entraron;
        costo = total > 0 ? (stock * costo + entraron * costoMov) / total : costoMov;
      }
    }

    if (fijado != null) {
      // El movimiento dice con cuánto quedó: ese número manda.
      stock = fijado;
      resincronizaciones++;
      continue;
    }
    if (delta == null) { indeterminados++; continue; }
    // Una salida no cambia el costo promedio: sacar mercadería no cambia lo
    // que costó la que queda.
    stock += delta;
  }

  // El stock no puede ser negativo. Si la reconstrucción da negativo es que
  // faltan movimientos, no que haya deuda de mercadería.
  if (stock < 0) stock = 0;
  return { stock, costo, indeterminados, resincronizaciones };
}


const E=(c,cu,origen="compra")=>({tipo:"ENTRADA",origen,cantidad:c,cantidad_delta:null,stock_despues:null,costo_unitario:cu});
const S=(c,origen="venta")=>({tipo:"SALIDA",origen,cantidad:c,cantidad_delta:null,stock_despues:null,costo_unitario:0});
const Adelta=(d,cu=0)=>({tipo:"AJUSTE",origen:"ajuste_manual",cantidad:Math.abs(d),cantidad_delta:d,stock_despues:null,costo_unitario:cu});
const Afija=(antes,desp,cu=0)=>({tipo:"AJUSTE",origen:"ajuste_manual",cantidad:Math.abs(desp-antes),cantidad_delta:desp-antes,stock_despues:desp,costo_unitario:cu});
const AsinSigno=(c)=>({tipo:"AJUSTE",origen:"ajuste_manual",cantidad:c,cantidad_delta:null,stock_despues:null,costo_unitario:0});
const AnulC=(c,cu)=>({tipo:"SALIDA",origen:"anulacion_compra",cantidad:c,cantidad_delta:null,stock_despues:null,costo_unitario:cu});
const AnulV=(c,cu)=>({tipo:"ENTRADA",origen:"anulacion_venta",cantidad:c,cantidad_delta:null,stock_despues:null,costo_unitario:cu});

const casos=[
 ["compra simple",                [E(10,1000)],                         10, 1000, 0],
 ["CPP de dos compras",           [E(10,1000),E(10,2000)],              20, 1500, 0],
 ["venta no cambia el costo",     [E(10,1000),E(10,2000),S(15)],         5, 1500, 0],
 ["entrada sin costo no diluye",  [E(10,1000),E(10,0)],                 20, 1000, 0],
 ["compra USD dos cotizaciones",  [E(10,6400),E(5,7300)],               15, 6700, 0],
 ["ajuste resta",                 [E(10,1000),Adelta(-3)],               7, 1000, 0],
 ["AJUSTE FIJA, no suma",         [E(162,1000),Afija(0,200,1000)],     200, 1000, 0],
 ["ajuste suma: costo intacto",   [E(10,1000),Afija(10,20,9999)],       20, 1000, 0],
 ["ajuste 1ro: adopta su costo",  [Afija(0,10,20000)],                  10,20000, 0],
 ["ANULACION COMPRA revierte CPP",[E(5,300000),E(10,320000),AnulC(10,320000)], 5, 300000, 0],
 ["anulacion venta repone",       [E(10,1000),S(4),AnulV(4,1000)],      10, 1000, 0],
 ["ajuste viejo sin signo",       [E(10,1000),AsinSigno(3)],            10, 1000, 1],
 ["sin movimientos",              [],                                    0,    0, 0],
 ["stock negativo se corta en 0", [E(5,1000),S(9)],                      0, 1000, 0],
];
let mal=0;
for(const [n,movs,eStock,eCosto,eInd] of casos){
  const r=reconstruirProducto(movs);
  const ok = r.stock===eStock && Math.abs(r.costo-eCosto)<0.5 && r.indeterminados===eInd;
  if(!ok) mal++;
  console.log(`${ok?"ok  ":"MAL "} ${n.padEnd(31)} stock=${String(r.stock).padStart(4)} costo=${String(Math.round(r.costo)).padStart(7)} ind=${r.indeterminados}${ok?"":`   ESPERADO stock=${eStock} costo=${eCosto} ind=${eInd}`}`);
}
console.log(mal===0?`\n${casos.length}/${casos.length} correctos`:`\n${mal} FALLARON`);
