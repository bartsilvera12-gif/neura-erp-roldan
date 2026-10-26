"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { calcMontoIvaIncluido, type IvaTipoPresupuesto } from "@/lib/presupuestos/types";
import { useExistencias, ExistenciaLinea, AvisoFaltantes } from "@/components/presupuestos/existencias";

type ProductoLite = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  precio_mayorista: number;
  unidad_medida: string;
};
type ClienteLite = {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  direccion: string | null;
};
type Item = {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  iva_tipo: IvaTipoPresupuesto;
  descuento: number;
  tipo_precio: "mayorista" | "minorista";
};

function fmtGs(n: number) {
  return "Gs. " + (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function itemTotals(it: Item) {
  const bruto = (Number(it.precio_unitario) || 0) * (Number(it.cantidad) || 0);
  const total = Math.max(0, bruto - (Number(it.descuento) || 0));
  const iva = round2(calcMontoIvaIncluido(it.iva_tipo, total));
  return { total: round2(total), iva, subtotal: round2(total - iva) };
}

const IVAS: IvaTipoPresupuesto[] = ["10%", "5%", "EXENTA"];
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const inputClass = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

export default function NuevoPresupuestoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState<ProductoLite[]>([]);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);

  // Cliente
  const [clienteId, setClienteId] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteRuc, setClienteRuc] = useState("");
  const [clienteTel, setClienteTel] = useState("");
  const [clienteDir, setClienteDir] = useState("");

  // Items
  const [items, setItems] = useState<Item[]>([]);
  const [selProd, setSelProd] = useState("");

  // Toggle mayorista: por defecto usa el precio de venta minorista.
  // Cuando está ON, al agregar un producto se toma `precio_mayorista` si > 0.
  const [usarMayorista, setUsarMayorista] = useState(false);

  // Condiciones
  const [validezDias, setValidezDias] = useState("15");
  const [formaPago, setFormaPago] = useState("");
  const [plazoEntrega, setPlazoEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");
  // Punto 9.4: el texto que obliga (garantía, flete, validez del precio). Es
  // otra cosa que las observaciones, que son las notas del producto.
  const [condiciones, setCondiciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/productos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          const list = (j.data?.productos ?? []) as Record<string, unknown>[];
          setProductos(
            list
              .filter((p) => p.es_vendible !== false)
              .map((p) => ({
                id: String(p.id),
                nombre: String(p.nombre),
                sku: String(p.sku ?? ""),
                precio_venta: Number(p.precio_venta) || 0,
                precio_mayorista: Number(p.precio_mayorista) || 0,
                unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
              }))
          );
        }
      })
      .catch(() => {});
    fetchWithSupabaseSession("/api/clientes", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && Array.isArray(j.data)) {
          const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
          setClientes(
            (j.data as Record<string, unknown>[]).map((r) => ({
              id: String(r.id),
              nombre: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
              ruc: s(r.ruc) || null,
              telefono: s(r.telefono) || null,
              direccion: s(r.direccion) || null,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  function seleccionarCliente(id: string | null) {
    const nextId = id ?? "";
    setClienteId(nextId);
    if (!nextId) return;
    const c = clientes.find((x) => x.id === nextId);
    if (c) {
      setClienteNombre(c.nombre);
      setClienteRuc(c.ruc ?? "");
      setClienteTel(c.telefono ?? "");
      setClienteDir(c.direccion ?? "");
    }
  }

  function precioParaProducto(p: ProductoLite): number {
    if (usarMayorista && p.precio_mayorista > 0) return p.precio_mayorista;
    return p.precio_venta;
  }

  /** Consulta al backend el precio a aplicar para este producto según la
   *  rubro del cliente (si tiene) y el precio configurado en
   *  precios_por_categoria. Si no hay match, cae al precio_venta. */
  async function resolverPrecioPorCategoria(productoId: string): Promise<number | null> {
    if (!clienteId) return null;
    try {
      const r = await fetch(`/api/productos/${productoId}/precio-para-cliente?cliente_id=${encodeURIComponent(clienteId)}`, {
        cache: "no-store", credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j.success && j.data.fuente === "categoria") {
        const p = Number(j.data.precio);
        return Number.isFinite(p) && p > 0 ? p : null;
      }
    } catch { /* silencioso: cae al fallback */ }
    return null;
  }

  async function agregarProducto() {
    const p = productos.find((x) => x.id === selProd);
    if (!p) return;
    if (items.some((it) => it.producto_id === p.id)) return;
    const usaMay = usarMayorista && p.precio_mayorista > 0;

    // Prioridad: precio por rubro del cliente → mayorista → precio_venta.
    const precioCategoria = await resolverPrecioPorCategoria(p.id);
    const precio = precioCategoria ?? precioParaProducto(p);
    const tipo_precio: "minorista" | "mayorista" | "distribuidor" =
      precioCategoria != null ? "minorista" : (usaMay ? "mayorista" : "minorista");

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku || null,
        cantidad: 1,
        unidad_medida: p.unidad_medida,
        precio_unitario: precio,
        iva_tipo: "10%",
        descuento: 0,
        tipo_precio,
      },
    ]);
    setSelProd("");
  }

  function agregarManual() {
    setItems((prev) => [
      ...prev,
      {
        producto_id: null,
        producto_nombre: "",
        sku: null,
        cantidad: 1,
        unidad_medida: null,
        precio_unitario: 0,
        iva_tipo: "10%",
        descuento: 0,
        tipo_precio: usarMayorista ? "mayorista" : "minorista",
      },
    ]);
  }

  function updItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function delItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  // La reserva la calcula el servidor desde los presupuestos aprobados
  // vigentes; acá solo se muestra (puntos 9.1 y 9.2).
  const existencias = useExistencias(items.map((it) => it.producto_id));

  const totales = useMemo(() => {
    let subtotal = 0,
      iva = 0,
      desc = 0,
      total = 0;
    for (const it of items) {
      const t = itemTotals(it);
      subtotal += t.subtotal;
      iva += t.iva;
      total += t.total;
      desc += Number(it.descuento) || 0;
    }
    return { subtotal: round2(subtotal), iva: round2(iva), desc: round2(desc), total: round2(total) };
  }, [items]);

  const valido =
    clienteNombre.trim().length > 0 &&
    items.length > 0 &&
    items.every((it) => it.producto_nombre.trim() && it.cantidad > 0 && it.precio_unitario >= 0);

  async function guardar() {
    if (guardando || !valido) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          cliente_nombre: clienteNombre.trim(),
          cliente_ruc: clienteRuc.trim() || null,
          cliente_telefono: clienteTel.trim() || null,
          cliente_direccion: clienteDir.trim() || null,
          moneda: "PYG",
          validez_dias: validezDias.trim() === "" ? null : parseInt(validezDias, 10),
          forma_pago: formaPago.trim() || null,
          plazo_entrega: plazoEntrega.trim() || null,
          observaciones: observaciones.trim() || null,
          condiciones_comerciales: condiciones.trim() || null,
          items: items.map((it) => ({
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre.trim(),
            sku: it.sku,
            cantidad: Number(it.cantidad),
            unidad_medida: it.unidad_medida,
            precio_unitario: Number(it.precio_unitario),
            iva_tipo: it.iva_tipo,
            descuento: Number(it.descuento) || 0,
            tipo_precio: it.tipo_precio,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo guardar el presupuesto.");
        return;
      }
      router.push(`/presupuestos/${body.data.id}`);
    } catch {
      setError("Error de red al guardar el presupuesto.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/presupuestos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver a presupuestos
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-7 w-7 text-[#4FAEB2]" />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Nuevo presupuesto</h1>
        </div>
        <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={usarMayorista}
            onChange={(e) => setUsarMayorista(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
          />
          <span>Usar precios mayoristas por defecto</span>
        </label>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Cliente */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Cliente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Cliente existente (opcional)</label>
            <SearchableSelect
              value={clienteId || null}
              onChange={(v) => seleccionarCliente(v)}
              placeholder="— Seleccioná un cliente —"
              options={clientes.map((c) => ({
                id: c.id,
                label: c.nombre,
                hint: c.ruc ?? undefined,
              }))}
            />
            <p className="mt-1 text-[11px] text-gray-400">O completá los campos de abajo manualmente si es un cliente nuevo.</p>
          </div>
          <div>
            <label className={labelClass}>Nombre / Razón social *</label>
            <input value={clienteNombre} onChange={(e) => { setClienteId(""); setClienteNombre(e.target.value); }} className={inputClass} placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className={labelClass}>RUC / CI</label>
            <input value={clienteRuc} onChange={(e) => setClienteRuc(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Teléfono</label>
            <input value={clienteTel} onChange={(e) => setClienteTel(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Dirección</label>
            <input value={clienteDir} onChange={(e) => setClienteDir(e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Productos</h2>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[260px]">
            <label className={labelClass}>Agregar desde inventario</label>
            <SearchableSelect
              value={selProd || null}
              onChange={(v) => setSelProd(v)}
              placeholder="— Buscá un producto por nombre o SKU —"
              options={productos
                .filter((p) => !items.some((it) => it.producto_id === p.id))
                .map((p) => ({ id: p.id, label: p.nombre, hint: p.sku || undefined }))}
            />
          </div>
          <button type="button" onClick={agregarProducto} disabled={!selProd} className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
            <Plus className="h-4 w-4" /> Agregar
          </button>
          <button type="button" onClick={agregarManual} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Ítem manual
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Sin ítems. Agregá productos del inventario o ítems manuales.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="py-2 pr-2">Descripción</th>
                  <th className="py-2 px-2 w-20">Cant.</th>
                  <th className="py-2 px-2 w-32">Precio unit.</th>
                  <th className="py-2 px-2 w-24">IVA</th>
                  <th className="py-2 px-2 w-28">Descuento</th>
                  <th className="py-2 px-2 w-32 text-right">Total</th>
                  <th className="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, i) => {
                  const t = itemTotals(it);
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-2">
                        <input value={it.producto_nombre} onChange={(e) => updItem(i, { producto_nombre: e.target.value })} className={inputClass} placeholder="Descripción" />
                        {it.tipo_precio === "mayorista" && (
                          <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Mayorista</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="0.01" value={it.cantidad || ""} onChange={(e) => updItem(i, { cantidad: Number(e.target.value) })} className={inputClass} />
                        <ExistenciaLinea
                          existencia={it.producto_id ? existencias[it.producto_id] : undefined}
                          cantidad={it.cantidad}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="1" value={it.precio_unitario || ""} onChange={(e) => updItem(i, { precio_unitario: Number(e.target.value) })} className={inputClass} />
                      </td>
                      <td className="py-2 px-2">
                        <select value={it.iva_tipo} onChange={(e) => updItem(i, { iva_tipo: e.target.value as IvaTipoPresupuesto })} className={`${inputClass} bg-white`}>
                          {IVAS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="1" value={it.descuento || ""} onChange={(e) => updItem(i, { descuento: Number(e.target.value) })} className={inputClass} />
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtGs(t.total)}</td>
                      <td className="py-2 pl-2 text-right">
                        <button onClick={() => delItem(i)} className="text-red-600 hover:text-red-700" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 ml-auto w-full sm:w-72 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal (sin IVA)</span><span className="tabular-nums">{fmtGs(totales.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">IVA</span><span className="tabular-nums">{fmtGs(totales.iva)}</span></div>
            {totales.desc > 0 && <div className="flex justify-between"><span className="text-gray-500">Descuentos</span><span className="tabular-nums">- {fmtGs(totales.desc)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-base"><span>Total</span><span className="tabular-nums text-[#4FAEB2]">{fmtGs(totales.total)}</span></div>
          </div>
        )}
      </div>

      {/* Condiciones */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Condiciones comerciales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Validez (días)</label>
            <input type="number" min="0" value={validezDias} onChange={(e) => setValidezDias(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Forma de pago</label>
            <input value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={inputClass} placeholder="Ej: 50% anticipo, saldo contra entrega" />
          </div>
          <div>
            <label className={labelClass}>Plazo de entrega</label>
            <input value={plazoEntrega} onChange={(e) => setPlazoEntrega(e.target.value)} className={inputClass} placeholder="Ej: 5 días hábiles" />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Condiciones comerciales</label>
            <textarea
              value={condiciones}
              onChange={(e) => setCondiciones(e.target.value)}
              rows={4}
              className={inputClass}
              placeholder={"Ej:\n- Precios válidos por la vigencia indicada.\n- Flete y descarga por cuenta del comprador.\n- Garantía de fábrica contra defectos."}
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Sale en el presupuesto, bajo el total. Es lo que se discute si
              después hay un reclamo, así que conviene escribirlo completo.
            </p>
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Observaciones</label>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className={inputClass} />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Notas sobre la mercadería o el pedido, no condiciones.
            </p>
          </div>
        </div>
      </div>

      <AvisoFaltantes lineas={items} existencias={existencias} />

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Link href="/presupuestos" className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Cancelar
        </Link>
        <button onClick={guardar} disabled={!valido || guardando} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
          {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Guardar presupuesto"}
        </button>
      </div>
    </div>
  );
}
