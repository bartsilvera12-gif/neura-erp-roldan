"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCompras } from "@/lib/compras/storage";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import AnularCompraModal from "./AnularCompraModal";
import { useModoPersistido } from "@/components/ui/ToggleNutricionConsig";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import type { Compra, TipoPago, Moneda } from "@/lib/compras/types";
import NotaCreditoCompraModal from "@/components/compras/NotaCreditoCompraModal";

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

const tipoPagoBadge: Record<TipoPago, string> = {
  contado: "bg-blue-50 text-blue-700",
  credito: "bg-orange-50 text-orange-700",
};

const metodoPagoBadge: Record<string, { label: string; className: string }> = {
  efectivo: { label: "Efectivo", className: "bg-emerald-50 text-emerald-700" },
  transferencia: { label: "Transferencia", className: "bg-indigo-50 text-indigo-700" },
  tarjeta: { label: "Tarjeta", className: "bg-amber-50 text-amber-800" },
};

function formatFechaDate(fecha: string | null | undefined): string {
  if (!fecha) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return fecha;
}

type GrupoCompra = {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  fecha: string;
  fecha_factura: string | null;
  metodo_pago: string | null;
  tipo_pago: TipoPago;
  plazo_dias?: number;
  moneda: Moneda;
  items: Compra[];
  total: number;
  comprobante: boolean;
  anulada: boolean;
};

function agrupar(rows: Compra[]): GrupoCompra[] {
  const map = new Map<string, GrupoCompra>();
  for (const c of rows) {
    const key = c.numero_control || c.id;
    let g = map.get(key);
    if (!g) {
      g = {
        numero_control: c.numero_control,
        proveedor_id: c.proveedor_id ?? null,
        proveedor_nombre: c.proveedor_nombre,
        fecha: c.fecha,
        fecha_factura: c.fecha_factura ?? null,
        metodo_pago: c.metodo_pago ?? null,
        tipo_pago: c.tipo_pago,
        plazo_dias: c.plazo_dias,
        moneda: c.moneda,
        items: [],
        total: 0,
        comprobante: false,
        anulada: c.estado === "anulada",
      };
      map.set(key, g);
    }
    g.items.push(c);
    g.total += Number(c.total) || 0;
    if (c.comprobante_storage_path) g.comprobante = true;
    if (c.estado === "anulada") g.anulada = true;
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

function resumenProductos(items: Compra[]): string {
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0].producto_nombre;
  return `${items[0].producto_nombre} + ${items.length - 1} más`;
}

// ── Header con toggle ─────────────────────────────────────────────────────────
function Header({ modo, setModo }: { modo: "nutricion" | "consignataria"; setModo: (m: "nutricion" | "consignataria") => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Zentra · Adquisiciones
          </p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compras</h1>
        <p className="mt-0.5 text-xs text-slate-500">Registro de órdenes de compra a proveedores</p>
      </div>
    </div>
  );
}

// ── VISTA NUTRICIÓN (comportamiento actual) ────────────────────────────────────
function VistaNutricion() {
  const [todas, setTodas] = useState<Compra[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipoPago, setFiltroTipoPago] = useState<TipoPago | "">("");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [anularTarget, setAnularTarget] = useState<{ numero: string; proveedor: string } | null>(null);
  const [ncTarget, setNcTarget] = useState<GrupoCompra | null>(null);
  // Notas de crédito de compra imputadas, sumadas por numero_control. Se usan para
  // mostrar el saldo neto (total − NC) en la fila, así el descuento se ve acá mismo.
  const [ncMap, setNcMap] = useState<Map<string, number>>(new Map());
  const { isAdmin } = useIsAdmin();

  async function cargarNc() {
    try {
      const res = await apiFetch("/api/compras/notas-credito");
      const body = await res.json().catch(() => ({}));
      const list = (body?.data?.notasCredito ?? []) as Array<{
        compra_numero_control: string | null;
        monto: number | string;
      }>;
      const m = new Map<string, number>();
      for (const r of list) {
        const k = r.compra_numero_control ?? "";
        if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + (Number(r.monto) || 0));
      }
      setNcMap(m);
    } catch {
      /* si falla, simplemente no mostramos el neto */
    }
  }

  async function recargar() {
    const data = await getCompras();
    setTodas(data);
    void cargarNc();
  }

  useEffect(() => {
    let cancel = false;
    getCompras().then((data) => {
      if (cancel) return;
      setTodas(data);
    });
    void cargarNc();
    return () => { cancel = true; };
  }, []);

  const grupos = useMemo(() => agrupar(todas), [todas]);

  const filtrados = useMemo(() => {
    const texto = busqueda.toLowerCase().trim();
    return grupos.filter((g) => {
      const coincideTexto =
        texto === "" ||
        g.proveedor_nombre.toLowerCase().includes(texto) ||
        g.numero_control.toLowerCase().includes(texto) ||
        g.items.some((i) => i.producto_nombre.toLowerCase().includes(texto));
      const coincideTipoPago = filtroTipoPago === "" || g.tipo_pago === filtroTipoPago;
      return coincideTexto && coincideTipoPago;
    });
  }, [grupos, busqueda, filtroTipoPago]);

  const hayFiltros = busqueda || filtroTipoPago;

  function toggle(numero: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) next.delete(numero);
      else next.add(numero);
      return next;
    });
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Órdenes de compra</h2>
          <div className="flex items-center gap-3">
            <ExportExcelButton url="/api/compras/export" />
            <Link
              href="/compras/pedidos"
              className="rounded-lg border border-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/10"
            >
              📄 Órdenes de compra
            </Link>
            <Link
              href="/compras/nueva"
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
            >
              + Nueva compra
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input
            type="text"
            placeholder="Buscar por proveedor, producto o N° control..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-72`}
          />
          <FancySelect
            value={filtroTipoPago}
            onChange={(v) => setFiltroTipoPago(v as TipoPago | "")}
            ariaLabel="Filtrar por tipo de pago"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los pagos" },
              { value: "contado", label: "Contado" },
              { value: "credito", label: "Crédito" },
            ]}
          />
          {hayFiltros && (
            <button
              onClick={() => { setBusqueda(""); setFiltroTipoPago(""); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtrados.length} de {grupos.length} compras
          </span>
        </div>

        <EdgeScrollArea>
          <table className="w-full min-w-[960px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">N° Control</th>
                <th className="py-3 pr-4 font-medium">Proveedor</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="py-3 pr-4 font-medium text-right">Cant.</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Método</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Fecha factura</th>
                <th className="py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400">
                    {grupos.length === 0 ? "No hay compras registradas" : "Ninguna compra coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtrados.map((g) => {
                  const abierto = expandidos.has(g.numero_control);
                  const multi = g.items.length > 1;
                  return (
                    <FragmentRow key={g.numero_control}>
                      <tr
                        className={`border-b border-slate-200 transition-colors hover:bg-[#4FAEB2]/[0.04] ${multi ? "cursor-pointer" : ""} ${g.anulada ? "opacity-60" : ""}`}
                        onClick={() => multi && toggle(g.numero_control)}
                      >
                        <td className={`py-4 pr-4 font-mono text-xs ${g.anulada ? "line-through text-gray-400" : "text-gray-500"}`}>
                          {multi && <span className="mr-1 inline-block text-gray-400">{abierto ? "▾" : "▸"}</span>}
                          {g.numero_control}
                        </td>
                        <td className="py-4 pr-4 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            <span className={g.anulada ? "line-through" : ""}>{g.proveedor_nombre}</span>
                            {g.anulada && (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                                Anulada
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-gray-600">
                          <div>{resumenProductos(g.items)}</div>
                          {g.comprobante && (
                            <a
                              href={`/api/compras/comprobante?numero_control=${encodeURIComponent(g.numero_control)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
                            >
                              📎 Ver comprobante
                            </a>
                          )}
                        </td>
                        <td className="py-4 pr-4 text-right tabular-nums text-gray-700" title={`${g.items.length} producto(s)`}>
                          {g.items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0)}
                        </td>
                        <td className={`py-4 pr-4 text-right tabular-nums font-semibold ${g.anulada ? "line-through text-gray-500" : "text-gray-800"}`}>
                          {(() => {
                            const nc = g.tipo_pago === "credito" && !g.anulada ? (ncMap.get(g.numero_control) ?? 0) : 0;
                            if (nc <= 0) return formatGs(g.total);
                            const saldo = Math.max(0, g.total - nc);
                            return (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="text-gray-400 line-through text-xs">{formatGs(g.total)}</span>
                                <span className="text-[11px] font-medium text-violet-600">NC −{formatGs(nc)}</span>
                                <span className="text-gray-800">Saldo {formatGs(saldo)}</span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="hidden py-4 pr-4 lg:table-cell">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${g.tipo_pago ? tipoPagoBadge[g.tipo_pago] : "bg-gray-100 text-gray-500"}`}>
                            {g.tipo_pago === "contado" ? "Contado" : g.tipo_pago === "credito" ? `Crédito ${g.plazo_dias ?? ""}d` : "—"}
                          </span>
                        </td>
                        <td className="hidden py-4 pr-4 lg:table-cell">
                          {g.metodo_pago && metodoPagoBadge[g.metodo_pago] ? (
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${metodoPagoBadge[g.metodo_pago].className}`}>
                              {metodoPagoBadge[g.metodo_pago].label}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums">{formatFecha(g.fecha)}</td>
                        <td className="hidden py-4 pr-4 text-gray-500 text-xs tabular-nums lg:table-cell">
                          {formatFechaDate(g.fecha_factura)}
                        </td>
                        <td className="py-4 text-right whitespace-nowrap">
                          {isAdmin && (
                            <Link
                              href={`/compras/nueva?numero=${encodeURIComponent(g.numero_control)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="mr-2 inline-flex items-center justify-center rounded-md border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
                              title="Editar esta compra (solo admin)"
                            >
                              Editar
                            </Link>
                          )}
                          {!g.anulada && g.tipo_pago === "credito" && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setNcTarget(g);
                              }}
                              className="mr-2 inline-flex items-center justify-center rounded-md border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors"
                              title="Cargar una nota de crédito recibida del proveedor e imputarla a esta compra"
                            >
                              Nota de crédito
                            </button>
                          )}
                          {!g.anulada && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAnularTarget({ numero: g.numero_control, proveedor: g.proveedor_nombre });
                              }}
                              className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                              title="Anular esta compra (reintegra stock en reverso)"
                            >
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>

                      {abierto && multi && g.items.map((it) => (
                        <tr key={it.id} className="border-b border-slate-100 bg-slate-50/50 text-xs">
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4 text-gray-700">
                            <span className="font-medium">{it.producto_nombre}</span>
                            <span className="ml-2 font-mono text-gray-400">{formatGs(it.costo_unitario)}/u</span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{it.cantidad}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{formatGs(it.total)}</td>
                          <td className="hidden lg:table-cell" />
                          <td className="hidden lg:table-cell" />
                          <td />
                          <td className="hidden lg:table-cell" />
                          <td />
                        </tr>
                      ))}
                    </FragmentRow>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>
      </div>

      <MobileFab href="/compras/nueva" label="Nueva compra" />

      {anularTarget && (
        <AnularCompraModal
          numeroControl={anularTarget.numero}
          proveedorNombre={anularTarget.proveedor}
          onClose={() => setAnularTarget(null)}
          onAnulada={() => {
            setAnularTarget(null);
            void recargar();
          }}
        />
      )}

      {ncTarget && (
        <NotaCreditoCompraModal
          proveedorId={ncTarget.proveedor_id}
          proveedorNombre={ncTarget.proveedor_nombre}
          numeroControl={ncTarget.numero_control}
          total={ncTarget.total}
          moneda={ncTarget.moneda}
          onClose={() => setNcTarget(null)}
          onExito={() => {
            setNcTarget(null);
            void recargar();
          }}
        />
      )}

    </>
  );
}


// ── VISTA CONSIGNATARIA ────────────────────────────────────────────────────────
interface CompraConsigRow {
  id: string;
  fecha: string | null;
  numero_control: string | null;
  proveedor_nombre: string | null;
  proveedor_ruc: string | null;
  concepto: string | null;
  cantidad: number | null;
  unidad_medida: string | null;
  monto_total: number;
  moneda: string;
  estado: string;
  iva_tipo: string | null;
  monto_iva: number | null;
  consignacion_id: string | null;
  consignacion_numero: string | null;
}

function formatFechaSolo(iso: string | null) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

type GrupoConsig = {
  numero_control: string;
  consignacion_id: string | null;
  consignacion_numero: string | null;
  proveedor_nombre: string | null;
  fecha: string | null;
  moneda: string;
  estado: string;
  lineas: CompraConsigRow[];
  monto_total: number;
  monto_iva: number;
};

function agruparConsig(rows: CompraConsigRow[]): GrupoConsig[] {
  const map = new Map<string, GrupoConsig>();
  for (const r of rows) {
    const key = r.numero_control ?? r.id;
    let g = map.get(key);
    if (!g) {
      g = {
        numero_control: r.numero_control ?? "—",
        consignacion_id: r.consignacion_id,
        consignacion_numero: r.consignacion_numero,
        proveedor_nombre: r.proveedor_nombre,
        fecha: r.fecha,
        moneda: r.moneda,
        estado: r.estado,
        lineas: [],
        monto_total: 0,
        monto_iva: 0,
      };
      map.set(key, g);
    }
    g.lineas.push(r);
    g.monto_total += Number(r.monto_total) || 0;
    g.monto_iva += Number(r.monto_iva) || 0;
    if (r.estado === "anulada") g.estado = "anulada";
  }
  return [...map.values()];
}

function VistaConsignataria() {
  const [rows, setRows] = useState<CompraConsigRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [accionBusy, setAccionBusy] = useState<string | null>(null);

  function toggleExpand(numero: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) next.delete(numero);
      else next.add(numero);
      return next;
    });
  }

  async function anularCompra(numero: string) {
    if (!window.confirm(`¿Anular la compra ${numero}? Quedará marcada como anulada.`)) return;
    setAccionBusy(numero);
    try {
      const res = await apiFetch("/api/consignaciones/compras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero_control: numero, estado: "anulada" }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo anular.");
    } finally {
      setAccionBusy(null);
    }
  }

  async function eliminarCompra(numero: string) {
    if (!window.confirm(`¿Eliminar definitivamente la compra ${numero}? Esta acción no se puede deshacer.`)) return;
    setAccionBusy(numero);
    try {
      const res = await apiFetch(`/api/consignaciones/compras?numero_control=${encodeURIComponent(numero)}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo eliminar.");
    } finally {
      setAccionBusy(null);
    }
  }

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    return p.toString();
  }, [desde, hasta]);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/consignaciones/compras-agregadas?${qs}`);
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
      setRows((j.data?.compras ?? []) as CompraConsigRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setRows([]);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  const filtrados = useMemo(() => {
    const t = busqueda.toLowerCase().trim();
    if (!t) return rows;
    return rows.filter(
      (r) =>
        (r.proveedor_nombre ?? "").toLowerCase().includes(t) ||
        (r.concepto ?? "").toLowerCase().includes(t) ||
        (r.numero_control ?? "").toLowerCase().includes(t)
    );
  }, [rows, busqueda]);

  const grupos = useMemo(() => agruparConsig(filtrados), [filtrados]);

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Compras de consignación</h2>
          <Link
            href="/compras/nueva-consig"
            className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
          >
            + Nueva compra consig.
          </Link>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-gray-100 pb-5">
          <input
            type="text"
            placeholder="Buscar por proveedor, concepto o N° control..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-72`}
          />
          <label className="text-xs font-semibold text-slate-500">
            Desde
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Hasta
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          {(busqueda || desde || hasta) && (
            <button
              onClick={() => { setBusqueda(""); setDesde(""); setHasta(""); }}
              className="px-2 text-sm text-gray-400 transition-colors hover:text-gray-600"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {grupos.length} {grupos.length === 1 ? "compra" : "compras"}
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <EdgeScrollArea>
          <table className="w-full min-w-[900px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium w-6"></th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 pr-4 font-medium">N° Consig.</th>
                <th className="py-3 pr-4 font-medium">Proveedor</th>
                <th className="py-3 pr-4 font-medium">Concepto</th>
                <th className="py-3 pr-4 font-medium text-right">Monto</th>
                <th className="py-3 pr-4 font-medium text-center">IVA</th>
                <th className="py-3 pr-4 font-medium">Estado</th>
                <th className="py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={9} className="py-12 text-center text-gray-400">Cargando…</td></tr>
              ) : grupos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-400">
                    {rows.length === 0 ? "No hay compras de consignación" : "Ninguna compra coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                grupos.map((g) => {
                  const abierto = expandidos.has(g.numero_control);
                  const anulada = g.estado === "anulada";
                  const resumen =
                    g.lineas.length === 1
                      ? (g.lineas[0].concepto ?? "—")
                      : `${g.lineas[0].concepto ?? "—"} + ${g.lineas.length - 1} más`;
                  const fmtMonto = (n: number) =>
                    g.moneda === "USD" ? `USD ${Number(n).toLocaleString("es-PY")}` : formatGs(Number(n));
                  return (
                    <FragmentRow key={g.numero_control}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-[#4FAEB2]/[0.04] cursor-pointer ${anulada ? "opacity-60" : ""}`}
                        onClick={() => toggleExpand(g.numero_control)}
                      >
                        <td className="py-3 pr-2 text-center text-slate-400">{abierto ? "▾" : "▸"}</td>
                        <td className="py-3 pr-4 text-xs tabular-nums text-slate-600">{formatFechaSolo(g.fecha)}</td>
                        <td className="py-3 pr-4 font-mono text-xs">
                          <Link
                            href={`/compras/nueva-consig?numero=${encodeURIComponent(g.numero_control)}`}
                            className="text-[#3F8E91] hover:text-[#2F6F72] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                            title="Abrir / editar esta compra"
                          >
                            {g.numero_control}
                          </Link>
                        </td>
                        <td className="py-3 pr-4 font-medium text-slate-800">{g.proveedor_nombre || "—"}</td>
                        <td className="py-3 pr-4 text-slate-600">{resumen}</td>
                        <td className="py-3 pr-4 text-right tabular-nums font-semibold text-slate-800">{fmtMonto(g.monto_total)}</td>
                        <td className="py-3 pr-4 text-center text-xs text-slate-600">
                          {g.monto_iva > 0 ? fmtMonto(g.monto_iva) : "Ex."}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            g.estado === "pagada" ? "bg-emerald-50 text-emerald-700"
                              : anulada ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                          }`}>
                            {g.estado}
                          </span>
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <Link
                            href={`/compras/nueva-consig?numero=${encodeURIComponent(g.numero_control)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="mr-3 text-xs font-medium text-teal-700 hover:text-teal-900"
                            title="Abrir / editar esta compra"
                          >
                            Editar
                          </Link>
                          {!anulada && (
                            <button
                              onClick={(e) => { e.stopPropagation(); void anularCompra(g.numero_control); }}
                              disabled={accionBusy === g.numero_control}
                              className="mr-3 text-xs font-medium text-amber-600 hover:text-amber-800 disabled:opacity-50"
                              title="Anular esta compra"
                            >
                              Anular
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); void eliminarCompra(g.numero_control); }}
                            disabled={accionBusy === g.numero_control}
                            className="text-xs font-medium text-rose-600 hover:text-rose-800 disabled:opacity-50"
                            title="Eliminar esta compra"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                      {abierto &&
                        g.lineas.map((l) => (
                          <tr key={l.id} className="bg-slate-50/60 text-xs">
                            <td></td>
                            <td colSpan={3} className="py-2 pr-4 text-slate-500">
                              {l.unidad_medida ? `${l.cantidad ?? 1} ${l.unidad_medida}` : `${l.cantidad ?? 1}`}
                            </td>
                            <td className="py-2 pr-4 text-slate-700">{l.concepto ?? "—"}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-slate-700">{fmtMonto(Number(l.monto_total))}</td>
                            <td className="py-2 pr-4 text-center text-slate-500">
                              {l.iva_tipo === "5" ? "5%" : l.iva_tipo === "10" ? "10%" : "Ex."}
                            </td>
                            <td colSpan={2}></td>
                          </tr>
                        ))}
                    </FragmentRow>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>
      </div>
    </>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────
export default function ComprasPage() {
  // Roldán e Hijos: sólo "Nutrición" (operación normal). Vista Consignataria oculta.
  const [modo, setModo] = useModoPersistido("compras.modo");
  return (
    <div className="space-y-8">
      <Header modo={modo} setModo={setModo} />
      <VistaNutricion />
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
