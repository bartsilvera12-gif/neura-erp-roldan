"""
Saca los datos de prueba, dejando solo lo migrado del sistema del cliente.

── CÓMO SE DISTINGUE PRUEBA DE REAL ─────────────────────────────────────────
  Todo lo que migré lleva una marca: las ventas arrancan con HIS-, las compras
  con HCO-, los clientes tienen `notas` con "Migrado del sistema anterior", los
  rubros y los turnos lo dicen en su descripción u observación. Lo que NO tiene
  marca es lo que estaba antes: las pruebas.

  No se borra por nombre ("PRUEBA", "QA") porque un cliente real podría
  llamarse así: se borra por ausencia de la marca de migración, que es un
  criterio que no depende de cómo alguien bautizó una fila.

── ANTES DE BORRAR, SE GUARDA ───────────────────────────────────────────────
  Todo lo que se va queda en un .json. Borrar no se puede deshacer, y "lo
  borré y no lo tengo" no es una respuesta aceptable si mañana resulta que una
  de esas filas importaba.
"""
import json, sys, urllib.request, urllib.parse
sys.path.insert(0, ".")
from migrar import URL, KEY, api

MARCA = "Migrado del sistema anterior"


def traer(tabla, campos="*", filtro="", paso=1000):
    salida, desde = [], 0
    while True:
        url = f"{URL}/rest/v1/{tabla}?select={campos}{filtro}"
        req = urllib.request.Request(url)
        req.add_header("apikey", KEY); req.add_header("Authorization", f"Bearer {KEY}")
        req.add_header("Accept-Profile", "roldanerp"); req.add_header("User-Agent", "curl/8.5.0")
        req.add_header("Range", f"{desde}-{desde+paso-1}")
        with urllib.request.urlopen(req, timeout=180) as r:
            lote = json.loads(r.read().decode())
        salida += lote
        if len(lote) < paso:
            return salida
        desde += paso


respaldo = {}

# ── Qué se va ───────────────────────────────────────────────────────────────
ventas = [v for v in traer("ventas", "id,numero_control,total,estado,fecha")
          if not (v["numero_control"] or "").startswith("HIS-")]
respaldo["ventas"] = ventas
ids_ventas = [v["id"] for v in ventas]

clientes = [c for c in traer("clientes", "id,nombre,ruc,notas") if MARCA not in (c["notas"] or "")]
respaldo["clientes"] = clientes

productos = [p for p in traer("productos", "id,sku,nombre,stock_actual,descripcion")
             if (p["sku"] or "").startswith(("QA-", "PRU-", "REV-"))]
respaldo["productos"] = productos

rubros = [r for r in traer("categorias_productos", "id,nombre,codigo,descripcion")
          if MARCA not in (r["descripcion"] or "")]
respaldo["categorias_productos"] = rubros

compras = [c for c in traer("compras", "id,numero_control,proveedor_nombre,total")
           if not (c["numero_control"] or "").startswith("HCO-")]
respaldo["compras"] = compras

cajas = [c for c in traer("cajas", "id,numero_caja,fecha_apertura,estado,observacion_apertura")
         if MARCA not in (c["observacion_apertura"] or "")]
respaldo["cajas"] = cajas

cat_cli = [c for c in traer("categorias_cliente", "id,nombre,orden")
           if c["nombre"] not in ("Precio Base", "Minorista", "Mayorista 1", "Mayorista 2",
                                  "Mayorista 3", "Mayorista 4")]
respaldo["categorias_cliente"] = cat_cli

anticipos = [a for a in traer("anticipos", "id,numero,monto,observacion")
             if MARCA not in (a["observacion"] or "")]
respaldo["anticipos"] = anticipos

print("A BORRAR:")
for k, v in respaldo.items():
    print(f"   {k:24s} {len(v):>6,}")

ruta = "/tmp/claude-0/-home-user/ff3cb10d-ed98-5489-a945-8feacb223c08/scratchpad/respaldo-datos-de-prueba.json"
with open(ruta, "w", encoding="utf-8") as fh:
    json.dump(respaldo, fh, ensure_ascii=False, indent=1)
print(f"\nrespaldo guardado en {ruta}")

if "--borrar" not in sys.argv:
    print("\n(corrida en seco: nada se borró. Agregar --borrar para hacerlo)")
    sys.exit(0)

# ── Borrado, en orden de dependencias ───────────────────────────────────────
def borrar_por_ids(tabla, campo, ids, lote=60):
    n = 0
    for i in range(0, len(ids), lote):
        trozo = ids[i : i + lote]
        api("DELETE", f"{tabla}?{campo}=in.({','.join(trozo)})", prefer="return=minimal")
        n += len(trozo)
    return n

print("\nBORRANDO...")
if ids_ventas:
    print("   ventas_items:", borrar_por_ids("ventas_items", "venta_id", ids_ventas))
    print("   ventas_pagos_detalle:", borrar_por_ids("ventas_pagos_detalle", "venta_id", ids_ventas))
    print("   movimientos de esas ventas:", borrar_por_ids("movimientos_inventario", "venta_id", ids_ventas))
    print("   ventas:", borrar_por_ids("ventas", "id", ids_ventas))

ids_cajas = [c["id"] for c in cajas]
if ids_cajas:
    print("   caja_movimientos:", borrar_por_ids("caja_movimientos", "caja_id", ids_cajas))
    print("   cajas:", borrar_por_ids("cajas", "id", ids_cajas))

for tabla, filas in (("compras", compras), ("anticipos", anticipos)):
    if filas:
        print(f"   {tabla}:", borrar_por_ids(tabla, "id", [f["id"] for f in filas]))

ids_prod = [p["id"] for p in productos]
if ids_prod:
    print("   movimientos de esos productos:", borrar_por_ids("movimientos_inventario", "producto_id", ids_prod))
    print("   stock por depósito:", borrar_por_ids("inventario_stock_ubicacion", "producto_id", ids_prod))
    print("   productos:", borrar_por_ids("productos", "id", ids_prod))

for tabla, filas in (("clientes", clientes), ("categorias_cliente", cat_cli),
                     ("categorias_productos", rubros)):
    if filas:
        print(f"   {tabla}:", borrar_por_ids(tabla, "id", [f["id"] for f in filas]))
print("\nlisto")
