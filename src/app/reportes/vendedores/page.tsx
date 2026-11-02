"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Trophy } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import AccionesTabla from "@/components/ui/AccionesTabla";
import PeriodoSelector, { type SeleccionPeriodo } from "@/components/reportes/PeriodoSelector";
import { getVendedoresReporte } from "@/lib/reportes/storage";
import type {
  VendedoresReporte,
  VendedorRow,
  VendedorItemRow,
  AgruparVendedor,
} from "@/lib/reportes/vendedores-types";

/**
 * Qué vende cada vendedor.
 *
 * ── CÓMO SE LEE ───────────────────────────────────────────────────────────
 *   Arriba, una tarjeta por vendedor con lo que más vende. Eso contesta la
 *   pregunta de un vistazo y sirve para comparar: quién mueve chapas, quién
 *   mueve perfiles, quién factura mucho con margen bajo.
 *
 *   Abajo, al tocar una tarjeta, TODO lo que vendió esa persona, producto por
 *   producto, con Excel e imprimir. La tarjeta es para mirar; la tabla es
 *   para revisar y para la reunión.
 *
 * ── UNA ADVERTENCIA QUE CONVIENE TENER A LA VISTA ─────────────────────────
 *   El vendedor de cada venta sale de `ventas.vendedor_usuario_id`, y cuando
 *   la venta no lo tiene cargado se usa el usuario que la hizo. O sea que si
 *   en el mostrador no eligen vendedor, lo vendido le queda al cajero. No es
 *   un error del reporte: es lo que quedó registrado. Está escrito al pie de
 *   la pantalla para que nadie discuta una comisión sin saberlo.
 */

const formatGs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
const formatPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const formatNum = (v: number) => v.toLocaleString("es-PY", { maximumFractionDigits: 2 });

type SortKey = "nombre" | "unidades" | "facturacion" | "costo" | "utilidad" | "margen" | "participacion";

export default function VendedoresReportePage() {
  const [sel, setSel] = useState<SeleccionPeriodo | null>(null);
  const [agrupar, setAgrupar] = useState<AgruparVendedor>("producto");
  const [vendedor, setVendedor] = useState<string | null>(null);
  const [data, setData] = useState<VendedoresReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("facturacion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const onPeriodo = useCallback((s: SeleccionPeriodo) => setSel(s), []);

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    setCargando(true);
    getVendedoresReporte(sel.tipo, agrupar, vendedor, {
      ref: sel.ref,
      desde: sel.desde,
      hasta: sel.hasta,
    }).then((d) => {
      if (!cancel) {
        setData(d);
        setCargando(false);
      }
    });
    return () => {
      cancel = true;
    };
  }, [sel, agrupar, vendedor]);

  const filasDetalle = useMemo(() => {
    const filas = data?.detalle?.filas ?? [];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filas].sort((a, b) => {
      if (sortKey === "nombre") return dir * a.nombre.localeCompare(b.nombre);
      return dir * ((a[sortKey] as number) - (b[sortKey] as number));
    });
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "nombre" ? "asc" : "desc");
    }
  }

  const esProducto = agrupar === "producto";
  const margenTotal =
    data && data.totalFacturacion > 0 ? (data.totalUtilidad / data.totalFacturacion) * 100 : 0;
  const elegido = data?.vendedores.find((v) => v.id === vendedor) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Ventas por vendedor"
        description="Qué vende cada uno, cuánto factura y cuánta utilidad deja"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              <button
                onClick={() => setAgrupar("producto")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${esProducto ? "bg-[#3F8E91] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
              >
                Por producto
              </button>
              <button
                onClick={() => setAgrupar("categoria")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${!esProducto ? "bg-[#3F8E91] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
              >
                Por rubro
              </button>
            </div>
            <PeriodoSelector onChange={onPeriodo} />
          </div>
        }
      />

      {cargando ? (
        <p className="animate-pulse text-slate-500">Cargando…</p>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
          No se pudo cargar el reporte por vendedor.
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">{data.periodoLabel}</span>
            {" · "}
            {esProducto ? "por producto" : "por rubro"}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact accent label="Facturación (sin IVA)" value={formatGs(data.totalFacturacion)} />
            <StatCard compact label="Utilidad" value={formatGs(data.totalUtilidad)} hint={`Margen ${formatPct(margenTotal)}`} />
            <StatCard compact label="Ventas" value={formatNum(data.totalVentas)} />
            <StatCard
              compact
              label="Vendedores con ventas"
              value={formatNum(data.vendedores.length)}
            />
          </div>

          {data.vendedores.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
              No hay ventas en el período.
            </div>
          ) : (
            <>
              {/* ── El tablero: una tarjeta por vendedor ─────────────────── */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.vendedores.map((v, i) => (
                  <TarjetaVendedor
                    key={v.id}
                    v={v}
                    puesto={i + 1}
                    seleccionado={v.id === vendedor}
                    onSeleccionar={() => setVendedor(v.id === vendedor ? null : v.id)}
                  />
                ))}
              </div>

              {/* ── El detalle del elegido ───────────────────────────────── */}
              {vendedor && data.detalle ? (
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-800">
                        Todo lo que vendió {data.detalle.nombre}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {esProducto ? "Producto por producto" : "Rubro por rubro"} ·{" "}
                        {data.detalle.filas.length}{" "}
                        {data.detalle.filas.length === 1 ? "línea" : "líneas"}
                        {elegido ? ` · ${formatGs(elegido.facturacion)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <AccionesTabla
                        titulo={`Ventas de ${data.detalle.nombre} — ${data.periodoLabel}`}
                        archivo={`ventas-vendedor-${data.detalle.nombre.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-${data.ref}`}
                        subtitulo={esProducto ? "Por producto" : "Por rubro"}
                        columnas={[
                          esProducto ? "Producto" : "Rubro",
                          "SKU",
                          "Unidades",
                          "Facturación",
                          "Costo",
                          "Utilidad",
                          "Margen %",
                          "% de su venta",
                        ]}
                        filas={filasDetalle.map((f) => [
                          f.nombre,
                          f.sku ?? "",
                          f.unidades,
                          f.facturacion,
                          f.costo,
                          f.utilidad,
                          Number(f.margen.toFixed(1)),
                          Number(f.participacion.toFixed(1)),
                        ])}
                        sumar={[2, 3, 4, 5]}
                      />
                      <button
                        onClick={() => setVendedor(null)}
                        className="text-xs font-medium text-slate-500 underline hover:text-slate-800"
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                          <Th label={esProducto ? "Producto" : "Rubro"} onClick={() => toggleSort("nombre")} active={sortKey === "nombre"} />
                          <Th label="Unidades" right onClick={() => toggleSort("unidades")} active={sortKey === "unidades"} />
                          <Th label="Facturación" right onClick={() => toggleSort("facturacion")} active={sortKey === "facturacion"} />
                          <Th label="Costo" right onClick={() => toggleSort("costo")} active={sortKey === "costo"} />
                          <Th label="Utilidad" right onClick={() => toggleSort("utilidad")} active={sortKey === "utilidad"} />
                          <Th label="Margen %" right onClick={() => toggleSort("margen")} active={sortKey === "margen"} />
                          <Th label="% de su venta" right onClick={() => toggleSort("participacion")} active={sortKey === "participacion"} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filasDetalle.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-slate-400">
                              Este vendedor no registró ventas en el período.
                            </td>
                          </tr>
                        ) : (
                          filasDetalle.map((f) => <FilaItem key={f.id} f={f} esProducto={esProducto} />)
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <p className="text-sm text-slate-400">
                  Tocá una tarjeta para ver todo lo que vendió esa persona y bajarlo a planilla.
                </p>
              )}
            </>
          )}

          <p className="max-w-3xl text-xs leading-relaxed text-slate-400">
            <strong>El vendedor sale de la venta</strong>: si en el mostrador no se eligió vendedor,
            la venta queda a nombre de quien la cargó en caja, y si tampoco hay usuario aparece como
            &quot;Sin vendedor&quot;. Facturación sin IVA; costo = costo de lo vendido sin IVA al
            momento de la venta. <strong>Utilidad</strong> está en guaraníes y{" "}
            <strong>Margen</strong> en porcentaje: el que más factura no es siempre el que más deja.
            Excluye ventas anuladas y de consignación, y solo cuenta la sucursal del usuario.
          </p>
        </>
      )}
    </div>
  );
}

function TarjetaVendedor({
  v,
  puesto,
  seleccionado,
  onSeleccionar,
}: {
  v: VendedorRow;
  puesto: number;
  seleccionado: boolean;
  onSeleccionar: () => void;
}) {
  // La barra compara cada producto contra el más vendido DEL VENDEDOR, no
  // contra el total: lo que se quiere ver es qué pesa en su venta.
  const tope = v.top.reduce((m, t) => Math.max(m, t.facturacion), 0);
  return (
    <button
      onClick={onSeleccionar}
      className={`flex w-full flex-col gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-[#4FAEB2] ${seleccionado ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/30" : "border-slate-200"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-800" title={v.nombre}>
            {v.nombre}
          </p>
          <p className="text-xs text-slate-500">
            {formatNum(v.ventas)} {v.ventas === 1 ? "venta" : "ventas"} · ticket{" "}
            {formatGs(v.ticketPromedio)}
          </p>
        </div>
        {puesto === 1 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
            <Trophy size={11} /> 1º
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Facturó</p>
          <p className="font-bold text-[#3F8E91]">{formatGs(v.facturacion)}</p>
          <p className="text-[11px] text-slate-400">{formatPct(v.participacion)} del total</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Utilidad</p>
          <p className={`font-bold ${v.utilidad < 0 ? "text-red-600" : "text-slate-900"}`}>
            {formatGs(v.utilidad)}
          </p>
          <p className="text-[11px] text-slate-400">margen {formatPct(v.margen)}</p>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-slate-100 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Lo que más vende
        </p>
        {v.top.length === 0 ? (
          <p className="text-xs text-slate-400">Sin líneas cargadas.</p>
        ) : (
          v.top.map((t) => (
            <div key={t.id}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-slate-700" title={t.nombre}>
                  {t.nombre}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {formatNum(t.unidades)} u · {formatPct(t.participacion)}
                </span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#4FAEB2]"
                  style={{ width: `${tope > 0 ? Math.max(2, (t.facturacion / tope) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </button>
  );
}

function Th({
  label,
  right,
  onClick,
  active,
}: {
  label: string;
  right?: boolean;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <th
      className={`select-none cursor-pointer px-4 py-2.5 font-medium hover:text-slate-600 ${right ? "text-right" : ""} ${active ? "text-slate-700" : ""}`}
      onClick={onClick}
    >
      <span className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
        {label}
        <ArrowUpDown size={12} className={active ? "text-[#3F8E91]" : "text-slate-300"} />
      </span>
    </th>
  );
}

function FilaItem({ f, esProducto }: { f: VendedorItemRow; esProducto: boolean }) {
  const color = f.utilidad > 0 ? "text-slate-900" : f.utilidad < 0 ? "text-red-600" : "text-slate-500";
  return (
    <tr className="hover:bg-slate-50/50">
      <td className="px-4 py-2.5">
        <div className="font-medium text-slate-700">{f.nombre}</div>
        {esProducto && (f.sku || f.categoria) && (
          <div className="text-xs text-slate-400">{[f.sku, f.categoria].filter(Boolean).join(" · ")}</div>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatNum(f.unidades)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatGs(f.facturacion)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatGs(f.costo)}</td>
      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${color}`}>{formatGs(f.utilidad)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatPct(f.margen)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatPct(f.participacion)}</td>
    </tr>
  );
}
