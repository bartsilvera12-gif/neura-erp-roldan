"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import { getProductos } from "@/lib/inventario/storage";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { Producto, TipoMovimiento, OrigenMovimiento } from "@/lib/inventario/types";

type UbicacionRow = { id: string; nombre: string; codigo: string | null; tipo: string };

export default function NuevoMovimientoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbicacionRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    producto_id: "",
    tipo: "ENTRADA" as TipoMovimiento,
    cantidad: "",
    costo_unitario: "",
    origen: "compra" as OrigenMovimiento,
    numero_lote: "",
    fecha_vencimiento: "",
    ubicacion_id: "",
    motivo: "",
  });

  // El desplegable con todos los productos era inusable apenas pasaban las dos
  // docenas: se escribe acá y la lista se filtra por nombre o SKU.
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let cancelled = false;
    getProductos().then((data) => {
      if (!cancelled) setProductos(data);
    });
    // Cargar depósitos/ubicaciones para el selector.
    (async () => {
      try {
        const r = await fetchWithSupabaseSession("/api/inventario/ubicaciones", { cache: "no-store" });
        const j = await r.json();
        if (!cancelled && r.ok && j?.success) {
          const ubis = ((j.data?.ubicaciones ?? []) as UbicacionRow[]).filter((u) => u);
          setUbicaciones(ubis);
          // Autoseleccionar el primero si hay uno solo.
          if (ubis.length === 1) setForm((prev) => ({ ...prev, ubicacion_id: ubis[0].id }));
        }
      } catch { /* silencioso */ }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleProductoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const producto = productos.find((p) => p.id === id);
    setForm((prev) => ({
      ...prev,
      producto_id: id,
      costo_unitario: producto ? String(producto.costo_promedio) : "",
    }));
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleTipoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tipo = e.target.value as TipoMovimiento;
    const origenSugerido: OrigenMovimiento =
      tipo === "ENTRADA" ? "compra" : tipo === "SALIDA" ? "venta" : "ajuste_manual";
    setForm((prev) => ({ ...prev, tipo, origen: origenSugerido }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const productoSeleccionado = productos.find((p) => p.id === form.producto_id);
    if (!productoSeleccionado) return;

    const cantidadNum =
      form.tipo === "AJUSTE"
        ? parseFloat(form.cantidad)
        : Math.abs(parseFloat(form.cantidad));

    // Lote/vencimiento: solo en ENTRADA de un producto que controla lote.
    const requiereLote =
      productoSeleccionado.controla_lote === true && form.tipo === "ENTRADA";
    if (requiereLote) {
      if (!form.numero_lote.trim()) {
        setError("Este producto controla lote: ingresá el número de lote.");
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fecha_vencimiento)) {
        setError("Ingresá la fecha de vencimiento del lote.");
        return;
      }
      if (!(cantidadNum > 0)) {
        setError("La cantidad del lote debe ser mayor a 0.");
        return;
      }
    }

    if (ubicaciones.length > 0 && !form.ubicacion_id) {
      setError("Elegí un depósito.");
      return;
    }
    if (form.tipo === "AJUSTE" && !form.motivo.trim()) {
      setError("Escribí el motivo del ajuste: es lo único que explica por qué cambió el stock.");
      return;
    }
    if (form.tipo === "SALIDA" && productoSeleccionado.stock_actual < Math.abs(cantidadNum)) {
      setError(
        `Stock insuficiente: "${productoSeleccionado.nombre}" tiene ${productoSeleccionado.stock_actual} y querés sacar ${Math.abs(cantidadNum)}.`
      );
      return;
    }
    setSaving(true);

    // Usamos el endpoint server-side que ajusta stock por ubicación + productos.stock_actual
    // + costo promedio. Fallback a saveMovimiento legacy si el endpoint falla por algo raro.
    let guardado: unknown = null;
    try {
      const res = await fetchWithSupabaseSession("/api/inventario/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          producto_id: productoSeleccionado.id,
          tipo: form.tipo,
          cantidad: cantidadNum,
          costo_unitario: parseFloat(form.costo_unitario) || 0,
          origen: form.origen,
          ubicacion_id: form.ubicacion_id || null,
          referencia: form.motivo.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !(j as { success?: boolean }).success) {
        setSaving(false);
        setError((j as { error?: string }).error ?? "No se pudo guardar el movimiento.");
        return;
      }
      guardado = j;
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : "Error de red al guardar el movimiento.");
      return;
    }
    void guardado;
    // saveMovimiento legacy queda deprecado — este flujo usa el endpoint
    // POST /api/inventario/movimientos que inserta el mov + ajusta
    // inventario_stock_ubicacion + actualiza productos.stock_actual.

    // Registrar el lote con su vencimiento (feed del reporte "Productos a vencer").
    // Se hace después del movimiento; si falla, el movimiento ya quedó guardado y
    // se avisa para cargar el lote a mano desde el producto.
    if (requiereLote) {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/${productoSeleccionado.id}/lotes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              numero_lote: form.numero_lote.trim(),
              fecha_vencimiento: form.fecha_vencimiento,
              cantidad: cantidadNum,
              observaciones: "Ingreso por movimiento de stock",
            }),
          }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) {
          setSaving(false);
          setError(
            `El movimiento se guardó, pero no se pudo registrar el lote: ${
              body?.error ?? "error"
            }. Cargalo desde el producto → Lotes.`
          );
          return;
        }
      } catch {
        setSaving(false);
        setError(
          "El movimiento se guardó, pero falló el registro del lote (red). Cargalo desde el producto → Lotes."
        );
        return;
      }
    }

    router.push("/inventario/movimientos");
  }

  const termino = busqueda.trim().toLowerCase();
  const productosFiltrados = termino
    ? productos.filter((p) =>
        `${p.nombre} ${p.sku ?? ""}`.toLowerCase().includes(termino)
      )
    : productos;

  const productoSeleccionado = productos.find((p) => p.id === form.producto_id);
  const requiereLoteUI =
    productoSeleccionado?.controla_lote === true && form.tipo === "ENTRADA";

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-gray-500 transition-colors text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo movimiento</h1>
        <p className="text-gray-600">Registra una entrada, salida o ajuste de stock</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-2xl">
        <form className="space-y-6" onSubmit={handleSubmit}>

          {/* Producto */}
          <div>
            <label className={labelClass}>Producto</label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className={`${inputClass} mb-2`}
            />
            <select
              name="producto_id"
              value={form.producto_id}
              onChange={handleProductoChange}
              className={inputClass}
              size={productosFiltrados.length > 1 ? Math.min(8, productosFiltrados.length + 1) : undefined}
              required
            >
              <option value="">Seleccionar producto...</option>
              {productosFiltrados.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.nombre} — {p.sku} (stock actual: {p.stock_actual})
                </option>
              ))}
            </select>
            {termino && productosFiltrados.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Ningún producto coincide con “{busqueda}”.
              </p>
            )}
          </div>

          {/* Depósito */}
          <div>
            <label className={labelClass}>Depósito <span className="text-red-500">*</span></label>
            <select
              name="ubicacion_id"
              value={form.ubicacion_id}
              onChange={handleChange}
              className={inputClass}
              required={ubicaciones.length > 0}
            >
              <option value="">Elegí un depósito…</option>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}{u.codigo ? ` — ${u.codigo}` : ""}
                </option>
              ))}
            </select>
            {ubicaciones.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Todavía no cargaste depósitos. Creá uno en Inventario → Ubicaciones.
              </p>
            )}
          </div>

          {/* Tipo + Origen */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Tipo de movimiento</label>
              <select
                name="tipo"
                value={form.tipo}
                onChange={handleTipoChange}
                className={inputClass}
              >
                <option value="ENTRADA">ENTRADA — aumenta stock</option>
                <option value="SALIDA">SALIDA — disminuye stock</option>
                <option value="AJUSTE">AJUSTE — corrección manual</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Origen</label>
              <select
                name="origen"
                value={form.origen}
                onChange={handleChange}
                className={inputClass}
              >
                <option value="compra">Compra</option>
                <option value="venta">Venta</option>
                <option value="ajuste_manual">Ajuste manual</option>
              </select>
            </div>
          </div>

          {/* Motivo — obligatorio en los ajustes, porque es lo único que deja
              rastro de por qué alguien cambió el stock a mano. */}
          <div>
            <label className={labelClass}>
              Motivo{" "}
              {form.tipo === "AJUSTE"
                ? <span className="text-red-500">*</span>
                : <span className="text-gray-400 font-normal">(opcional)</span>}
            </label>
            <input
              type="text"
              name="motivo"
              value={form.motivo}
              onChange={handleChange}
              placeholder={
                form.tipo === "AJUSTE"
                  ? "Ej: conteo físico del 21/10, faltaban 3 unidades"
                  : "Ej: remito 001-002-0000345"
              }
              className={inputClass}
              maxLength={200}
              required={form.tipo === "AJUSTE"}
            />
          </div>

          {/* Cantidad + Costo unitario */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>
                Cantidad
                {form.tipo === "AJUSTE" && (
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    (negativo para disminuir)
                  </span>
                )}
              </label>
              <input
                type="number"
                name="cantidad"
                value={form.cantidad}
                onChange={handleChange}
                placeholder={form.tipo === "AJUSTE" ? "Ej: -3 o +5" : "Ej: 10"}
                className={inputClass}
                step="1"
                required
              />
            </div>

            <div>
              <label className={labelClass}>Costo unitario (Gs.)</label>
              <MontoInput
                value={form.costo_unitario}
                onChange={(n) => setForm((prev) => ({ ...prev, costo_unitario: String(n) }))}
                placeholder="Ej: 35000"
                className={inputClass}
                decimals={false}
                required
              />
            </div>
          </div>

          {/* Lote + vencimiento (solo ENTRADA de productos que controlan lote) */}
          {requiereLoteUI && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-4">
              <p className="text-sm font-medium text-amber-800">
                Este producto controla lote — registrá el lote que ingresa y su vencimiento
              </p>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>N° de lote</label>
                  <input
                    type="text"
                    name="numero_lote"
                    value={form.numero_lote}
                    onChange={handleChange}
                    placeholder="Ej: L-2026-08"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Fecha de vencimiento</label>
                  <input
                    type="date"
                    name="fecha_vencimiento"
                    value={form.fecha_vencimiento}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="text-xs text-amber-700">
                El lote se crea con la cantidad de esta entrada y alimenta el reporte
                “Productos a vencer”.
              </p>
            </div>
          )}

          {/* Nota de fecha automática */}
          <p className="text-xs text-gray-400">
            La fecha y hora del movimiento se registrarán automáticamente al guardar.
          </p>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Vista previa del impacto en stock */}
          {productoSeleccionado && form.cantidad !== "" && (
            <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 text-sm space-y-1">
              <p className="font-medium text-gray-700 mb-2">Vista previa del impacto</p>
              <div className="flex justify-between text-gray-600">
                <span>Stock actual</span>
                <span className="font-semibold tabular-nums">
                  {productoSeleccionado.stock_actual} uds.
                </span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Movimiento ({form.tipo})</span>
                <span className={`font-semibold tabular-nums ${
                  form.tipo === "ENTRADA"
                    ? "text-green-600"
                    : form.tipo === "SALIDA"
                    ? "text-red-600"
                    : "text-yellow-600"
                }`}>
                  {form.tipo === "ENTRADA" ? "+" : form.tipo === "SALIDA" ? "−" : ""}
                  {form.tipo !== "AJUSTE"
                    ? Math.abs(parseFloat(form.cantidad) || 0)
                    : parseFloat(form.cantidad) || 0}{" "}
                  uds.
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold text-gray-800">
                <span>Stock resultante</span>
                <span className="tabular-nums">
                  {Math.max(
                    0,
                    form.tipo === "ENTRADA"
                      ? productoSeleccionado.stock_actual + Math.abs(parseFloat(form.cantidad) || 0)
                      : form.tipo === "SALIDA"
                      ? productoSeleccionado.stock_actual - Math.abs(parseFloat(form.cantidad) || 0)
                      : productoSeleccionado.stock_actual + (parseFloat(form.cantidad) || 0)
                  )}{" "}
                  uds.
                </span>
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-gray-900 text-white px-5 py-3 rounded-lg text-sm hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar movimiento"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/inventario/movimientos")}
              className="border border-gray-300 px-5 py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}
