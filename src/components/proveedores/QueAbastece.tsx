"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

/**
 * Qué puede traer este proveedor: rubros de producto y artículos puntuales.
 *
 * ── POR QUÉ NO ES LO MISMO QUE "RUBROS" DE MÁS ARRIBA ──────────────────────
 *   Aquellos son la taxonomía PROPIA de proveedores —sirve para agruparlos
 *   entre sí—. Estos son los rubros del CATÁLOGO: FERRETERIA, CHAPA
 *   TERMOPANEL, CAÑOS CUADRADOS. Es la diferencia entre "qué clase de
 *   proveedor es" y "qué le puedo pedir".
 *
 * ── PARA QUÉ SIRVE ─────────────────────────────────────────────────────────
 *   Para que al armar una orden de compra o pedir cotizaciones el sistema
 *   pueda contestar "¿a quién le pido chapa?". Hoy esa pregunta no tiene
 *   respuesta: ninguno de los 1.002 artículos tiene proveedor principal.
 *
 * ── LOS ARTÍCULOS SUELTOS SON LA EXCEPCIÓN, NO LA REGLA ────────────────────
 *   Casi todos los proveedores traen rubros enteros. El artículo puntual es
 *   para el importador que trae una sola marca de disco y no define el rubro.
 *   Por eso se cargan buscando, no con una lista de mil casillas.
 */

type Rubro = { id: string; nombre: string };
type Articulo = { id: string; nombre: string; sku: string | null };

export default function QueAbastece({ proveedorId }: { proveedorId: string }) {
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Articulo[]>([]);
  const [disponible, setDisponible] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lo que abastece hoy, más el catálogo de rubros.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [rA, rB] = await Promise.all([
          apiFetch(`/api/proveedores/abastece?proveedor_id=${encodeURIComponent(proveedorId)}`),
          apiFetch("/api/inventario/categorias"),
        ]);
        const jA = await rA.json();
        const jB = await rB.json().catch(() => ({}));
        if (!vivo) return;

        if (jA?.success) {
          setElegidos(new Set((jA.data?.categoria_ids ?? []) as string[]));
          setDisponible(jA.data?.disponible !== false);
          if (jA.data?.aviso) setAviso(String(jA.data.aviso));
          setArticulos((jA.data?.productos ?? []) as Articulo[]);
        }
        const cats = (jB?.data?.categorias ?? []) as Array<Record<string, unknown>>;
        if (Array.isArray(cats)) {
          setRubros(cats.map((c) => ({ id: String(c.id), nombre: String(c.nombre ?? "") }))
            .filter((c) => c.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
        }
      } catch {
        if (vivo) setError("No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [proveedorId]);

  // Buscador de artículos sueltos.
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/productos?q=${encodeURIComponent(q)}&limit=12`);
        const j = await r.json().catch(() => ({}));
        const lista = (j?.data?.productos ?? []) as Array<Record<string, unknown>>;
        setResultados(
          (Array.isArray(lista) ? lista : [])
            .map((p) => ({ id: String(p.id), nombre: String(p.nombre ?? ""), sku: p.sku ? String(p.sku) : null }))
            .filter((p) => !articulos.some((a) => a.id === p.id))
            .slice(0, 12)
        );
      } catch { setResultados([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, articulos]);

  function alternar(id: string) {
    setOk(null);
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      const r = await apiFetch("/api/proveedores/abastece", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedorId,
          categoria_ids: [...elegidos],
          producto_ids: articulos.map((a) => a.id),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setOk(
        `Guardado: ${j.data?.rubros ?? 0} ${Number(j.data?.rubros) === 1 ? "rubro" : "rubros"}` +
        (Number(j.data?.articulos) > 0 ? ` y ${j.data.articulos} artículos` : "") + "."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="py-4 text-sm text-slate-500">Cargando…</p>;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">Qué puede abastecer</h2>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
        Los rubros del catálogo que este proveedor trae. Es lo que contesta «¿a quién le pido
        chapa?» al armar una orden de compra o pedir cotizaciones.
      </p>

      {!disponible && aviso && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {aviso}
        </p>
      )}

      {/* ── Rubros ───────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rubros.length === 0 ? (
          <p className="text-sm text-slate-500">No hay rubros de producto cargados.</p>
        ) : rubros.map((r) => {
          const on = elegidos.has(r.id);
          return (
            <button
              key={r.id} type="button" onClick={() => alternar(r.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]"
              }`}
            >
              {r.nombre}
            </button>
          );
        })}
      </div>

      {/* ── Artículos sueltos ────────────────────────────────────────── */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-[11px] font-medium text-slate-500">
          Artículos puntuales <span className="font-normal normal-case text-slate-400">(opcional)</span>
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Para el que trae un artículo suelto que no define todo su rubro.
        </p>

        {articulos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {articulos.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700">
                {a.nombre}{a.sku ? ` · ${a.sku}` : ""}
                <button
                  type="button"
                  onClick={() => { setArticulos((p) => p.filter((x) => x.id !== a.id)); setOk(null); }}
                  className="text-slate-400 hover:text-rose-600"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar un artículo por nombre o código…"
          className="mt-2 w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        {resultados.length > 0 && (
          <ul className="mt-1 max-w-md overflow-hidden rounded-lg border border-slate-200">
            {resultados.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setArticulos((prev) => [...prev, p]);
                    setBusca(""); setResultados([]); setOk(null);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  {p.nombre}{p.sku ? <span className="ml-1 text-slate-400">{p.sku}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p>
      )}
      {ok && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">{ok}</p>
      )}

      <button
        type="button" onClick={() => void guardar()} disabled={guardando}
        className="mt-3 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}
