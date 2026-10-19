"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getProducto } from "@/lib/inventario/storage";
import type { Producto } from "@/lib/inventario/types";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

interface CatRow { id: string; nombre: string }
interface UbiRow { id: string; nombre: string; tipo: string }
interface ProvRow { id: string; nombre: string }

function formatGs(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return `Gs. ${Number(valor).toLocaleString("es-PY")}`;
}

function formatStock(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return Number(valor).toLocaleString("es-PY", { maximumFractionDigits: 3 });
}

/** Deriva el tipo de producto (Reventa / Menú / Materia prima) desde los flags. */
function tipoProducto(p: Producto): { label: string; hint: string } {
  const esVendible = p.es_vendible !== false;
  const esInsumo = p.es_insumo === true;
  const controlaStock = p.controla_stock !== false;
  if (esInsumo) return { label: "Materia prima (insumo)", hint: "Insumo para producir menú." };
  if (esVendible && !controlaStock) return { label: "Menú (fabricado)", hint: "Producto que se fabrica y se vende al cliente final." };
  return { label: "Reventa (compra y vende)", hint: "Producto que se compra y se revende tal cual." };
}

/** Fila etiqueta → valor para el detalle. */
function DatoFila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-3 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-sm text-slate-800">{children}</span>
    </div>
  );
}

export default function DetalleProductoPage() {
  const params = useParams();
  const id = (params?.id as string) ?? "";
  const { isAdmin } = useIsAdmin();

  const [producto, setProducto] = useState<Producto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  const [categorias, setCategorias] = useState<CatRow[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbiRow[]>([]);
  const [proveedores, setProveedores] = useState<ProvRow[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    setCargando(true);
    getProducto(id)
      .then((p) => {
        if (cancel) return;
        if (!p) { setNoEncontrado(true); return; }
        setProducto(p);
      })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [id]);

  useEffect(() => {
    let cancel = false;
    async function load(url: string) {
      try {
        const r = await fetch(url, { credentials: "include", cache: "no-store" });
        const j = await r.json();
        return r.ok && j?.success ? j.data : null;
      } catch { return null; }
    }
    (async () => {
      const [cats, ubis, provs] = await Promise.all([
        load("/api/inventario/categorias"),
        load("/api/inventario/ubicaciones"),
        load("/api/proveedores"),
      ]);
      if (cancel) return;
      if (cats?.categorias) setCategorias(cats.categorias as CatRow[]);
      if (ubis?.ubicaciones) setUbicaciones(ubis.ubicaciones as UbiRow[]);
      if (provs?.proveedores) setProveedores(provs.proveedores as ProvRow[]);
    })();
    return () => { cancel = true; };
  }, []);

  const nombreCategoria = producto?.categoria_principal_id
    ? categorias.find((c) => c.id === producto.categoria_principal_id)?.nombre ?? null
    : null;
  const nombreUbicacion = producto?.ubicacion_principal_id
    ? ubicaciones.find((u) => u.id === producto.ubicacion_principal_id)?.nombre ?? null
    : null;
  const nombreProveedor = producto?.proveedor_principal_id
    ? proveedores.find((p) => p.id === producto.proveedor_principal_id)?.nombre ?? null
    : null;

  if (cargando) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold text-gray-800">Detalle del producto</h1>
        <p className="text-gray-500 animate-pulse">Cargando…</p>
      </div>
    );
  }

  if (noEncontrado || !producto) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-800">Detalle del producto</h1>
        <p className="text-gray-500">No se encontró el producto.</p>
        <Link href="/inventario" className="text-sm text-sky-700 underline">← Volver al inventario</Link>
      </div>
    );
  }

  const tipo = tipoProducto(producto);
  const controlaStock = producto.controla_stock !== false;
  const esInsumo = producto.es_insumo === true;
  const mostrarStock = controlaStock || esInsumo;
  const mostrarPrecioVenta = !esInsumo;
  const stockBajo = producto.stock_actual <= producto.stock_minimo;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{producto.nombre}</h1>
          <p className="text-gray-600">Detalle del producto (solo lectura)</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/inventario"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-gray-50"
          >
            ← Volver
          </Link>
          {/* Editar solo para admin. El personal de sucursal ve el detalle sin editar. */}
          {isAdmin && (
            <Link
              href={`/inventario/${producto.id}/editar`}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
            >
              Editar
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Columna principal: datos */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Información general</h2>
            <DatoFila label="Tipo de producto">
              {tipo.label}
              <span className="block text-xs font-normal text-slate-400">{tipo.hint}</span>
            </DatoFila>
            <DatoFila label="Nombre">{producto.nombre}</DatoFila>
            <DatoFila label="Descripción">{producto.descripcion?.trim() || "—"}</DatoFila>
            <DatoFila label="SKU interno"><span className="font-mono">{producto.sku || "—"}</span></DatoFila>
            <DatoFila label="Código de barras"><span className="font-mono">{producto.codigo_barras || "—"}</span></DatoFila>
            <DatoFila label="Unidad de medida">{producto.unidad_medida || "—"}</DatoFila>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Precios</h2>
            <DatoFila label="Costo promedio">{formatGs(producto.costo_promedio)}</DatoFila>
            {mostrarPrecioVenta && <DatoFila label="Precio de venta (minorista)">{formatGs(producto.precio_venta)}</DatoFila>}
            {mostrarPrecioVenta && <DatoFila label="Precio mayorista">{formatGs(producto.precio_mayorista)}</DatoFila>}
            {mostrarPrecioVenta && producto.cantidad_minima_mayorista != null && (
              <DatoFila label="Cantidad mínima mayorista">{formatStock(producto.cantidad_minima_mayorista)}</DatoFila>
            )}
            {mostrarPrecioVenta && <DatoFila label="Precio distribuidor">{formatGs(producto.precio_distribuidor)}</DatoFila>}
            {mostrarPrecioVenta && <DatoFila label="IVA aplicado">{producto.tipo_iva === "EXENTA" ? "Exenta" : `IVA ${producto.tipo_iva ?? "10%"}`}</DatoFila>}
          </div>

          {mostrarStock && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Stock</h2>
              <DatoFila label="Stock actual">
                <span className={stockBajo ? "font-semibold text-red-600" : "font-semibold text-slate-800"}>
                  {formatStock(producto.stock_actual)} {producto.unidad_medida}
                </span>
              </DatoFila>
              <DatoFila label="Stock mínimo">{formatStock(producto.stock_minimo)} {producto.unidad_medida}</DatoFila>
              {producto.controla_lote === true && (
                <DatoFila label="Control de lote / vencimiento">Sí — requiere lote y fecha de vencimiento</DatoFila>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Clasificación y ubicación</h2>
            <DatoFila label="Categoría principal">{nombreCategoria || "—"}</DatoFila>
            {!esInsumo && <DatoFila label="Proveedor principal">{nombreProveedor || "—"}</DatoFila>}
            <DatoFila label="Depósito principal">{nombreUbicacion || "—"}</DatoFila>
          </div>
        </div>

        {/* Columna lateral: imagen */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Imagen</h2>
            {producto.imagen_url ? (
              <div className="aspect-square w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={producto.imagen_url}
                  alt={producto.nombre}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                Sin imagen
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
