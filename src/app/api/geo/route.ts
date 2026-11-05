import { NextRequest, NextResponse } from "next/server";
import datos from "@/lib/geo/paraguay-ine.json";

/**
 * Ciudades y barrios de Paraguay, del Instituto Nacional de Estadística
 * (códigos geográficos del censo 2022): 263 distritos y sus barrios o
 * localidades.
 *
 *   GET /api/geo              → las ciudades { codigo, nombre, departamento }
 *   GET /api/geo?ciudad=1112  → los barrios de esa ciudad
 *
 * El listado vive en el servidor: son 150 KB que no tienen por qué viajar
 * enteros al navegador. Se cachea un día: el censo no cambia.
 */

type Fila = { c: string; n: string; d: string; b: string[] };
const FILAS = datos as Fila[];
const CACHE = { "Cache-Control": "public, max-age=86400, immutable" };

export async function GET(request: NextRequest) {
  const ciudad = request.nextUrl.searchParams.get("ciudad");
  if (ciudad) {
    return NextResponse.json({ success: true, data: { barrios: FILAS.find((f) => f.c === ciudad)?.b ?? [] } }, { headers: CACHE });
  }
  return NextResponse.json(
    { success: true, data: { ciudades: FILAS.map((f) => ({ codigo: f.c, nombre: f.n, departamento: f.d })) } },
    { headers: CACHE }
  );
}
