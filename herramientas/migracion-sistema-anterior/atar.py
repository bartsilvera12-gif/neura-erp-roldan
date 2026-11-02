
"""
Ata las ventas y los anticipos ya migrados a su turno de caja.

Se puede correr tantas veces como haga falta: escribir el mismo caja_id dos
veces no cambia nada. Está aparte porque son miles de pedidos y es la parte
que se corta cuando el servidor cierra conexiones.
"""
import sys
sys.path.insert(0, ".")
from collections import defaultdict
import dump
from migrar import F, api, uid

aperturas = {}
for a in dump.filas(F, "apertura"):
    f = (a["apefecha"] or "")
    if f and not f.startswith("0000") and a["apecodigo"] != "0":
        aperturas[a["apecodigo"]] = uid("apertura", a["apecodigo"])
print(f"turnos: {len(aperturas):,}")

por_caja = defaultdict(list)
for v in dump.filas(F, "venta"):
    cid = aperturas.get(v["apecodigo"])
    if cid:
        por_caja[cid].append(uid("venta", v["vencodigo"]))
total = sum(len(x) for x in por_caja.values())
print(f"ventas a atar: {total:,} en {len(por_caja):,} turnos")

hechas = 0
for cid, ids in por_caja.items():
    for i in range(0, len(ids), 120):
        trozo = ids[i : i + 120]
        api("PATCH", f"ventas?id=in.({','.join(trozo)})", {"caja_id": cid}, prefer="return=minimal")
        hechas += len(trozo)
        if hechas % 6000 < 120:
            print(f"   {hechas:,}/{total:,}", flush=True)
print(f"ventas atadas: {hechas:,}")

# Los anticipos de a uno son 948 pedidos: se agrupan por turno igual que las ventas.
por_caja_ant = defaultdict(list)
for a in dump.filas(F, "anticipo"):
    cid = aperturas.get(a["apecodigo"])
    if cid:
        por_caja_ant[cid].append(uid("anticipo", a["antcodigo"]))
n = 0
for cid, ids in por_caja_ant.items():
    api("PATCH", f"anticipos?id=in.({','.join(ids)})", {"caja_id": cid}, prefer="return=minimal")
    n += len(ids)
print(f"anticipos atados: {n:,}")
