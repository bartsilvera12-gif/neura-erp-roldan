"""
Contraste entre el sistema viejo y el nuevo, fila por fila y guaraní por
guaraní. Sin esto, "la migración terminó" es una afirmación sin respaldo.
"""
import sys, json, urllib.request, collections
sys.path.insert(0, ".")
import dump
from migrar import URL, KEY, F

def traer(tabla, campos, paso=1000):
    # PostgREST corta en 1.000 filas por página (max-rows del servidor): pedir
    # 10.000 devuelve 1.000 y hace creer que ahí se terminó.
    salida, desde = [], 0
    while True:
        req = urllib.request.Request(f"{URL}/rest/v1/{tabla}?select={campos}")
        req.add_header("apikey", KEY); req.add_header("Authorization", f"Bearer {KEY}")
        req.add_header("Accept-Profile", "roldanerp"); req.add_header("User-Agent", "curl/8.5.0")
        req.add_header("Range-Unit", "items"); req.add_header("Range", f"{desde}-{desde+paso-1}")
        with urllib.request.urlopen(req, timeout=300) as r:
            lote = json.loads(r.read().decode())
        salida += lote
        if len(lote) < paso: break  # la última página vino incompleta
        desde += paso
    return salida

print("── CONTEOS ──")
viejo = {
    "productos": sum(1 for a in dump.filas(F, "articulo")
                     if (a["artdescrip"] or "").strip() and (a["artdescrip"] or "").strip().upper() != "DATOS EXPORTADO"),
    "clientes": sum(1 for c in dump.filas(F, "cliente") if (c["clidescrip"] or "").strip()),
    "anticipos": sum(1 for a in dump.filas(F, "anticipo")
                     if (a["antfecha"] or "").strip() and not (a["antfecha"] or "").startswith("0000") and float(a["antmonto"] or 0) > 0),
}
print("   sistema viejo:", viejo)

ventas = traer("ventas", "numero_control,fecha,total,estado")
mig = [v for v in ventas if (v["numero_control"] or "").startswith("HIS-")]
print(f"   ventas migradas en la base nueva: {len(mig):,}   (total en la tabla: {len(ventas):,})")

print("\n── FACTURACIÓN POR AÑO ──")
# Viejo
va = collections.defaultdict(float); vc = collections.Counter()
for v in dump.filas(F, "venta"):
    f = (v["venfecha"] or "")
    if not f or f.startswith("0000"): continue
    if v["estcodigo"] == "2": continue          # anuladas no facturan
    va[f[:4]] += float(v["venmonto"] or 0); vc[f[:4]] += 1
# Nuevo
na = collections.defaultdict(float); nc = collections.Counter()
for v in mig:
    if v["estado"] == "anulada": continue
    a = (v["fecha"] or "")[:4]
    na[a] += float(v["total"] or 0); nc[a] += 1

print(f"   {'año':5s} {'ventas viejo':>13s} {'ventas nuevo':>13s} {'Gs. viejo':>20s} {'Gs. nuevo':>20s} {'dif':>12s}")
tv = tn = 0.0
for a in sorted(set(va) | set(na)):
    d = na[a] - va[a]; tv += va[a]; tn += na[a]
    print(f"   {a:5s} {vc[a]:>13,} {nc[a]:>13,} {va[a]:>20,.0f} {na[a]:>20,.0f} {d:>12,.0f}")
print(f"   {'TOTAL':5s} {sum(vc.values()):>13,} {sum(nc.values()):>13,} {tv:>20,.0f} {tn:>20,.0f} {tn-tv:>12,.0f}")

print("\n── ANULADAS ──")
anv = sum(1 for v in dump.filas(F, "venta") if v["estcodigo"] == "2")
ann = sum(1 for v in mig if v["estado"] == "anulada")
print(f"   viejo: {anv:,}   nuevo: {ann:,}")

print("\n── STOCK ──")
sv = {s["artcodigo"]: float(s["existencia"] or 0) for s in dump.filas(F, "stock") if s["succodigo"] == "1"}
costos = {a["artcodigo"]: float(a["Artprecompra"] or 0) for a in dump.filas(F, "articulo")}
val_v = sum(q * costos.get(k, 0) for k, q in sv.items() if q > 0)
prods = traer("productos", "sku,stock_actual,costo_promedio")
val_n = sum((p["stock_actual"] or 0) * (p["costo_promedio"] or 0) for p in prods if (p["stock_actual"] or 0) > 0)
print(f"   valorizado viejo: Gs. {val_v:,.0f}")
print(f"   valorizado nuevo: Gs. {val_n:,.0f}   (incluye los 6 productos de prueba que ya estaban)")
print(f"   unidades viejo: {sum(q for q in sv.values() if q>0):,.0f}   nuevo: {sum((p['stock_actual'] or 0) for p in prods if (p['stock_actual'] or 0)>0):,.0f}")


print("\n── STOCK, PRODUCTO POR PRODUCTO ──")
sku_de = {}
for a in dump.filas(F, "articulo"):
    n = (a["artdescrip"] or "").strip()
    if not n or n.upper() == "DATOS EXPORTADO":
        continue
    sku_de[a["artcodigo"]] = (a["artcodrefe"] or "").strip() or f"ART-{a['artcodigo']}"
viejo_por_sku = {}
for k, q in sv.items():
    if k in sku_de:
        viejo_por_sku[sku_de[k]] = viejo_por_sku.get(sku_de[k], 0) + q
nuevo_por_sku = {}
for p_ in prods:
    nuevo_por_sku[p_["sku"]] = nuevo_por_sku.get(p_["sku"], 0) + (p_["stock_actual"] or 0)
difs = []
for sku, q in viejo_por_sku.items():
    n = nuevo_por_sku.get(sku)
    if n is None:
        difs.append((sku, q, "NO ESTÁ"))
    elif abs(n - q) > 0.001:
        difs.append((sku, q, n))
print(f"   SKUs del viejo: {len(viejo_por_sku):,}   con diferencia: {len(difs)}")
for d in difs[:10]:
    print("   ", d)
sobran = [s_ for s_ in nuevo_por_sku if s_ not in viejo_por_sku]
print(f"   SKUs en la base nueva que no venían del viejo: {len(sobran)} → {sobran[:10]}")
