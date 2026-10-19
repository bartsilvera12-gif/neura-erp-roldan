"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { formatearNumeroFactura } from "@/lib/formato/numero-factura";

type Estado = "pendiente" | "pagada" | "anulada";

type IvaTipo = "exenta" | "5" | "10";
type Moneda = "PYG" | "USD";

type Linea = {
  concepto: string;
  cantidad: string;
  unidad_medida: string;
  precio_unitario: string;
  iva_tipo: IvaTipo;
};

// Misma lista de unidades que el resto del sistema (inventario/compras).
const UNIDADES: { v: string; l: string }[] = [
  { v: "UNIDAD", l: "Unidad" },
  { v: "BOLSA", l: "Bolsa" },
  { v: "KG", l: "Kg" },
  { v: "G", l: "G" },
  { v: "LT", l: "Litro" },
  { v: "ML", l: "Ml" },
  { v: "CAJA", l: "Caja" },
  { v: "PAQUETE", l: "Paquete" },
  { v: "DOCENA", l: "Docena" },
  { v: "LATA", l: "Lata" },
  { v: "BOTELLA", l: "Botella" },
  { v: "PORCION", l: "Porción" },
  { v: "COMBO", l: "Combo" },
];

const IVA_LABEL: Record<IvaTipo, string> = { exenta: "Exenta", "5": "IVA 5%", "10": "IVA 10%" };

function ivaIncluido(total: number, tipo: IvaTipo): number {
  if (tipo === "5") return total - total / 1.05;
  if (tipo === "10") return total - total / 1.1;
  return 0;
}

const inp = "w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500";

export default function NuevaCompraConsignacionPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modo edición: ?numero=COMP-XXXXXX en la URL.
  const [numeroEdit, setNumeroEdit] = useState<string | null>(null);
  const editando = numeroEdit !== null;

  const [header, setHeader] = useState({
    proveedor_nombre: "",
    proveedor_ruc: "",
    fecha: new Date().toISOString().slice(0, 10),
    nro_timbrado: "",
    numero_factura: "",
    moneda: "PYG" as Moneda,
    tipo_cambio: "",
    tipo_pago: "contado" as "contado" | "credito",
    estado: "pagada" as Estado,
    observaciones: "",
  });

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [nl, setNl] = useState<Linea>({ concepto: "", cantidad: "1", unidad_medida: "UNIDAD", precio_unitario: "", iva_tipo: "10" });

  // Cargar la compra si estamos editando (?numero=).
  useEffect(() => {
    let numero: string | null = null;
    try { numero = new URLSearchParams(window.location.search).get("numero"); } catch { numero = null; }
    if (!numero) return;
    setNumeroEdit(numero);
    (async () => {
      try {
        const res = await fetchWithSupabaseSession(`/api/consignaciones/compras?numero_control=${encodeURIComponent(numero)}`);
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
        const c = j.data.compra as Record<string, unknown>;
        setHeader({
          proveedor_nombre: String(c.proveedor_nombre ?? ""),
          proveedor_ruc: String(c.proveedor_ruc ?? ""),
          fecha: String(c.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
          nro_timbrado: String(c.nro_timbrado ?? ""),
          numero_factura: String(c.numero_factura ?? ""),
          moneda: c.moneda === "USD" ? "USD" : "PYG",
          tipo_cambio: c.moneda === "USD" ? String(c.tipo_cambio ?? "") : "",
          tipo_pago: c.tipo_pago === "credito" ? "credito" : "contado",
          estado: c.estado === "pagada" || c.estado === "anulada" ? (c.estado as Estado) : "pendiente",
          observaciones: String(c.observaciones ?? ""),
        });
        const items = (j.data.items ?? []) as Record<string, unknown>[];
        setLineas(items.map((it) => ({
          concepto: String(it.concepto ?? ""),
          cantidad: String(it.cantidad ?? 1),
          unidad_medida: String(it.unidad_medida ?? "UNIDAD") || "UNIDAD",
          precio_unitario: it.precio_unitario != null ? String(it.precio_unitario) : "",
          iva_tipo: it.iva_tipo === "5" || it.iva_tipo === "10" ? (it.iva_tipo as IvaTipo) : "exenta",
        })));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar la compra.");
      }
    })();
  }, []);

  const money = header.moneda === "USD" ? "USD " : "Gs ";
  const fmt = (n: number) => money + new Intl.NumberFormat("es-PY").format(Math.round(n));

  function totalLinea(l: Linea): number {
    const cant = Number(l.cantidad) || 0;
    const precio = Number(l.precio_unitario) || 0;
    return cant * precio;
  }

  function agregarLinea() {
    setError(null);
    if (!nl.concepto.trim()) return setError("Escribí el concepto de la línea.");
    if (!(Number(nl.precio_unitario) > 0)) return setError("El precio unitario debe ser mayor a 0.");
    setLineas((prev) => [...prev, { ...nl, concepto: nl.concepto.trim() }]);
    setNl({ concepto: "", cantidad: "1", unidad_medida: nl.unidad_medida, precio_unitario: "", iva_tipo: nl.iva_tipo });
  }

  const totales = useMemo(() => {
    let subtotal = 0, iva = 0, total = 0;
    for (const l of lineas) {
      const t = totalLinea(l);
      const mi = ivaIncluido(t, l.iva_tipo);
      subtotal += t - mi;
      iva += mi;
      total += t;
    }
    return { subtotal, iva, total };
  }, [lineas]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (lineas.length === 0) return setError("Agregá al menos una línea.");
    if (header.moneda === "USD" && !(Number(header.tipo_cambio) > 0))
      return setError("Ingresá el tipo de cambio para dólares.");

    setSaving(true);
    try {
      const payload = {
        ...(editando ? { numero_control: numeroEdit, estado: header.estado } : {}),
        fecha: header.fecha,
        proveedor_nombre: header.proveedor_nombre.trim(),
        proveedor_ruc: header.proveedor_ruc.trim() || null,
        nro_timbrado: header.nro_timbrado.trim() || null,
        numero_factura: header.numero_factura.trim() || null,
        moneda: header.moneda,
        tipo_cambio: header.moneda === "USD" ? Number(header.tipo_cambio) || 0 : 1,
        tipo_pago: header.tipo_pago,
        consignacion_id: null,
        observaciones: header.observaciones.trim() || null,
        items: lineas.map((l) => ({
          concepto: l.concepto,
          cantidad: Number(l.cantidad) || 1,
          unidad_medida: l.unidad_medida,
          precio_unitario: Number(l.precio_unitario) || 0,
          iva_tipo: l.iva_tipo,
          monto_total: totalLinea(l),
        })),
      };
      const res = await fetchWithSupabaseSession("/api/consignaciones/compras", {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error al guardar");
      router.push("/compras");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/compras" className="text-sm text-teal-700 hover:underline">← Volver a compras</Link>
      <h1 className="text-2xl font-bold text-slate-900 mt-2 mb-1">
        {editando ? `Editar compra ${numeroEdit}` : "Nueva compra de consignación"}
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        Registro/control de compras de la consignataria. No toca inventario. Concepto libre con desglose de IVA.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={guardar} className="space-y-5">
        {/* ── Cabecera ── */}
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Datos de la compra</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Proveedor</label>
              <input value={header.proveedor_nombre} onChange={(e) => setHeader({ ...header, proveedor_nombre: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs text-slate-600">RUC</label>
              <input value={header.proveedor_ruc} onChange={(e) => setHeader({ ...header, proveedor_ruc: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs text-slate-600">Fecha</label>
              <input type="date" value={header.fecha} onChange={(e) => setHeader({ ...header, fecha: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs text-slate-600">N° de timbrado</label>
              <input value={header.nro_timbrado} onChange={(e) => setHeader({ ...header, nro_timbrado: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs text-slate-600">N° de factura</label>
              <input value={header.numero_factura} onChange={(e) => setHeader({ ...header, numero_factura: formatearNumeroFactura(e.target.value) })} className={inp} placeholder="Ej: 007-001-0016173" inputMode="numeric" />
            </div>
            <div>
              <label className="text-xs text-slate-600">Tipo de pago</label>
              <select value={header.tipo_pago} onChange={(e) => setHeader({ ...header, tipo_pago: e.target.value as "contado" | "credito" })} className={inp}>
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-600">Moneda</label>
              <select value={header.moneda} onChange={(e) => setHeader({ ...header, moneda: e.target.value as Moneda })} className={inp}>
                <option value="PYG">Guaraníes</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
            {header.moneda === "USD" && (
              <div>
                <label className="text-xs text-slate-600">Tipo de cambio (Gs/USD)</label>
                <input type="number" min="0" step="any" value={header.tipo_cambio} onChange={(e) => setHeader({ ...header, tipo_cambio: e.target.value })} className={inp} placeholder="Ej: 7300" />
              </div>
            )}
            {editando && (
              <div>
                <label className="text-xs font-semibold text-teal-700">Estado</label>
                <select value={header.estado} onChange={(e) => setHeader({ ...header, estado: e.target.value as Estado })} className={inp}>
                  <option value="pendiente">Pendiente</option>
                  <option value="pagada">Pagada</option>
                  <option value="anulada">Anulada</option>
                </select>
              </div>
            )}
          </div>
        </section>

        {/* ── Líneas ── */}
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Conceptos</h2>
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end mb-3">
            <div className="col-span-2 md:col-span-3">
              <label className="text-xs text-slate-600">Concepto</label>
              <input value={nl.concepto} onChange={(e) => setNl({ ...nl, concepto: e.target.value })} className={inp} placeholder="Ej: soja, camioneta Hilux…" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Cantidad</label>
              <input type="number" min="0" step="any" value={nl.cantidad} onChange={(e) => setNl({ ...nl, cantidad: e.target.value })} className={inp} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Unidad</label>
              <select value={nl.unidad_medida} onChange={(e) => setNl({ ...nl, unidad_medida: e.target.value })} className={inp}>
                {UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Precio unit.</label>
              <input type="number" min="0" step="any" value={nl.precio_unitario} onChange={(e) => setNl({ ...nl, precio_unitario: e.target.value })} className={inp} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">IVA</label>
              <select value={nl.iva_tipo} onChange={(e) => setNl({ ...nl, iva_tipo: e.target.value as IvaTipo })} className={inp}>
                <option value="exenta">Exenta</option>
                <option value="5">5%</option>
                <option value="10">10%</option>
              </select>
            </div>
            <div className="md:col-span-1">
              <button type="button" onClick={agregarLinea} className="w-full px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium">+</button>
            </div>
          </div>

          {lineas.length === 0 ? (
            <p className="text-sm text-slate-400">Todavía no agregaste conceptos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-200">
                    <th className="text-left py-2">Concepto</th>
                    <th className="text-right py-2">Cant.</th>
                    <th className="text-right py-2">Precio</th>
                    <th className="text-center py-2">IVA</th>
                    <th className="text-right py-2">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => {
                    const t = totalLinea(l);
                    return (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 text-slate-800">{l.concepto}</td>
                        <td className="py-2 text-right tabular-nums">
                          {l.cantidad} <span className="text-slate-400 text-xs">{UNIDADES.find((u) => u.v === l.unidad_medida)?.l ?? l.unidad_medida}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmt(Number(l.precio_unitario) || 0)}</td>
                        <td className="py-2 text-center text-xs">{IVA_LABEL[l.iva_tipo]}</td>
                        <td className="py-2 text-right tabular-nums font-medium">{fmt(t)}</td>
                        <td className="py-2 text-right">
                          <button type="button" onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 text-xs">Quitar</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {lineas.length > 0 && (
            <div className="mt-4 flex justify-end">
              <div className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between text-slate-600"><span>Subtotal (sin IVA)</span><span className="tabular-nums">{fmt(totales.subtotal)}</span></div>
                <div className="flex justify-between text-slate-600"><span>IVA</span><span className="tabular-nums">{fmt(totales.iva)}</span></div>
                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1"><span>Total</span><span className="tabular-nums">{fmt(totales.total)}</span></div>
              </div>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <label className="text-xs text-slate-600">Observaciones</label>
          <textarea rows={2} value={header.observaciones} onChange={(e) => setHeader({ ...header, observaciones: e.target.value })} className={inp} placeholder="Detalles adicionales…" />
        </section>

        <div className="flex justify-end gap-2">
          <Link href="/compras" className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md text-sm">Cancelar</Link>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
            {saving ? "Guardando…" : editando ? "Guardar cambios" : "Guardar compra"}
          </button>
        </div>
      </form>
    </div>
  );
}
