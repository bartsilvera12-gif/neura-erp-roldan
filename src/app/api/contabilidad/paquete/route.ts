import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { successResponse } from "@/lib/api/response";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";
import { REPORTES_DEL_PAQUETE, reportePorId, catalogoParaPantalla } from "@/lib/contabilidad/paquete/reportes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paquete mensual de contabilidad: un ZIP con todos los informes del mes.
 *
 * ── QUÉ RESUELVE ──────────────────────────────────────────────────────────
 *   Hasta ahora el cierre se armaba bajando los informes uno por uno desde
 *   cada pantalla, y en el sistema anterior se exportaban a mano, un archivo
 *   por sucursal y por mes. Son doce descargas que hay que acordarse de hacer
 *   todas, con el mismo mes y la misma sucursal en cada una; cualquier
 *   distracción manda al contador un paquete con un informe de otro período.
 *
 *   Acá se eligen el mes y la sucursal una sola vez y sale todo junto.
 *
 * ── UN INFORME QUE FALLA NO TUMBA EL PAQUETE ──────────────────────────────
 *   Si un informe se cae (le falta una migración, una cuenta sin configurar),
 *   el ZIP se arma igual con los demás y el detalle del problema queda en
 *   `_ERRORES.txt` adentro del archivo. Lo contrario —un 500 y ningún ZIP—
 *   dejaría a alguien esperando el cierre sin saber qué le falta, cuando once
 *   de los doce informes estaban listos.
 *
 * ── SE GENERAN DE A UNO ───────────────────────────────────────────────────
 *   En serie y no en paralelo: son consultas pesadas sobre los mismos meses y
 *   comparten el pool de conexiones. Lanzadas todas juntas se pelean por el
 *   pool y el conjunto termina tardando más que haciéndolas en fila.
 *
 * ── SIN SELECTOR DE SUCURSAL, A PROPÓSITO ─────────────────────────────────
 *   El paquete sale siempre de la sucursal del usuario que lo pide. No es una
 *   simplificación: el modelo de sucursales de esta instancia es que cada
 *   usuario pertenece a una y ve solo lo de ella, sin excepción para el
 *   administrador — está escrito como decisión del cliente en
 *   `src/lib/sucursales/filtro.ts`. Un selector acá sería la puerta para
 *   bajarse el cierre de la otra sucursal.
 *
 * GET  /api/contabilidad/paquete?catalogo=1 → la lista de informes disponibles
 * GET  /api/contabilidad/paquete?mes=YYYY-MM[&reportes=a,b] → el ZIP
 */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const sp = new URL(request.url).searchParams;

  // La pantalla pide el catálogo con este mismo endpoint: así la lista de
  // informes vive en un solo lugar y no hay que mantenerla también en el front.
  if (sp.get("catalogo") === "1") {
    return NextResponse.json(successResponse({ reportes: catalogoParaPantalla() }));
  }

  const mes = normalizarMes(sp.get("mes"));

  const pedidos = (sp.get("reportes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const elegidos = pedidos.length
    ? pedidos.map(reportePorId).filter((r): r is NonNullable<typeof r> => !!r)
    : REPORTES_DEL_PAQUETE;

  if (elegidos.length === 0) {
    return new Response("No se eligió ningún informe para el paquete.", { status: 400 });
  }

  try {
    const zip = new JSZip();
    const errores: string[] = [];
    const incluidos: string[] = [];

    for (const rep of [...elegidos].sort((a, b) => a.orden - b.orden)) {
      try {
        const handler = await rep.cargar();
        const url = new URL(rep.ruta, request.url);
        for (const [k, v] of Object.entries(rep.params(mes))) url.searchParams.set(k, v);

        // Se invoca el handler del informe en este mismo proceso. Se le pasan
        // los encabezados del pedido original para que resuelva la sesión del
        // mismo usuario: el paquete no puede ver más de lo que vería él
        // bajando los informes a mano.
        const res = await handler(new NextRequest(url, { headers: request.headers }));
        if (!res.ok) {
          errores.push(`${rep.nombre}: el informe respondió ${res.status} (${(await res.text()).slice(0, 200)})`);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) {
          errores.push(`${rep.nombre}: el informe salió vacío.`);
          continue;
        }
        const nombre = `${String(rep.orden).padStart(2, "0")}-${rep.archivo}.xlsx`;
        zip.file(nombre, buf);
        incluidos.push(`${nombre}  —  ${rep.nombre}`);
      } catch (e) {
        errores.push(`${rep.nombre}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // `requireContabilidadApiAccess` no devuelve la sucursal; se pide aparte,
    // y solo para poner su nombre en el ZIP y en el LEEME. El filtrado de los
    // datos lo hace cada informe por su cuenta, con la misma sesión.
    const sesion = await getUserAndEmpresa(request);
    const [emp, suc] = await Promise.all([
      datosEmpresaInforme(auth.empresaId),
      nombreSucursal(sesion?.sucursal_id ?? null),
    ]);
    const ambito = suc ?? "Sucursal del usuario";

    zip.file(
      "_LEEME.txt",
      [
        emp.empresa,
        emp.ruc ? `RUC ${emp.ruc}` : null,
        "",
        `Paquete de cierre — ${mesLabelLargo(mes)}`,
        `Alcance: ${ambito}`,
        `Generado: ${new Date().toISOString()}`,
        "",
        "INFORMES INCLUIDOS",
        ...incluidos.map((l) => `  ${l}`),
        "",
        "ACLARACIONES",
        "  · Los totales de las planillas son SUBTOTAL: si se filtra una columna,",
        "    el total se recalcula con lo que queda a la vista.",
        "  · 'Stock con precios' es una foto del stock de hoy, no del cierre del mes:",
        "    el stock es un saldo y no se guarda mes por mes.",
        "  · Las ventas anuladas no suman en ningún informe; donde aparecen, van marcadas.",
        errores.length ? "" : null,
        errores.length ? "ATENCIÓN: hubo informes que no se pudieron generar. Ver _ERRORES.txt" : null,
      ]
        .filter((l) => l !== null)
        .join("\n")
    );

    if (errores.length) {
      zip.file(
        "_ERRORES.txt",
        [
          "Estos informes no entraron en el paquete:",
          "",
          ...errores.map((e) => `  · ${e}`),
          "",
          "El resto del paquete está completo. Si el motivo es una migración que falta,",
          "correrla y volver a descargar el paquete.",
        ].join("\n")
      );
    }

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const sufijo = ambito.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
    const archivo = `cierre-${mes}_${sufijo}.zip`;

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archivo}"`,
        "Cache-Control": "no-store",
        // La pantalla lo lee para avisar que faltó algo, sin tener que abrir el ZIP.
        "X-Paquete-Informes": String(incluidos.length),
        "X-Paquete-Errores": String(errores.length),
      },
    });
  } catch (err) {
    console.error("[/api/contabilidad/paquete]", err instanceof Error ? err.message : err);
    return new Response("No se pudo armar el paquete.", { status: 500 });
  }
}
