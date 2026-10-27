"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import AccionesTabla from "@/components/ui/AccionesTabla";
import DetalleVentaModal, { type VentaDetalleLite } from "@/components/ventas/DetalleVentaModal";

/**
 * Historial de ventas.
 *
 * ── POR QUÉ ES UNA PANTALLA APARTE Y NO UN FILTRO MÁS ────────────────────
 *   Reportes → Ventas trabaja de a un mes: calcula ticket promedio, corte por
 *   tipo de precio y por producto, y esas cuentas tienen sentido sobre un mes
 *   cerrado. Estirarlo a un rango largo las vuelve promedios de nada.
 *
 *   La pantalla de Ventas sí tiene rango, pero está hecha para operar: desde
 *   ahí se anula, se edita y se cobra. Para buscar una venta de hace ocho
 *   meses y mandarla por correo, esos botones estorban.
 *
 *   Acá va solo el listado: rango de fechas, filtros, Excel e imprimir.
 *
 * ── DE DÓNDE SALEN LOS DATOS ─────────────────────────────────────────────
 *   Del mismo /api/ventas que usa la pantalla de Ventas, que ya aplica el
 *   rango en la consulta. Una ruta propia sería la misma consulta escrita dos
 *   veces, y a la primera corrección una de las dos quedaría distinta.
 */

type Row = {
  id: string;
  numero_control: string;
  fecha: string;
  total: number;
  estado?: string | null;
  tipo_venta?: string | null;
  metodo_pago?: string | null;
  cliente_nombre?: string | null;
  vendedor_nombre?: string | null;
  usuario_nombre?: string | null;
  numero_factura?: string | null;
  anulacion_motivo?: string | null;
  subtotal?: number;
  monto_iva?: number;
  /** Los ítems ya vienen en /api/ventas: el detalle no pide nada más. */
  items?: VentaDetalleLite["items"];
  /** Banderas del listado; el detalle de cada una se pide al abrir la venta. */
  editada?: boolean;
  tiene_devolucion?: boolean;
};

const TOPE = 2000;

/** Hoy y el primero del mes, en hora de Paraguay (UTC−3). */
function ymdPy(d = new Date()): string {
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${py.getUTCFullYear()}-${p(py.getUTCMonth() + 1)}-${p(py.getUTCDate())}`;
}
function primeroDelMes(): string {
  return ymdPy().slice(0, 7) + "-01";
}

const fmtGs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

function fechaHora(iso: string): { fecha: string; hora: string } {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

const MEDIO: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia",
  qr: "QR", billetera: "Billetera", cheque: "Cheque", mixto: "Mixto",
};

export default function HistorialVentasPage() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(ymdPy());
  const [filas, setFilas] = useState<Row[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estos cuatro filtran sobre lo ya traído: son listas cortas (un puñado de
  // vendedores, cuatro medios de pago) y filtrarlos en el servidor obligaría a
  // volver a consultar por cada tilde. El rango sí va al servidor, que es el
  // que decide qué ventas llegan.
  const [fTexto, setFTexto] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fVendedor, setFVendedor] = useState("");
  const [abierta, setAbierta] = useState<Row | null>(null);
  const [fMedio, setFMedio] = useState("");
  const [fEstado, setFEstado] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limite: String(TOPE) });
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const r = await fetchWithSupabaseSession(`/api/ventas?${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setError(String(j?.error ?? `No se pudo cargar (${r.status}).`));
        setFilas([]);
        return;
      }
      setFilas((j.data?.ventas ?? []) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const vendedores = useMemo(() => {
    const s = new Set<string>();
    for (const v of filas) {
      const n = v.vendedor_nombre || v.usuario_nombre;
      if (n) s.add(n);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const clientes = useMemo(() => {
    const s = new Set<string>();
    for (const v of filas) if (v.cliente_nombre) s.add(v.cliente_nombre);
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const vista = useMemo(() => {
    const t = fTexto.trim().toLowerCase();
    return filas.filter((v) => {
      const vend = v.vendedor_nombre || v.usuario_nombre || "";
      if (fCliente && (v.cliente_nombre ?? "") !== fCliente) return false;
      if (fVendedor && vend !== fVendedor) return false;
      if (fMedio && (v.metodo_pago ?? "") !== fMedio) return false;
      if (fEstado === "anuladas" && v.estado !== "anulada") return false;
      if (fEstado === "activas" && v.estado === "anulada") return false;
      if (t) {
        // Los productos entran en la búsqueda: "cinta" tiene que traer todas
        // las ventas que llevaron una cinta, no solo las del cliente Cinta.
        // Los ítems ya vienen con cada venta, así que esto no pide nada más
        // al servidor.
        const productos = (v.items ?? [])
          .map((i) => `${i.producto_nombre} ${i.sku ?? ""}`)
          .join(" ");
        const heno = [v.numero_control, v.numero_factura, v.cliente_nombre, vend, productos]
          .filter(Boolean).join(" ").toLowerCase();
        if (!heno.includes(t)) return false;
      }
      return true;
    });
  }, [filas, fTexto, fCliente, fVendedor, fMedio, fEstado]);

  // El total no cuenta las anuladas aunque estén a la vista: una anulada se
  // muestra para saber que existió, no porque sea plata.
  const total = useMemo(
    () => vista.reduce((s, v) => s + (v.estado === "anulada" ? 0 : Number(v.total) || 0), 0),
    [vista]
  );
  const anuladas = useMemo(() => vista.filter((v) => v.estado === "anulada").length, [vista]);

  const hayFiltro = !!(fTexto || fCliente || fVendedor || fMedio || fEstado);
  const periodo = `Del ${desde || "inicio"} al ${hasta || "hoy"}`;

  const columnas = ["Fecha", "Hora", "Comprobante", "Factura", "Cliente", "Qué se vendió", "Vendedor", "Condición", "Medio", "Total", "Estado", "Motivo de anulación"];
  const filasExport = vista.map((v) => {
    const { fecha, hora } = fechaHora(v.fecha);
    return [
      fecha, hora,
      v.numero_control,
      v.numero_factura ?? "",
      v.cliente_nombre ?? "Consumidor final",
      // En la planilla va la lista completa, no el resumen de la pantalla: un
      // Excel se filtra y se busca, y "y 3 productos más" no se puede buscar.
      (v.items ?? []).map((i) => `${i.cantidad} × ${i.producto_nombre}`).join(" · "),
      v.vendedor_nombre || v.usuario_nombre || "",
      v.tipo_venta ?? "",
      MEDIO[v.metodo_pago ?? ""] ?? v.metodo_pago ?? "",
      Number(v.total) || 0,
      v.estado === "anulada" ? "ANULADA" : "",
      v.anulacion_motivo ?? "",
    ];
  });

  const selectCls = "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none";

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> /{" "}
            <span className="font-semibold text-slate-700">Historial de ventas</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Historial de ventas</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Todas las ventas de un período, para buscar una y para mandarla. Para los
            promedios y los cortes por producto está <Link href="/reportes/ventas" className="underline hover:text-[#4FAEB2]">Ventas del mes</Link>.
          </p>
        </div>
        <AccionesTabla
          titulo="Historial de ventas"
          archivo={`historial-ventas-${desde || "inicio"}_${hasta || "hoy"}`}
          subtitulo={hayFiltro ? `${periodo} · filtrado` : periodo}
          columnas={columnas}
          filas={filasExport}
          sumar={[8]}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-semibold text-slate-500">
            Desde
            <input type="date" value={desde} max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)} className={`mt-1 ${selectCls}`} />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Hasta
            <input type="date" value={hasta} min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)} className={`mt-1 ${selectCls}`} />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Cliente
            <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} className={`mt-1 ${selectCls}`}>
              <option value="">Todos</option>
              {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Vendedor
            <select value={fVendedor} onChange={(e) => setFVendedor(e.target.value)} className={`mt-1 ${selectCls}`}>
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Medio de pago
            <select value={fMedio} onChange={(e) => setFMedio(e.target.value)} className={`mt-1 ${selectCls}`}>
              <option value="">Todos</option>
              {Object.entries(MEDIO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Estado
            <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={`mt-1 ${selectCls}`}>
              <option value="">Todas</option>
              <option value="activas">Sin anular</option>
              <option value="anuladas">Solo anuladas</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={fTexto}
            onChange={(e) => setFTexto(e.target.value)}
            placeholder="N° de comprobante, factura, cliente, vendedor o producto…"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
          />
          {hayFiltro && (
            <button
              type="button"
              onClick={() => { setFTexto(""); setFCliente(""); setFVendedor(""); setFMedio(""); setFEstado(""); }}
              className="text-xs text-slate-400 underline transition-colors hover:text-slate-700"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div>
          <span className="text-xs text-slate-400">Ventas</span>
          <p className="font-bold tabular-nums text-slate-800">{vista.length}</p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Total (sin las anuladas)</span>
          <p className="font-bold tabular-nums text-emerald-700">Gs. {fmtGs(total)}</p>
        </div>
        {anuladas > 0 && (
          <div>
            <span className="text-xs text-slate-400">Anuladas</span>
            <p className="font-bold tabular-nums text-rose-700">{anuladas}</p>
          </div>
        )}
        {/* Si el período llegó al tope, lo viejo quedó afuera y el total no es
            el del período: hay que decirlo, no dejar que se asuma completo. */}
        {filas.length >= TOPE && (
          <p className="text-xs font-medium text-amber-700">
            El período llegó al tope de {TOPE.toLocaleString("es-PY")} ventas: hay más de las que se ven. Acortá el rango.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : vista.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            {filas.length === 0 ? "No hay ventas en el período." : "Ninguna venta coincide con los filtros."}
          </p>
        ) : (
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Hora</th>
                <th className="px-4 py-3 font-semibold">Comprobante</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Qué se vendió</th>
                <th className="px-4 py-3 font-semibold">Vendedor</th>
                <th className="px-4 py-3 font-semibold">Condición</th>
                <th className="px-4 py-3 font-semibold">Medio</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vista.map((v) => {
                const { fecha, hora } = fechaHora(v.fecha);
                const anulada = v.estado === "anulada";
                return (
                  <tr
                    key={v.id}
                    onClick={() => setAbierta(v)}
                    title="Ver qué se vendió, ediciones y devoluciones"
                    className={`cursor-pointer ${anulada ? "bg-rose-50/40 hover:bg-rose-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fecha}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-500">{hora}</td>
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-800">
                      {v.numero_control}
                      {v.numero_factura && (
                        <span className="block text-[11px] font-normal text-slate-400">Fact. {v.numero_factura}</span>
                      )}
                      {/* El motivo va acá y no en una columna: es texto largo y
                          una columna propia quedaría vacía en casi todas las filas. */}
                      {anulada && (
                        <span className="block text-[11px] font-normal text-rose-600">
                          ANULADA{v.anulacion_motivo ? `: ${v.anulacion_motivo}` : ""}
                        </span>
                      )}
                      {/* Que una venta se haya editado o devuelto cambia cómo
                          se lee el total: conviene verlo en la fila y no solo
                          al abrirla. */}
                      {(v.editada || v.tiene_devolucion) && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {v.editada && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">EDITADA</span>
                          )}
                          {v.tiene_devolucion && (
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">CON DEVOLUCIÓN</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{v.cliente_nombre ?? <span className="text-slate-400">Consumidor final</span>}</td>
                    {/* Qué se vendió, en una línea. El detalle completo está a
                        un clic; acá alcanza con reconocer la venta al pasar. */}
                    <td className="px-4 py-3 text-slate-600">
                      {(() => {
                        const its = v.items ?? [];
                        if (its.length === 0) return <span className="text-slate-300">—</span>;
                        const primero = its[0]!;
                        return (
                          <>
                            <span className="block truncate max-w-[16rem]">
                              {primero.cantidad > 1 && <span className="text-slate-400">{primero.cantidad} × </span>}
                              {primero.producto_nombre}
                            </span>
                            {its.length > 1 && (
                              <span className="text-[11px] text-slate-400">
                                y {its.length - 1} producto{its.length - 1 === 1 ? "" : "s"} más
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{v.vendedor_nombre || v.usuario_nombre || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{v.tipo_venta ?? ""}</td>
                    <td className="px-4 py-3 text-slate-600">{MEDIO[v.metodo_pago ?? ""] ?? v.metodo_pago ?? ""}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${anulada ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {fmtGs(v.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {abierta && (
        <DetalleVentaModal venta={abierta as VentaDetalleLite} onClose={() => setAbierta(null)} />
      )}
    </div>
  );
}
