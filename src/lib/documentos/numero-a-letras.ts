/**
 * Número entero a letras, para los montos en guaraníes de los documentos
 * ("SON GUARANÍES: …"). Soporta hasta miles de millones.
 *
 * Estaba copiado dentro de cada documento que lo usaba.
 */
export function numeroALetras(n: number): string {
  const num = Math.round(Math.max(0, Number.isFinite(n) ? n : 0));
  if (num === 0) return "CERO";
  const unidades = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const decenas = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

  function menores1000(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    let out = "";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    if (c > 0) out += centenas[c] + " ";
    if (resto < 10) {
      out += unidades[resto];
    } else if (resto < 20) {
      out += especiales[resto - 10];
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (d === 2 && u > 0) {
        out += "VEINTI" + unidades[u].toLowerCase();
      } else if (u === 0) {
        out += decenas[d];
      } else {
        out += decenas[d] + " Y " + unidades[u];
      }
    }
    return out.trim().toUpperCase();
  }

  function grupo(n: number, singular: string, plural: string): string {
    if (n === 0) return "";
    if (n === 1) return singular;
    const t = menores1000(n);
    return `${t} ${plural}`;
  }

  const millones = Math.floor(num / 1_000_000);
  const restoMillones = num % 1_000_000;
  const miles = Math.floor(restoMillones / 1000);
  const unidadesFinal = restoMillones % 1000;

  const partes: string[] = [];
  if (millones > 0) partes.push(grupo(millones, "UN MILLON", "MILLONES"));
  if (miles > 0) partes.push(miles === 1 ? "MIL" : `${menores1000(miles)} MIL`);
  if (unidadesFinal > 0) partes.push(menores1000(unidadesFinal));

  return partes.join(" ").replace(/\s+/g, " ").trim();
}
