/**
 * «Ver órdenes de venta» del perfil: que la casilla sirva en todos los roles.
 *
 * El caso que reportó el cliente: en el perfil del SUPERVISOR la casilla
 * estaba y no hacía nada, porque el techo del supervisor cortaba antes de
 * mirarla.
 *
 * Correr:  npm run test:acceso-ordenes-venta
 */
import {
  puedeVerSidebarSlugPorRol,
  slugsEfectivosPorRol,
} from "../src/lib/roles/erp-role-access";

let fallos = 0, ok = 0;
function check(n: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${n}`); }
  else { fallos++; console.error(`  FALLÓ ${n}\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`); }
}
const sec = (t: string) => console.log(`\n— ${t} —`);
const VER = ["ver_ordenes_venta"];
const ver = (slug: string, rol: string, f?: string[]) => puedeVerSidebarSlugPorRol(slug, rol, f ?? []);
const slugs = (s: string[], rol: string, f?: string[]) => [...slugsEfectivosPorRol(new Set(s), rol, f ?? [])].sort();

sec("Supervisor: el caso que faltaba");
check("sin la casilla NO ve órdenes de venta", ver("ordenes_venta", "supervisor"), false);
check("con la casilla SÍ las ve", ver("ordenes_venta", "supervisor", VER), true);
check("el guard de rutas lo deja entrar", slugs(["ordenes_venta", "cierres-caja"], "supervisor", VER), ["cierres-caja", "ordenes_venta"]);
check("…y sin la casilla no", slugs(["ordenes_venta", "cierres-caja"], "supervisor"), ["cierres-caja"]);
// La casilla levanta la veda del rol, no reparte módulos.
check("con la casilla pero sin el módulo, no entra", slugs(["cierres-caja"], "supervisor", VER), ["cierres-caja"]);
// El techo sigue siendo corto para todo lo demás.
check("la casilla no le abre el inventario", ver("inventario", "supervisor", VER), false);
check("ni la configuración", ver("configuracion", "supervisor", VER), false);
check("ni el dashboard", ver("dashboard", "supervisor", VER), false);
check("el guard no le arrastra el resto", slugs(["inventario", "compras", "ordenes_venta"], "supervisor", VER), ["ordenes_venta"]);
check("sigue viendo los cierres de caja", ver("cierres-caja", "supervisor"), true);

sec("Usuario limitado (cajera, vendedor externo): como antes");
check("la cajera no ve órdenes de venta", ver("ordenes_venta", "usuario"), false);
check("el vendedor externo sí, con la casilla", ver("ordenes_venta", "usuario", VER), true);
check("el guard lo deja entrar con la casilla", slugs(["ordenes_venta", "ventas"], "usuario", VER), ["ordenes_venta", "ventas"]);
check("y sin la casilla no", slugs(["ordenes_venta", "ventas"], "usuario"), ["ventas"]);
check("el dashboard sigue vedado aunque tenga la casilla", ver("dashboard", "usuario", VER), false);

sec("Administrador: no cambia nada");
check("ve órdenes de venta sin casilla", ver("ordenes_venta", "administrador"), true);
check("no se le recorta nada", slugs(["inventario", "compras", "ordenes_venta"], "administrador"), ["compras", "inventario", "ordenes_venta"]);

sec("Rol desconocido: no se recorta (un error de red no deja a nadie afuera)");
check("ve el slug", ver("ordenes_venta", null), true);
check("no se le recortan los módulos", slugs(["inventario", "ordenes_venta"], null), ["inventario", "ordenes_venta"]);

console.log(`\n${fallos === 0 ? "TODO OK" : "HAY FALLOS"} — ${ok} pasaron, ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
