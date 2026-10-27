"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getProductosPaginated } from "@/lib/inventario/storage";
import type { Producto, MetodoValuacion } from "@/lib/inventario/types";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImprimirTablaButton from "@/components/ui/ImprimirTablaButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { margenSobreVenta, remarcacionSobreCosto, colorMargen, pct } from "@/lib/precios/margen";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Package,
  Loader2,
  X,
  Eye,
  Pencil,
  Trash2,
  Printer,
} from "lucide-react";

const metodoBadge: Record<MetodoValuacion, string> = {
  CPP: "bg-blue-100 text-blue-700",
  FIFO: "bg-green-100 text-green-700",
  LIFO: "bg-purple-100 text-purple-700",
};

function formatGs(valor: number) {
  return `Gs. ${valor.toLocaleString("es-PY")}`;
}

function formatStock(valor: number) {
  return valor.toLocaleString("es-PY", { maximumFractionDigits: 3 });
}



/**
 * Devuelve un color consistente para una categoria basado en hash del nombre.
 * Cada categoria distinta queda con su color propio, asi el ojo escanea
 * rapido la columna y ve grupos de la misma cat. Paleta soft tipo Linear/Notion.
 */
const CATEGORY_PALETTE = [
  { dot: "#0ea5e9", bg: "#f0f9ff" },  // sky
  { dot: "#10b981", bg: "#ecfdf5" },  // emerald
  { dot: "#f59e0b", bg: "#fffbeb" },  // amber
  { dot: "#8b5cf6", bg: "#f5f3ff" },  // violet
  { dot: "#ec4899", bg: "#fdf2f8" },  // pink
  { dot: "#06b6d4", bg: "#ecfeff" },  // cyan
  { dot: "#ef4444", bg: "#fef2f2" },  // red
  { dot: "#14b8a6", bg: "#f0fdfa" },  // teal
  { dot: "#a855f7", bg: "#faf5ff" },  // purple
  { dot: "#f97316", bg: "#fff7ed" },  // orange
  { dot: "#84cc16", bg: "#f7fee7" },  // lime
  { dot: "#6366f1", bg: "#eef2ff" },  // indigo
];
function categoryColor(name: string): { dot: string; bg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

interface CategoriaLite {
  id: string;
  nombre: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

/**
 * Miniatura del producto en el listado. Si no hay imagen cargada deja un
 * recuadro gris del mismo tamaño, para que las filas no bailen de alto.
 */
function MiniatureProducto({ url, alt }: { url?: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
        <Package className="h-4 w-4 text-slate-300" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="h-9 w-9 shrink-0 rounded-md border border-slate-200 object-cover"
    />
  );
}

export default function InventarioPage() {
  const { isAdmin } = useIsAdmin();

  // Datos
  const [productos, setProductos] = useState<Producto[]>([]);
  const [total, setTotal] = useState(0);
  const [categorias, setCategorias] = useState<CategoriaLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filtros / paginacion
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Clasificación ABC (rotación por ventas, últimos 3 meses). Misma lógica que
  // el reporte /reportes/rotacion-abc — se consume su API para no duplicarla.

  // Modal de eliminacion
  const [planillaAbierta, setPlanillaAbierta] = useState(false);
  const [deleting, setDeleting] = useState<Producto | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmarEliminar() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const r = await fetch(`/api/productos/${deleting.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setDeleteError((j as { error?: string })?.error ?? "No se pudo eliminar.");
        return;
      }
      setDeleting(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setDeleteLoading(false);
    }
  }

  // Debounce del search (350ms)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchDraft]);

  // Cargar categorias 1 sola vez
  useEffect(() => {
    let cancel = false;
    fetch("/api/inventario/categorias", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        const list: CategoriaLite[] = ((j.data?.categorias ?? []) as Array<{ id: string; nombre: string }>)
          .map((c) => ({ id: c.id, nombre: c.nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        setCategorias(list);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  // Cargar productos paginados cuando cambia algun parametro
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    getProductosPaginated({ page, pageSize, q: search, categoria: categoriaId })
      .then(({ productos, total }) => {
        if (cancel) return;
        setProductos(productos);
        setTotal(total);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [page, pageSize, search, categoriaId, refreshKey]);

  // Paginacion derivada
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const fromIdx = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toIdx = Math.min(safePage * pageSize, total);

  // Mapa de categorias para mostrar nombre rapido
  const categoriaById = useMemo(
    () => new Map(categorias.map((c) => [c.id, c.nombre])),
    [categorias]
  );

  const hasFilters = !!search || !!categoriaId;

  const productosMostrados = productos;

  function limpiarFiltros() {
    setSearchDraft("");
    setSearch("");
    setCategoriaId("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Stock
            </p>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">Inventario</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Gestión de productos y control de stock
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPlanillaAbierta(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border-2 border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-all hover:border-[#4FAEB2] hover:text-[#4FAEB2] active:scale-95"
            title="Imprimir planilla para el conteo físico"
          >
            <Printer className="h-3.5 w-3.5" />
            Planilla de conteo
          </button>
          <span className="inline-flex items-start gap-2">
            <ExportExcelButton url="/api/inventario/productos/export" />
            <ImprimirTablaButton
              titulo="Productos"
              columnas={["Producto", "SKU", "Rubro", "Costo", "Precio", "Stock", "Mínimo"]}
              sumar={[5]}
              filas={productosMostrados.map((p) => [
                p.nombre,
                p.sku,
                p.categoria_principal_id ? categoriaById.get(p.categoria_principal_id) ?? "" : "",
                p.costo_promedio,
                p.precio_venta,
                p.controla_stock === false ? "" : p.stock_actual,
                p.controla_stock === false ? "" : p.stock_minimo,
              ])}
            />
          </span>
          {/* La planilla que el cliente venía armando a mano con el sistema
              viejo (`stockconprecio-<mes>-<año>_<SUCURSAL>.xls`): existencias
              con costo, precios de lista y valorizado. Va aparte del export de
              productos porque contestan cosas distintas — ese es el catálogo,
              esta es la plata que hay en el depósito. */}
          <ExportExcelButton
            url="/api/inventario/stock-con-precios/export"
            label="Stock con precios"
          />
          <ImportExcelButton
            entidad="Productos"
            previewUrl="/api/inventario/productos/import/preview"
            commitUrl="/api/inventario/productos/import/commit"
            templateUrl="/api/inventario/productos/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </header>

      {/* Tarjeta principal */}
      <section className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        {/* Barra de acciones + filtros */}
        <div className="flex flex-col gap-3 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#4FAEB2]">
                <Package className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">Productos</h2>
                <p className="text-[11px] text-slate-500">
                  {loading
                    ? "Cargando..."
                    : total === 0
                    ? "Sin resultados"
                    : `Mostrando ${fromIdx.toLocaleString("es-PY")}-${toIdx.toLocaleString("es-PY")} de ${total.toLocaleString("es-PY")}`}
                </p>
              </div>
            </div>
            <div className="ml-auto">
              <Link
                href="/inventario/nuevo"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/30 transition-all hover:bg-[#3F8E91] active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo producto
              </Link>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            {/* Search — ocupa el espacio disponible */}
            <div className="relative lg:flex-1 lg:min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Buscar por nombre o SKU..."
                className="h-10 w-full rounded-lg border-2 border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition-all focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => setSearchDraft("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Selects agrupados, alineados a la derecha en desktop */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:items-center lg:gap-2">
              <select
                value={categoriaId}
                onChange={(e) => { setCategoriaId(e.target.value); setPage(1); }}
                className="h-10 w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 lg:w-[190px]"
                aria-label="Filtrar por rubro"
              >
                <option value="">Todos los rubros</option>
                <option value="__sin__">— Sin rubro —</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>

              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="col-span-2 h-10 w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 sm:col-span-1 lg:w-[120px]"
                aria-label="Cantidad por página"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} / pág</option>
                ))}
              </select>
            </div>
          </div>

          {hasFilters && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Filtros activos:</span>
              {search && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 font-medium text-[#4FAEB2]">
                  Búsqueda: &quot;{search}&quot;
                </span>
              )}
              {categoriaId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 font-medium text-[#4FAEB2]">
                  {categoriaId === "__sin__"
                    ? "Sin rubro"
                    : categoriaById.get(categoriaId) ?? "Rubro"}
                </span>
              )}
              <button
                type="button"
                onClick={limpiarFiltros}
                className="ml-auto rounded text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>

        {/* Tabla */}
        <EdgeScrollArea>
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-[#4FAEB2]/15 bg-[#4FAEB2]/5 text-[11px] font-bold uppercase tracking-wider text-[#3F8E91]">
                <th className="px-5 py-3">Producto</th>
                <th className="hidden px-3 py-3 lg:table-cell">SKU</th>
                <th className="hidden px-3 py-3 md:table-cell">Rubro</th>
                <th className="px-3 py-3 text-right">Costo</th>
                <th className="px-3 py-3 text-right">Precio</th>
                <th className="px-3 py-3 text-center">Stock</th>
                <th
                  className="hidden px-3 py-3 text-right lg:table-cell"
                  title="Cuánto se le puso encima al costo. Costo 100.000 y precio 150.000 son 50% de remarcación."
                >
                  Remarcación
                </th>
                <th
                  className="hidden px-3 py-3 text-right lg:table-cell"
                  title="Qué parte de la venta queda como ganancia. Costo 100.000 y precio 150.000 son 33,3% de margen."
                >
                  Margen
                </th>
                <th className="hidden px-3 py-3 text-center lg:table-cell">Valuación</th>
                <th className="px-5 py-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && productos.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    <p className="mt-2 text-xs text-slate-500">Cargando productos...</p>
                  </td>
                </tr>
              ) : productosMostrados.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-16 text-center">
                    <Package className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      No se encontraron productos
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {hasFilters
                        ? "Probá con otra búsqueda o cambiá los filtros."
                        : "Aún no cargaste productos. Empezá creando uno nuevo."}
                    </p>
                  </td>
                </tr>
              ) : (
                productosMostrados.map((p) => {
                  const stockBajo = p.stock_actual <= p.stock_minimo;
                  const margen = margenSobreVenta(p.costo_promedio, p.precio_venta);
                  const remarcacion = remarcacionSobreCosto(p.costo_promedio, p.precio_venta);
                  const sinControl = p.controla_stock === false;
                  const catNombre = p.categoria_principal_id
                    ? categoriaById.get(p.categoria_principal_id) ?? "—"
                    : "—";
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-slate-100 transition-colors hover:bg-[#4FAEB2]/5"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <MiniatureProducto url={p.imagen_url} alt={p.nombre} />
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-900">
                              {p.nombre}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-600 lg:hidden">
                              {p.sku}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3.5 font-mono text-xs text-slate-600 lg:table-cell">
                        {p.sku}
                      </td>
                      <td className="hidden px-3 py-3.5 text-xs text-slate-600 md:table-cell">
                        {catNombre === "—" ? (
                          <span className="text-slate-400">— Sin rubro</span>
                        ) : (
                          (() => {
                            const c = categoryColor(catNombre);
                            return (
                              <span
                                className="inline-flex max-w-full items-center gap-1.5 truncate whitespace-nowrap rounded-md border border-slate-200/70 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                                title={catNombre}
                              >
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    background: c.dot,
                                    boxShadow: `0 0 0 3px ${c.bg}`,
                                  }}
                                />
                                <span className="truncate">{catNombre}</span>
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-slate-700">
                        {formatGs(p.costo_promedio)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums font-semibold text-slate-900">
                        {formatGs(p.precio_venta)}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {sinControl ? (
                          <span className="text-xs font-medium text-slate-500">— sin control</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
                              stockBajo
                                ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                                : p.stock_actual > 0
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                                : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"
                            }`}
                          >
                            {formatStock(p.stock_actual)}
                            <span className="text-[10px] font-normal opacity-80">
                              {p.unidad_medida}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3.5 text-right tabular-nums text-slate-600 lg:table-cell">
                        {pct(remarcacion)}
                      </td>
                      <td
                        className={`hidden px-3 py-3.5 text-right tabular-nums font-semibold lg:table-cell ${colorMargen(margen)}`}
                      >
                        {pct(margen)}
                      </td>
                      <td className="hidden px-3 py-3.5 text-center lg:table-cell">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${metodoBadge[p.metodo_valuacion]}`}
                        >
                          {p.metodo_valuacion}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          {/* La ficha del producto existía pero no se llegaba
                              desde ningún lado: para ver costos, precios y
                              datos del artículo había que entrar a editarlo,
                              con el riesgo de guardar algo sin querer. */}
                          <Link
                            href={`/inventario/${p.id}`}
                            title="Ver ficha del producto"
                            aria-label={`Ver ficha de ${p.nombre}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-all hover:bg-[#4FAEB2]/10 hover:text-[#4FAEB2]"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            href={`/inventario/${p.id}/editar`}
                            title="Editar producto"
                            aria-label={`Editar ${p.nombre}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-all hover:bg-[#4FAEB2]/10 hover:text-[#4FAEB2]"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleting(p);
                              setDeleteError(null);
                            }}
                            title="Eliminar producto"
                            aria-label={`Eliminar ${p.nombre}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-all hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

        {/* Paginacion */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-4 py-3 sm:px-5">
            <p className="text-xs text-slate-500">
              Página{" "}
              <span className="font-semibold text-slate-900">{safePage}</span>{" "}
              de{" "}
              <span className="font-semibold text-slate-900">{totalPages.toLocaleString("es-PY")}</span>
            </p>
            <div className="flex items-center gap-1">
              <PagBtn
                onClick={() => setPage(1)}
                disabled={safePage === 1}
                title="Primera página"
              >
                <ChevronsLeft className="h-4 w-4" />
              </PagBtn>
              <PagBtn
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                title="Anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </PagBtn>
              <div className="mx-1 flex items-center gap-1.5 text-xs text-slate-600">
                <span>Ir a</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={safePage}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) setPage(Math.max(1, Math.min(totalPages, n)));
                  }}
                  className="h-8 w-16 rounded-md border border-slate-200 bg-white px-2 text-center text-xs outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
                />
              </div>
              <PagBtn
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                title="Siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </PagBtn>
              <PagBtn
                onClick={() => setPage(totalPages)}
                disabled={safePage >= totalPages}
                title="Última página"
              >
                <ChevronsRight className="h-4 w-4" />
              </PagBtn>
            </div>
          </div>
        )}
      </section>

      {/* Modal de confirmacion de eliminar */}
      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-[fadeIn_.15s_ease-out]"
          onClick={() => !deleteLoading && setDeleting(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 animate-[popIn_.22s_cubic-bezier(.2,.7,.2,1)]"
            onClick={(e) => e.stopPropagation()}
            style={{ animationFillMode: "both" }}
          >
            {/* Cabecera con icono centrado */}
            <div className="flex flex-col items-center px-6 pt-7 pb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 ring-4 ring-rose-50/60">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <h3 className="mt-4 text-center text-base font-semibold tracking-tight text-slate-900">
                ¿Eliminar este producto?
              </h3>
              <p className="mt-1.5 text-center text-[13px] leading-relaxed text-slate-500">
                El producto deja de aparecer en el inventario y en el sitio
                público. Se puede reactivar después si fue por error.
              </p>
            </div>

            {/* Tarjeta del producto a eliminar */}
            <div className="mx-6 mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <p className="truncate text-[13px] font-semibold text-slate-900">
                {deleting.nombre}
              </p>
              {deleting.sku && (
                <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">
                  SKU{" "}
                  <span className="font-mono text-slate-500">
                    {deleting.sku}
                  </span>
                </p>
              )}
            </div>

            {deleteError && (
              <div className="mx-6 mt-3 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-700">
                {deleteError}
              </div>
            )}

            {/* Acciones */}
            <div className="mt-5 flex gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={deleteLoading}
                className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={deleteLoading}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-rose-600/25 transition-all hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60"
              >
                {deleteLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {deleteLoading ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>

          <style jsx>{`
            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @keyframes popIn {
              from {
                opacity: 0;
                transform: translateY(8px) scale(0.96);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
          `}</style>
        </div>
      )}

      {planillaAbierta && (
        <ModalPlanilla
          onClose={() => setPlanillaAbierta(false)}
          rubros={categorias}
          rubroInicial={categoriaId}
          busqueda={search}
        />
      )}
    </div>
  );
}

function PagBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-all hover:border-[#4FAEB2] hover:text-[#4FAEB2] disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
    >
      {children}
    </button>
  );
}

/**
 * Opciones para imprimir la planilla de conteo físico.
 *
 * Arranca con los filtros que ya están puestos en la pantalla: si el encargado
 * filtró un rubro es porque va a contar ese grupo, no todo el depósito.
 *
 * El conteo ciego está marcado por defecto a propósito. Si el papel lleva el
 * stock del sistema impreso al lado, lo que se anota termina siendo ese número
 * copiado y el conteo no sirve para detectar diferencias.
 */
function ModalPlanilla({
  onClose,
  rubros,
  rubroInicial,
  busqueda,
}: {
  onClose: () => void;
  rubros: CategoriaLite[];
  rubroInicial: string;
  busqueda: string;
}) {
  const [ciego, setCiego] = useState(true);
  const [soloConStock, setSoloConStock] = useState(false);
  const [usarBusqueda, setUsarBusqueda] = useState(Boolean(busqueda));
  // Arranca con el rubro que ya estaba filtrado en la pantalla: si el
  // encargado filtró uno es porque ese es el que va a contar.
  const [elegidos, setElegidos] = useState<string[]>(
    rubroInicial ? [rubroInicial] : []
  );

  const todos = elegidos.length === 0;

  // Buscador de la lista de rubros. Con cuarenta rubros, encontrar
  // "TEJIDOS-ALAMBRES-CLAVOS" bajando con la rueda es peor que escribirlo.
  const [filtroRubro, setFiltroRubro] = useState("");

  /**
   * Los rubros que se ven en la lista.
   *
   * Un rubro ya tildado se muestra SIEMPRE, aunque no coincida con lo que se
   * está escribiendo: si se escondiera, se perdería de vista que está elegido
   * y la planilla saldría con un rubro que el usuario cree que sacó.
   */
  const rubrosVisibles = useMemo(() => {
    const t = filtroRubro.trim().toLowerCase();
    if (!t) return rubros;
    return rubros.filter(
      (r) => r.nombre.toLowerCase().includes(t) || elegidos.includes(r.id)
    );
  }, [rubros, filtroRubro, elegidos]);

  function alternar(id: string) {
    setElegidos((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function imprimir() {
    const qs = new URLSearchParams();
    if (ciego) qs.set("oculto", "1");
    if (soloConStock) qs.set("stock", "con");
    for (const id of elegidos) {
      if (id === "__sin__") qs.set("sin_categoria", "1");
      else qs.append("categoria", id);
    }
    if (usarBusqueda && busqueda) qs.set("q", busqueda);
    qs.set("auto", "1");
    window.open(`/api/inventario/planilla?${qs.toString()}`, "_blank");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#4FAEB2]">
            <Printer className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Planilla de conteo</h3>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              El papel que se lleva al depósito, con dos columnas en blanco para
              anotar a mano lo contado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Rubros a contar */}
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Rubros a contar
              </p>
              {!todos && (
                <button
                  type="button"
                  onClick={() => setElegidos([])}
                  className="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
                >
                  Limpiar
                </button>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              {todos
                ? "Sin elegir ninguno sale el inventario general, en una sola planilla."
                : elegidos.length === 1
                ? "Una planilla con ese rubro."
                : `${elegidos.length} rubros: sale una hoja por rubro, para repartir el conteo.`}
            </p>

            {/* El buscador aparece recién cuando hay suficientes rubros como
                para que valga la pena: con cinco a la vista, un campo de
                búsqueda arriba es un paso de más. */}
            {rubros.length > 8 && (
              <input
                type="text"
                value={filtroRubro}
                onChange={(e) => setFiltroRubro(e.target.value)}
                placeholder="Buscar rubro…"
                className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-[#4FAEB2] focus:outline-none"
              />
            )}

            <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
              {rubros.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-400">Todavía no cargaste rubros.</p>
              ) : (
                <>
                  {rubrosVisibles.length === 0 && (
                    <p className="px-2 py-3 text-xs text-slate-400">
                      Ningún rubro se llama así.
                    </p>
                  )}
                  {rubrosVisibles.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={elegidos.includes(r.id)}
                        onChange={() => alternar(r.id)}
                        className="h-4 w-4 shrink-0 accent-[#4FAEB2]"
                      />
                      <span className="truncate">{r.nombre}</span>
                    </label>
                  ))}
                  {/* No se filtra con el buscador: no es un rubro con nombre,
                      es la bolsa de los que no tienen uno, y esconderla al
                      escribir dejaría sin forma de contarlos. */}
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={elegidos.includes("__sin__")}
                      onChange={() => alternar("__sin__")}
                      className="h-4 w-4 shrink-0 accent-[#4FAEB2]"
                    />
                    <span className="truncate">— Sin rubro —</span>
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Opciones */}
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <label className="flex cursor-pointer gap-2.5">
              <input
                type="checkbox"
                checked={ciego}
                onChange={(e) => setCiego(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#4FAEB2]"
              />
              <span className="text-sm text-slate-700">
                Conteo ciego
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                  No imprime el stock del sistema. Recomendado: si se ve, se copia.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer gap-2.5">
              <input
                type="checkbox"
                checked={soloConStock}
                onChange={(e) => setSoloConStock(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#4FAEB2]"
              />
              <span className="text-sm text-slate-700">
                Solo artículos con stock
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                  Hojas más cortas, pero no se detecta lo que figura en cero y en
                  realidad hay.
                </span>
              </span>
            </label>

            {busqueda && (
              <label className="flex cursor-pointer gap-2.5">
                <input
                  type="checkbox"
                  checked={usarBusqueda}
                  onChange={(e) => setUsarBusqueda(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#4FAEB2]"
                />
                <span className="text-sm text-slate-700">
                  Usar la búsqueda de la pantalla
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                    &quot;{busqueda}&quot;
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={imprimir}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/30 transition-all hover:bg-[#3F8E91] active:scale-[0.98]"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
