"use client";

import { useMemo, useState } from "react";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { padresPosibles, rutaDeRubro, type RubroNodo } from "@/lib/inventario/arbol-rubros";

/**
 * Editar un rubro entero.
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 *   "quiero poder editar todo no solo su nombre."
 *
 *   El lápiz abría "Renombrar rubro" con un solo campo. El código, la
 *   descripción, de quién cuelga y si está activo no se podían tocar desde
 *   ninguna parte, y el crítico, la remarcación y el descuento solo haciendo
 *   clic en su columna, de a uno y con un modal cada vez. Para acomodar un
 *   rubro había que abrir cuatro ventanas y no se veía el conjunto.
 *
 * ── LOS TRES NÚMEROS NO CAMBIAN NINGÚN PRECIO ──────────────────────────────
 *   Remarcación y descuento son la política del rubro: lo que se le propone a
 *   un producto nuevo y hasta dónde se puede descontar. Los productos ya
 *   cargados quedan como están. Vale la pena que se lea en la pantalla, porque
 *   el lugar más caro para equivocarse es creer que tocando acá se repreciaron
 *   mil artículos.
 */

export interface RubroEditable extends RubroNodo {
  codigo: string | null;
  descripcion: string | null;
  activo: boolean;
  dias_critico?: number | null;
  descuento_pct?: number | null;
  markup_pct?: number | null;
}

type Errores = Partial<Record<"nombre" | "dias_critico" | "markup_pct" | "descuento_pct", string>>;

/** Un número escrito a mano: admite coma decimal y espacios. */
function aNumero(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export default function EditarRubroModal({
  rubro, todos, onClose, onGuardado,
}: {
  rubro: RubroEditable;
  /** Todos los rubros, para elegir el padre sin armar un círculo. */
  todos: RubroNodo[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(rubro.nombre);
  const [codigo, setCodigo] = useState(rubro.codigo ?? "");
  const [descripcion, setDescripcion] = useState(rubro.descripcion ?? "");
  const [parentId, setParentId] = useState(rubro.parent_id ?? "");
  const [activo, setActivo] = useState(rubro.activo);
  const [diasCritico, setDiasCritico] = useState(rubro.dias_critico == null ? "" : String(rubro.dias_critico));
  const [markup, setMarkup] = useState(rubro.markup_pct == null ? "" : String(rubro.markup_pct));
  const [descuento, setDescuento] = useState(rubro.descuento_pct ? String(rubro.descuento_pct) : "");

  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los que cuelgan de este rubro no se ofrecen: serían un círculo, y un
  // rubro en círculo no se ve mal, desaparece de la lista con sus productos.
  const opciones = useMemo(
    () => padresPosibles(todos, rubro.id).map((r) => ({ id: r.id, label: r.nombre })),
    [todos, rubro.id]
  );
  const padre = todos.find((t) => t.id === parentId) ?? null;
  const rutaActual = useMemo(() => rutaDeRubro(todos, rubro.id), [todos, rubro.id]);

  function validar(): Errores {
    const e: Errores = {};
    if (nombre.trim() === "") e.nombre = "El nombre no puede quedar vacío.";

    const d = aNumero(diasCritico);
    if (d != null && (Number.isNaN(d) || d < 1 || d > 365)) {
      e.dias_critico = "Tiene que ser un número entre 1 y 365, o vacío.";
    }
    const m = aNumero(markup);
    if (m != null && (Number.isNaN(m) || m < 0)) {
      e.markup_pct = "Tiene que ser un número mayor o igual a cero, o vacío.";
    }
    const dc = aNumero(descuento);
    if (dc != null && (Number.isNaN(dc) || dc < 0 || dc > 100)) {
      e.descuento_pct = "Tiene que ser un número entre 0 y 100, o vacío.";
    }
    return e;
  }

  async function guardar() {
    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return;

    setGuardando(true);
    setError(null);
    try {
      const d = aNumero(diasCritico);
      const m = aNumero(markup);
      const dc = aNumero(descuento);
      const r = await fetch(`/api/inventario/categorias/${rubro.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          descripcion: descripcion.trim() || null,
          parent_id: parentId || null,
          activo,
          dias_critico: d == null ? null : Math.trunc(d),
          markup_pct: m,
          // Vacío en descuento es cero: "sin tope propio", que es como lo lee
          // la venta. Un null acá haría que el campo quede sin definir.
          descuento_pct: dc == null ? 0 : dc,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const campo = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";
  const label = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  const malo = "border-rose-300 focus:ring-rose-200";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div className="my-8 w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Editar rubro</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {rutaActual || rubro.nombre}
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={label}>Nombre</span>
            <input
              value={nombre} onChange={(e) => setNombre(e.target.value)}
              className={`${campo} ${errores.nombre ? malo : ""}`}
            />
            {errores.nombre
              ? <span className="mt-1 block text-[11px] text-rose-700">{errores.nombre}</span>
              : <span className="mt-1 block text-[11px] text-slate-500">
                  Se cambia en todos los productos que hoy están en este rubro.
                </span>}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Código</span>
              <input
                value={codigo} onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ej: G37" className={campo}
              />
            </label>
            <label className="block">
              <span className={label}>Cuelga de</span>
              <div className="mt-1">
                <SearchableSelect
                  value={parentId || null}
                  onChange={(v) => setParentId(v)}
                  options={[{ id: "", label: "— Ninguno: es un rubro principal —" }, ...opciones]}
                  placeholder="— Ninguno: es un rubro principal —"
                />
              </div>
              <span className="mt-1 block text-[11px] text-slate-500">
                {padre
                  ? `Va a quedar dentro de ${padre.nombre}.`
                  : "Queda como rubro principal, sin colgar de otro."}
              </span>
            </label>
          </div>

          <label className="block">
            <span className={label}>Descripción</span>
            <textarea
              value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2}
              className={campo} placeholder="Para qué sirve este rubro, si hace falta aclararlo"
            />
          </label>

          {/* ── La política del rubro ─────────────────────────────────── */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Política del rubro</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              Estos tres <strong>no cambian el precio de ningún producto ya cargado</strong>. Son el
              valor que se le propone a uno nuevo y los topes con los que se vende.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={label}>Crítico bajo</span>
                <div className="relative">
                  <input
                    value={diasCritico}
                    onChange={(e) => setDiasCritico(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="general"
                    className={`${campo} pr-12 ${errores.dias_critico ? malo : ""}`}
                  />
                  <span className="pointer-events-none absolute right-3 top-3 text-[11px] text-slate-400">días</span>
                </div>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Lo que tarda reponerlo. Vacío usa el umbral general.
                </span>
                {errores.dias_critico && (
                  <span className="mt-1 block text-[11px] text-rose-700">{errores.dias_critico}</span>
                )}
              </label>

              <label className="block">
                <span className={label}>Remarcación</span>
                <div className="relative">
                  <input
                    value={markup} onChange={(e) => setMarkup(e.target.value)}
                    placeholder="—" className={`${campo} pr-8 ${errores.markup_pct ? malo : ""}`}
                  />
                  <span className="pointer-events-none absolute right-3 top-3 text-[11px] text-slate-400">%</span>
                </div>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Con la que se carga un producto nuevo del rubro.
                </span>
                {errores.markup_pct && (
                  <span className="mt-1 block text-[11px] text-rose-700">{errores.markup_pct}</span>
                )}
              </label>

              <label className="block">
                <span className={label}>Descuento máx.</span>
                <div className="relative">
                  <input
                    value={descuento} onChange={(e) => setDescuento(e.target.value)}
                    placeholder="sin tope" className={`${campo} pr-8 ${errores.descuento_pct ? malo : ""}`}
                  />
                  <span className="pointer-events-none absolute right-3 top-3 text-[11px] text-slate-400">%</span>
                </div>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Un artículo con su propio tope usa el suyo, no la suma.
                </span>
                {errores.descuento_pct && (
                  <span className="mt-1 block text-[11px] text-rose-700">{errores.descuento_pct}</span>
                )}
              </label>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#4FAEB2]"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Rubro activo</span>
              <span className="block text-[11px] leading-snug text-slate-500">
                Desactivarlo lo saca del selector de Nuevo producto. Los productos que ya están en él
                no se tocan y se siguen vendiendo: es la forma de retirar un rubro que no se usa más,
                sin borrarlo.
              </span>
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={() => void guardar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
