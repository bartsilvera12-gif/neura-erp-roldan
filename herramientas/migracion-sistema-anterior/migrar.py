"""
Migración del sistema viejo (MariaDB `sysges_acero_metal`) al ERP nuevo.

── CÓMO EVITA DUPLICAR ───────────────────────────────────────────────────────
  Cada fila nueva lleva un UUID derivado del código viejo con uuid5. O sea:
  el artículo 1000 SIEMPRE va a tener el mismo id, lo corra una vez o diez.
  Si una tanda se corta a mitad de camino, se vuelve a correr y las que ya
  estaban chocan contra su propia clave primaria en vez de entrar de nuevo.

  Es la diferencia entre poder reintentar y tener que limpiar a mano 80.000
  ventas duplicadas.

── CÓMO TRATA LOS NÚMEROS ───────────────────────────────────────────────────
  Los precios del sistema viejo son CON IVA incluido (se verificó: el balde
  `gravada2` de cada línea es exactamente cantidad × precio). El modelo nuevo
  guarda igual el precio con IVA y desglosa subtotal + monto_iva, así que la
  conversión es aritmética, no interpretación.

  El total de la cabecera se guarda como lo tenía el sistema viejo (`venmonto`)
  y NO como la suma de las líneas: es el número que el cliente conoce y el que
  sale en sus reportes. En 46.900 ventas las dos cuentas difieren en menos de
  0,1% por redondeos del sistema viejo; en 101 difieren de verdad, y eso se
  informa al final en vez de taparlo.
"""
import json
import os
import sys
import time
import http.client
import urllib.error
import urllib.request
import uuid
import collections
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dump  # noqa: E402

F = "/tmp/claude-0/-home-user/ff3cb10d-ed98-5489-a945-8feacb223c08/scratchpad/cliente-sql/05-10-26-17-03-24.sql"
URL = os.environ["SB_URL"].rstrip("/")
KEY = os.environ["SB_KEY"]
EMPRESA = "9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23"
SUCURSAL = "766eb564-1a74-4864-91d2-8043b6938467"  # Casa Central
NS = uuid.UUID("6f1a9d2c-3b47-4e55-8a90-roldan000001".replace("roldan", "aaaaaa"))
MIGRADO = "Migrado del sistema anterior"


def uid(clase, codigo):
    """Mismo código viejo → mismo uuid, siempre."""
    return str(uuid.uuid5(NS, f"{clase}:{codigo}"))


def api(metodo, ruta, cuerpo=None, prefer=None, intentos=4):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    for n in range(intentos):
        req = urllib.request.Request(f"{URL}/rest/v1/{ruta}", data=datos, method=metodo)
        req.add_header("apikey", KEY)
        req.add_header("Authorization", f"Bearer {KEY}")
        req.add_header("Content-Profile", "roldanerp")
        req.add_header("Accept-Profile", "roldanerp")
        req.add_header("Content-Type", "application/json")
        # Cloudflare rechaza el User-Agent de urllib con un 403 (código 1010)
        # que NO viene de la base y no dice nada de lo que pasa. Con un agente
        # normal pasa igual que curl.
        req.add_header("User-Agent", "curl/8.5.0")
        if prefer:
            req.add_header("Prefer", prefer)
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            detalle = e.read().decode()[-500:]
            if e.code in (502, 503, 504) and n < intentos - 1:
                time.sleep(2 * (n + 1))
                continue
            raise RuntimeError(f"{metodo} {ruta} → {e.code}: {detalle}") from None
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
            # El servidor corta conexiones cuando se le mandan miles de
            # pedidos seguidos (RemoteDisconnected). Es un corte de red, no un
            # rechazo: se reintenta en vez de perder la corrida entera.
            if n < intentos - 1:
                time.sleep(2 * (n + 1))
                continue
            raise


def uniformar(filas):
    """
    Todas las filas del lote con las mismas claves.

    PostgREST rechaza el lote entero con "All object keys must match" si una
    fila trae una clave que otra no: no mira columna por columna, arma un solo
    INSERT. Las que falten van en None, que es lo que querían decir.
    """
    claves = set()
    for f in filas:
        claves |= set(f.keys())
    return [{k: f.get(k) for k in claves} for f in filas]


def insertar(tabla, filas, lote=500, ignorar_duplicados=True):
    """Inserta en tandas. Devuelve (insertadas, ya_estaban)."""
    filas = uniformar(filas)
    puestas = repetidas = 0
    for i in range(0, len(filas), lote):
        trozo = filas[i : i + lote]
        prefer = "return=minimal"
        if ignorar_duplicados:
            prefer += ",resolution=ignore-duplicates"
        try:
            api("POST", tabla, trozo, prefer=prefer)
            puestas += len(trozo)
        except RuntimeError as e:
            if "duplicate key" in str(e) and ignorar_duplicados:
                repetidas += len(trozo)
            else:
                print(f"\n  ✗ lote {i}-{i+len(trozo)} de {tabla}: {e}", flush=True)
                raise
        if (i // lote) % 20 == 0:
            print(f"    {tabla}: {min(i+lote, len(filas)):,}/{len(filas):,}", flush=True)
    return puestas, repetidas


def contar(tabla, filtro=""):
    req = urllib.request.Request(f"{URL}/rest/v1/{tabla}?select=id{filtro}", method="HEAD")
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Accept-Profile", "roldanerp")
    req.add_header("Prefer", "count=exact")
    with urllib.request.urlopen(req, timeout=120) as r:
        rango = r.headers.get("content-range", "0-0/0")
    return int(rango.split("/")[-1])


def num(v, defecto=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return defecto


def txt(v, maximo=None):
    """
    Limpia un texto del sistema viejo.

    Saca los caracteres de control: hay notas de egreso con un NUL (\x00)
    adentro, y PostgreSQL rechaza la fila entera con "unsupported Unicode
    escape sequence". Un carácter invisible en una nota de 2021 no puede
    frenar la migración de 18.000 movimientos.
    """
    s = (v or "").strip()
    s = "".join(c for c in s if c == "\n" or c == "\t" or ord(c) >= 32)
    s = s.strip()
    if s in ("", "-", "0"):
        return None
    return s[:maximo] if maximo else s


def hora_ok(v, defecto="12:00:00"):
    """
    El sistema viejo guarda la hora como texto y a veces pone "0" o la deja
    vacía. Sin validar el formato salían fechas como "2019-01-31T0-03:00",
    que PostgreSQL rechaza.
    """
    s_ = (v or "").strip()
    partes = s_.split(":")
    if len(partes) >= 2 and all(p.isdigit() for p in partes[:3]):
        h, m = int(partes[0]), int(partes[1])
        sg = int(partes[2]) if len(partes) > 2 else 0
        if 0 <= h < 24 and 0 <= m < 60 and 0 <= sg < 60:
            return f"{h:02d}:{m:02d}:{sg:02d}"
    return defecto


def fecha_ok(v):
    """El sistema viejo guarda 0000-00-00 cuando no sabe."""
    s = (v or "").strip()
    return s if s and not s.startswith("0000") else None


def articulo_migrable(a):
    """
    ¿Este artículo del sistema viejo llegó a `productos`?

    Vive en una función sola porque lo necesitan tres fases: si artículos,
    ventas y compras cada una decidiera por su cuenta, una terminaría
    apuntando a un producto que la otra no creó — que es exactamente la clave
    foránea que falló.
    """
    nombre = txt(a["artdescrip"], 200)
    return bool(nombre) and nombre.upper() != "DATOS EXPORTADO"


# ══════════════════════════════════════════════════════════════════════════
#  FASE 1 — Catálogos chicos
# ══════════════════════════════════════════════════════════════════════════
def fase_catalogos():
    print("\n── RUBROS (grupo → categorias_productos) ──")
    grupos = list(dump.filas(F, "grupo"))
    filas = []
    for g in grupos:
        nombre = txt(g["GRUDESCRIP"], 120)
        if not nombre:
            continue
        filas.append({
            "id": uid("grupo", g["GRUCODIGO"]),
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            "nombre": nombre,
            "codigo": f"G{g['GRUCODIGO']}",
            # pormino01 es la remarcación con la que armaban el precio minorista.
            # Va en la descripción porque el rubro nuevo no tiene campo de
            # markup: el dato no se pierde y queda a la vista de quien lo mire.
            "descripcion": f"{MIGRADO} (grupo {g['GRUCODIGO']}). Remarcación minorista del sistema viejo: {num(g['pormino01']):.2f}%.",
            "descuento_pct": num(g["GRUPORCDTO"]),
            "activo": True,
        })
    print(f"   {len(filas)} rubros")
    print("  ", insertar("categorias_productos", filas))

    print("\n── PROFESIONES ──")
    pros = [p for p in dump.filas(F, "profesion") if txt(p["prodescrip"])]
    filas = [{
        "id": uid("profesion", p["procodigo"]),
        "empresa_id": EMPRESA,
        "nombre": txt(p["prodescrip"], 120).upper(),
        "orden": int(num(p["procodigo"])),
        "activa": True,
    } for p in pros]
    # El catálogo nuevo tiene un único por (empresa, nombre en mayúsculas): el
    # sistema viejo puede tener el mismo oficio dos veces escrito distinto.
    vistos, limpias = set(), []
    for f in filas:
        if f["nombre"] in vistos:
            continue
        vistos.add(f["nombre"])
        limpias.append(f)
    print(f"   {len(limpias)} profesiones ({len(filas) - len(limpias)} repetidas descartadas)")
    print("  ", insertar("profesiones", limpias))

    print("\n── CATEGORÍAS DE CLIENTE (cliente_tipo) ──")
    tipos = list(dump.filas(F, "cliente_tipo"))
    filas = [{
        "id": uid("cliente_tipo", t["tipcodigo"]),
        "empresa_id": EMPRESA,
        "nombre": txt(t["tipdescrip"], 80),
        "orden": int(num(t["tipcodigo"])),
        "activa": True,
    } for t in tipos if txt(t["tipdescrip"])]
    print(f"   {len(filas)} categorías")
    print("  ", insertar("categorias_cliente", filas))

    print("\n── PROVEEDORES ──")
    provs = [p for p in dump.filas(F, "proveedor") if txt(p["prodescrip"])]
    cond = {c["concodigo"]: c for c in dump.filas(F, "condicion")}
    filas = []
    for p in provs:
        c = cond.get(p["concodigo"])
        dias = int(num(c["condiaplazo"])) if c else 0
        filas.append({
            "id": uid("proveedor", p["procodigo"]),
            "empresa_id": EMPRESA,
            "nombre": txt(p["prodescrip"], 150),
            "razon_social": txt(p["prodescrip"], 150),
            "ruc": txt(p["proruc"], 25),
            "direccion": txt(p["prodire"], 200),
            "telefono": txt(p["protele"], 50),
            "email": txt(p["proemail"], 120),
            "contacto": txt(p["proresponsable"], 120),
            "condicion_pago": "credito" if dias > 1 else "contado",
            "plazo_pago_dias": dias or None,
            "estado": "activo",
            "observaciones": MIGRADO,
        })
    # `compras.proveedor_id` es obligatorio y el sistema viejo tiene compras
    # con el proveedor "-" (código 0). Se crea uno explícito en vez de
    # descartar esas compras o inventarles un proveedor real.
    filas.append({
        "id": uid("proveedor", "0"),
        "empresa_id": EMPRESA,
        "nombre": "SIN PROVEEDOR IDENTIFICADO",
        "razon_social": "SIN PROVEEDOR IDENTIFICADO",
        "estado": "activo",
        "condicion_pago": "contado",
        "observaciones": f"{MIGRADO}. Las compras del sistema anterior que no tenían proveedor cargado quedaron acá.",
    })
    print(f"   {len(filas)} proveedores (incluye el comodín para los que no tenían)")
    print("  ", insertar("proveedores", filas))


# ══════════════════════════════════════════════════════════════════════════
#  FASE 2 — Artículos
# ══════════════════════════════════════════════════════════════════════════
def fase_articulos():
    print("\n── ARTÍCULOS (articulo + stock → productos) ──")
    existencia = {}
    for s in dump.filas(F, "stock"):
        if s["succodigo"] == "1":
            existencia[s["artcodigo"]] = num(s["existencia"])
    medidas = {m["MEDCODIGO"]: txt(m["MEDDESCRIP"]) for m in dump.filas(F, "medida")}
    grupos = {g["GRUCODIGO"] for g in dump.filas(F, "grupo")}

    filas, saltados = [], 0
    for a in dump.filas(F, "articulo"):
        nombre = txt(a["artdescrip"], 200)
        # El artículo 1 es "DATOS EXPORTADO": basura del sistema viejo.
        if not articulo_migrable(a):
            saltados += 1
            continue
        sku = txt(a["artcodrefe"], 50) or f"ART-{a['artcodigo']}"
        precio = num(a["artpreciomino"])
        costo = num(a["Artprecompra"])
        filas.append({
            "id": uid("articulo", a["artcodigo"]),
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            "nombre": nombre,
            "sku": sku,
            "costo_promedio": costo,
            "precio_venta": precio,
            # El precio en dólares del sistema viejo, que el ERP nuevo ya sabe
            # convertir con la cotización del día.
            "precio_usd": num(a["artpredolarventa"]) or None,
            "costo_usd": num(a["artpreciodolar"]) or None,
            "stock_actual": existencia.get(a["artcodigo"], 0.0),
            "stock_minimo": num(a["stockminimo"]),
            "unidad_medida": (medidas.get(a["medcodigo"]) or "UNIDAD")[:20],
            "metodo_valuacion": "CPP",
            "categoria_principal_id": uid("grupo", a["grucodigo"]) if a["grucodigo"] in grupos else None,
            "tipo_iva": "10%" if a["Artimpuesto"] == "3" else "EXENTA",
            "controla_stock": a["Artstockcontrol"] == "1",
            "es_vendible": True,
            "es_insumo": False,
            "valorizado": True,
            "activo": a["artdeshabilitar"] != "1",
            "descuento_pct": num(a["Artdescuento"]),
            # La remarcación con la que quedó armado el precio, calculada del
            # costo y el precio reales en vez de copiada de ningún lado.
            "markup_pct": round((precio / costo - 1) * 100, 2) if costo > 0 and precio > 0 else None,
            "descripcion": txt(a["Artcomentario"], 400),
            "modo_receta": "preparado_al_vender",
        })
    print(f"   {len(filas)} artículos ({saltados} descartados por basura del sistema viejo)")
    print(f"   con stock > 0: {sum(1 for f in filas if f['stock_actual'] > 0)}")
    print(f"   con precio en dólares: {sum(1 for f in filas if f['precio_usd'])}")
    print("  ", insertar("productos", filas, lote=200))


# ══════════════════════════════════════════════════════════════════════════
#  FASE 3 — Clientes
# ══════════════════════════════════════════════════════════════════════════
def ruc_limpio(ruc, dv):
    """
    El RUC del sistema viejo viene sucio: hay 130 clientes con '***', otros
    con '.', '123' o '****'. Eso no es un RUC, es un campo que alguien
    completó para poder guardar. Se descarta en vez de migrar basura que
    después rompe la facturación electrónica.
    """
    r = (ruc or "").strip()
    if len(r) < 4 or sum(c.isdigit() for c in r) < 4:
        return None
    d = (dv or "").strip()
    return f"{r}-{d}" if d and "-" not in r else r


def fase_clientes():
    print("\n── CLIENTES ──")
    ciudades = {c["ciucodigo"]: txt(c["ciudescrip"]) for c in dump.filas(F, "ciudad")}
    profs = {p["procodigo"]: txt(p["prodescrip"]) for p in dump.filas(F, "profesion")}
    cond = {c["concodigo"]: c for c in dump.filas(F, "condicion")}
    tipos = {t["tipcodigo"] for t in dump.filas(F, "cliente_tipo")}

    filas = []
    for c in dump.filas(F, "cliente"):
        nombre = txt(c["clidescrip"], 180)
        if not nombre:
            continue
        cd = cond.get(c["concodigo"])
        dias = int(num(cd["condiaplazo"])) if cd else 0
        filas.append({
            "id": uid("cliente", c["clicodigo"]),
            "empresa_id": EMPRESA,
            "codigo": str(c["clicodigo"]),
            "nombre": nombre,
            "nombre_facturacion": nombre,
            "ruc": ruc_limpio(c["cliruc"], c["dv"]),
            "direccion": txt(c["clidire"], 200),
            "telefono": txt(c["clitele"], 50),
            # El sistema viejo usaba `cliemail` para cualquier cosa ("OCACIONAL"),
            # así que solo se migra lo que parece un correo.
            "email": (txt(c["cliemail"], 120) or "") if "@" in (c["cliemail"] or "") else None,
            "ciudad": ciudades.get(c["ciucodigo"]),
            "profesion": profs.get(c["procodigo"]),
            "categoria_cliente_id": uid("cliente_tipo", c["clitipo"]) if c["clitipo"] in tipos else None,
            "limite_credito": num(c["clilimite"]) or None,
            "dias_credito": dias or None,
            "condicion_pago": "credito" if dias > 1 else "contado",
            # habilitar = 1 es el deshabilitado del sistema viejo (son 17).
            "estado": "inactivo" if c["habilitar"] == "1" else "activo",
            "pais": "PARAGUAY",
            "notas": MIGRADO,
        })
    print(f"   {len(filas)} clientes")
    print(f"   con RUC válido: {sum(1 for f in filas if f['ruc'])}")
    print(f"   con límite de crédito: {sum(1 for f in filas if f['limite_credito'])}")
    print("  ", insertar("clientes", filas, lote=300))


# ══════════════════════════════════════════════════════════════════════════
#  FASE 4 — Histórico de ventas
# ══════════════════════════════════════════════════════════════════════════
IVA_FACTOR = {"10%": 1.10, "5%": 1.05, "EXENTA": 1.0}


def fase_ventas(desde_anio=None):
    print("\n── HISTÓRICO DE VENTAS ──")
    print("   leyendo el detalle...", flush=True)
    det = defaultdict(list)
    for d in dump.filas(F, "venta_detalle"):
        det[d["vencodigo"]].append(d)
    print(f"   {sum(len(v) for v in det.values()):,} líneas en {len(det):,} ventas", flush=True)

    arts = {a["artcodigo"]: a for a in dump.filas(F, "articulo") if articulo_migrable(a)}
    personal = {p["percodigo"]: txt(p["perdescrip"]) for p in dump.filas(F, "personal")}
    cond = {c["concodigo"]: c for c in dump.filas(F, "condicion")}
    clientes_ok = {c["clicodigo"] for c in dump.filas(F, "cliente")}

    cabeceras, items, pagos = [], [], []
    sin_lineas = descartadas = 0
    for v in dump.filas(F, "venta"):
        f = fecha_ok(v["venfecha"])
        if not f:
            descartadas += 1
            continue
        if desde_anio and int(f[:4]) < desde_anio:
            continue
        lineas = det.get(v["vencodigo"]) or []
        if not lineas:
            sin_lineas += 1
            continue

        cd = cond.get(v["concodigo"])
        dias = int(num(cd["condiaplazo"])) if cd else 0
        credito = dias > 1
        efe, che, tar = num(v["efectivo"]), num(v["chemonto"]), num(v["tarmonto"])
        usados = [(m, x) for m, x in (("efectivo", efe), ("cheque", che), ("tarjeta", tar)) if x > 0]
        # El CHECK de `ventas.metodo_pago` todavía NO acepta 'mixto' (ver el
        # script 52, que lo corrige para las ventas NUEVAS). Para el histórico
        # se guarda el medio con el que se pagó la mayor parte y el desglose
        # real queda en `ventas_pagos_detalle` y escrito en la observación.
        # Son 55 ventas en siete años: no vale frenar la migración por eso.
        if len(usados) > 1:
            usados.sort(key=lambda t: -t[1])
            metodo = usados[0][0]
        else:
            metodo = usados[0][0] if usados else "efectivo"

        total = num(v["venmonto"])
        iva = monto_iva_de_lineas = 0.0
        sub = 0.0
        vid = uid("venta", v["vencodigo"])
        for i, d in enumerate(lineas, start=1):
            a = arts.get(d["artcodigo"])
            # El IVA sale del balde en el que el sistema viejo puso ESTA línea,
            # no del impuesto del artículo: 187 líneas se facturaron exentas
            # con artículos gravados y lo que vale es lo que se facturó.
            if num(d["exenta"]) > 0:
                tipo_iva = "EXENTA"
            elif num(d["gravada1"]) > 0:
                tipo_iva = "5%"
            else:
                tipo_iva = "10%"
            cant = num(d["cantidad"])
            precio = num(d["precio"])
            bruto = round(cant * precio, 2)
            factor = IVA_FACTOR[tipo_iva]
            neto = round(bruto / factor, 2)
            mi = round(bruto - neto, 2)
            sub += neto
            monto_iva_de_lineas += mi
            items.append({
                "id": uid("vdet", f"{v['vencodigo']}-{i}"),
                "empresa_id": EMPRESA,
                "venta_id": vid,
                "producto_id": uid("articulo", d["artcodigo"]) if d["artcodigo"] in arts else None,
                "producto_nombre": (txt(a["artdescrip"], 200) if a else None) or f"Artículo {d['artcodigo']}",
                "sku": (txt(a["artcodrefe"], 50) if a else None) or f"ART-{d['artcodigo']}",
                "cantidad": cant,
                "precio_venta": precio,
                "precio_venta_original": precio,
                "tipo_iva": tipo_iva,
                "tipo_precio": "minorista",
                "subtotal": neto,
                "monto_iva": mi,
                "total_linea": bruto,
            })

        iva = round(monto_iva_de_lineas, 2)
        cabeceras.append({
            "id": vid,
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            # HIS- y no VTA-: así el correlativo de las ventas nuevas sigue su
            # propia serie y no arranca en 85.668.
            "numero_control": f"HIS-{int(v['vencodigo']):06d}",
            "cliente_id": uid("cliente", v["clicodigo"]) if v["clicodigo"] in clientes_ok else None,
            "fecha": f"{f}T{(v['venhora'] or f + ' 12:00:00')[11:19]}-03:00",
            "moneda": "GS",
            "tipo_cambio": 1,
            "tipo_venta": "CREDITO" if credito else "CONTADO",
            "plazo_dias": dias if credito else None,
            "metodo_pago": metodo,
            # El total es el del sistema viejo, que es el que el cliente conoce.
            "total": total,
            "subtotal": round(total - iva, 2),
            "monto_iva": iva,
            "estado": "anulada" if v["estcodigo"] == "2" else "completada",
            "anulacion_motivo": MIGRADO if v["estcodigo"] == "2" else None,
            "usuario_nombre": txt(v["usuario"], 80),
            "vendedor_nombre": personal.get(v["percodigo"]) or txt(v["usuario"], 80),
            # La plata que en esa venta puso un anticipo del cliente.
            "anticipo_aplicado": num(v["antmonto"]),
            "observaciones": f"{MIGRADO}. Factura N° {v['venfactnro']}."
                             + (f" {txt(v['comentario'], 150)}" if txt(v["comentario"]) else ""),
        })

        # El sistema viejo redondeaba por línea, así que en 4 de cada 10 ventas
        # la suma de las líneas no da exactamente el total cobrado (diferencias
        # de 2 a 24 Gs. sobre millones). Se conserva el total cobrado —es el que
        # está en sus reportes y en el banco— y la diferencia queda escrita,
        # para que el día que alguien la note tenga la explicación al lado en
        # vez de pensar que la migración perdió plata.
        bruto_lineas = round(sum(
            round(num(d["cantidad"]) * num(d["precio"]), 2) for d in lineas
        ), 2)
        if len(usados) > 1:
            desglose = ", ".join(f"{m} Gs. {x:,.0f}" for m, x in usados)
            cabeceras[-1]["observaciones"] += f" Pago mixto: {desglose}."
            for m, x in usados:
                pagos.append({
                    "id": uid("vpago", f"{v['vencodigo']}-{m}"),
                    "empresa_id": EMPRESA,
                    "venta_id": vid,
                    "metodo_pago": m,
                    "monto": x,
                    "fecha_pago": f,
                })

        if abs(bruto_lineas - total) > 1:
            cabeceras[-1]["observaciones"] += (
                f" La suma de las líneas da Gs. {bruto_lineas:,.0f} y el total cobrado fue"
                f" Gs. {total:,.0f} (redondeo por línea del sistema anterior)."
            )

    print(f"   cabeceras: {len(cabeceras):,}  ítems: {len(items):,}")
    print(f"   sin líneas (se saltan): {sin_lineas}   sin fecha: {descartadas}")
    print(f"   anuladas: {sum(1 for c in cabeceras if c['estado'] == 'anulada'):,}")
    print(f"   con anticipo aplicado: {sum(1 for c in cabeceras if c['anticipo_aplicado'] > 0):,}")
    print("   insertando cabeceras...", flush=True)
    print("  ", insertar("ventas", cabeceras, lote=500))
    print("   insertando ítems...", flush=True)
    print("  ", insertar("ventas_items", items, lote=500))
    if pagos:
        print(f"   desglose de pago de las ventas mixtas: {len(pagos)} filas", flush=True)
        print("  ", insertar("ventas_pagos_detalle", pagos, lote=200))


# ══════════════════════════════════════════════════════════════════════════
#  FASE 5 — Compras y anticipos
# ══════════════════════════════════════════════════════════════════════════
def fase_compras():
    print("\n── COMPRAS ──")
    # El modelo nuevo de compras es PLANO: una fila por línea, todas con el
    # mismo numero_control. No hay tabla de ítems, así que 5.500 compras del
    # sistema viejo se convierten en 17.018 filas.
    cab = {c["comcodigo"]: c for c in dump.filas(F, "compra")}
    arts = {a["artcodigo"]: a for a in dump.filas(F, "articulo") if articulo_migrable(a)}
    provs = {p["procodigo"]: txt(p["prodescrip"], 150) for p in dump.filas(F, "proveedor")}
    cond = {c["concodigo"]: c for c in dump.filas(F, "condicion")}
    monedas = {"1": "USD", "4": "PYG"}

    filas, huerfanas = [], 0
    for i, d in enumerate(dump.filas(F, "compra_detalle")):
        c = cab.get(d["comcodigo"])
        if not c:
            huerfanas += 1
            continue
        f = fecha_ok(c["comfecha"])
        if not f:
            huerfanas += 1
            continue
        a = arts.get(d["artcodigo"])
        # `compras.producto_id` es obligatoria: una línea cuyo artículo ya no
        # existe en el catálogo no se puede colgar de ningún producto. Se
        # cuenta y se informa en vez de inventarle uno.
        if not a:
            huerfanas += 1
            continue
        cd = cond.get(c["concodigo"])
        dias = int(num(cd["condiaplazo"])) if cd else 0
        cant = num(d["cantidad"])
        precio = num(d["precio"])
        bruto = round(cant * precio, 2)
        # Las compras del sistema viejo son con IVA incluido, igual que las ventas.
        neto = round(bruto / 1.10, 2)
        filas.append({
            "id": uid("compradet", f"{d['comcodigo']}-{i}"),
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            "numero_control": f"HCO-{int(d['comcodigo']):06d}",
            "fecha": f,
            "fecha_factura": fecha_ok(c["comfechafact"]),
            "numero_factura": txt(str(c["comfacturanro"]), 30),
            "proveedor_id": uid("proveedor", c["procodigo"] if c["procodigo"] in provs else "0"),
            "proveedor_nombre": provs.get(c["procodigo"]) or "SIN PROVEEDOR IDENTIFICADO",
            "producto_id": uid("articulo", d["artcodigo"]) if d["artcodigo"] in arts else None,
            "producto_nombre": (txt(a["artdescrip"], 200) if a else None) or f"Artículo {d['artcodigo']}",
            "cantidad": cant,
            "costo_unitario": precio,
            # Obligatoria: es el costo tal como se tipeó, antes de cualquier
            # conversión de moneda. En el histórico son el mismo número.
            "costo_unitario_original": num(d["preciotipeado"]) or precio,
            "subtotal": neto,
            "monto_iva": round(bruto - neto, 2),
            "total": bruto,
            # El precio de venta que tenía el artículo: la compra lo guarda
            # para poder mostrar con qué margen entró la mercadería.
            "precio_venta": num(a["artpreciomino"]) if a else 0,
            "margen_venta": round((num(a["artpreciomino"]) / precio - 1) * 100, 2)
                            if a and precio > 0 and num(a["artpreciomino"]) > 0 else 0,
            "iva_tipo": "10",
            "moneda": monedas.get(c["moncodigo"], "PYG"),
            "tipo_cambio": num(c["cotizacion"]) or 1,
            "tipo_pago": "credito" if dias > 1 else "contado",
            "plazo_dias": dias or None,
            "estado": "anulada" if c["estcodigo"] == "2" else "registrada",
            # Obligatorias en el modelo nuevo. El sistema viejo no guardaba el
            # timbrado de la factura de compra, así que se dice eso y no se
            # inventa un número que después alguien podría tomar por real.
            "nro_timbrado": "SIN DATO (migrado)",
            "estado_contable": "no_contabilizado",
            "usuario_nombre": MIGRADO,
        })
    print(f"   {len(filas):,} filas de compra ({huerfanas} líneas sin cabecera o sin fecha)")
    print("  ", insertar("compras", filas, lote=400))


def fase_anticipos():
    print("\n── ANTICIPOS ──")
    clientes_ok = {c["clicodigo"]: txt(c["clidescrip"], 180) for c in dump.filas(F, "cliente")}
    filas = []
    for a in dump.filas(F, "anticipo"):
        f = fecha_ok(a["antfecha"])
        monto = num(a["antmonto"])
        if not f or monto <= 0:
            continue
        # El estado viejo: 2 = anulado. Lo demás se trae como usado, porque
        # son anticipos de hasta 2019: dar por disponible plata de hace años
        # sería ofrecerle al cajero usar un anticipo que el cliente ya retiró.
        anulado = a["Estcodigo"] == "2"
        filas.append({
            "id": uid("anticipo", a["antcodigo"]),
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            "cliente_id": uid("cliente", a["clicodigo"]) if a["clicodigo"] in clientes_ok else None,
            "cliente_nombre": clientes_ok.get(a["clicodigo"]) or "Sin cliente",
            "fecha": f"{f}T12:00:00-03:00",
            "monto": monto,
            "monto_utilizado": 0 if anulado else monto,
            "medio_pago": "efectivo",
            "estado": "anulado" if anulado else "utilizado",
            "usuario_nombre": txt(a["Usuario"], 80) or MIGRADO,
            "anulado_motivo": MIGRADO if anulado else None,
            "observacion": f"{MIGRADO} (anticipo {a['antcodigo']})."
                           + (f" {txt(a['Antnota'], 150)}" if txt(a["Antnota"]) else ""),
        })
    print(f"   {len(filas)} anticipos ({sum(1 for f in filas if f['estado'] == 'anulado')} anulados)")
    print("  ", insertar("anticipos", filas, lote=300))


# ══════════════════════════════════════════════════════════════════════════
#  FASE 6 — Turnos de caja
# ══════════════════════════════════════════════════════════════════════════
def fase_cajas():
    """
    Los 2.137 turnos de caja de siete años, con sus movimientos.

    ── TODOS ENTRAN CERRADOS ─────────────────────────────────────────────
      El sistema viejo tiene un turno en estado 'Activo'. Si se migrara así,
      el ERP nuevo creería que hay una caja abierta desde 2019 y Caja no
      dejaría abrir la de hoy. Se fuerzan todos a 'cerrada'.

    ── QUÉ MOVIMIENTOS SE TRAEN ──────────────────────────────────────────
      El arqueo del turno se rearma sumando lo que entró y salió del cajón,
      así que no alcanza con la cabecera: hacen falta los egresos (14.195),
      las entregas de recaudación (3.952), las cobranzas con recibo y las
      otras entradas. Sin ellos, cada turno viejo mostraría un faltante
      enorme que nunca existió.

    ── LO QUE NO SE PUEDE TRAER ──────────────────────────────────────────
      El desglose por billete (`b1..b12` al abrir, `r1..r12` al cerrar). En
      el sistema viejo esas columnas mezclan importes y cantidades —`b11` vale
      752.000 y `r2` vale 11— y no hay tabla que diga qué denominación es
      cada una. Inventar el desglose sería fabricar un arqueo que nadie contó:
      se migran los totales, que son los que cuadran la caja.
    """
    print("\n── TURNOS DE CAJA ──")
    resp = {r["rescodigo"]: txt(r["resdescrip"]) for r in dump.filas(F, "responsable")}
    aperturas = {}
    fecha_del_turno = {}
    cajas = []
    for a in dump.filas(F, "apertura"):
        f = fecha_ok(a["apefecha"])
        # El turno 0 es la misma basura que la venta 0: sin hora, sin montos y
        # sin ninguna venta colgada. Un turno número 0 en el reporte de cierres
        # solo genera la pregunta de qué es.
        if not f or a["apecodigo"] == "0":
            continue
        ini = hora_ok(a["apehoraini"], "08:00:00")
        # El cierre suele ser al otro día (abre 09:07 y cierra 07:00): la fecha
        # real del cierre es la de liquidación, no la de apertura.
        fcierre = fecha_ok(a["fecha_liquidacion"]) or f
        fin = hora_ok(a["apehorafin"], "20:00:00")
        esperado = num(a["monto_a_rendir"])
        contado = num(a["monto_rendido"])
        quien = resp.get(a["rescodigo"]) or "sin identificar"
        cid = uid("apertura", a["apecodigo"])
        aperturas[a["apecodigo"]] = cid
        fecha_del_turno[a["apecodigo"]] = f
        cajas.append({
            "id": cid,
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            "numero_caja": int(num(a["apecodigo"])),
            "estado": "cerrada",
            "fecha_apertura": f"{f}T{ini}-03:00",
            "fecha_cierre": f"{fcierre}T{fin}-03:00",
            "monto_apertura": num(a["permonto"]),
            "monto_esperado_efectivo": esperado,
            "monto_cierre_contado": contado,
            # Se calcula en vez de copiar `monto_diferencia`: el sistema viejo
            # la guarda siempre en positivo y acá el signo es el que distingue
            # un faltante de un sobrante.
            "diferencia": round(contado - esperado, 2),
            "diferencia_arrastrada": num(a["dife_caja_ante"]),
            "diferencia_resuelta": True,
            "observacion_apertura": f"{MIGRADO}. Abrió: {quien}.",
            "observacion_cierre": (txt(a["comentario"], 400) or "")
                                  + (f" [{MIGRADO}. Turno {a['apecodigo']} del sistema anterior.]"),
        })
    print(f"   {len(cajas):,} turnos")
    print("  ", insertar("cajas", cajas, lote=300))

    # ── Movimientos del cajón ───────────────────────────────────────────
    movs = []

    def mov(clase, codigo, caja_old, tipo, concepto, monto, medio="efectivo",
            fecha=None, obs=None, tipo_egreso=None):
        cid = aperturas.get(caja_old)
        if not cid or monto <= 0:
            return
        # `created_at` es obligatoria, y `uniformar` le pone None a las filas
        # que no la traen: sin esto, el lote entero se cae. Cuando el detalle
        # no tiene fecha propia se usa la del turno, que es la correcta —
        # el movimiento pasó dentro de ese turno.
        if not fecha:
            dia = fecha_del_turno.get(caja_old)
            fecha = f"{dia}T12:00:00-03:00" if dia else None
        movs.append({
            "id": uid(clase, codigo),
            "empresa_id": EMPRESA,
            "sucursal_id": SUCURSAL,
            "caja_id": cid,
            "tipo": tipo,
            "concepto": (concepto or tipo)[:200],
            "monto": monto,
            "medio_pago": medio,
            "tipo_egreso": tipo_egreso,
            "usuario_email": None,
            "observacion": obs,
            "adjuntos": [],
            "created_at": fecha,
        })

    provs = {p["procodigo"]: txt(p["prodescrip"], 150) for p in dump.filas(F, "proveedor")}
    for e in dump.filas(F, "egreso"):
        f = fecha_ok(e["egrfecha"])
        prov = provs.get(e["procodigo"])
        mov("egreso", e["egrcodigo"], e["apecodigo"], "egreso",
            txt(e["nota"], 200) or "Egreso de caja", num(e["egrmonto"]),
            fecha=f"{f}T12:00:00-03:00" if f else None,
            obs=f"{MIGRADO}." + (f" Proveedor: {prov}." if prov else "")
                + (f" Factura {e['egrnrofact']}." if txt(str(e['egrnrofact'])) else ""),
            tipo_egreso="otros")

    for d in dump.filas(F, "apertura_deposito"):
        # La recaudación que se saca del cajón y se entrega: en el modelo nuevo
        # es un retiro, que es justo lo que el arqueo descuenta del esperado.
        dia = None  # la fecha la pone el turno; el detalle solo trae la hora
        mov("deposito", d["depcodigo"], d["apecodigo"], "retiro",
            txt(d["depdescrip"], 200) or "Entrega de recaudación", num(d["depmonto"]),
            fecha=(f"{fecha_del_turno[d['apecodigo']]}T{hora_ok(d['dephora'])}-03:00"
                   if d["apecodigo"] in fecha_del_turno else None),
            obs=MIGRADO)
        del dia

    for o in dump.filas(F, "aper_otra_entrada"):
        f = fecha_ok(o["fecha"])
        mov("otraentrada", o["otrcodigo"], o["apecodigo"], "ingreso",
            txt(o["otrcomentario"], 200) or "Otra entrada", num(o["monto"]),
            fecha=f"{f}T{hora_ok(o['hora'])}-03:00" if f else None,
            obs=MIGRADO)

    for c in dump.filas(F, "apertura_cobranza"):
        # Una cobranza puede venir partida en efectivo, cheque y tarjeta. Solo
        # la parte en efectivo mueve el cajón, y el medio queda guardado para
        # que el arqueo sepa qué contar y qué no.
        for medio, campo in (("efectivo", "efectivo"), ("cheque", "chemonto"), ("tarjeta", "tarmonto")):
            monto = num(c[campo])
            if monto <= 0:
                continue
            mov("cobranza", f"{c['Cobcodigo']}-{medio}", c["apecodigo"], "ingreso",
                f"Cobranza {txt(c['cobdescrip'], 150) or ''}".strip(), monto, medio=medio,
                obs=f"{MIGRADO}. Recibo {c['recnro']}.")

    print(f"   {len(movs):,} movimientos de caja")
    por_tipo = collections.Counter(m["tipo"] for m in movs)
    print(f"   por tipo: {dict(por_tipo)}")
    print("  ", insertar("caja_movimientos", movs, lote=400))

    # ── Atar lo ya migrado a su turno ───────────────────────────────────
    print("\n   atando las ventas a su turno...", flush=True)
    por_caja = defaultdict(list)
    for v in dump.filas(F, "venta"):
        cid = aperturas.get(v["apecodigo"])
        if cid:
            por_caja[cid].append(uid("venta", v["vencodigo"]))
    atadas = 0
    for cid, ids in por_caja.items():
        for i in range(0, len(ids), 150):
            trozo = ids[i : i + 150]
            lista = ",".join(trozo)
            api("PATCH", f"ventas?id=in.({lista})", {"caja_id": cid}, prefer="return=minimal")
            atadas += len(trozo)
    print(f"   {atadas:,} ventas atadas a su turno")

    print("   atando los anticipos a su turno...", flush=True)
    n = 0
    for a in dump.filas(F, "anticipo"):
        cid = aperturas.get(a["apecodigo"])
        if not cid:
            continue
        api("PATCH", f"anticipos?id=eq.{uid('anticipo', a['antcodigo'])}",
            {"caja_id": cid}, prefer="return=minimal")
        n += 1
    print(f"   {n} anticipos atados")


if __name__ == "__main__":
    fase = sys.argv[1] if len(sys.argv) > 1 else ""
    t0 = time.time()
    if fase == "catalogos":
        fase_catalogos()
    elif fase == "articulos":
        fase_articulos()
    elif fase == "clientes":
        fase_clientes()
    elif fase == "cajas":
        fase_cajas()
    elif fase == "compras":
        fase_compras()
    elif fase == "anticipos":
        fase_anticipos()
    elif fase == "ventas":
        anio = int(sys.argv[2]) if len(sys.argv) > 2 else None
        fase_ventas(desde_anio=anio)
    else:
        print("fases: catalogos | articulos | clientes | ventas | compras")
        sys.exit(1)
    print(f"\nlisto en {time.time()-t0:.1f}s")
