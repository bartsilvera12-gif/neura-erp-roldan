"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import Selector from "@/components/ui/Selector";

/**
 * Punto de equilibrio: cuánto hay que vender para cubrir los gastos.
 *
 * Toma el mes anterior como referencia —su margen y sus gastos— y contesta
 * cuánto hay que facturar este mes para que la ganancia bruta los cubra. De
 * ahí en adelante, se gana.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Resp = {
  periodo: { anio: number; mes: number; dias: number; dia_hoy: number; en_curso: boolean };
  base: {
    anio: number; mes: number; ventas: number; ventas_netas: number; cmv: number;
    lineas: number; lineas_sin_costo: number;
    gastos: number; gastos_modulo: number; gastos_caja: number; margen_pct: number | null;
    margen: {
      vendido: number; costo: number; diferencia: number;
      iva_debito: number; iva_credito: number; diferencia_iva: number; margen: number; margen_pct: number | null;
    };
  };
  costo_estimado: boolean;
  supuestos: { margen_pct: number | null; gastos: number; margen_editado: boolean; gastos_editados: boolean };
  resultado: { ventas_necesarias: number | null; motivo?: string; margen_pct: number | null; gastos: number };
  actual: { ventas: number; ventas_netas: number; vendido: number; cmv: number };
  avance: { pct: number; faltante: number; cubierto: boolean; dia_estimado: number | null; ritmo_diario: number } | null;
};

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

export default function PuntoEquilibrioPage() {
  const hoy = new Date(Date.now() - 3 * 3_600_000);
  const [anio, setAnio] = useState(hoy.getUTCFullYear());
  const [mes, setMes] = useState(hoy.getUTCMonth() + 1);
  const [margen, setMargen] = useState("");
  const [gastos, setGastos] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const p = new URLSearchParams({ anio: String(anio), mes: String(mes) });
      if (margen.trim()) p.set("margen", margen.trim());
      if (gastos.trim()) p.set("gastos", gastos.trim());
      const r = await fetchWithSupabaseSession(`/api/contabilidad/punto-equilibrio?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo calcular.");
      setData(j.data as Resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [anio, mes, margen, gastos]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), margen || gastos ? 400 : 0);
    return () => clearTimeout(t);
  }, [cargar, margen, gastos]);

  const d = data;
  const objetivo = d?.resultado.ventas_necesarias ?? null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Contabilidad"
        title="Punto de equilibrio"
        description="Cuánto hay que vender este mes para cubrir los gastos. De ahí en adelante, se gana"
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Mes</span>
          <Selector
            value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Selector>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Año</span>
          <input
            type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value) || anio)}
            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Calculando…</p>
      ) : !d ? null : (
        <>
          {/* ── El número ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            {objetivo == null ? (
              <SinResultado motivo={d.resultado.motivo} margen={d.resultado.margen_pct} />
            ) : (
              <>
                <p className="text-[11px] font-medium text-slate-500">
                  Hay que vender en {MESES[d.periodo.mes - 1]}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">Gs. {gs(objetivo)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  facturado (con IVA), con {pct(d.supuestos.margen_pct)} de margen y Gs. {gs(d.supuestos.gastos)} de gastos
                </p>

                {d.avance && (
                  <div className="mt-4">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${d.avance.cubierto ? "bg-emerald-500" : "bg-[#4FAEB2]"}`}
                        style={{ width: `${Math.min(100, Math.max(0, d.avance.pct))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-sm text-slate-700">
                      {d.avance.cubierto ? (
                        <>
                          <strong className="text-emerald-700">Gastos cubiertos.</strong>{" "}
                          Se llegó {d.avance.dia_estimado ? <>alrededor del <strong>día {d.avance.dia_estimado}</strong></> : "este mes"}, y
                          lo vendido desde ahí —Gs. {gs(d.actual.vendido - objetivo)}— va a ganancia.
                        </>
                      ) : (
                        <>
                          Van <strong>Gs. {gs(d.actual.vendido)}</strong> de los Gs. {gs(objetivo)}{" "}
                          ({d.avance.pct.toFixed(0)}%). Faltan <strong>Gs. {gs(d.avance.faltante)}</strong>.
                          {d.periodo.en_curso && d.avance.dia_estimado && (
                            <> Al ritmo de ahora se llega cerca del <strong>día {d.avance.dia_estimado}</strong>.</>
                          )}
                          {d.periodo.en_curso && !d.avance.dia_estimado && d.avance.ritmo_diario > 0 && (
                            <> Al ritmo de ahora <strong>no se llega</strong> dentro del mes.</>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── De dónde salen los supuestos ────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-800">
              De dónde sale: {MESES[d.base.mes - 1]} {d.base.anio}
            </h2>
            <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_auto]">
              {/* El margen, renglón por renglón, con la fórmula del cliente:
                  vendido − costo de venta − diferencia de IVA. */}
              <table className="w-full max-w-lg text-sm">
                <tbody className="tabular-nums">
                  <tr>
                    <td className="py-1 text-slate-600">Lo vendido <span className="text-[11px] text-slate-400">({d.base.ventas} ventas, con IVA)</span></td>
                    <td className="py-1 text-right font-medium text-slate-900">Gs. {gs(d.base.margen.vendido)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-600">− Costo de venta <span className="text-[11px] text-slate-400">(con IVA, estimado)</span></td>
                    <td className="py-1 text-right text-slate-700">− Gs. {gs(d.base.margen.costo)}</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-1 font-medium text-slate-700">= Diferencia</td>
                    <td className="py-1 text-right font-medium text-slate-900">Gs. {gs(d.base.margen.diferencia)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-600">
                      − Diferencia de IVA
                      <span className="block text-[11px] text-slate-400">
                        IVA de las ventas {gs(d.base.margen.iva_debito)} − IVA del costo {gs(d.base.margen.iva_credito)}
                      </span>
                    </td>
                    <td className="py-1 text-right align-top text-slate-700">− Gs. {gs(d.base.margen.diferencia_iva)}</td>
                  </tr>
                  <tr className="border-t-2 border-slate-800">
                    <td className="py-1.5 font-semibold text-slate-900">= Margen</td>
                    <td className="py-1.5 text-right font-bold text-slate-900">
                      Gs. {gs(d.base.margen.margen)} <span className="ml-1 text-sm font-semibold text-[#3F8E91]">{pct(d.base.margen_pct)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="grid content-start gap-3 text-sm">
                <Dato
                  t="Gastos" v={`Gs. ${gs(d.base.gastos)}`}
                  s={`caja ${gs(d.base.gastos_caja)} · módulo ${gs(d.base.gastos_modulo)}`}
                />
              </div>
            </div>

            {/* El margen es el número del que cuelga todo: si baja a la mitad,
                el objetivo se duplica. Por eso se puede cambiar. */}
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              <p className="w-full text-[11px] leading-snug text-slate-500">
                Si el mes pasado tuvo algo fuera de lo común —un gasto extraordinario, una venta
                atípica— cambiá el supuesto y el objetivo se recalcula.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">
                  Margen a usar (%)
                </span>
                <input
                  type="number" step="0.1" value={margen} onChange={(e) => setMargen(e.target.value)}
                  placeholder={d.base.margen_pct != null ? d.base.margen_pct.toFixed(1) : "—"}
                  className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">
                  Gastos a cubrir
                </span>
                <input
                  type="number" value={gastos} onChange={(e) => setGastos(e.target.value)}
                  placeholder={String(Math.round(d.base.gastos))}
                  className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </label>
              {(margen || gastos) && (
                <button
                  type="button" onClick={() => { setMargen(""); setGastos(""); }}
                  className="pb-2 text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
                >
                  Volver a los del mes pasado
                </button>
              )}
            </div>
          </div>

          {/* El aviso va SIEMPRE, no solo cuando falla: quien lee el número
              tiene que saber que el costo es estimado. */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            <strong>El costo es una estimación.</strong> El sistema no guarda cuánto costó cada
            artículo al momento de venderlo —la migración no trajo esos movimientos— así que el costo
            de lo vendido se calcula con el <strong>costo promedio de hoy</strong>. Para el mes pasado
            es razonable; para meses viejos, cada vez menos. Si el margen que ves no es el que
            conocés, cambialo arriba: todo el objetivo cuelga de ese número.
            {d.base.lineas_sin_costo > 0 && (
              <> Además, <strong>{d.base.lineas_sin_costo}</strong> de {d.base.lineas} líneas no
              tienen costo cargado y quedaron fuera del cálculo, así que el margen sale más alto de
              lo real.</>
            )}
          </div>

          <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-500">
            <p>
              <strong>El margen:</strong> lo vendido − el costo de venta, y a esa diferencia se le
              resta la diferencia de IVA (el IVA cobrado en las ventas menos el IVA pagado en la
              mercadería vendida), que es lo que se va al fisco y no es ganancia. El porcentaje es
              sobre lo vendido.
            </p>
            <p>
              <strong>La cuenta:</strong> hay que facturar = gastos ÷ margen. Con 20% de margen y
              Gs. 20 de gastos hay que facturar Gs. 100: de esos 100, 20 quedan de margen, que es
              justo lo que se va en gastos. El objetivo y lo que se lleva vendido van <strong>con
              IVA</strong>, como se factura.
            </p>
            <p>
              Los <strong>gastos</strong> son los del módulo de Gastos más los egresos de caja, sin
              los pagos a proveedores: esa plata es el costo de la mercadería y ya está contada del
              otro lado.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Dato({ t, v, s }: { t: string; v: string; s: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-500">{t}</p>
      <p className="font-bold tabular-nums text-slate-900">{v}</p>
      <p className="text-[11px] text-slate-400">{s}</p>
    </div>
  );
}

/**
 * Cuando no hay número, se dice por qué y qué hacer. Un "—" sin explicación
 * manda a adivinar si falta un dato o si el sistema se rompió.
 */
function SinResultado({ motivo, margen }: { motivo?: string; margen: number | null }) {
  if (motivo === "margen_negativo") {
    return (
      <div>
        <p className="text-sm font-semibold text-rose-700">No hay punto de equilibrio</p>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          El mes pasado se vendió <strong>por debajo del costo</strong> ({pct(margen)} de margen).
          Vender más agranda la pérdida en vez de achicarla, así que no existe un monto que cubra
          los gastos. Antes de proyectar hay que revisar los precios o los costos cargados.
        </p>
      </div>
    );
  }
  if (motivo === "sin_gastos") {
    return (
      <div>
        <p className="text-sm font-semibold text-amber-700">Faltan los gastos del mes pasado</p>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Sin gastos cargados el objetivo daría cero, que parece una buena noticia y solo significa
          que falta el dato. Cargalos en Gastos o en los egresos de caja, o escribilos abajo.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm font-semibold text-amber-700">No se puede calcular el margen</p>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        El mes pasado no tiene ventas con costo cargado, así que no hay margen del que partir.
        Escribí abajo el que usás y el objetivo se calcula igual.
      </p>
    </div>
  );
}
