import sys, collections
sys.path.insert(0, ".")
import dump
from migrar import F, api, uid, num, txt, MIGRADO

ap = {a["apecodigo"]: a for a in dump.filas(F, "apertura")}
no_efectivo = collections.defaultdict(lambda: collections.defaultdict(float))
for c in dump.filas(F, "apertura_cobranza"):
    for medio, campo in (("cheque", "chemonto"), ("tarjeta", "tarmonto"),
                         ("depósito", "depmonto"), ("nota de crédito", "Notmonto")):
        m = num(c[campo])
        if m > 0:
            no_efectivo[c["apecodigo"]][medio] += m

n = 0
for ape, medios in no_efectivo.items():
    a = ap.get(ape)
    if not a:
        continue
    detalle = ", ".join(f"Gs. {m:,.0f} en {k}" for k, m in sorted(medios.items()))
    partes = []
    if txt(a["comentario"], 400):
        partes.append(txt(a["comentario"], 400))   # lo que escribió el cajero, primero
    partes.append(f"[{MIGRADO}. Turno {ape} del sistema anterior.]")
    partes.append(f"El monto esperado del sistema anterior incluye cobranzas que no entraron al cajón: {detalle}.")
    api("PATCH", f"cajas?id=eq.{uid('apertura', ape)}",
        {"observacion_cierre": " ".join(partes)[:1000]}, prefer="return=minimal")
    n += 1
print(f"turnos rearmados con su comentario original + la explicación: {n}")
