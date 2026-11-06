"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import AccionesTabla from "@/components/ui/AccionesTabla";
import Selector from "@/components/ui/Selector";
import { Metrica, FilaDeMetricas } from "@/components/ui/Metrica";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ChevronDown, ChevronRight, Info, Search } from "lucide-react";

/**
 * Aguinaldo: lo cobrado en el año ÷ 12, por empleado.
 *
 * Mes por mes se ve de dónde sale cada número: el recibo (salario real) o,
 * si ese mes no tiene recibo, el salario de la ficha menos las ausencias.
 * Los reposos, permisos y demás ausencias bajan el aguinaldo; las
 * vacaciones no, porque son pagas.
 */

type Mes = { mes: string; fuente: "recibo" | "estimado" | "fuera"; dias_ausencia: number; dias_pagados: number; monto: number };
type Fila = {
  empleado_id: string;
  nombre: string;
  cargo: string | null;
  codigo: string | null;
  tipo_periodo: string;
  salario_base: number;
  meses: Mes[];
  total_cobrado: number;
  aguinaldo: number;
  dias_ausencia: number;
};

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export default function AguinaldoPage() {
  const hoy = new Date(Date.now() - 3 * 3_600_000);
  const [anio, setAnio] = useState(hoy.getUTCFullYear());
  /** "proyeccion" = todo el año (los meses que faltan, estimados); "a_hoy" = hasta el mes actual. */
  const [alcance, setAlcance] = useState<"proyeccion" | "a_hoy">("proyeccion");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const esAnioActual = anio === hoy.getUTCFullYear();
  const hastaMes = esAnioActual && alcance === "a_hoy" ? hoy.getUTCMonth() + 1 : 12;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/rrhh/aguinaldo?anio=${anio}&hasta_mes=${hastaMes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setFilas((j.data?.empleados ?? []) as Fila[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [anio, hastaMes]);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? filas.filter((f) => `${f.nombre} ${f.cargo ?? ""} ${f.codigo ?? ""}`.toLowerCase().includes(s)) : filas;
  }, [filas, q]);

  const total = visibles.reduce((s, f) => s + f.aguinaldo, 0);
  const conAusencias = visibles.filter((f) => f.dias_ausencia > 0).length;
  const mesesEstimados = visibles.reduce((s, f) => s + f.meses.filter((m) => m.fuente === "estimado").length, 0);

  function alternar(id: string) {
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const anios = [hoy.getUTCFullYear(), hoy.getUTCFullYear() - 1, hoy.getUTCFullYear() - 2];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RRHH"
        title="Aguinaldo"
        description="Lo cobrado en el año ÷ 12. Los reposos, permisos y demás ausencias lo bajan; las vacaciones no."
        backHref="/rrhh/nomina/recibos"
        backLabel="Salarios"
      />

      <FilaDeMetricas>
        <Metrica etiqueta={`Aguinaldo ${anio}`} valor={gs(total)} detalle={`${visibles.length} empleados`} cargando={cargando} />
        <Metrica etiqueta="Con ausencias que descuentan" valor={conAusencias}
          detalle="reposo, permiso u otras" cargando={cargando} />
        <Metrica etiqueta="Meses estimados" valor={mesesEstimados} tono={mesesEstimados ? "pendiente" : undefined}
          detalle="sin recibo: salario de la ficha − ausencias" cargando={cargando} />
      </FilaDeMetricas>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Año</span>
          <Selector value={String(anio)} onChange={(e) => setAnio(Number(e.target.value))} className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector>
        </label>
        {esAnioActual && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Calcular</span>
            <Selector value={alcance} onChange={(e) => setAlcance(e.target.value as "proyeccion" | "a_hoy")} className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="proyeccion">Todo el año (proyección a diciembre)</option>
              <option value="a_hoy">Lo acumulado hasta {MESES_LARGOS[hoy.getUTCMonth()]}</option>
            </Selector>
          </label>
        )}
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Buscar</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, cargo o código…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
          </span>
        </label>
        <AccionesTabla
          titulo={`Aguinaldo ${anio}`}
          archivo={`aguinaldo-${anio}`}
          subtitulo={hastaMes < 12 ? `Acumulado hasta ${MESES_LARGOS[hastaMes - 1]}` : "Año completo"}
          columnas={["Código", "Empleado", "Cargo", ...MESES.slice(0, hastaMes), "Días de ausencia", "Total cobrado", "Aguinaldo"]}
          filas={visibles.map((f) => [
            f.codigo ?? "", f.nombre, f.cargo ?? "",
            ...f.meses.map((m) => m.monto),
            f.dias_ausencia, f.total_cobrado, f.aguinaldo,
          ])}
          sumar={[3 + hastaMes + 1, 3 + hastaMes + 2]}
        />
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-semibold">Empleado</th>
                <th className="px-3 py-2.5 font-semibold">Meses</th>
                <th className="px-3 py-2.5 text-right font-semibold">Días de ausencia</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total cobrado</th>
                <th className="px-3 py-2.5 text-right font-semibold">Aguinaldo</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-500">Calculando…</td></tr>
              ) : visibles.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-500">No hay empleados para ese año.</td></tr>
              ) : visibles.map((f) => {
                const abierto = abiertos.has(f.empleado_id);
                return (
                  <Fragment key={f.empleado_id}>
                    <tr onClick={() => alternar(f.empleado_id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-3 text-slate-400">{abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-slate-900">{f.nombre}</span>
                        <span className="block text-xs text-slate-500">
                          {[f.codigo ? `Código ${f.codigo}` : null, f.cargo, f.tipo_periodo === "jornal" ? "Jornalero" : "Mensualero"].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {/* Un cuadradito por mes: lleno = recibo, rayado = estimado, vacío = no estaba. */}
                        <span className="flex gap-0.5">
                          {f.meses.map((m, i) => (
                            <span key={m.mes} title={`${MESES_LARGOS[i]}: ${m.fuente === "recibo" ? "recibo" : m.fuente === "estimado" ? "estimado" : "no estaba en la empresa"} · ${gs(m.monto)}${m.dias_ausencia ? ` · ${m.dias_ausencia} días de ausencia` : ""}`}
                              className={`h-4 w-3 rounded-sm ${
                                m.fuente === "fuera" ? "bg-slate-100"
                                : m.dias_ausencia > 0 ? "bg-amber-400"
                                : m.fuente === "recibo" ? "bg-[#4FAEB2]" : "bg-[#4FAEB2]/35"
                              }`} />
                          ))}
                        </span>
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums ${f.dias_ausencia ? "font-medium text-amber-700" : "text-slate-400"}`}>{f.dias_ausencia || "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700">{gs(f.total_cobrado)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{gs(f.aguinaldo)}</td>
                    </tr>
                    {abierto && (
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <td />
                        <td colSpan={5} className="px-3 py-3">
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                            {f.meses.map((m, i) => (
                              <div key={m.mes} className={`rounded-lg border px-3 py-2 ${m.fuente === "fuera" ? "border-slate-100 bg-white/50 text-slate-400" : "border-slate-200 bg-white"}`}>
                                <p className="flex items-center justify-between text-[11px] font-semibold uppercase text-slate-500">
                                  {MESES[i]}
                                  <span className={`font-medium normal-case ${m.fuente === "recibo" ? "text-[#3F8E91]" : "text-slate-400"}`}>
                                    {m.fuente === "recibo" ? "recibo" : m.fuente === "estimado" ? "estimado" : "—"}
                                  </span>
                                </p>
                                <p className="text-sm font-semibold tabular-nums text-slate-800">{gs(m.monto)}</p>
                                {m.dias_ausencia > 0 && (
                                  <p className="text-[11px] text-amber-700">− {m.dias_ausencia} {m.dias_ausencia === 1 ? "día" : "días"} de ausencia</p>
                                )}
                              </div>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {gs(f.total_cobrado)} ÷ 12 = <strong className="text-slate-800">{gs(f.aguinaldo)}</strong>
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          El aguinaldo es la doceava parte de lo cobrado en el año (Código del Trabajo, art. 243) y se paga
          hasta el 31 de diciembre. Cada mes se toma del <strong>recibo de salario</strong>; si ese mes todavía no
          tiene recibo, se estima con el salario de la ficha <strong>menos los días de reposo, permiso y otras
          ausencias</strong> cargadas en Feriados y ausencias. Las vacaciones no descuentan. Los recibos nuevos ya
          descuentan esos días solos.
        </p>
      </div>
    </div>
  );
}
