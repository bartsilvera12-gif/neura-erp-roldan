"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Vendedores y comisiones (módulo 4).
 *
 * Tres solapas porque son tres preguntas distintas:
 *   Informe (4.6) — cuánto se le debe a cada uno este mes.
 *   Cartera (4.1) — de quién es cada cliente y a quién se le está por soltar.
 *   Configuración (4.5) — cuánto paga cada rubro y cada tipo de vendedor.
 */

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const pct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`;

function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function inicioMesPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-01`;
}
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()}`;
}

type Vendedor = {
  vendedor_id: string | null; vendedor_nombre: string; tipo_vendedor: string | null;
  operaciones: number; facturado: number; descuento: number; costo: number;
  ganancia: number; comision: number; margen_pct: number;
};
type VentaCom = {
  venta_id: string; numero_control: string; fecha: string; cliente_nombre: string | null;
  vendedor_nombre: string; facturado: number; descuento: number; ganancia: number; comision: number;
};
type Informe = {
  ventas: VentaCom[]; vendedores: Vendedor[]; desde: string; hasta: string;
  base_calculo: "margen" | "facturacion";
  totales: { operaciones: number; facturado: number; descuento: number; costo: number; ganancia: number; comision: number };
};

type Tipo = { id: string; nombre: string; porcentaje_base: number; activo: boolean };
type Regla = { id: string; tipo_vendedor_id: string | null; categoria_id: string | null; porcentaje: number; activo: boolean };
type UsuarioLite = { id: string; nombre: string | null; email: string; tipo_vendedor_id: string | null };
type RubroLite = { id: string; nombre: string };
type Config = {
  tipos: Tipo[]; reglas: Regla[]; vendedores: UsuarioLite[]; rubros: RubroLite[];
  config: { dias_cartera: number; base_calculo: "margen" | "facturacion" };
};

type ClienteCartera = {
  id: string; nombre: string; vendedor_id: string | null; vendedor_nombre: string | null;
  cartera_desde: string | null; en_cartera: boolean; dias_restantes: number;
};
type Cartera = {
  clientes: ClienteCartera[]; dias_cartera: number;
  resumen: { total: number; en_cartera: number; libres: number; sin_vendedor: number };
};

type Solapa = "informe" | "cartera" | "config";

export default function ComisionesPage() {
  const [solapa, setSolapa] = useState<Solapa>("informe");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Vendedores y comisiones</h1>
        <p className="text-sm text-slate-500">
          Cuánto vendió cada uno, cuánto le corresponde y de quién es cada cliente.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([["informe", "Informe"], ["cartera", "Cartera"], ["config", "Configuración"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setSolapa(k); setError(null); }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              solapa === k
                ? "border-[#4FAEB2] text-[#3F8E91]"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {solapa === "informe" && <TabInforme onError={setError} />}
      {solapa === "cartera" && <TabCartera onError={setError} />}
      {solapa === "config" && <TabConfig onError={setError} />}
    </div>
  );
}

/* ─────────────────────────────── Informe (4.6 y 4.2) ──────────────────── */

function TabInforme({ onError }: { onError: (e: string | null) => void }) {
  const [desde, setDesde] = useState(inicioMesPy);
  const [hasta, setHasta] = useState(hoyPy);
  const [vendedor, setVendedor] = useState("");
  const [rubro, setRubro] = useState("");
  const [data, setData] = useState<Informe | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);
  const [verDetalle, setVerDetalle] = useState(false);

  useEffect(() => {
    fetchWithSupabaseSession("/api/comisiones/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCfg(j.data as Config); })
      .catch(() => { /* los filtros quedan vacíos; el informe anda igual */ });
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    onError(null);
    try {
      const sp = new URLSearchParams({ desde, hasta });
      if (vendedor) sp.set("vendedor", vendedor);
      if (rubro) sp.set("rubro", rubro);
      const r = await fetchWithSupabaseSession(`/api/comisiones/informe?${sp}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo calcular el informe.");
      setData(j.data as Informe);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, vendedor, rubro, onError]);

  useEffect(() => { void cargar(); }, [cargar]);

  const t = data?.totales;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <Campo label="Desde">
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </Campo>
        <Campo label="Hasta">
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </Campo>
        <Campo label="Vendedor">
          <select value={vendedor} onChange={(e) => setVendedor(e.target.value)}
            className="min-w-[170px] rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Todos</option>
            {(cfg?.vendedores ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.nombre || u.email}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Rubro">
          <select value={rubro} onChange={(e) => setRubro(e.target.value)}
            className="min-w-[170px] rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Todos</option>
            {(cfg?.rubros ?? []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </Campo>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={verDetalle} onChange={(e) => setVerDetalle(e.target.checked)} />
          Ver venta por venta
        </label>
      </div>

      {t && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Tarjeta label="Operaciones" valor={String(t.operaciones)} />
          <Tarjeta label="Vendido (sin IVA)" valor={gs(t.facturado)} />
          <Tarjeta label="Descuentos" valor={gs(t.descuento)} tono="ambar" />
          <Tarjeta label="Ganancia" valor={gs(t.ganancia)} />
          <Tarjeta label="Comisiones" valor={gs(t.comision)} destacado />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-right">Oper.</th>
                <th className="px-4 py-3 text-right">Vendido</th>
                <th className="px-4 py-3 text-right">Descuentos</th>
                <th className="px-4 py-3 text-right">Ganancia</th>
                <th className="px-4 py-3 text-right">Margen</th>
                <th className="px-4 py-3 text-right">Comisión</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">Calculando…</td></tr>
              ) : (data?.vendedores.length ?? 0) === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">Sin ventas en el período.</td></tr>
              ) : data!.vendedores.map((v) => (
                <tr key={v.vendedor_id ?? "sin"} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{v.vendedor_nombre}</td>
                  <td className="px-4 py-2.5 text-slate-500">{v.tipo_vendedor ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{v.operaciones}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{gs(v.facturado)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                    {v.descuento > 0 ? gs(v.descuento) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{gs(v.ganancia)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{pct(v.margen_pct)}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#3F8E91]">{gs(v.comision)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {v.vendedor_id && (
                      <a
                        href={`/api/comisiones/hoja?vendedor=${v.vendedor_id}&desde=${desde}&hasta=${hasta}&auto=1`}
                        target="_blank" rel="noopener"
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
                        title="Hoja imprimible con el detalle y espacio para firma"
                      >
                        Hoja para firmar
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {verDetalle && data && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Comprobante</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3 text-right">Vendido</th>
                  <th className="px-4 py-3 text-right">Desc.</th>
                  <th className="px-4 py-3 text-right">Ganancia</th>
                  <th className="px-4 py-3 text-right">Comisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.ventas.map((v) => (
                  <tr key={v.venta_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-500">{v.numero_control}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">{fechaCorta(v.fecha)}</td>
                    <td className="px-4 py-2 text-slate-700">{v.cliente_nombre ?? "Consumidor final"}</td>
                    <td className="px-4 py-2 text-slate-500">{v.vendedor_nombre}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{gs(v.facturado)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">{v.descuento > 0 ? gs(v.descuento) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{gs(v.ganancia)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-[#3F8E91]">{gs(v.comision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-snug text-slate-400">
        {data?.base_calculo === "facturacion" ? (
          <>La comisión se calcula sobre el importe vendido sin IVA.</>
        ) : (
          <>
            La comisión se calcula <strong>sobre la ganancia</strong> de cada venta (precio sin IVA
            menos costo). Por eso un descuento la baja sola, en la misma proporción en que baja la
            rentabilidad: no hace falta ninguna regla aparte. El costo es el del momento de la
            venta, no el de hoy, así una liquidación cerrada no cambia de número.
          </>
        )}{" "}
        Las ventas anuladas no entran. Una venta a pérdida da comisión cero, nunca negativa.
      </p>
    </div>
  );
}

/* ─────────────────────────────── Cartera (4.1 y 4.3) ──────────────────── */

function TabCartera({ onError }: { onError: (e: string | null) => void }) {
  const [data, setData] = useState<Cartera | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [soloLibres, setSoloLibres] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/comisiones/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCfg(j.data as Config); })
      .catch(() => { /* el selector de vendedor queda vacío */ });
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    onError(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/comisiones/cartera${soloLibres ? "?libres=1" : ""}`, { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar la cartera.");
      setData(j.data as Cartera);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [soloLibres, onError]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(clienteId: string, body: Record<string, unknown>) {
    setGuardando(clienteId);
    onError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/comisiones/cartera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, ...body }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
      await cargar();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(null);
    }
  }

  const r = data?.resumen;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          Un cliente queda en la cartera de su vendedor por{" "}
          <b>{data?.dias_cartera ?? 30} días</b> desde su última operación. Pasado ese plazo queda
          libre solo, sin borrar quién lo atendía.
        </p>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloLibres} onChange={(e) => setSoloLibres(e.target.checked)} />
          Ver solo los libres
        </label>
      </div>

      {r && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tarjeta label="Clientes" valor={String(r.total)} />
          <Tarjeta label="En cartera" valor={String(r.en_cartera)} destacado />
          <Tarjeta label="Libres" valor={String(r.libres)} tono="ambar" />
          <Tarjeta label="Sin vendedor" valor={String(r.sin_vendedor)} />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Última operación</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">Cargando…</td></tr>
              ) : (data?.clientes.length ?? 0) === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                  {soloLibres ? "No hay clientes libres." : "No hay clientes."}
                </td></tr>
              ) : data!.clientes.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.nombre}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={c.vendedor_id ?? ""}
                      disabled={guardando === c.id}
                      onChange={(e) => guardar(c.id, { vendedor_id: e.target.value || null })}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    >
                      <option value="">— Sin vendedor —</option>
                      {(cfg?.vendedores ?? []).map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre || u.email}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {c.cartera_desde ? fechaCorta(c.cartera_desde) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {!c.vendedor_id ? (
                      <span className="text-slate-400">—</span>
                    ) : c.en_cartera ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        En cartera · {c.dias_restantes} día{c.dias_restantes === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                        Libre
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {c.en_cartera && (
                      <button
                        type="button"
                        disabled={guardando === c.id}
                        onClick={() => {
                          if (window.confirm(`¿Liberar a ${c.nombre} de la cartera de ${c.vendedor_nombre}?\n\nSigue constando quién lo atendía; solo deja de contar para la cartera.`)) {
                            void guardar(c.id, { accion: "liberar" });
                          }
                        }}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-amber-300 hover:text-amber-700"
                      >
                        Liberar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        Si un vendedor está ausente y otro le vende a un cliente de su cartera, la comisión es de
        quien cerró la operación, pero <strong>el cliente queda en la cartera original</strong> y
        se le renuevan los días. De lo contrario, el titular perdería su cartera por estar enfermo.
      </p>
    </div>
  );
}

/* ─────────────────────────── Configuración (4.5) ──────────────────────── */

function TabConfig({ onError }: { onError: (e: string | null) => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    onError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/comisiones/config", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar la configuración.");
      setCfg(j.data as Config);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [onError]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function enviar(body: Record<string, unknown>) {
    setGuardando(true);
    onError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/comisiones/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
      await cargar();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(tipo: "tipo" | "regla", id: string) {
    if (!window.confirm("¿Borrar?")) return;
    setGuardando(true);
    onError(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/comisiones/config?tipo=${tipo}&id=${id}`, { method: "DELETE" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo borrar.");
      await cargar();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>;
  if (!cfg) return null;

  const nombreTipo = (id: string | null) =>
    id ? cfg.tipos.find((t) => t.id === id)?.nombre ?? "—" : "Cualquier tipo";
  const nombreRubro = (id: string | null) =>
    id ? cfg.rubros.find((r) => r.id === id)?.nombre ?? "—" : "Cualquier rubro";

  return (
    <div className="space-y-6">
      {/* General */}
      <Caja titulo="General">
        <div className="flex flex-wrap items-end gap-4">
          <Campo label="Días de cartera">
            <input
              type="number" min={1} max={365} defaultValue={cfg.config.dias_cartera}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v !== cfg.config.dias_cartera) {
                  void enviar({ accion: "config", dias_cartera: v, base_calculo: cfg.config.base_calculo });
                }
              }}
              className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
          </Campo>
          <Campo label="Calcular la comisión sobre">
            <select
              value={cfg.config.base_calculo}
              onChange={(e) => void enviar({
                accion: "config", dias_cartera: cfg.config.dias_cartera, base_calculo: e.target.value,
              })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="margen">La ganancia (recomendado)</option>
              <option value="facturacion">El importe vendido</option>
            </select>
          </Campo>
          <p className="max-w-md pb-1 text-[11px] leading-snug text-slate-400">
            Sobre la ganancia, un descuento baja la comisión en la misma proporción en que baja la
            rentabilidad. Sobre el importe vendido, casi no la afecta: se termina premiando vender
            barato.
          </p>
        </div>
      </Caja>

      {/* Tipos de vendedor */}
      <Caja titulo="Tipos de vendedor"
        ayuda="El porcentaje base se usa cuando ninguna regla por rubro aplica.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Nombre</th>
              <th className="py-2 text-right">% base</th>
              <th className="py-2 text-center">Activo</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cfg.tipos.map((t) => (
              <tr key={t.id}>
                <td className="py-2 font-medium text-slate-800">{t.nombre}</td>
                <td className="py-2 text-right tabular-nums">{pct(t.porcentaje_base)}</td>
                <td className="py-2 text-center">{t.activo ? "Sí" : "No"}</td>
                <td className="py-2 text-right">
                  <button onClick={() => borrar("tipo", t.id)} disabled={guardando}
                    className="text-xs text-rose-600 underline-offset-2 hover:underline">Borrar</button>
                </td>
              </tr>
            ))}
            {cfg.tipos.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-slate-400">
                Todavía no hay tipos. Cargá al menos uno para poder comisionar.
              </td></tr>
            )}
          </tbody>
        </table>

        <FormaInline
          campos={[
            { name: "nombre", placeholder: "Ej: EXTERNO", tipo: "text" },
            { name: "porcentaje_base", placeholder: "% base", tipo: "number" },
          ]}
          textoBoton="Agregar tipo"
          disabled={guardando}
          onEnviar={(v) => void enviar({
            accion: "tipo", nombre: v.nombre, porcentaje_base: Number(v.porcentaje_base) || 0,
          })}
        />
      </Caja>

      {/* Reglas */}
      <Caja titulo="Porcentajes por rubro y tipo"
        ayuda="Gana siempre la regla más específica: tipo + rubro, después solo rubro, después solo tipo, y al final el porcentaje base del tipo.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Tipo de vendedor</th>
              <th className="py-2">Rubro</th>
              <th className="py-2 text-right">%</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cfg.reglas.map((r) => (
              <tr key={r.id}>
                <td className="py-2 text-slate-700">{nombreTipo(r.tipo_vendedor_id)}</td>
                <td className="py-2 text-slate-700">{nombreRubro(r.categoria_id)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{pct(r.porcentaje)}</td>
                <td className="py-2 text-right">
                  <button onClick={() => borrar("regla", r.id)} disabled={guardando}
                    className="text-xs text-rose-600 underline-offset-2 hover:underline">Borrar</button>
                </td>
              </tr>
            ))}
            {cfg.reglas.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-slate-400">
                Sin reglas: se usa el porcentaje base de cada tipo.
              </td></tr>
            )}
          </tbody>
        </table>

        <ReglaNueva cfg={cfg} disabled={guardando}
          onEnviar={(b) => void enviar({ accion: "regla", ...b })} />
      </Caja>

      {/* Tipo de cada usuario */}
      <Caja titulo="Tipo de cada vendedor">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {cfg.vendedores.map((u) => (
              <tr key={u.id}>
                <td className="py-2 text-slate-800">{u.nombre || u.email}</td>
                <td className="py-2 text-right">
                  <select
                    value={u.tipo_vendedor_id ?? ""}
                    disabled={guardando}
                    onChange={(e) => void enviar({
                      accion: "asignar_tipo", usuario_id: u.id, tipo_vendedor_id: e.target.value || null,
                    })}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                  >
                    <option value="">— Sin tipo —</option>
                    {cfg.tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Caja>
    </div>
  );
}

/* ─────────────────────────────── Piezas ───────────────────────────────── */

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Caja({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
      {ayuda && <p className="mt-0.5 mb-2 text-[11px] leading-snug text-slate-400">{ayuda}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Tarjeta({ label, valor, sub, tono, destacado = false }: {
  label: string; valor: string; sub?: string; tono?: "ambar"; destacado?: boolean;
}) {
  const color = destacado ? "text-[#3F8E91]" : tono === "ambar" ? "text-amber-600" : "text-slate-900";
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${destacado ? "border-[#4FAEB2]/40" : "border-slate-200"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function FormaInline({ campos, textoBoton, disabled, onEnviar }: {
  campos: { name: string; placeholder: string; tipo: string }[];
  textoBoton: string;
  disabled?: boolean;
  onEnviar: (v: Record<string, string>) => void;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      {campos.map((c) => (
        <input
          key={c.name} type={c.tipo} placeholder={c.placeholder}
          value={v[c.name] ?? ""}
          onChange={(e) => setV((p) => ({ ...p, [c.name]: e.target.value }))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        />
      ))}
      <button
        type="button" disabled={disabled}
        onClick={() => { onEnviar(v); setV({}); }}
        className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
      >
        {textoBoton}
      </button>
    </div>
  );
}

function ReglaNueva({ cfg, disabled, onEnviar }: {
  cfg: Config; disabled?: boolean;
  onEnviar: (b: Record<string, unknown>) => void;
}) {
  const [tipo, setTipo] = useState("");
  const [rubro, setRubro] = useState("");
  const [porcentaje, setPorcentaje] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <select value={tipo} onChange={(e) => setTipo(e.target.value)}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
        <option value="">Cualquier tipo</option>
        {cfg.tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
      </select>
      <select value={rubro} onChange={(e) => setRubro(e.target.value)}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
        <option value="">Cualquier rubro</option>
        {cfg.rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
      </select>
      <input type="number" placeholder="%" value={porcentaje}
        onChange={(e) => setPorcentaje(e.target.value)}
        className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm tabular-nums" />
      <button
        type="button" disabled={disabled}
        onClick={() => {
          onEnviar({
            tipo_vendedor_id: tipo || null,
            categoria_id: rubro || null,
            porcentaje: Number(porcentaje) || 0,
          });
          setPorcentaje("");
        }}
        className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
      >
        Agregar regla
      </button>
    </div>
  );
}
