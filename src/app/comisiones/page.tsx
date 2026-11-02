"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { tiposDisponibles } from "@/lib/comisiones/tipos-vendedor";

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
  /** Lo que tenía que facturar. null = sin mínimo (o falta el script 54). */
  minimo_ventas?: number | null;
  /** Si llegó. Cuando no llegó, la comisión ya viene a la mitad. */
  llego_al_minimo?: boolean;
  factor_minimo?: number;
};
type VentaCom = {
  venta_id: string; numero_control: string; fecha: string; cliente_nombre: string | null;
  vendedor_nombre: string; facturado: number; descuento: number; ganancia: number; comision: number;
};
type Informe = {
  ventas: VentaCom[]; vendedores: Vendedor[]; desde: string; hasta: string;
  base_calculo: "margen" | "facturacion";
  totales: { operaciones: number; facturado: number; descuento: number; costo: number; ganancia: number; comision: number };
  /** false cuando el informe está filtrado por rubro: ahí no se puede medir. */
  minimo_aplicado?: boolean;
};

type Tipo = {
  id: string; nombre: string; porcentaje_base: number; activo: boolean;
  /** Tope de descuento en Caja para todos los de este tipo. null = sin tope. */
  descuento_maximo_pct?: number | null;
  /** Facturación a alcanzar en el período. null = sin mínimo (script 54). */
  minimo_ventas?: number | null;
};
type Regla = { id: string; tipo_vendedor_id: string | null; categoria_id: string | null; porcentaje: number; activo: boolean };
type UsuarioLite = {
  id: string; nombre: string | null; email: string; tipo_vendedor_id: string | null;
  /** Tope propio. null = usa el de su tipo de vendedor. */
  descuento_maximo_pct?: number | null;
  /** Comisión propia. null = usa las reglas y el % base de su tipo. */
  porcentaje_comision?: number | null;
  /** Mínimo propio. null = usa el de su tipo. */
  minimo_ventas?: number | null;
};
type RubroLite = { id: string; nombre: string; parent_id?: string | null };
type Config = {
  tipos: Tipo[]; reglas: Regla[]; vendedores: UsuarioLite[]; rubros: RubroLite[];
  config: {
    dias_cartera: number;
    base_calculo: "margen" | "facturacion";
    /** Script 43: puede no estar en bases que no lo corrieron. */
    penaliza_descuento?: boolean;
    penalizacion_maxima_pct?: number | null;
  };
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

  // Se puede entrar directo a una solapa con ?tab=config. Lo usa el link
  // "Comisiones por rubro" del estudio de precios: mandar a la pantalla y
  // que después haya que buscar la solapa es media ayuda.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "config" || t === "cartera" || t === "informe") setSolapa(t);
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendedores y comisiones</h1>
          <p className="text-sm text-slate-500">
            Cuánto vendió cada uno, cuánto le corresponde y de quién es cada cliente.
          </p>
        </div>
        {/* La comisión dice cuánto cobra cada uno; el otro reporte dice QUÉ
            vende. Son las dos mitades de la misma conversación, así que se
            llega de una a la otra. */}
        <Link
          href="/reportes/vendedores"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
        >
          Ver qué vende cada uno →
        </Link>
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

  const [detalleDe, setDetalleDe] = useState<Vendedor | null>(null);

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
                <th className="px-4 py-3 text-right">Mínimo</th>
                <th className="px-4 py-3 text-right">Descuentos</th>
                <th className="px-4 py-3 text-right">Ganancia</th>
                <th className="px-4 py-3 text-right">Margen</th>
                <th className="px-4 py-3 text-right">Comisión</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400">Calculando…</td></tr>
              ) : (data?.vendedores.length ?? 0) === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400">Sin ventas en el período.</td></tr>
              ) : data!.vendedores.map((v) => (
                <tr
                  key={v.vendedor_id ?? "sin"}
                  onClick={() => setDetalleDe(v)}
                  title="Ver el resumen de este vendedor, venta por venta"
                  className="cursor-pointer hover:bg-slate-50/60"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800">{v.vendedor_nombre}</td>
                  <td className="px-4 py-2.5 text-slate-500">{v.tipo_vendedor ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{v.operaciones}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{gs(v.facturado)}</td>
                  {/* Si no llegó al mínimo la comisión ya viene a la mitad: hay
                      que poder verlo acá, o el vendedor lee un número más chico
                      sin ninguna explicación. */}
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                    {v.minimo_ventas == null ? (
                      <span className="text-slate-400">sin mínimo</span>
                    ) : v.llego_al_minimo === false ? (
                      <span className="font-medium text-amber-700" title={`No llegó al mínimo de ${gs(v.minimo_ventas)}: cobra la mitad de su comisión.`}>
                        {gs(v.minimo_ventas)}
                        <span className="block font-normal">no llegó · mitad</span>
                      </span>
                    ) : (
                      <span className="text-emerald-700" title={`Llegó al mínimo de ${gs(v.minimo_ventas)}.`}>
                        {gs(v.minimo_ventas)}
                        <span className="block text-slate-400">llegó</span>
                      </span>
                    )}
                  </td>
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
                        onClick={(e) => e.stopPropagation()}
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

      {detalleDe && data && (
        <ResumenVendedorModal
          vendedor={detalleDe}
          ventas={data.ventas.filter((x) => x.vendedor_nombre === detalleDe.vendedor_nombre)}
          desde={desde}
          hasta={hasta}
          baseCalculo={data.base_calculo}
          onClose={() => setDetalleDe(null)}
        />
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

      {/* Filtrando por rubro, lo vendido no es lo del período y el mínimo no se
          puede medir: el informe lo dice en vez de mostrar comisiones enteras
          que después van a salir a la mitad. */}
      {data && data.minimo_aplicado === false && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs leading-snug text-amber-900">
          <strong>Este informe está filtrado por rubro,</strong> así que el mínimo de ventas no se
          está teniendo en cuenta: lo que figura como vendido es solo lo de ese rubro y compararlo
          contra el mínimo daría cualquier cosa. Las comisiones de acá son las enteras. Para ver lo
          que se va a pagar de verdad, sacá el filtro de rubro.
        </p>
      )}
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
      // Guardó, pero algo quedó afuera —por ejemplo el tope de descuento si
      // todavía no se corrió el script 34. Se dice, en vez de dejar creer que
      // se aplicó.
      if (typeof j?.data?.aviso === "string") onError(j.data.aviso);
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
                  void enviar({
                    accion: "config", dias_cartera: v, base_calculo: cfg.config.base_calculo,
                    penaliza_descuento: cfg.config.penaliza_descuento,
                    penalizacion_maxima_pct: cfg.config.penalizacion_maxima_pct,
                  });
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
                penaliza_descuento: cfg.config.penaliza_descuento,
                penalizacion_maxima_pct: cfg.config.penalizacion_maxima_pct,
              })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="margen">La ganancia (recomendado)</option>
              <option value="facturacion">El importe vendido</option>
            </select>
          </Campo>
          <p className="max-w-md pb-1 text-[11px] leading-snug text-slate-400">
            Sobre la ganancia, un descuento baja la comisión en la misma proporción en que baja la
            rentabilidad. Sobre el importe vendido no la afecta sola: para eso está la opción de
            abajo.
          </p>
        </div>

        {/* El recorte por descuento. Solo tiene sentido sobre el importe
            vendido: sobre la ganancia el descuento ya pega solo, y aplicarlo
            dos veces sería castigar dos veces lo mismo. */}
        {cfg.config.base_calculo === "facturacion" && (
          <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={cfg.config.penaliza_descuento === true}
                onChange={(e) => void enviar({
                  accion: "config", dias_cartera: cfg.config.dias_cartera,
                  base_calculo: cfg.config.base_calculo,
                  penaliza_descuento: e.target.checked,
                  penalizacion_maxima_pct: cfg.config.penalizacion_maxima_pct,
                })}
                className="h-4 w-4 rounded border-slate-300"
              />
              El descuento recorta la comisión
            </label>
            {cfg.config.penaliza_descuento && (
              <Campo label="Recorte máximo (%)">
                <input
                  type="number" min={0} max={100}
                  defaultValue={cfg.config.penalizacion_maxima_pct ?? ""}
                  placeholder="sin tope"
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    void enviar({
                      accion: "config", dias_cartera: cfg.config.dias_cartera,
                      base_calculo: cfg.config.base_calculo,
                      penaliza_descuento: true,
                      penalizacion_maxima_pct: t === "" ? null : Number(t),
                    });
                  }}
                  className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </Campo>
            )}
            <p className="max-w-lg pb-1 text-[11px] leading-snug text-slate-500">
              La comisión baja en la misma proporción en que el descuento se comió la utilidad: si
              se llevó el 30%, se cobra 30% menos. Sin descuento se comisiona normal. El recorte
              máximo limita cuánto se puede descontar por este concepto; vacío, puede llegar a cero.
            </p>
          </div>
        )}
      </Caja>

      {/* Tipos de vendedor */}
      <Caja titulo="Tipos de vendedor"
        ayuda="El % base es lo que cobra de comisión cuando ninguna regla por rubro aplica. El mínimo de ventas es lo que tiene que facturar en el período para cobrar la comisión entera: si no llega, cobra la mitad (vacío = sin mínimo). El tope de descuento es cuánto puede bajar el precio en Caja: vacío = sin tope, 0 = no puede descontar nada. La excepción de una persona se carga abajo, en “Tipo de cada vendedor”, y le gana a esto.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Nombre</th>
              <th className="py-2 text-right">% base</th>
              <th className="py-2 text-right">Mínimo de ventas</th>
              <th className="py-2 text-right">Desc. máx.</th>
              <th className="py-2 text-center">Activo</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cfg.tipos.map((t) => (
              <tr key={t.id}>
                <td className="py-2 font-medium text-slate-800">{t.nombre}</td>
                <td className="py-2 text-right">
                  <PctEditable
                    valor={Number(t.porcentaje_base) || 0}
                    disabled={guardando}
                    onGuardar={(n) => void enviar({
                      accion: "tipo", id: t.id, nombre: t.nombre, porcentaje_base: n,
                    })}
                  />
                </td>
                <td className="py-2 text-right">
                  <GsEditable
                    valor={t.minimo_ventas == null ? null : Number(t.minimo_ventas)}
                    disabled={guardando}
                    etiquetaVacio="sin mínimo"
                    onGuardar={(n) => void enviar({
                      accion: "tipo", id: t.id, nombre: t.nombre,
                      porcentaje_base: Number(t.porcentaje_base) || 0,
                      minimo_ventas: n,
                    })}
                  />
                </td>
                <td className="py-2 text-right">
                  <PctEditable
                    valor={t.descuento_maximo_pct == null ? -1 : Number(t.descuento_maximo_pct)}
                    disabled={guardando}
                    etiquetaVacio="sin tope"
                    permiteVacio
                    onGuardar={(n) => void enviar({
                      accion: "tipo", id: t.id, nombre: t.nombre,
                      porcentaje_base: Number(t.porcentaje_base) || 0,
                      descuento_maximo_pct: n < 0 ? null : n,
                    })}
                  />
                </td>
                <td className="py-2 text-center">{t.activo ? "Sí" : "No"}</td>
                <td className="py-2 text-right">
                  <button onClick={() => borrar("tipo", t.id)} disabled={guardando}
                    className="text-xs text-rose-600 underline-offset-2 hover:underline">Borrar</button>
                </td>
              </tr>
            ))}
            {cfg.tipos.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-slate-400">
                Todavía no hay tipos. Cargá al menos uno para poder comisionar.
              </td></tr>
            )}
          </tbody>
        </table>

        {/* El nombre sale de una lista, no se escribe.
            Con el campo abierto aparecían "CALL CENTER", "Call center" y
            "CALLCENTER" como tres tipos distintos, cada uno con su porcentaje y
            su mínimo, y las comisiones se repartían entre tres configuraciones
            que nadie quiso crear. */}
        <NuevoTipoVendedor
          yaCargados={cfg.tipos}
          disabled={guardando}
          onEnviar={(nombre, porcentajeBase) => void enviar({
            accion: "tipo", nombre, porcentaje_base: porcentajeBase,
          })}
        />
      </Caja>

      {/* Porcentajes por rubro */}
      <Caja titulo="Porcentajes por rubro"
        ayuda="Están todos los rubros del catálogo. El que no tiene porcentaje cargado comisiona con el porcentaje base del tipo de vendedor, que casi nunca es lo que se quiso. Si un rubro tiene subcategorías, alcanza con cargar el porcentaje en el padre: lo heredan todas, salvo la que tenga uno propio. Por encima de todo esto manda la comisión propia de la persona.">
        <ReglasPorRubro
          cfg={cfg}
          disabled={guardando}
          onGuardar={(categoriaId, porcentaje, idExistente) => void enviar({
            accion: "regla",
            ...(idExistente ? { id: idExistente } : {}),
            tipo_vendedor_id: null,
            categoria_id: categoriaId,
            porcentaje,
          })}
          onBorrar={(id) => borrar("regla", id)}
        />
      </Caja>

      {/* Tipo de cada usuario */}
      <Caja titulo="Tipo de cada vendedor"
        ayuda="El tipo define cuánto comisiona, cuánto tiene que vender y hasta cuánto puede descontar. Las tres columnas de la derecha son las excepciones de esa persona: vacías usa lo de su tipo. La comisión propia le gana incluso a la regla por rubro, y un 0 es un valor real (no comisiona / no tiene mínimo / no puede descontar).">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Vendedor</th>
              <th className="py-2 text-right">Tipo</th>
              <th className="py-2 text-right">Comisión propia</th>
              <th className="py-2 text-right">Mínimo propio</th>
              <th className="py-2 text-right">Desc. máx. propio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cfg.vendedores.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-slate-400">
                No hay usuarios cargados en la empresa.
              </td></tr>
            )}
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
                <td className="py-2 text-right">
                  <PctEditable
                    valor={u.porcentaje_comision == null ? -1 : Number(u.porcentaje_comision)}
                    disabled={guardando}
                    permiteVacio
                    etiquetaVacio="por reglas"
                    onGuardar={(n) => void enviar({
                      accion: "comision_usuario", usuario_id: u.id,
                      porcentaje_comision: n < 0 ? null : n,
                    })}
                  />
                </td>
                <td className="py-2 text-right">
                  <GsEditable
                    valor={u.minimo_ventas == null ? null : Number(u.minimo_ventas)}
                    disabled={guardando}
                    etiquetaVacio="el de su tipo"
                    onGuardar={(n) => void enviar({
                      accion: "minimo_usuario", usuario_id: u.id, minimo_ventas: n,
                    })}
                  />
                </td>
                <td className="py-2 text-right">
                  <PctEditable
                    valor={u.descuento_maximo_pct == null ? -1 : Number(u.descuento_maximo_pct)}
                    disabled={guardando}
                    permiteVacio
                    etiquetaVacio="el de su tipo"
                    onGuardar={(n) => void enviar({
                      accion: "tope_usuario", usuario_id: u.id,
                      descuento_maximo_pct: n < 0 ? null : n,
                    })}
                  />
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

/**
 * Porcentaje editable en la misma tabla.
 *
 * Antes solo se podía agregar y borrar. Cambiar un 5% a un 6% obligaba a
 * borrar la regla y cargarla de nuevo, y si no la borrabas primero el
 * servidor rechazaba el alta con "ya hay una regla para esa combinación,
 * editá la que existe" — un mensaje que mandaba a editar algo que no se
 * podía editar.
 *
 * Guarda al salir del campo y solo si el número cambió: así no escribe una
 * vez por tecla.
 */
function PctEditable({
  valor, disabled, onGuardar, permiteVacio, etiquetaVacio,
}: {
  /** Con `permiteVacio`, -1 representa "sin valor" y el campo se ve vacío. */
  valor: number;
  disabled?: boolean;
  onGuardar: (nuevo: number) => void;
  /** Deja borrar el campo, y entonces devuelve -1 en vez de un número. */
  permiteVacio?: boolean;
  /** Lo que se ve de fondo cuando está vacío, por ejemplo "sin tope". */
  etiquetaVacio?: string;
}) {
  const aTexto = (v: number) => (permiteVacio && v < 0 ? "" : String(v));
  const [texto, setTexto] = useState(aTexto(valor));
  // Si el valor cambia desde afuera (otro guardado, una recarga), el campo
  // lo sigue, salvo que lo esté editando alguien.
  useEffect(() => { setTexto(aTexto(valor)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [valor, permiteVacio]);

  return (
    <input
      type="number"
      min={0}
      max={100}
      step="0.01"
      value={texto}
      disabled={disabled}
      placeholder={etiquetaVacio}
      aria-label="Porcentaje"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        // Vacío es un valor en sí: "sin tope". Distinto de cero, que es "no
        // puede descontar nada".
        if (permiteVacio && texto.trim() === "") {
          if (valor < 0) return;
          onGuardar(-1);
          return;
        }
        const n = Number(texto.replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 100) { setTexto(aTexto(valor)); return; }
        if (n === valor) return;
        onGuardar(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none disabled:opacity-50"
    />
  );
}

/**
 * Los porcentajes de comisión, un renglón por rubro.
 *
 * ── POR QUÉ ASÍ Y NO UNA LISTA DE REGLAS ──────────────────────────────────
 * Antes había que agregar las reglas de a una, eligiendo el rubro en un
 * desplegable. Con 55 rubros eso quiere decir que en la práctica se cargan
 * tres o cuatro y el resto queda comisionando con el porcentaje base del tipo
 * de vendedor sin que nadie se entere: la pantalla mostraba las reglas que
 * existían, no las que faltaban, así que no había forma de ver el agujero.
 *
 * Acá están los rubros todos, y arriba dice cuántos faltan.
 *
 * ── VACÍO NO ES CERO ──────────────────────────────────────────────────────
 * Un campo vacío significa "no hay regla para este rubro": comisiona con el
 * porcentaje base del tipo. Un 0 escrito a mano significa "este rubro no
 * comisiona". Son cosas distintas y por eso borrar el campo borra la regla en
 * vez de guardar un cero.
 */
function ReglasPorRubro({ cfg, disabled, onGuardar, onBorrar }: {
  cfg: Config;
  disabled?: boolean;
  /** `idExistente` vacío = la regla todavía no existe y hay que crearla. */
  onGuardar: (categoriaId: string, porcentaje: number, idExistente?: string) => void;
  onBorrar: (id: string) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [soloFaltan, setSoloFaltan] = useState(false);

  // Las reglas que edita esta pantalla: por rubro, sin tipo de vendedor.
  const porRubro = new Map<string, Regla>();
  const conTipo: Regla[] = [];
  for (const r of cfg.reglas) {
    if (r.tipo_vendedor_id == null && r.categoria_id != null) porRubro.set(r.categoria_id, r);
    else conTipo.push(r);
  }

  /**
   * El porcentaje que termina cobrando un rubro: el suyo, o el del primer
   * padre que tenga uno. Es la misma cuenta que hace `porcentajeAplicable` en
   * el servidor, y está acá para que la pantalla muestre exactamente lo que se
   * va a pagar en vez de "sin cargar" sobre un rubro que sí cobra algo.
   */
  const padreDe = new Map<string, string | null>(
    cfg.rubros.map((r) => [r.id, r.parent_id ?? null])
  );
  function heredado(rubroId: string): { pct: number; de: string } | null {
    const vistos = new Set<string>([rubroId]);
    let actual = padreDe.get(rubroId) ?? null;
    while (actual && !vistos.has(actual)) {
      vistos.add(actual);
      const regla = porRubro.get(actual);
      if (regla) {
        return {
          pct: Number(regla.porcentaje) || 0,
          de: cfg.rubros.find((x) => x.id === actual)?.nombre ?? "su rubro padre",
        };
      }
      actual = padreDe.get(actual) ?? null;
    }
    return null;
  }

  // Falta cargar el que no tiene regla propia NI hereda una.
  const faltan = cfg.rubros.filter((r) => !porRubro.has(r.id) && !heredado(r.id)).length;

  /**
   * Los rubros ordenados como árbol: cada padre seguido de sus hijos.
   *
   * Un rubro cuyo padre no está en la lista (desactivado, o de otra sucursal)
   * se trata como raíz en vez de desaparecer: no mostrarlo haría que su
   * porcentaje no se pueda cargar desde ningún lado.
   */
  const hijosDe = new Map<string, RubroLite[]>();
  const raices: RubroLite[] = [];
  const existe = new Set(cfg.rubros.map((r) => r.id));
  for (const r of cfg.rubros) {
    const padre = r.parent_id && existe.has(r.parent_id) ? r.parent_id : null;
    if (padre) {
      const l = hijosDe.get(padre) ?? [];
      l.push(r);
      hijosDe.set(padre, l);
    } else {
      raices.push(r);
    }
  }
  const enOrden: Array<{ rubro: RubroLite; nivel: number }> = [];
  const aplanar = (lista: RubroLite[], nivel: number, vistos: Set<string>) => {
    for (const r of lista) {
      if (vistos.has(r.id)) continue;
      vistos.add(r.id);
      enOrden.push({ rubro: r, nivel });
      aplanar(hijosDe.get(r.id) ?? [], nivel + 1, vistos);
    }
  };
  aplanar(raices, 0, new Set<string>());

  const t = busqueda.trim().toLowerCase();
  const visibles = enOrden.filter(({ rubro }) => {
    if (soloFaltan && (porRubro.has(rubro.id) || heredado(rubro.id))) return false;
    return t === "" || rubro.nombre.toLowerCase().includes(t);
  });

  const nombreTipo = (id: string | null) =>
    id == null ? "Cualquier tipo" : (cfg.tipos.find((x) => x.id === id)?.nombre ?? "—");
  const nombreRubro = (id: string | null) =>
    id == null ? "Cualquier rubro" : (cfg.rubros.find((x) => x.id === id)?.nombre ?? "—");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar rubro…"
          className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={soloFaltan} onChange={(e) => setSoloFaltan(e.target.checked)} />
          Solo los que faltan
        </label>
        <span className="ml-auto text-sm">
          {faltan === 0 ? (
            <span className="font-medium text-emerald-700">
              Los {cfg.rubros.length} rubros tienen porcentaje cargado.
            </span>
          ) : (
            <span className="font-medium text-amber-700">
              Faltan {faltan} de {cfg.rubros.length} rubros por cargar.
            </span>
          )}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
            <th className="py-2">Rubro</th>
            <th className="py-2 text-right">%</th>
            <th className="py-2 pl-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cfg.rubros.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-slate-400">
              No hay rubros cargados en el catálogo.
            </td></tr>
          )}
          {cfg.rubros.length > 0 && visibles.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-slate-400">
              Ningún rubro coincide con la búsqueda.
            </td></tr>
          )}
          {visibles.map(({ rubro, nivel }) => {
            const regla = porRubro.get(rubro.id);
            const hereda = regla ? null : heredado(rubro.id);
            const cubierto = !!regla || !!hereda;
            return (
              <tr key={rubro.id} className={cubierto ? "" : "bg-amber-50/40"}>
                <td className="py-2 text-slate-700" style={{ paddingLeft: nivel * 18 }}>
                  {nivel > 0 && <span className="mr-1 text-slate-300">└</span>}
                  {rubro.nombre}
                </td>
                <td className="py-2 text-right">
                  <PctEditable
                    valor={regla ? Number(regla.porcentaje) || 0 : -1}
                    disabled={disabled}
                    permiteVacio
                    etiquetaVacio={hereda ? pct(hereda.pct) : "sin cargar"}
                    onGuardar={(n) => {
                      if (n < 0) {
                        if (regla) onBorrar(regla.id);
                        return;
                      }
                      onGuardar(rubro.id, n, regla?.id);
                    }}
                  />
                </td>
                <td className="py-2 pl-3 text-xs">
                  {regla ? null : hereda ? (
                    <span className="text-slate-500">hereda el {pct(hereda.pct)} de {hereda.de}</span>
                  ) : (
                    <span className="text-amber-700">sin cargar: usa el % base del tipo</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Las reglas que esta pantalla ya no edita, pero que siguen pesando. */}
      {conTipo.length > 0 && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm font-medium text-amber-900">
            Hay {conTipo.length} regla{conTipo.length === 1 ? "" : "s"} vieja
            {conTipo.length === 1 ? "" : "s"} atada{conTipo.length === 1 ? "" : "s"} a un tipo de vendedor.
          </p>
          <p className="mt-0.5 text-xs leading-snug text-amber-800">
            Le ganan a la lista de arriba, porque son más específicas: un vendedor de
            ese tipo comisiona con esto y no con el porcentaje del rubro. Si ya no
            hacen falta, borralas.
          </p>
          <ul className="mt-2 space-y-1">
            {conTipo.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm text-amber-900">
                <span className="tabular-nums font-medium">{pct(Number(r.porcentaje) || 0)}</span>
                <span>· {nombreTipo(r.tipo_vendedor_id)} · {nombreRubro(r.categoria_id)}</span>
                <button
                  onClick={() => onBorrar(r.id)}
                  disabled={disabled}
                  className="ml-auto text-xs text-rose-700 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Un importe en guaraníes que se edita en la tabla, igual que `PctEditable`
 * pero para plata.
 *
 * Vacío devuelve null y NO es cero: en el mínimo de ventas, vacío significa
 * "no tiene uno propio" o "sin mínimo", y un cero cargado a mano significa
 * "esta persona no tiene mínimo que alcanzar". Guardar un cero cuando alguien
 * borró el campo cambiaría el sentido.
 */
function GsEditable({ valor, disabled, etiquetaVacio, onGuardar }: {
  valor: number | null;
  disabled?: boolean;
  etiquetaVacio?: string;
  onGuardar: (nuevo: number | null) => void;
}) {
  const aTexto = (v: number | null) => (v == null ? "" : String(v));
  const [texto, setTexto] = useState(aTexto(valor));
  useEffect(() => { setTexto(aTexto(valor)); }, [valor]);

  return (
    <input
      type="number"
      min={0}
      step="1"
      value={texto}
      disabled={disabled}
      placeholder={etiquetaVacio}
      aria-label="Mínimo de ventas en guaraníes"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto.trim() === "") {
          if (valor == null) return;
          onGuardar(null);
          return;
        }
        const n = Number(texto.replace(/[.,\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) { setTexto(aTexto(valor)); return; }
        if (n === valor) return;
        onGuardar(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-32 rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none disabled:opacity-50"
    />
  );
}

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

/**
 * Alta de un tipo de vendedor, eligiendo el nombre de una lista cerrada.
 *
 * Los tipos que ya existen en la base siguen funcionando aunque no estén en la
 * lista: esto limita lo que se puede CREAR, no lo que hay. Borrar un tipo
 * cargado dejaría sin porcentaje a los vendedores que lo tienen asignado.
 */
function NuevoTipoVendedor({ yaCargados, disabled, onEnviar }: {
  yaCargados: Tipo[];
  disabled?: boolean;
  onEnviar: (nombre: string, porcentajeBase: number) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [pctBase, setPctBase] = useState("");

  const opciones = tiposDisponibles(yaCargados);

  if (opciones.length === 0) {
    return (
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
        Ya están cargados todos los tipos de vendedor previstos.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <select
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
      >
        <option value="">— Tipo de vendedor —</option>
        {opciones.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        type="number" min={0} max={100} step="0.01"
        placeholder="% base"
        value={pctBase}
        onChange={(e) => setPctBase(e.target.value)}
        disabled={disabled}
        className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-sm tabular-nums"
      />
      <button
        type="button"
        // Sin nombre no hay nada que crear. El % base puede quedar en cero: es
        // un valor real (el que no comisiona si ninguna regla aplica).
        disabled={disabled || nombre === ""}
        onClick={() => {
          onEnviar(nombre, Number(pctBase) || 0);
          setNombre("");
          setPctBase("");
        }}
        className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
      >
        Agregar tipo
      </button>
    </div>
  );
}



/* ──────────────────── Resumen de un vendedor, en pantalla ───────────────── */
/**
 * Antes el único detalle de un vendedor era la hoja para firmar, que se abre
 * como documento imprimible. Para una pregunta rápida —"¿de qué ventas salen
 * estos 7.868?"— eso es mucho: hay que abrir una pestaña nueva, leer una hoja
 * armada para papel y volver.
 *
 * Las ventas ya vienen con el informe, así que esto no pide nada al servidor:
 * filtra las del vendedor y las muestra. La hoja sigue estando, acá adentro,
 * para cuando de verdad hay que firmarla.
 */
function ResumenVendedorModal({
  vendedor, ventas, desde, hasta, baseCalculo, onClose,
}: {
  vendedor: Vendedor;
  ventas: VentaCom[];
  desde: string;
  hasta: string;
  baseCalculo: "margen" | "facturacion";
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{vendedor.vendedor_nombre}</h2>
            <p className="text-sm text-slate-500">
              {vendedor.tipo_vendedor ?? "Sin tipo"} · del {fechaCorta(desde)} al {fechaCorta(hasta)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {vendedor.vendedor_id && (
              <a
                href={`/api/comisiones/hoja?vendedor=${vendedor.vendedor_id}&desde=${desde}&hasta=${hasta}&auto=1`}
                target="_blank" rel="noopener"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
              >
                Hoja para firmar
              </a>
            )}
            <button
              type="button" onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-5">
          <Tarjeta label="Operaciones" valor={String(vendedor.operaciones)} />
          <Tarjeta label="Vendido (sin IVA)" valor={gs(vendedor.facturado)} />
          <Tarjeta label="Descuentos" valor={gs(vendedor.descuento)} tono="ambar" />
          <Tarjeta label="Ganancia" valor={gs(vendedor.ganancia)} sub={`Margen ${pct(vendedor.margen_pct)}`} />
          <Tarjeta label="Comisión" valor={gs(vendedor.comision)} destacado />
        </div>

        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Comprobante</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Vendido</th>
                <th className="px-3 py-2 text-right">Desc.</th>
                <th className="px-3 py-2 text-right">Ganancia</th>
                <th className="px-3 py-2 text-right">Comisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ventas.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Sin ventas en el período.</td></tr>
              ) : ventas.map((v) => (
                <tr key={v.venta_id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{v.numero_control}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fechaCorta(v.fecha)}</td>
                  <td className="px-3 py-2 text-slate-700">{v.cliente_nombre ?? "Consumidor final"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{gs(v.facturado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">{v.descuento > 0 ? gs(v.descuento) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{gs(v.ganancia)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-[#3F8E91]">{gs(v.comision)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-snug text-slate-400">
            {baseCalculo === "facturacion"
              ? "La comisión se calcula sobre el importe vendido sin IVA."
              : "La comisión se calcula sobre la ganancia de cada venta. Las ventas anuladas no entran."}
          </p>
        </div>
      </div>
    </div>
  );
}
