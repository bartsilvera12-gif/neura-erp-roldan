"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Plus, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { leerRenglonesExcel, claveRenglon, type RenglonExcel } from "@/lib/compras/excel-cotizacion";
import Selector from "@/components/ui/Selector";

type Prov = { id: string; nombre: string };
type Lista = { proveedorId: string; archivo: File | null; renglones: RenglonExcel[] | null; error: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * Nueva cotización armada directamente con las listas de los proveedores
 * (pedido del cliente: «¿no puedo subir nomás los Excel sin poner los
 * productos?»).
 *
 * Se elige el proveedor y su Excel, uno por lista. Los artículos de la
 * cotización son todos los que aparecen en las listas (el mismo código, o la
 * misma descripción si no hay código, cuenta como el mismo artículo). Los que
 * tienen el código de un producto del inventario quedan vinculados, para el
 * «precio sistema». Después se cargan los precios de cada proveedor.
 */
export default function CotizacionDesdeExcelModal({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: (id: string) => void;
}) {
  const [proveedores, setProveedores] = useState<Prov[]>([]);
  const [listas, setListas] = useState<Lista[]>([{ proveedorId: "", archivo: null, renglones: null, error: null }]);
  const [skuAProducto, setSkuAProducto] = useState<Map<string, string>>(new Map());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    void (async () => {
      try {
        const [rp, rprod] = await Promise.all([
          apiFetch("/api/proveedores", { cache: "no-store" }),
          apiFetch("/api/productos", { cache: "no-store" }),
        ]);
        const jp = await rp.json().catch(() => ({}));
        setProveedores(((jp?.data?.proveedores ?? []) as Array<Record<string, unknown>>)
          .map((p) => ({ id: String(p.id), nombre: String(p.nombre ?? "") }))
          .filter((p) => p.nombre)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
        const jprod = await rprod.json().catch(() => ({}));
        const lista = (Array.isArray(jprod?.data) ? jprod.data : (jprod?.data?.productos ?? [])) as Array<Record<string, unknown>>;
        const m = new Map<string, string>();
        for (const p of lista) if (p.sku) m.set(norm(String(p.sku)), String(p.id));
        setSkuAProducto(m);
      } catch { /* sin padrón: los artículos quedan sin vincular */ }
    })();
  }, []);

  async function elegirArchivo(i: number, f: File) {
    setListas((prev) => prev.map((l, k) => (k === i ? { ...l, archivo: f, renglones: null, error: null } : l)));
    try {
      const renglones = await leerRenglonesExcel(f);
      if (renglones.length === 0) throw new Error("No encontré renglones con precio.");
      setListas((prev) => prev.map((l, k) => (k === i ? { ...l, renglones } : l)));
    } catch (e) {
      setListas((prev) => prev.map((l, k) => (k === i ? { ...l, error: e instanceof Error ? e.message : "No se pudo leer." } : l)));
    }
  }

  /**
   * Los artículos de la cotización: la unión de todas las listas. Un renglón
   * es el mismo artículo que otro si tiene el mismo código o, si alguno no
   * trae código, la misma descripción.
   */
  const { articulos, claveDe } = useMemo(() => {
    const m = new Map<string, { codigo: string; descripcion: string; unidad: string }>();
    const porDesc = new Map<string, string>();
    const claveDe = (r: RenglonExcel): string => {
      const d = norm(r.descripcion);
      if (r.codigo) {
        const k = claveRenglon(r);
        if (m.has(k)) return k;
        // Un renglón anterior sin código y con la misma descripción.
        return (d && porDesc.get(d)) || k;
      }
      return (d && porDesc.get(d)) || claveRenglon(r);
    };
    for (const l of listas) {
      for (const r of l.renglones ?? []) {
        const k = claveDe(r);
        const prev = m.get(k);
        if (!prev) m.set(k, { codigo: r.codigo, descripcion: r.descripcion || r.codigo, unidad: r.unidad });
        else {
          if (!prev.codigo && r.codigo) prev.codigo = r.codigo;
          if (!prev.descripcion && r.descripcion) prev.descripcion = r.descripcion;
        }
        const d = norm(r.descripcion);
        if (d && !porDesc.has(d)) porDesc.set(d, k);
      }
    }
    return { articulos: [...m.entries()], claveDe };
  }, [listas]);

  const listasOk = listas.filter((l) => l.proveedorId && l.renglones?.length);
  const repetido = new Set(listas.map((l) => l.proveedorId).filter(Boolean)).size !== listas.filter((l) => l.proveedorId).length;
  const vinculados = articulos.filter(([, a]) => a.codigo && skuAProducto.has(norm(a.codigo))).length;

  async function crear() {
    if (listasOk.length === 0) { setError("Elegí al menos un proveedor con su Excel."); return; }
    if (repetido) { setError("Hay un proveedor elegido dos veces."); return; }
    setGuardando(true);
    setError(null);
    try {
      // 1) La cotización, con los artículos en un orden fijo.
      const r = await apiFetch("/api/compras/cotizaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observaciones: `Armada desde ${listasOk.length === 1 ? "la lista" : "las listas"} de ${listasOk.map((l) => proveedores.find((p) => p.id === l.proveedorId)?.nombre ?? "").join(", ")}.`,
          items: articulos.map(([, a]) => {
            const productoId = a.codigo ? skuAProducto.get(norm(a.codigo)) ?? null : null;
            return {
            producto_id: productoId,
            // Sin producto del inventario, el código del proveedor queda en la
            // descripción para no perderlo.
            descripcion: !productoId && a.codigo && !a.descripcion.includes(a.codigo) ? `${a.descripcion} (${a.codigo})` : a.descripcion,
            cantidad: 1,
            unidad: a.unidad || "UNIDAD",
            };
          }),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo crear la cotización.");
      const id = String(j.data.id);

      // 2) Los ids de los artículos, en el mismo orden en que se mandaron.
      const rd = await apiFetch(`/api/compras/cotizaciones?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const jd = await rd.json();
      const items = (jd?.data?.items ?? []) as Array<{ id: string }>;
      const idDe = new Map(articulos.map(([k], i) => [k, items[i]?.id]));

      // 3) Los precios de cada proveedor.
      for (const l of listasOk) {
        const precios = (l.renglones ?? [])
          .map((rr) => ({ item_id: idDe.get(claveDe(rr)), precio_unitario: rr.precio }))
          .filter((p): p is { item_id: string; precio_unitario: number } => !!p.item_id);
        const rp = await apiFetch("/api/compras/cotizaciones", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, proveedor_id: l.proveedorId, precios }),
        });
        const jp = await rp.json().catch(() => ({}));
        if (!rp.ok || !jp?.success) throw new Error(jp?.error ?? "No se pudieron guardar los precios de un proveedor.");
      }
      onCreada(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={guardando ? undefined : onClose}>
      <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Nueva cotización desde Excel</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Subí la lista de precios de cada proveedor. Los artículos salen de las listas: no hace falta cargarlos antes.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={guardando} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 space-y-2">
          {listas.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <Selector
                value={l.proveedorId}
                onChange={(e) => setListas((prev) => prev.map((x, k) => (k === i ? { ...x, proveedorId: e.target.value } : x)))}
                className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Elegí el proveedor…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Selector>
              <input ref={(el) => { inputs.current[i] = el; }} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void elegirArchivo(i, f); }} />
              <button type="button" onClick={() => inputs.current[i]?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
                <FileSpreadsheet className="h-4 w-4" /> {l.archivo ? "Cambiar Excel" : "Elegir Excel"}
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {l.error ? <span className="text-rose-700">{l.error}</span>
                  : l.renglones ? <>{l.archivo?.name} · <strong className="text-slate-700">{l.renglones.length} precios</strong></>
                  : l.archivo ? "Leyendo…" : "Sin archivo"}
              </span>
              {listas.length > 1 && (
                <button type="button" onClick={() => setListas((prev) => prev.filter((_, k) => k !== i))} className="text-slate-400 hover:text-rose-600" aria-label="Quitar">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setListas((prev) => [...prev, { proveedorId: "", archivo: null, renglones: null, error: null }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#3F8E91] hover:underline">
            <Plus className="h-3.5 w-3.5" /> Otro proveedor
          </button>
        </div>

        {articulos.length > 0 && (
          <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            La cotización va a tener <strong>{articulos.length} artículos</strong>
            {vinculados > 0 && <> ({vinculados} reconocidos en el inventario por su código, con su precio del sistema)</>}.
            {repetido && <span className="block text-rose-700">Hay un proveedor elegido dos veces.</span>}
          </p>
        )}
        {error && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={() => void crear()} disabled={guardando || listasOk.length === 0 || repetido}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Crear cotización
          </button>
        </div>
      </div>
    </div>
  );
}
