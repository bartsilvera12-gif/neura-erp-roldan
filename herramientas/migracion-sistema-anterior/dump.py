"""
Lector del dump MySQL del sistema viejo (sysges_acero_metal).

POR QUE UN PARSER A MANO Y NO mysql: no hay MySQL en este contenedor, y
levantar uno para leer 275 MB una vez es mas fragil que leer el archivo.

El dump usa INSERT extendidos: INSERT INTO `t` VALUES (..),(..),(..);
Hay que respetar comillas, escapes y NULL, porque los comentarios de las
ventas tienen comas, parentesis y apostrofes adentro.
"""
import re

RE_CREATE = re.compile(r"^CREATE TABLE `([^`]+)`")
RE_COL = re.compile(r"^\s*`([^`]+)` (\w+)")
RE_INSERT = re.compile(r"^INSERT INTO `([^`]+)` VALUES ")


def columnas(ruta, tablas):
    """{tabla: [columna, ...]} en el orden del CREATE TABLE."""
    quedan = set(tablas)
    cols, dentro = {}, None
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        for linea in fh:
            m = RE_CREATE.match(linea)
            if m:
                dentro = m.group(1) if m.group(1) in quedan else None
                if dentro:
                    cols[dentro] = []
                continue
            if dentro:
                if linea.startswith(") ENGINE"):
                    quedan.discard(dentro)
                    dentro = None
                    if not quedan:
                        break
                    continue
                c = RE_COL.match(linea)
                if c and not linea.strip().startswith(("PRIMARY", "KEY", "UNIQUE", "CONSTRAINT")):
                    cols[dentro].append(c.group(1))
    return cols


def _tuplas(cuerpo):
    """Parte el `(..),(..)` de un INSERT en listas de valores."""
    fila, valor, salida = [], [], []
    i, n = 0, len(cuerpo)
    en_cadena = False
    en_fila = False
    while i < n:
        ch = cuerpo[i]
        if en_cadena:
            if ch == "\\" and i + 1 < n:
                sig = cuerpo[i + 1]
                valor.append({"n": "\n", "t": "\t", "r": "\r", "0": "\0"}.get(sig, sig))
                i += 2
                continue
            if ch == "'":
                en_cadena = False
                i += 1
                continue
            valor.append(ch)
            i += 1
            continue
        if ch == "(" and not en_fila:
            en_fila, fila, valor = True, [], []
            i += 1
            continue
        if ch == "'":
            en_cadena = True
            i += 1
            continue
        if ch == "," and en_fila:
            fila.append("".join(valor).strip())
            valor = []
            i += 1
            continue
        if ch == ")" and en_fila:
            fila.append("".join(valor).strip())
            salida.append(fila)
            en_fila, fila, valor = False, [], []
            i += 1
            continue
        if en_fila:
            valor.append(ch)
        i += 1
    return salida


def filas(ruta, tabla, limite=None):
    """Itera dicts {columna: valor} de una tabla. NULL -> None."""
    cols = columnas(ruta, [tabla]).get(tabla) or []
    if not cols:
        return
    n = 0
    with open(ruta, encoding="utf-8", errors="replace") as fh:
        for linea in fh:
            m = RE_INSERT.match(linea)
            if not m or m.group(1) != tabla:
                continue
            cuerpo = linea[m.end():].rstrip().rstrip(";")
            for t in _tuplas(cuerpo):
                if len(t) != len(cols):
                    continue
                yield {c: (None if v == "NULL" else v) for c, v in zip(cols, t)}
                n += 1
                if limite and n >= limite:
                    return
