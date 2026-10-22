"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PackageX, ArrowLeft, Plus, Trash2, Loader2, Printer } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { formatFecha as fmtFecha } from "@/lib/fecha/asuncion";

type ProductoLite = { id: string; nombre: string; sku: string; costo: number; stock: number; unidad: string };
type ProveedorLite = { id: string; nombre: string };
type Item = { producto_id: string; producto_nombre: string; producto_sku: string; cantidad: number; costo_unitario: number; unidad: string; stock: number };
type DevRow = {
  id: string;
  numero_control: string;
  proveedor_nombre: string | null;
  motivo: string | null;
  total_unidades: number | string;
  usuario_nombre: string | null;
  fecha: string;
};

const inputClass = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelClass = "block text-xs font-medium text-gray-600 mb-1";


export default function DevolucionesProveedorPage() {
  const [productos, setProductos] = useState<ProductoLite[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorLite[]>([]);
  const [rows, setRows] = useState<DevRow[]>([]);

  const [proveedorId, setProveedorId] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [motivo, setMotivo] = useState("");
  const [transporte, setTransporte] = useState({
    choferNombre: "", choferCi: "", choferTel: "",
    marca: "", chapa: "", color: "",
    receptorNombre: "", receptorTel: "",
  });
  const setTr = (patch: Partial<typeof transporte>) => setTransporte((prev) => ({ ...prev, ...patch }));
  const [items, setItems] = useState<Item[]>([]);
  const [selProd, setSelProd] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function cargarLista() {
    try {
      const r = await fetchWithSupabaseSession("/api/devoluciones-proveedor", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setRows((j.data?.devoluciones ?? []) as DevRow[]);
    } catch { /* noop */ }
  }

  useEffect(() => {
    fetchWithSupabaseSession("/api/productos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          const list = (j.data?.productos ?? []) as Record<string, unknown>[];
          setProductos(
            list.map((p) => ({
              id: String(p.id),
              nombre: String(p.nombre),
              sku: String(p.sku ?? ""),
              costo: Number(p.costo_promedio) || 0,
              stock: Number(p.stock_actual) || 0,
              unidad: String(p.unidad_medida ?? "UNIDAD"),
            }))
          );
        }
      })
      .catch(() => {});
    fetchWithSupabaseSession("/api/proveedores", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.data?.proveedores) ? j.data.proveedores : [];
        setProveedores(
          (arr as Record<string, unknown>[])
            .map((p) => ({ id: String(p.id), nombre: String(p.nombre ?? p.nombre_comercial ?? "Proveedor") }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
        );
      })
      .catch(() => {});
    void cargarLista();
  }, []);

  function seleccionarProveedor(id: string | null) {
    const nextId = id ?? "";
    setProveedorId(nextId);
    const p = proveedores.find((x) => x.id === nextId);
    setProveedorNombre(p?.nombre ?? "");
  }

  function agregarProducto() {
    const p = productos.find((x) => x.id === selProd);
    if (!p) return;
    if (items.some((it) => it.producto_id === p.id)) return;
    setItems((prev) => [
      ...prev,
      { producto_id: p.id, producto_nombre: p.nombre, producto_sku: p.sku, cantidad: 1, costo_unitario: p.costo, unidad: p.unidad, stock: p.stock },
    ]);
    setSelProd("");
  }
  function updItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function delItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totalUnidades = useMemo(() => items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0), [items]);
  const valido = items.length > 0 && items.every((it) => it.cantidad > 0);

  async function guardar() {
    if (guardando || !valido) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetchWithSupabaseSession("/api/devoluciones-proveedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedorId || null,
          proveedor_nombre: proveedorNombre || null,
          motivo: motivo.trim() || null,
          nr_chofer_nombre: transporte.choferNombre.trim() || null,
          nr_chofer_ci: transporte.choferCi.trim() || null,
          nr_chofer_telefono: transporte.choferTel.trim() || null,
          nr_transporte_marca: transporte.marca.trim() || null,
          nr_transporte_chapa: transporte.chapa.trim() || null,
          nr_transporte_color: transporte.color.trim() || null,
          receptor_nombre: transporte.receptorNombre.trim() || null,
          receptor_telefono: transporte.receptorTel.trim() || null,
          items: items.map((it) => ({
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre,
            producto_sku: it.producto_sku,
            cantidad: Number(it.cantidad),
            costo_unitario: Number(it.costo_unitario) || 0,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo registrar la devolución.");
        return;
      }
      const num = body?.data?.devolucion?.numero_control ?? "";
      const devId = body?.data?.devolucion?.id ?? null;
      setOk(`Devolución ${num} registrada. Stock descontado.${body?.data?.stock_warning ? ` (${body.data.stock_warning})` : ""}`);
      setItems([]);
      setMotivo("");
      setProveedorId("");
      setProveedorNombre("");
      setTransporte({ choferNombre: "", choferCi: "", choferTel: "", marca: "", chapa: "", color: "", receptorNombre: "", receptorTel: "" });
      await cargarLista();
      // Abrir la remisión imprimible de la devolución recién creada.
      if (devId) {
        try { window.open(`/api/devoluciones-proveedor/${devId}/remision`, "_blank", "noopener,noreferrer"); } catch { /* popup bloqueado */ }
      }
    } catch {
      setError("Error de red al registrar la devolución.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/inventario/movimientos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver a movimientos
      </Link>

      <div className="flex items-center gap-3">
        <PackageX className="h-7 w-7 text-[#4FAEB2]" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Devolución a proveedor</h1>
          <p className="text-gray-600">Devolvé productos al proveedor. Al guardar se descuenta el stock automáticamente.</p>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">✓ {ok}</div>}

      {/* Datos */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Proveedor (opcional)</label>
            <SearchableSelect
              value={proveedorId || null}
              onChange={(v) => seleccionarProveedor(v)}
              placeholder="— Seleccioná un proveedor —"
              options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
            />
          </div>
          <div>
            <label className={labelClass}>Motivo</label>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputClass} placeholder="Ej: productos rechazados / vencidos / fallados" />
          </div>
        </div>
      </div>

      {/* Datos de transporte para la remisión (opcional) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Transporte (para la remisión)</h2>
        <p className="text-xs text-gray-500 mb-3">Opcional — aparece en la remisión impresa. Útil para los controles en ruta.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Chofer</div>
            <input value={transporte.choferNombre} onChange={(e) => setTr({ choferNombre: e.target.value })} className={`${inputClass} mb-2`} placeholder="Nombre y apellido" />
            <input value={transporte.choferCi} onChange={(e) => setTr({ choferCi: e.target.value })} className={`${inputClass} mb-2`} placeholder="CI" />
            <input value={transporte.choferTel} onChange={(e) => setTr({ choferTel: e.target.value })} className={inputClass} placeholder="Teléfono" />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Transporte / Camión</div>
            <input value={transporte.marca} onChange={(e) => setTr({ marca: e.target.value })} className={`${inputClass} mb-2`} placeholder="Marca" />
            <input value={transporte.chapa} onChange={(e) => setTr({ chapa: e.target.value })} className={`${inputClass} mb-2`} placeholder="Chapa" />
            <input value={transporte.color} onChange={(e) => setTr({ color: e.target.value })} className={inputClass} placeholder="Color" />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Recibe</div>
            <input value={transporte.receptorNombre} onChange={(e) => setTr({ receptorNombre: e.target.value })} className={`${inputClass} mb-2`} placeholder="Nombre de quien recibe" />
            <input value={transporte.receptorTel} onChange={(e) => setTr({ receptorTel: e.target.value })} className={inputClass} placeholder="Teléfono de quien recibe" />
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Productos a devolver</h2>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[260px]">
            <label className={labelClass}>Agregar producto</label>
            <SearchableSelect
              value={selProd || null}
              onChange={(v) => setSelProd(v)}
              placeholder="— Buscá un producto por nombre o SKU —"
              options={productos
                .filter((p) => !items.some((it) => it.producto_id === p.id))
                .map((p) => ({ id: p.id, label: p.nombre, hint: `${p.sku || ""} · stock ${p.stock}` }))}
            />
          </div>
          <button type="button" onClick={agregarProducto} disabled={!selProd} className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
            <Plus className="h-4 w-4" /> Agregar
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Sin productos. Agregá al menos uno.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="py-2 pr-2">Producto</th>
                  <th className="py-2 px-2 w-28">Stock actual</th>
                  <th className="py-2 px-2 w-28">Cant. a devolver</th>
                  <th className="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, i) => (
                  <tr key={it.producto_id}>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-gray-800">{it.producto_nombre}</div>
                      {it.producto_sku && <div className="text-xs text-gray-400 font-mono">{it.producto_sku}</div>}
                    </td>
                    <td className="py-2 px-2 tabular-nums text-gray-600">{it.stock} {it.unidad}</td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.cantidad || ""}
                        onChange={(e) => updItem(i, { cantidad: Number(e.target.value) })}
                        className={`${inputClass} ${it.cantidad > it.stock ? "border-amber-400 bg-amber-50" : ""}`}
                      />
                      {it.cantidad > it.stock && <div className="mt-1 text-[11px] text-amber-600">Mayor al stock (quedará en 0)</div>}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button onClick={() => delItem(i)} className="text-red-600 hover:text-red-700" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-gray-600">Total a devolver: <strong className="tabular-nums">{totalUnidades}</strong> unidad(es)</span>
            <button onClick={guardar} disabled={!valido || guardando} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Registrar devolución y descontar stock"}
            </button>
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-gray-700">Devoluciones registradas</h2>
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">Todavía no hay devoluciones a proveedor.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-3 px-4 font-medium">N°</th>
                  <th className="py-3 px-4 font-medium">Fecha</th>
                  <th className="py-3 px-4 font-medium">Proveedor</th>
                  <th className="py-3 px-4 font-medium">Motivo</th>
                  <th className="py-3 px-4 font-medium text-right">Unidades</th>
                  <th className="py-3 px-4 font-medium text-right">Remisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-gray-800">{d.numero_control}</td>
                    <td className="py-3 px-4 text-gray-600">{fmtFecha(d.fecha)}</td>
                    <td className="py-3 px-4 text-gray-700">{d.proveedor_nombre || "—"}</td>
                    <td className="py-3 px-4 text-gray-600">{d.motivo || "—"}</td>
                    <td className="py-3 px-4 text-right tabular-nums font-semibold text-gray-800">{Number(d.total_unidades)}</td>
                    <td className="py-3 px-4 text-right">
                      <a
                        href={`/api/devoluciones-proveedor/${d.id}/remision`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Printer className="h-3.5 w-3.5" /> Imprimir
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
