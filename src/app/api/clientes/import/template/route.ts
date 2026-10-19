import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/excel/export";
import { CLIENTES_TEMPLATE_ROW } from "@/lib/imports/clientes-importer";

export async function GET() {
  const cols = Object.keys(CLIENTES_TEMPLATE_ROW).map((k) => ({
    header: k,
    value: (r: typeof CLIENTES_TEMPLATE_ROW) => r[k as keyof typeof CLIENTES_TEMPLATE_ROW],
    width: 22,
  }));
  const buf = buildXlsxBuffer([CLIENTES_TEMPLATE_ROW], cols, { sheetName: "Clientes" });
  return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("plantilla-clientes") });
}
