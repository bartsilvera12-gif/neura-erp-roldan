"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import NuevaOrdenCompraModal from "@/components/compras/NuevaOrdenCompraModal";
import NuevaCotizacionModal from "@/components/compras/NuevaCotizacionModal";
import CargarPreciosModal from "@/components/compras/CargarPreciosModal";
import { lineasParaProveedor, type FilaComparativo } from "@/lib/compras/comparativo";
import { Plus, ShoppingCart, Trophy } from "lucide-react";

/**
 * Comparativo de cotizaciones entre proveedores.
 *
 * ── CÓMO SE LEE ────────────────────────────────────────────────────────────
 *   Artículos en las filas, proveedores en las columnas. El más barato de cada
 *   fila va marcado. Abajo, el total de cada uno Y CUÁNTOS ARTÍCULOS COTIZÓ:
 *   sin ese segundo número, el que cotizó dos de diez siempre parece el más
 *   barato.
 */

type Cotizacion = { id: string; numero_control: string; fecha: string; estado: string; observaciones: string | null };
type Resumen = {
  proveedor_id: string; nombre: string; cotizados: number; total: number;
  gana_en: number; completo: boolean; total_comparable: number | null;
};
type Detalle = {
  cotizacion: Cotizacion;
  items: { id: string; descripcion: string; cantidad: number; unidad: string; sku?: string | null; costo_sistema?: number | null }[];
  proveedores: { id: string; nombre: string }[];
  filas: FilaComparativo[];
  resumen: Resumen[];
  veredicto: {
    mejor_completo: Resumen | null;
    total_repartido: number | null;
    ahorro_repartiendo: number | null;
    sin_cotizar: { id: string; descripcion: string }[];
    items_comparables: number;
  };
};

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");
const fmt = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export default function CotizacionesPage() {
  const [lista, setLista] = useState<Cotizacion[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [cargandoPrecios, setCargandoPrecios] = useState(false);
  const [ordenPara, setOrdenPara] = useState<{ id: string; nombre: string } | null>(null);
  /** La lista completa de lo que nadie cotizó, solo si se pide. */
  const [verSinCotizar, setVerSinCotizar] = useState(false);

  const cargarLista = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/api/compras/cotizaciones", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setLista((j.data?.cotizaciones ?? []) as Cotizacion[]);
      setDisponible(j.data?.disponible !== false);
      if (j.data?.aviso) setAviso(String(j.data.aviso));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarDetalle = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`/api/compras/cotizaciones?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el comparativo.");
      setDetalle(j.data as Detalle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setDetalle(null);
    }
  }, []);

  useEffect(() => { void cargarLista(); }, [cargarLista]);
  useEffect(() => { if (abierta) void cargarDetalle(abierta); else setDetalle(null); }, [abierta, cargarDetalle]);

  const v = detalle?.veredicto;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Compras"
        title="Comparativo de cotizaciones"
        description="Los mismos artículos pedidos a varios proveedores, lado a lado"
        actions={
          <button
            type="button" onClick={() => setNueva(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            <Plus className="h-4 w-4" /> Pedir cotización
          </button>
        }
      />

      {!disponible && aviso && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{aviso}</p>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">Todavía no hay pedidos de cotización.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Se arma una lista de artículos, se le pide precio a varios proveedores y acá se ven
            lado a lado. Los artículos se pueden traer de <strong>Bajo mínimo</strong>.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {lista.map((c) => (
            <button
              key={c.id} type="button"
              onClick={() => setAbierta(abierta === c.id ? null : c.id)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                abierta === c.id
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span className="block font-mono font-semibold text-slate-800">{c.numero_control}</span>
              <span className="block text-slate-500">{fmt(c.fecha)} · {c.estado}</span>
            </button>
          ))}
        </div>
      )}

      {detalle && (
        <>
          {/* ── El veredicto ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            {detalle.proveedores.length === 0 ? (
              <p className="text-sm text-slate-600">
                Todavía no cargaste ningún precio. Apretá <strong>Cargar precios</strong> y elegí el
                proveedor que contestó.
              </p>
            ) : v?.mejor_completo ? (
              <>
                <p className="text-[11px] font-medium text-slate-500">
                  Comprándole todo a uno, el más barato es
                </p>
                <p className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  {v.mejor_completo.nombre}
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  Gs. {gs(v.mejor_completo.total)} por los {detalle.items.length} artículos
                </p>
                {v.ahorro_repartiendo != null && v.ahorro_repartiendo > 0 && (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
                    Comprándole a cada uno lo suyo saldría <strong>Gs. {gs(v.total_repartido ?? 0)}</strong>,
                    o sea <strong>Gs. {gs(v.ahorro_repartiendo)} menos</strong>. Son varios pedidos y
                    varios fletes: la diferencia es lo que hay que pesar contra esa molestia.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-600">
                <strong>Ningún proveedor cotizó todos los artículos</strong>, así que no hay uno que
                pueda compararse contra los demás de punta a punta. Mirá la grilla: el mejor precio
                de cada fila está marcado.
              </p>
            )}

            {/* Lo que nadie cotizó. Sin ningún precio cargado no se muestra
                (serían todos los artículos, y el aviso de arriba ya lo dice);
                con precios, unos pocos y el resto a pedido. */}
            {v && detalle.proveedores.length > 0 && v.sin_cotizar.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
                <strong>{v.sin_cotizar.length}</strong>{" "}
                {v.sin_cotizar.length === 1 ? "artículo que nadie cotizó" : "artículos que nadie cotizó"}
                {v.sin_cotizar.length <= 5 || verSinCotizar ? (
                  <>: {v.sin_cotizar.map((i) => i.descripcion).join(", ")}.</>
                ) : (
                  <>: {v.sin_cotizar.slice(0, 5).map((i) => i.descripcion).join(", ")} y {v.sin_cotizar.length - 5} más.</>
                )}{" "}
                Hay que pedirlos aparte.
                {v.sin_cotizar.length > 5 && (
                  <button type="button" onClick={() => setVerSinCotizar((x) => !x)} className="ml-1 font-semibold underline">
                    {verSinCotizar ? "Ver menos" : "Ver todos"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── La grilla ────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <span className="font-mono text-sm font-semibold text-slate-800">
                {detalle.cotizacion.numero_control}
              </span>
              <span className="text-xs text-slate-500">
                {detalle.items.length} artículos · {detalle.proveedores.length} proveedores
              </span>
              <button
                type="button" onClick={() => setCargandoPrecios(true)}
                className="ml-auto rounded-lg border border-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10"
              >
                Cargar precios
              </button>
            </div>

            <EdgeScrollArea>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 text-left font-semibold">Artículo</th>
                    <th className="px-2 py-2 text-right font-semibold">Cant.</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Costo promedio ponderado del producto en el sistema">
                      Precio sistema
                    </th>
                    {detalle.proveedores.map((p) => (
                      <th key={p.id} className="px-3 py-2 text-right font-semibold">{p.nombre}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detalle.filas.map((f) => (
                    <tr key={f.item.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-800">
                        {f.item.descripcion}
                        {f.dispersion_pct != null && f.dispersion_pct > 15 && (
                          <span
                            className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                            title="Diferencia entre el más caro y el más barato"
                          >
                            +{f.dispersion_pct.toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                        {f.item.cantidad} {f.item.unidad}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {f.item.costo_sistema ? gs(f.item.costo_sistema) : "—"}
                      </td>
                      {detalle.proveedores.map((p) => {
                        const precio = f.precios[p.id];
                        const gana = f.mejores.includes(p.id);
                        return (
                          <td
                            key={p.id}
                            className={`px-3 py-2 text-right tabular-nums ${
                              precio == null ? "text-slate-300"
                              // Amarillo el más barato; si hay otro a menos
                              // del 1%, los dos (pedido del cliente).
                              : gana ? "bg-yellow-200 font-semibold text-slate-900"
                              : "text-slate-700"
                            }`}
                            title={precio == null ? "No lo cotizó"
                              : `Subtotal: Gs. ${gs(f.subtotales[p.id] ?? 0)}${gana && f.mejores.length > 1 ? " · menos de 1% de diferencia con el más barato: elegí" : ""}${f.item.costo_sistema ? ` · ${(((precio - f.item.costo_sistema) / f.item.costo_sistema) * 100).toFixed(1)}% contra el sistema` : ""}`}
                          >
                            {precio == null ? "—" : gs(precio)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* El total NUNCA va solo: al lado, cuántos cotizó. */}
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-700" colSpan={3}>Total cotizado</td>
                    {detalle.resumen.map((r) => (
                      <td key={r.proveedor_id} className="px-3 py-2 text-right">
                        <span className="block font-bold tabular-nums text-slate-900">{gs(r.total)}</span>
                        <span className={`block text-[10px] ${r.completo ? "text-emerald-600" : "text-amber-600"}`}>
                          {r.completo
                            ? `cotizó los ${detalle.items.length}`
                            : `solo ${r.cotizados} de ${detalle.items.length}`}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 text-[11px] text-slate-500" colSpan={3}>Mejor precio en</td>
                    {detalle.resumen.map((r) => (
                      <td key={r.proveedor_id} className="px-3 py-2 text-right text-[11px] text-slate-600">
                        {r.gana_en} de {detalle.items.length}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-white">
                    <td className="px-3 py-2" colSpan={3} />
                    {detalle.resumen.map((r) => (
                      <td key={r.proveedor_id} className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setOrdenPara({ id: r.proveedor_id, nombre: r.nombre })}
                          disabled={r.cotizados === 0}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#3F8E91] hover:underline disabled:opacity-40"
                        >
                          <ShoppingCart className="h-3.5 w-3.5" /> Orden
                        </button>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </EdgeScrollArea>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            El <strong>total cotizado</strong> de cada proveedor va siempre con cuántos artículos
            cotizó. Sin ese segundo número, el que cotizó dos de diez siempre parece el más barato.
            Por eso el ganador se elige entre los que cotizaron <strong>todo</strong>.
          </p>
        </>
      )}

      {nueva && (
        <NuevaCotizacionModal
          onClose={() => setNueva(false)}
          onCreada={(id) => { setNueva(false); void cargarLista(); setAbierta(id); }}
        />
      )}

      {cargandoPrecios && detalle && (
        <CargarPreciosModal
          cotizacionId={detalle.cotizacion.id}
          items={detalle.items}
          onClose={() => setCargandoPrecios(false)}
          onGuardado={() => { setCargandoPrecios(false); void cargarDetalle(detalle.cotizacion.id); }}
        />
      )}

      {ordenPara && detalle && (
        <NuevaOrdenCompraModal
          itemsIniciales={lineasParaProveedor(detalle.filas, ordenPara.id)}
          origen={`el comparativo ${detalle.cotizacion.numero_control}`}
          onClose={() => setOrdenPara(null)}
          onCreada={() => setOrdenPara(null)}
        />
      )}
    </div>
  );
}
