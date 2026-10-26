import { editarVentaPg, EdicionRechazada } from "@/lib/ventas/server/editar-venta-pg";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";

const EMP = "11111111-1111-1111-1111-111111111111";
const SUC = "22222222-2222-2222-2222-222222222222";
const VENTA = "bbbbbbbb-0000-0000-0000-000000000001";
const TOR = "aaaaaaaa-0000-0000-0000-000000000001";
const CHA = "aaaaaaaa-0000-0000-0000-000000000002";

const linea = (id: string, nombre: string, sku: string, cant: number, precio: number) => {
  const total = cant * precio;
  const sub = Math.round(total / 1.1);
  return { producto_id: id, producto_nombre: nombre, sku, cantidad: cant,
    precio_venta: precio, precio_venta_original: precio, tipo_iva: "10%" as const,
    subtotal: sub, monto_iva: total - sub, total_linea: total };
};

async function main() {
const pool = getChatPostgresPool()!;
const stock = async () => {
  const r = await pool.query(`SELECT nombre, stock_actual::float8 s FROM roldanerp.productos ORDER BY nombre`);
  return Object.fromEntries(r.rows.map((x: any) => [x.nombre, x.s]));
};
const base = { schema: "roldanerp", empresaId: EMP, sucursalId: SUC, ventaId: VENTA,
  usuarioId: null, usuarioNombre: "Karen" };

let fallos = 0;
const chk = (nombre: string, ok: boolean, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "MAL "} ${nombre}${detalle ? "  → " + detalle : ""}`);
};

console.log("stock inicial:", await stock());

// 1) Bajar 10 -> 6 tornillos. Stock tiene que subir de 90 a 94.
const r1 = await editarVentaPg({ ...base, motivo: "Se devolvieron 4", items: [linea(TOR,"TORNILLO","TOR-1",6,10000)] });
const s1 = await stock();
chk("bajar cantidad devuelve stock", s1.TORNILLO === 94, `TORNILLO=${s1.TORNILLO} (esperado 94)`);
chk("el numero de comprobante no cambia", r1.numeroControl === "VTA-000001");
chk("registra el cambio de total", r1.cambios.some(c => c.campo === "Total" && c.antes === 100000 && c.despues === 60000),
    JSON.stringify(r1.cambios.map(c => c.campo)));

// 2) Agregar un producto nuevo
const r2 = await editarVentaPg({ ...base, motivo: "Agrega chapa",
  items: [linea(TOR,"TORNILLO","TOR-1",6,10000), linea(CHA,"CHAPA","CHA-1",2,80000)] });
const s2 = await stock();
chk("agregar producto descuenta su stock", s2.CHAPA === 1, `CHAPA=${s2.CHAPA} (esperado 1)`);
chk("tornillo no se movio", s2.TORNILLO === 94, `TORNILLO=${s2.TORNILLO}`);
chk("detecta producto agregado", r2.cambios.some(c => c.campo === "Producto agregado"));

// 3) Stock insuficiente: pedir 50 chapas (hay 1 + las 2 que devuelve = 3)
let err3: any = null;
try { await editarVentaPg({ ...base, motivo: "Mucho", items: [linea(CHA,"CHAPA","CHA-1",50,80000)] }); }
catch (e) { err3 = e; }
const s3 = await stock();
chk("rechaza por stock insuficiente", err3 instanceof EdicionRechazada, String(err3?.message).slice(0,60));
chk("ROLLBACK: el stock quedo intacto", s3.CHAPA === 1 && s3.TORNILLO === 94,
    `CHAPA=${s3.CHAPA} TORNILLO=${s3.TORNILLO} (esperado 1 y 94)`);
const its = await pool.query(`SELECT count(*)::int n FROM roldanerp.ventas_items WHERE venta_id=$1`, [VENTA]);
chk("ROLLBACK: los items siguen siendo 2", its.rows[0].n === 2, `n=${its.rows[0].n}`);

// 4) Editar sin cambiar nada
let err4: any = null;
try { await editarVentaPg({ ...base, motivo: "Igual",
  items: [linea(TOR,"TORNILLO","TOR-1",6,10000), linea(CHA,"CHAPA","CHA-1",2,80000)] }); }
catch (e) { err4 = e; }
chk("rechaza una edicion sin cambios", err4 instanceof EdicionRechazada, String(err4?.message).slice(0,50));

// 5) Sin motivo
let err5: any = null;
try { await editarVentaPg({ ...base, motivo: "   ", items: [linea(TOR,"TORNILLO","TOR-1",1,10000)] }); }
catch (e) { err5 = e; }
chk("exige motivo", err5 instanceof EdicionRechazada);

// 6) Venta anulada
await pool.query(`UPDATE roldanerp.ventas SET estado='anulada' WHERE id=$1`, [VENTA]);
let err6: any = null;
try { await editarVentaPg({ ...base, motivo: "x", items: [linea(TOR,"TORNILLO","TOR-1",1,10000)] }); }
catch (e) { err6 = e; }
chk("no edita una venta anulada", err6 instanceof EdicionRechazada && err6.status === 409);
await pool.query(`UPDATE roldanerp.ventas SET estado='completada' WHERE id=$1`, [VENTA]);

// 7) El historial quedo bien
const h = await pool.query(`SELECT venta_numero, motivo, total_antes::float8 ta, total_despues::float8 td,
  jsonb_array_length(cambios) nc FROM roldanerp.ventas_ediciones ORDER BY fecha`);
chk("se registraron 2 ediciones", h.rows.length === 2, `${h.rows.length}`);
console.log("\nhistorial:");
for (const r of h.rows) console.log(`   ${r.venta_numero}  "${r.motivo}"  ${r.ta} -> ${r.td}  (${r.nc} cambios)`);

// 8) Movimientos generados
const m = await pool.query(`SELECT origen, tipo, sum(cantidad)::float8 q FROM roldanerp.movimientos_inventario
  GROUP BY origen, tipo ORDER BY origen`);
console.log("\nmovimientos:");
for (const r of m.rows) console.log(`   ${r.origen.padEnd(24)} ${r.tipo.padEnd(8)} ${r.q}`);

// Cuadratura final: stock + lo que la venta tiene vendido = stock original
const final = await stock();
const vendidos = await pool.query(`SELECT producto_nombre, sum(cantidad)::float8 q FROM roldanerp.ventas_items WHERE venta_id=$1 GROUP BY 1`, [VENTA]);
const v = Object.fromEntries(vendidos.rows.map((x:any)=>[x.producto_nombre,x.q]));
chk("CUADRA tornillo: stock + vendido = 100", final.TORNILLO + (v.TORNILLO ?? 0) === 100, `${final.TORNILLO} + ${v.TORNILLO ?? 0}`);
chk("CUADRA chapa: stock + vendido = 3", final.CHAPA + (v.CHAPA ?? 0) === 3, `${final.CHAPA} + ${v.CHAPA ?? 0}`);

console.log(fallos === 0 ? "\nTODOS LOS CASOS OK" : `\n${fallos} FALLARON`);
await pool.end();
process.exit(fallos === 0 ? 0 : 1);

}
main();
