"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Categoria = {
  id: string; nombre: string; orden: number; activa: boolean;
  ajuste_pct?: number | null;
  /** Compra mensual mínima para entrar. null = se asigna a mano (script 55). */
  monto_minimo_mensual?: number | null;
};

/** "-8" para mostrar, "" cuando no hay política definida. */
/**
 * El monto con separador de miles, como se escribe en Paraguay.
 *
 * ── POR QUÉ NO ES UN `input type="number"` ────────────────────────────────
 * Un campo numérico del navegador no agrupa los miles: muestra 10000 y el que
 * carga un mínimo de diez millones tiene que contar los ceros con el dedo. Y
 * contar ceros sobre un campo que decide a qué precio se le vende al cliente es
 * exactamente donde se equivoca uno por diez.
 *
 * Por eso el campo es de texto y se formatea mientras se escribe. Lo que se
 * guarda son los dígitos, sin los puntos.
 */
function milesTexto(v: number | string | null | undefined): string {
  const digitos = String(v ?? "").replace(/[^0-9]/g, "");
  if (digitos === "") return "";
  // Se sacan los ceros a la izquierda, pero no el cero solo: un mínimo de 0 es
  // un valor real (el piso de la escalera).
  const n = Number(digitos);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("es-PY");
}

/** Los dígitos pelados de un monto escrito con puntos. */
function milesNumero(texto: string): number | null {
  const digitos = texto.replace(/[^0-9]/g, "");
  if (digitos === "") return null;
  const n = Number(digitos);
  return Number.isFinite(n) ? n : null;
}

function pctTexto(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}
/** Cómo se lee el porcentaje en la fila: el signo es lo que importa. */
function pctLeyenda(v: number | null | undefined): string {
  if (v == null || v === 0) return "Precio de lista";
  return v < 0 ? `${Math.abs(v)}% menos que lista` : `${v}% más que lista`;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]";

export default function CategoriasClientePage() {
  const [items, setItems] = useState<Categoria[]>([]);
  const [nombre, setNombre] = useState("");
  // Orden vacío ⇒ el backend usa max(existente)+1 al crear. También se muestra
  // como hint en el placeholder para que Jaz sepa qué valor va a tomar.
  const [orden, setOrden] = useState<string>("");
  const [ajuste, setAjuste] = useState<string>("");
  // false mientras no se corra el script 39: la columna no existe y el
  // porcentaje no se puede guardar. Se dice en pantalla en vez de fallar.
  const [ajusteDisponible, setAjusteDisponible] = useState(true);
  const [minimoDisponible, setMinimoDisponible] = useState(true);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edición inline: id del rubro que se está editando + valores en curso.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editOrden, setEditOrden] = useState("");
  const [editAjuste, setEditAjuste] = useState("");
  const [editMinimo, setEditMinimo] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  const proximoOrden = items.length > 0 ? Math.max(...items.map((i) => i.orden)) + 1 : 0;

  async function cargar() {
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/categorias-cliente", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.success) {
        setItems(j.data.categorias ?? []);
        setAjusteDisponible(j.data.ajuste_disponible !== false);
        setMinimoDisponible(j.data.minimo_disponible !== false);
      }
      else setError(j.error ?? `Error ${r.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  }
  useEffect(() => { void cargar(); }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    try {
      // Si el usuario dejó Orden en blanco, autocalculamos max+1 en el cliente.
      const ordenNum = orden.trim() === "" ? proximoOrden : Number(orden);
      const r = await fetchWithSupabaseSession("/api/categorias-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          orden: Number.isFinite(ordenNum) ? ordenNum : proximoOrden,
          ajuste_pct: ajuste.trim() === "" ? null : Number(ajuste),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      setNombre(""); setOrden(""); setAjuste("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setCreando(false);
    }
  }

  function iniciarEdicion(c: Categoria) {
    setEditandoId(c.id);
    setEditNombre(c.nombre);
    setEditOrden(String(c.orden));
    setEditAjuste(pctTexto(c.ajuste_pct));
    setEditMinimo(milesTexto(c.monto_minimo_mensual));
    setError(null);
  }
  function cancelarEdicion() {
    setEditandoId(null); setEditNombre(""); setEditOrden(""); setEditAjuste(""); setEditMinimo("");
  }
  async function guardarEdicion(c: Categoria) {
    const nombreNuevo = editNombre.trim();
    if (!nombreNuevo) { setError("El nombre es obligatorio."); return; }
    const ordenNuevo = editOrden.trim() === "" ? c.orden : Number(editOrden);
    if (!Number.isFinite(ordenNuevo)) { setError("El orden debe ser un número."); return; }
    let ajusteNuevo: number | null = null;
    if (editAjuste.trim() !== "") {
      const n = Number(editAjuste);
      if (!Number.isFinite(n)) { setError("El porcentaje debe ser un número."); return; }
      if (n <= -100 || n > 100) { setError("El porcentaje tiene que estar entre -99 y 100."); return; }
      ajusteNuevo = n;
    }
    setGuardandoEdit(true);
    try {
      // Vacío NO es cero: vacío significa "esta categoría se asigna a mano y el
      // automático no la toca", y cero es el piso de la escalera, la categoría
      // del que compra poco o nada.
      let minimoNuevo: number | null = null;
      if (editMinimo.trim() !== "") {
        const n = milesNumero(editMinimo);
        if (n == null || n < 0) {
          setError("El mínimo mensual tiene que ser un monto en guaraníes, o vacío.");
          return;
        }
        minimoNuevo = Math.round(n);
      }

      const body: Record<string, unknown> = { nombre: nombreNuevo, orden: ordenNuevo };
      if (ajusteDisponible) body.ajuste_pct = ajusteNuevo;
      if (minimoDisponible) body.monto_minimo_mensual = minimoNuevo;
      const ok = await patch(c.id, body);
      if (ok) cancelarEdicion();
    } finally { setGuardandoEdit(false); }
  }

  async function toggleActiva(c: Categoria) { await patch(c.id, { activa: !c.activa }); }
  async function eliminar(c: Categoria) {
    if (!window.confirm(`¿Borrar el rubro "${c.nombre}"?`)) return;
    try {
      const r = await fetchWithSupabaseSession(`/api/categorias-cliente/${c.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar.");
    }
  }
  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await fetchWithSupabaseSession(`/api/categorias-cliente/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
      return false;
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">← Configuración</Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-800">Rubros de cliente</h1>
        <p className="text-slate-600">
          Rubros configurables (ej. Supermercado grande, Restaurante, Mayorista).
          Cada rubro tiene un <strong>porcentaje</strong> sobre el precio de lista:
          se carga una vez acá y vale para todo el catálogo, también para los
          productos que todavía no existen. Al elegir un cliente con rubro en la
          caja o en un presupuesto, el precio se ajusta solo.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Si un producto puntual tiene precio negociado que no sigue la regla,
          se carga como excepción en la ficha de ese producto y gana sobre el
          porcentaje del rubro.
        </p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {!ajusteDisponible && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Falta correr <code className="font-mono">39_ajuste_pct_rubro_cliente.sql</code>.
          Hasta entonces el porcentaje por rubro no se puede guardar y el precio
          sale de la lista (o de la excepción cargada en el producto).
        </div>
      )}
      {!minimoDisponible && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Falta correr <code className="font-mono">55_categorias_cliente_automaticas.sql</code>.
          Hasta entonces no se puede cargar el mínimo mensual y ningún cliente
          cambia de rubro solo.
        </div>
      )}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-[13px] leading-snug text-slate-600">
        <b className="text-slate-800">Cómo funciona el mínimo mensual:</b> se suma todo lo que el
        cliente compró en el mes y le toca el rubro con el mínimo más alto que ese monto alcanza. El
        que deja de comprar baja, por eso conviene que el rubro más bajo tenga mínimo{" "}
        <b>0</b> y no vacío. Un rubro con el mínimo <b>vacío</b> se asigna a mano y el automático
        nunca lo toca: es para los acuerdos particulares.{" "}
        <Link href="/clientes/categorias" className="text-sky-600 hover:underline">
          Ver el historial de cambios
        </Link>.
      </div>

      <form onSubmit={crear} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Nuevo rubro</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input className={`${inputClass} sm:col-span-2`} placeholder="Nombre (ej. Supermercado grande)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <input
            type="number" step="0.01" className={inputClass}
            placeholder="% sobre lista (ej. -8)"
            value={ajuste} onChange={(e) => setAjuste(e.target.value)}
            disabled={!ajusteDisponible}
          />
          <input type="number" className={inputClass} placeholder={`Orden (auto: ${proximoOrden})`} value={orden} onChange={(e) => setOrden(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500">
          El porcentaje va con signo: <strong>-8</strong> es 8% menos que el precio
          de lista, <strong>5</strong> es 5% más. Vacío o 0 = paga lista.
          Dejá el orden vacío para que se ubique al final ({proximoOrden}).
        </p>
        <button disabled={creando} className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium disabled:opacity-60">
          {creando ? "Creando…" : "Crear rubro"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Rubros cargados</h2>
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">Todavía no hay rubros.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2 w-48">% sobre lista</th>
                <th className="text-left px-4 py-2 w-44">Mínimo mensual</th>
                <th className="text-left px-4 py-2 w-24">Orden</th>
                <th className="text-left px-4 py-2 w-32">Activa</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const isEditing = editandoId === c.id;
                return (
                <tr key={c.id} className={`border-t border-slate-100 ${isEditing ? "bg-amber-50/60" : ""}`}>
                  <td className="px-4 py-2 font-medium">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editNombre}
                        onChange={(e) => setEditNombre(e.target.value)}
                        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
                      />
                    ) : c.nombre}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <input
                        type="number" step="0.01"
                        value={editAjuste}
                        onChange={(e) => setEditAjuste(e.target.value)}
                        disabled={!ajusteDisponible}
                        placeholder="ej. -8"
                        className="w-24 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm disabled:bg-slate-100"
                      />
                    ) : c.ajuste_pct == null || c.ajuste_pct === 0 ? (
                      <span className="text-slate-400">Precio de lista</span>
                    ) : (
                      <span className={`font-semibold tabular-nums ${c.ajuste_pct < 0 ? "text-emerald-700" : "text-amber-700"}`}>
                        {c.ajuste_pct > 0 ? "+" : ""}{c.ajuste_pct}%
                        <span className="ml-2 text-xs font-normal text-slate-500">{pctLeyenda(c.ajuste_pct)}</span>
                      </span>
                    )}
                  </td>
                  {/* Lo que hay que comprar en el mes para entrar en esta
                      categoría. Vacío = la categoría se asigna a mano y el
                      ascenso automático no la toca. */}
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={editMinimo}
                        // Se reformatea en cada tecla: escribir 10000000 va
                        // mostrando 1.000 · 10.000 · 100.000 … y se ve cuántos
                        // ceros lleva sin tener que contarlos.
                        onChange={(e) => setEditMinimo(milesTexto(e.target.value))}
                        disabled={!minimoDisponible}
                        placeholder="a mano"
                        className="w-32 rounded-md border border-amber-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-100"
                      />
                    ) : c.monto_minimo_mensual == null ? (
                      <span className="text-slate-400">Se asigna a mano</span>
                    ) : (
                      <span className="font-semibold tabular-nums text-slate-700">
                        Gs. {Math.round(c.monto_minimo_mensual).toLocaleString("es-PY")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editOrden}
                        onChange={(e) => setEditOrden(e.target.value)}
                        className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
                      />
                    ) : c.orden}
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggleActiva(c)}
                            role="switch" aria-checked={c.activa}
                            disabled={isEditing}
                            className={`inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${c.activa ? "bg-emerald-500" : "bg-slate-300"}`}>
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${c.activa ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <span className={`ml-2 text-xs font-medium ${c.activa ? "text-emerald-700" : "text-slate-500"}`}>{c.activa ? "Sí" : "No"}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isEditing ? (
                      <div className="inline-flex gap-3">
                        <button onClick={() => guardarEdicion(c)} disabled={guardandoEdit} className="text-xs text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50">
                          {guardandoEdit ? "Guardando…" : "Guardar"}
                        </button>
                        <button onClick={cancelarEdicion} disabled={guardandoEdit} className="text-xs text-slate-500 hover:text-slate-800 underline">Cancelar</button>
                      </div>
                    ) : (
                      <div className="inline-flex gap-3">
                        <button onClick={() => iniciarEdicion(c)} className="text-xs text-sky-700 hover:text-sky-900 underline">Editar</button>
                        <button onClick={() => eliminar(c)} className="text-xs text-red-600 hover:text-red-800 underline">Borrar</button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
