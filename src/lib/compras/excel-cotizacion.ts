/**
 * Leer la lista de precios que manda un proveedor en Excel y cruzarla con los
 * artículos de la cotización (pedido del cliente: «que suba en Excel»).
 *
 * El Excel de cada proveedor es distinto, así que se busca la fila de títulos:
 * una columna de precio («precio», «costo», «valor», «unitario») y una de
 * artículo («descripción», «artículo», «producto», «nombre», «detalle») y/o de
 * código («código», «cod», «sku», «ref»). Cada artículo se cruza primero por
 * código y, si no, por la descripción.
 */

export type ItemParaCruzar = { id: string; descripcion: string; sku?: string | null };

export type ResultadoExcel = {
  precios: Record<string, number>;
  cruzados: number;
  filas: number;
  sinCruzar: string[];
};

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function aNumero(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  // 1.234.567 / 1.234,50 / 1234.50
  const limpio = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/[.,](?=\d{3}(\D|$))/g, "");
  const n = Number(limpio.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export async function leerExcelCotizacion(file: File, items: ItemParaCruzar[]): Promise<ResultadoExcel> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const hoja = wb.Sheets[wb.SheetNames[0]!];
  if (!hoja) throw new Error("El archivo no tiene hojas.");
  const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, blankrows: false, defval: "" });

  // La fila de títulos: la primera que tenga una columna de precio.
  let cab = -1, colPrecio = -1, colDesc = -1, colCod = -1;
  for (let r = 0; r < Math.min(filas.length, 30) && cab < 0; r++) {
    const fila = (filas[r] ?? []).map(norm);
    const p = fila.findIndex((c) => /\b(PRECIO|COSTO|VALOR|UNITARIO|P UNIT)\b/.test(c));
    if (p < 0) continue;
    cab = r;
    colPrecio = p;
    colDesc = fila.findIndex((c) => /\b(DESCRIPCION|ARTICULO|PRODUCTO|NOMBRE|DETALLE|ITEM)\b/.test(c));
    colCod = fila.findIndex((c) => /\b(CODIGO|COD|SKU|REF|REFERENCIA)\b/.test(c));
  }
  if (cab < 0) throw new Error("No encontré la columna del precio (un título como «Precio», «Costo» o «Valor»).");
  if (colDesc < 0 && colCod < 0) throw new Error("No encontré la columna del artículo ni la del código.");

  const datos = filas.slice(cab + 1).map((f) => ({
    desc: colDesc >= 0 ? norm(f[colDesc]) : "",
    cod: colCod >= 0 ? norm(f[colCod]) : "",
    precio: aNumero(f[colPrecio]),
  })).filter((d) => d.precio > 0 && (d.desc || d.cod));

  const precios: Record<string, number> = {};
  const sinCruzar: string[] = [];
  for (const it of items) {
    const sku = norm(it.sku);
    const desc = norm(it.descripcion);
    const hit =
      (sku && datos.find((d) => d.cod === sku)) ||
      datos.find((d) => d.desc && d.desc === desc) ||
      datos.find((d) => d.desc && desc && (d.desc.includes(desc) || desc.includes(d.desc)) && Math.min(d.desc.length, desc.length) >= 6);
    if (hit) precios[it.id] = hit.precio;
    else sinCruzar.push(it.descripcion);
  }
  return { precios, cruzados: Object.keys(precios).length, filas: datos.length, sinCruzar };
}
