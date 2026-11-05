"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { monedaDeLasFacturas, revisarCheque } from "@/lib/flujo-caja/coherencia-cheque";
import type {
  CobranzaProyectada, DiagnosticoFlujo, EntradaFlujo, FilaFlujo, FlujoCajaMes, SaldoLiquidez, TipoSaldo,
} from "@/lib/flujo-caja/types";

import { X } from "lucide-react";
import Selector from "@/components/ui/Selector";

/**
 * Flujo de caja de proveedores.
 *
 * Replica la planilla que se llevaba a mano: una fila por proveedor, una
 * columna por día del mes, y el color de cada celda según el estado del cheque.
 * Lo que antes iba en los comentarios de Excel (nº de factura, nº de carga,
 * nº de cheque y fecha de cobro) ahora sale de los datos y se arma solo.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Los tres colores de la planilla, más el gris de lo ya cobrado. */
const TONO: Record<string, string> = {
  pendiente_emision: "bg-violet-100 text-violet-900 ring-violet-300",
  emitido:           "bg-emerald-100 text-emerald-900 ring-emerald-300",
  cobrado:           "bg-amber-100 text-amber-900 ring-amber-300",
  anulado:           "bg-slate-100 text-slate-400 ring-slate-200 line-through",
};
const ETIQUETA: Record<string, string> = {
  pendiente_emision: "Cheque pendiente de emisión",
  emitido:           "Cheque emitido, sin cobrar",
  cobrado:           "Cheque cobrado — no suma al flujo",
  anulado:           "Anulado",
};

/**
 * Quién paga ese día, para el tooltip de la celda de cobranzas.
 *
 * El número solo no sirve para decidir nada: "entran 4.300.000 el martes" se
 * actúa distinto según sean cuarenta clientes o uno que ya debe.
 */
function tooltipCobranzas(cobranzas?: CobranzaProyectada[]): string | undefined {
  if (!cobranzas || cobranzas.length === 0) return undefined;
  const lineas = cobranzas
    .slice(0, 12)
    .map((c) => {
      const venta = c.numero_venta ? ` (${c.numero_venta})` : "";
      const parcial = c.estado === "parcial" ? " · cobro parcial" : "";
      return `${c.cliente_nombre}${venta}: ${c.moneda === "USD" ? "US$ " : ""}${miles(c.saldo)}${parcial}`;
    });
  if (cobranzas.length > 12) lineas.push(`…y ${cobranzas.length - 12} más`);
  return lineas.join("\n");
}

function miles(v: number, decimales = 0): string {
  return v.toLocaleString("es-PY", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}
function importeDe(e: EntradaFlujo): string {
  return e.moneda === "USD" ? `US$ ${miles(e.importe, 2)}` : miles(e.importe);
}

/** El comentario de la celda: lo mismo que anotaban en Excel, ya armado. */
function tooltipDe(e: EntradaFlujo): string {
  const l: string[] = [];
  if (e.facturas.length > 1) {
    l.push(`Cubre ${e.facturas.length} facturas:`);
    for (const f of e.facturas) {
      l.push(`  · ${f.numero_factura ?? "s/nº"}  (${f.numero_control})`);
    }
  } else {
    const f = e.facturas[0];
    if (f) l.push(`Factura ${f.numero_factura ?? "s/nº"}   ·   Carga ${f.numero_control}`);
  }
  if (e.numero_cheque) l.push(`Cheque Nº ${e.numero_cheque}${e.banco_nombre ? ` — ${e.banco_nombre}` : ""}`);
  else l.push("Sin cheque emitido");
  if (e.fecha_emision) l.push(`Emitido: ${e.fecha_emision}`);
  if (e.fecha_cobro) l.push(`Cobro: ${e.fecha_cobro}`);
  if (e.observacion) l.push(e.observacion);
  l.push(ETIQUETA[e.estado] ?? e.estado);
  return l.join("\n");
}

export default function FlujoCajaPage() {
  const ahora = new Date();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [data, setData] = useState<FlujoCajaMes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config editable del mes.
  const [tc, setTc] = useState("");
  const [fondos, setFondos] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Panel de la celda: emitir cheques y cambiar su estado.
  const [celda, setCelda] = useState<{ dia: number; fila: FilaFlujo } | null>(null);
  const [bancos, setBancos] = useState<{ id: string; nombre: string }[]>([]);

  // Posición de liquidez: bancos, efectivo y mercadería. Carga manual.
  const [saldos, setSaldos] = useState<SaldoLiquidez[]>([]);
  const [editandoSaldos, setEditandoSaldos] = useState(false);
  const [trayendoMercaderia, setTrayendoMercaderia] = useState(false);
  const [errorMercaderia, setErrorMercaderia] = useState<string | null>(null);
  const [guardandoSaldos, setGuardandoSaldos] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/flujo-caja?anio=${anio}&mes=${mes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const d = j.data as FlujoCajaMes;
      setData(d);
      setTc(d.config.tipo_cambio ? String(d.config.tipo_cambio) : "");
      setFondos(d.config.fondos_disponibles ? String(d.config.fondos_disponibles) : "");
      setSaldos(d.liquidez.detalle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el flujo.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [anio, mes]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Bancos para el desplegable al emitir un cheque.
  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/entidades-bancarias", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        setBancos(
          ((j.data?.entidades ?? []) as Array<{ id: string; nombre: string }>)
            .map((e) => ({ id: String(e.id), nombre: String(e.nombre ?? "") }))
        );
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  async function guardarConfig() {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/flujo-caja", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anio, mes,
          tipo_cambio: Number(tc) || 0,
          fondos_disponibles: Number(fondos) || 0,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarSaldos() {
    setGuardandoSaldos(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/flujo-caja/saldos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anio, mes, saldos }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setEditandoSaldos(false);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los saldos.");
    } finally {
      setGuardandoSaldos(false);
    }
  }

  function agregarSaldo(tipo: TipoSaldo) {
    setSaldos((prev) => [...prev, { tipo, descripcion: "", moneda: "PYG", importe: 0 }]);
    setEditandoSaldos(true);
  }

  /**
   * Trae el valor de la mercadería del propio inventario, un renglón por
   * depósito, en vez de tipearlo.
   *
   * Reemplaza las filas de mercadería que haya, no las suma: si se aprieta dos
   * veces, el valor quedaría duplicado y nadie lo notaría mirando el total.
   *
   * Lo que no está asignado a ningún depósito entra en su propio renglón, con
   * ese nombre. No se reparte ni se manda al principal: sería inventar una
   * ubicación, y encima hoy es casi todo el inventario, porque la migración
   * nunca escribió el stock por depósito (lo arregla el script 66).
   */
  async function traerMercaderia() {
    setTrayendoMercaderia(true);
    setErrorMercaderia(null);
    try {
      const r = await fetchWithSupabaseSession("/api/inventario/valor-por-deposito", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo valorizar la mercadería.");
      const d = j.data as {
        depositos: { nombre: string; sucursal_nombre: string; es_central: boolean; valor_gs: number }[];
        sin_ubicar: { valor_gs: number; articulos: number };
        valor_total_gs: number;
      };

      const filas: SaldoLiquidez[] = d.depositos
        .filter((x) => x.valor_gs > 0)
        .map((x) => ({
          tipo: "mercaderia" as TipoSaldo,
          descripcion: `${x.nombre}${x.sucursal_nombre && x.sucursal_nombre !== "—" ? ` · ${x.sucursal_nombre}` : ""}`,
          moneda: "PYG" as const,
          importe: Math.round(x.valor_gs),
        }));
      if (d.sin_ubicar.valor_gs > 0) {
        filas.push({
          tipo: "mercaderia",
          descripcion: `Sin depósito asignado (${d.sin_ubicar.articulos} art.)`,
          moneda: "PYG",
          importe: Math.round(d.sin_ubicar.valor_gs),
        });
      }
      if (filas.length === 0) {
        setErrorMercaderia("No hay stock valorizado: o no hay existencias, o los artículos no tienen costo cargado.");
        return;
      }
      setSaldos((prev) => [...prev.filter((x) => x.tipo !== "mercaderia"), ...filas]);
      setEditandoSaldos(true);
    } catch (e) {
      setErrorMercaderia(e instanceof Error ? e.message : "No se pudo valorizar la mercadería.");
    } finally {
      setTrayendoMercaderia(false);
    }
  }

  /**
   * Un mes son 31 columnas y casi todas quedan vacías, así que por defecto se
   * muestran solo los días con pagos. El mes completo sigue a un clic, para
   * cuando hace falta ver la planilla entera como en el Excel de Joaquín.
   */
  const [mesCompleto, setMesCompleto] = useState(false);

  const todosLosDias = useMemo(
    () => Array.from({ length: data?.dias ?? 0 }, (_, i) => i + 1),
    [data?.dias]
  );

  const diasConPagos = useMemo(
    () => todosLosDias.filter((d) => (data?.filas ?? []).some((f) => (f.dias[d] ?? []).length > 0)),
    [todosLosDias, data?.filas]
  );

  const dias = mesCompleto || diasConPagos.length === 0 ? todosLosDias : diasConPagos;
  const ocultos = todosLosDias.length - dias.length;

  // Pistas visuales para no perderse entre 31 columnas iguales: la inicial del
  // día de la semana, el fin de semana apagado y la columna de hoy marcada.
  const LETRAS = ["D", "L", "M", "M", "J", "V", "S"];
  const diaSemana = (d: number) => new Date(Date.UTC(anio, mes - 1, d)).getUTCDay();
  const letraDia = (d: number) => LETRAS[diaSemana(d)];
  const esFinde = (d: number) => diaSemana(d) === 0 || diaSemana(d) === 6;

  const hoy = new Date();
  const esHoy = (d: number) =>
    d === hoy.getDate() && mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Tesorería"
        title="Flujo de caja"
        description="Pagos a proveedores por día, con el estado de cada cheque."
      />

      {/* Período y parámetros del mes */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mes</span>
          <Selector
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Selector>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Año</span>
          <input
            type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Tipo de cambio
          </span>
          <input
            type="number" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="6.400"
            className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Fondos disponibles (Gs.)
          </span>
          <input
            type="number" value={fondos} onChange={(e) => setFondos(e.target.value)} placeholder="0"
            className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <button
          type="button" onClick={guardarConfig} disabled={guardando}
          className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <p className="ml-auto max-w-xs text-[11px] leading-snug text-slate-500">
          El tipo de cambio lo fija la empresa: suele ir por encima del real para
          dejar colchón ante subas del dólar.
        </p>
      </div>

      {/* Posición de liquidez — informativa: la foto sobre la que se apoya el flujo.
          No alimenta la proyección de pagos; solo aporta los fondos iniciales. */}
      {data && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4FAEB2]">
                Posición de liquidez
              </p>
              <p className="text-[11px] text-slate-500">
                Bancos, efectivo y mercadería. Se cargan a mano: el ERP no tiene conciliación bancaria.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {editandoSaldos ? (
                <>
                  <button
                    type="button" onClick={() => { setEditandoSaldos(false); void cargar(); }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button" onClick={guardarSaldos} disabled={guardandoSaldos}
                    className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                  >
                    {guardandoSaldos ? "Guardando…" : "Guardar saldos"}
                  </button>
                </>
              ) : (
                <button
                  type="button" onClick={() => setEditandoSaldos(true)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Editar
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {(["banco", "efectivo", "mercaderia"] as const).map((tipo) => {
              const delTipo = saldos
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.tipo === tipo);
              const titulo = tipo === "banco" ? "Bancos" : tipo === "efectivo" ? "Efectivo en caja" : "Mercadería";
              return (
                <div key={tipo} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">{titulo}</span>
                    <span className="flex items-center gap-2">
                      {/* La mercadería no se tipea: sale del inventario, que ya
                          sabe cuántas unidades hay y cuánto costó cada una. */}
                      {tipo === "mercaderia" && editandoSaldos && (
                        <button
                          type="button" onClick={() => void traerMercaderia()}
                          disabled={trayendoMercaderia}
                          className="text-[11px] font-semibold text-[#3F8E91] hover:underline disabled:opacity-50"
                          title="Valoriza el stock al costo promedio y lo separa por depósito"
                        >
                          {trayendoMercaderia ? "Calculando…" : "Traer del inventario"}
                        </button>
                      )}
                      {editandoSaldos && (
                        <button
                          type="button" onClick={() => agregarSaldo(tipo)}
                          className="text-[11px] font-semibold text-[#3F8E91] hover:underline"
                        >
                          + Agregar
                        </button>
                      )}
                    </span>
                  </div>
                  {tipo === "mercaderia" && errorMercaderia && (
                    <p className="mb-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-snug text-rose-800">
                      {errorMercaderia}
                    </p>
                  )}
                  {delTipo.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Sin cargar</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {delTipo.map(({ s, i }) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs">
                          {editandoSaldos ? (
                            <>
                              <input
                                value={s.descripcion}
                                placeholder={tipo === "banco" ? "Banco" : tipo === "efectivo" ? "Caja" : "Depósito"}
                                onChange={(e) => setSaldos((prev) => prev.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-xs"
                              />
                              <Selector
                                value={s.moneda}
                                onChange={(e) => setSaldos((prev) => prev.map((x, j) => j === i ? { ...x, moneda: e.target.value === "USD" ? "USD" : "PYG" } : x))}
                                className="rounded border border-slate-200 px-1 py-1 text-xs"
                              >
                                <option value="PYG">Gs.</option>
                                <option value="USD">US$</option>
                              </Selector>
                              <input
                                type="number" value={s.importe}
                                onChange={(e) => setSaldos((prev) => prev.map((x, j) => j === i ? { ...x, importe: Number(e.target.value) || 0 } : x))}
                                className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right text-xs tabular-nums"
                              />
                              <button
                                type="button" onClick={() => setSaldos((prev) => prev.filter((_, j) => j !== i))}
                                className="text-slate-400 hover:text-red-600" title="Quitar"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate text-slate-600">{s.descripcion}</span>
                              <span className="tabular-nums font-medium text-slate-800">
                                {s.moneda === "USD" ? `US$ ${miles(s.importe, 2)}` : miles(s.importe)}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-xs">
            <span className="text-slate-600">
              Disponible al inicio:{" "}
              <strong className="tabular-nums text-slate-900">Gs. {miles(data.liquidez.total_gs)}</strong>
            </span>
            {data.liquidez.mercaderia_gs > 0 && (
              <span className="text-slate-500">
                Mercadería:{" "}
                <strong className="tabular-nums">Gs. {miles(data.liquidez.mercaderia_gs)}</strong>
                <span className="ml-1 text-slate-400">(no es plata disponible)</span>
              </span>
            )}
            <span className="ml-auto text-[11px] text-slate-400">
              {data.liquidez.origen === "saldos"
                ? "Los fondos del flujo salen de bancos + efectivo."
                : "Sin saldos cargados: se usa el monto manual de arriba."}
            </span>
          </div>
        </div>
      )}

      {/* Leyenda de colores */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {(["pendiente_emision", "emitido", "cobrado"] as const).map((k) => (
          <span key={k} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ${TONO[k]}`}>
            {ETIQUETA[k]}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <p className="py-16 text-center text-sm text-slate-400">Cargando…</p>
      ) : !data || data.filas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">No hay pagos proyectados en {MESES[mes - 1]} {anio}</p>
          <VacioExplicado diag={data?.diagnostico} anio={anio} mes={mes} onIr={(a, m) => { setAnio(a); setMes(m); }} />
        </div>
      ) : (
        <>
        {data.liquidez.origen === "sin_datos" && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            No hay fondos cargados en este mes ni en los doce anteriores, así que{" "}
            <strong>Disponible</strong> arranca en cero y cualquier pago lo deja en rojo. Ese rojo no
            es una deuda: es que falta el dato. Escribilos arriba en “Fondos disponibles” y apretá
            Guardar, o cargá la posición de liquidez.
          </div>
        )}
        {data.liquidez.origen === "arrastre" && data.liquidez.arrastre_de && (
          <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            Este mes no tiene fondos propios cargados, así que abre con{" "}
            <strong>{miles(data.liquidez.total_gs)} Gs.</strong>, que es el Disponible con que cerró{" "}
            {MESES[data.liquidez.arrastre_de.mes - 1]} {data.liquidez.arrastre_de.anio}. Es una
            proyección, no un saldo de banco: si querés que arranque del dinero real, cargá la
            posición de liquidez de este mes y manda ella.
          </div>
        )}
        {data.resumen.cobranzas_vencidas_gs > 0 && (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
            Hay <strong>{miles(data.resumen.cobranzas_vencidas_gs)} Gs.</strong> que vencieron antes
            de este mes y siguen sin cobrarse. <strong>No</strong> están sumados en Disponible: es
            plata que ya tendría que haber entrado, y contarla como disponible sería contar
            justamente lo que no está.
          </div>
        )}
        {(ocultos > 0 || mesCompleto) && (
          <div className="mb-2 flex items-center justify-end gap-2 text-[11px] text-slate-500">
            {!mesCompleto && (
              <span>Se ocultan {ocultos} {ocultos === 1 ? "día sin pagos" : "días sin pagos"}.</span>
            )}
            <button
              type="button"
              onClick={() => setMesCompleto((v) => !v)}
              className="rounded-full border border-slate-300 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-50"
            >
              {mesCompleto ? "Ver solo días con pagos" : "Ver el mes completo"}
            </button>
          </div>
        )}
        <EdgeScrollArea>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">
                  Proveedor
                </th>
                {dias.map((d) => (
                  <th
                    key={d}
                    className={`min-w-[64px] px-1.5 py-1.5 text-center font-semibold ${
                      esHoy(d) ? "bg-[#4FAEB2]/10 text-[#2F6E71]"
                      : esFinde(d) ? "text-slate-300"
                      : "text-slate-500"
                    }`}
                  >
                    <span className="block text-[9px] font-medium uppercase opacity-60">{letraDia(d)}</span>
                    {d}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((fila) => (
                <tr key={fila.proveedor_id ?? "varios"} className="border-b border-slate-100">
                  <td className={`sticky left-0 z-10 bg-white px-3 py-2 font-medium ${fila.es_varios ? "text-slate-500 italic" : "text-slate-800"}`}>
                    {fila.nombre}
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">{fila.moneda}</span>
                  </td>
                  {dias.map((d) => {
                    const entradas = fila.dias[d] ?? [];
                    return (
                      <td
                        key={d}
                        onClick={() => entradas.length > 0 && setCelda({ dia: d, fila })}
                        className={`px-1 py-1 text-right align-top ${
                          entradas.length > 0 ? "cursor-pointer hover:bg-slate-50" : ""
                        } ${esHoy(d) ? "bg-[#4FAEB2]/5" : esFinde(d) ? "bg-slate-50/60" : ""}`}
                      >
                        {entradas.map((e, i) => (
                          <span
                            key={`${e.cheque_id ?? e.numero_control}-${i}`}
                            title={tooltipDe(e)}
                            className={`mb-0.5 block rounded px-1.5 py-1 text-right tabular-nums ring-1 ${TONO[e.estado] ?? ""}`}
                          >
                            {importeDe(e)}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                    {fila.total_usd > 0 && <div>US$ {miles(fila.total_usd, 2)}</div>}
                    {fila.total_gs > 0 && <div>{miles(fila.total_gs)}</div>}
                    {fila.total_usd === 0 && fila.total_gs === 0 && <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50/70">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-1.5 font-semibold text-slate-600">Subtotal US$</td>
                {data.totales.filter((t) => dias.includes(t.dia)).map((t) => (
                  <td
                    key={t.dia}
                    className={`px-1.5 py-1.5 text-right tabular-nums text-slate-700 ${
                      esHoy(t.dia) ? "bg-[#4FAEB2]/5" : esFinde(t.dia) ? "bg-slate-50/60" : ""
                    }`}
                  >
                    {t.subtotal_usd ? miles(t.subtotal_usd, 2) : ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{miles(data.resumen.total_usd, 2)}</td>
              </tr>
              <tr className="bg-slate-50/70">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-1.5 font-semibold text-slate-600">Subtotal Gs.</td>
                {data.totales.filter((t) => dias.includes(t.dia)).map((t) => (
                  <td
                    key={t.dia}
                    className={`px-1.5 py-1.5 text-right tabular-nums text-slate-700 ${
                      esHoy(t.dia) ? "bg-[#4FAEB2]/5" : esFinde(t.dia) ? "bg-slate-50/60" : ""
                    }`}
                  >
                    {t.subtotal_gs ? miles(t.subtotal_gs) : ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{miles(data.resumen.total_gs)}</td>
              </tr>
              <tr className="bg-emerald-50/40">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-emerald-50/60 px-3 py-1.5 font-semibold text-emerald-800">
                  Cobranzas Gs.
                </td>
                {data.totales.filter((t) => dias.includes(t.dia)).map((t) => (
                  <td
                    key={t.dia}
                    title={tooltipCobranzas(data.cobranzas?.[t.dia])}
                    className={`px-1.5 py-1.5 text-right tabular-nums ${
                      t.ingreso_gs > 0 ? "text-emerald-700" : "text-slate-300"
                    } ${esHoy(t.dia) ? "bg-[#4FAEB2]/5" : esFinde(t.dia) ? "bg-slate-50/60" : ""}`}
                  >
                    {t.ingreso_gs ? miles(t.ingreso_gs) : ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-800">
                  {data.resumen.ingreso_total_gs ? miles(data.resumen.ingreso_total_gs) : "—"}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 font-semibold text-slate-600">
                  Disponible Gs.
                </td>
                {data.totales.filter((t) => dias.includes(t.dia)).map((t) => (
                  <td
                    key={t.dia}
                    className={`px-1.5 py-1.5 text-right tabular-nums ${
                      t.acumulado_gs < 0 ? "text-red-600"
                      : t.egreso_gs > 0 || t.ingreso_gs > 0 ? "text-slate-700"
                      : "text-slate-300"
                    } ${esHoy(t.dia) ? "bg-[#4FAEB2]/5" : esFinde(t.dia) ? "bg-slate-50/60" : ""}`}
                  >
                    {miles(t.acumulado_gs)}
                  </td>
                ))}
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${data.resumen.acumulado_final_gs < 0 ? "text-red-600" : "text-slate-800"}`}>
                  {miles(data.resumen.acumulado_final_gs)}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-[11px] font-medium text-slate-400">
                  Disponible US$
                </td>
                {data.totales.filter((t) => dias.includes(t.dia)).map((t) => (
                  <td
                    key={t.dia}
                    className={`px-1.5 py-1.5 text-right text-[11px] tabular-nums ${
                      t.egreso_gs > 0 || t.ingreso_gs > 0 ? "text-slate-400" : "text-slate-300"
                    } ${esHoy(t.dia) ? "bg-[#4FAEB2]/5" : esFinde(t.dia) ? "bg-slate-50/60" : ""}`}
                  >
                    {miles(t.acumulado_usd, 0)}
                  </td>
                ))}
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </EdgeScrollArea>
        </>
      )}

      {celda && (
        <PanelCelda
          dia={celda.dia}
          fila={celda.fila}
          anio={anio}
          mes={mes}
          bancos={bancos}
          tipoCambio={data?.config.tipo_cambio ?? 0}
          onClose={() => setCelda(null)}
          onCambio={() => { setCelda(null); void cargar(); }}
        />
      )}

      <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-500">
        <p>
          <strong>Disponible</strong> arranca en los fondos del mes, <strong>suma</strong> las
          cobranzas que vencen ese día y <strong>resta</strong> los pagos proyectados. Pasa a rojo
          cuando los pagos del mes superan a lo que hay más lo que entra.
        </p>
        <p>
          Si el mes no tiene fondos propios cargados, abre con lo que quedó del mes anterior, igual
          que la caja con el sobrante del día. Cargar la posición de liquidez (bancos + efectivo) lo
          vuelve a anclar a la plata real: cuando está cargada, manda ella.
        </p>
        <p>
          Los cheques ya cobrados no suman: ya salieron del banco. Las cobranzas vencidas sin cobrar
          tampoco: van avisadas aparte, arriba. En la planilla el Disponible se llevaba en negativo;
          acá es positivo mientras quede plata.
        </p>
      </div>
    </div>
  );
}

/**
/**
 * Explica una grilla vacía con los números que manda la API, en vez de dejar un
 * texto genérico. Las causas reales son siempre las mismas tres: no hay compras,
 * están cargadas como contado, o el pago cae en otro mes.
 */
function VacioExplicado({
  diag, anio, mes, onIr,
}: {
  diag?: DiagnosticoFlujo;
  anio: number;
  mes: number;
  onIr: (anio: number, mes: number) => void;
}) {
  const clase = "mx-auto mt-2 max-w-md text-sm text-slate-500";

  if (!diag || diag.compras_total === 0) {
    return (
      <p className={clase}>
        Todavía no hay compras cargadas. Las facturas de compra <strong>a crédito</strong> caen
        acá solas, en la fecha de pago (fecha de factura más el plazo).
      </p>
    );
  }

  if (diag.compras_credito === 0) {
    return (
      <p className={clase}>
        Hay {diag.compras_total} {diag.compras_total === 1 ? "compra cargada" : "compras cargadas"},
        pero ninguna está a crédito. En Compras → Nueva, el campo <strong>Tipo de pago</strong>{" "}
        viene en <em>Contado</em>: ponelo en <strong>Crédito</strong> y cargale el plazo en días.
        Una compra al contado ya está pagada, así que no se proyecta.
      </p>
    );
  }

  const otros = diag.meses_con_pagos.filter((x) => x.anio !== anio || x.mes !== mes);
  if (otros.length > 0) {
    return (
      <div className={clase}>
        <p>
          Hay {diag.compras_credito} {diag.compras_credito === 1 ? "factura" : "facturas"} a
          crédito, pero {diag.compras_credito === 1 ? "su pago cae" : "sus pagos caen"} en otro mes.
          La fecha de pago es <strong>fecha de factura + plazo</strong>: con 30 días de plazo, una
          factura de hoy se paga el mes que viene.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {otros.map((x) => (
            <button
              key={`${x.anio}-${x.mes}`}
              type="button"
              onClick={() => onIr(x.anio, x.mes)}
              className="rounded-full border border-[#4FAEB2] px-3 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10"
            >
              {MESES[x.mes - 1]} {x.anio} ({x.cantidad})
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <p className={clase}>
      Hay {diag.compras_credito} {diag.compras_credito === 1 ? "factura" : "facturas"} a crédito,
      pero {diag.compras_credito === 1 ? "ya está paga" : "ya están pagas"}.
    </p>
  );
}

/**
 * Panel de una celda del flujo: las facturas y cheques de ese día para ese
 * proveedor. Desde acá se emite el cheque y se le cambia el estado.
 *
 * Emitir es el único paso que sigue siendo decisión humana: qué se paga, con
 * qué número y de qué banco. Lo demás ya viene de las compras.
 */
function PanelCelda({
  dia, fila, anio, mes, bancos, tipoCambio, onClose, onCambio,
}: {
  dia: number;
  fila: FilaFlujo;
  anio: number;
  mes: number;
  bancos: { id: string; nombre: string }[];
  /** El del mes, para poder comparar un cheque en dólares con una factura en guaraníes. */
  tipoCambio: number;
  onClose: () => void;
  onCambio: () => void;
}) {
  const entradas = fila.dias[dia] ?? [];
  const sinCheque = entradas.filter((e) => e.tipo === "factura");

  const [seleccion, setSeleccion] = useState<string[]>(
    sinCheque.map((e) => e.numero_control ?? "").filter(Boolean)
  );
  const [numero, setNumero] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fechaPago = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

  // Fecha a partir de la cual el proveedor puede cobrar el cheque en ventanilla.
  // Joaquín: "son cheques diferidos, antes de esa fecha el banco no le permite".
  // Arranca en la fecha de pago, que es el caso más común, y se corre a mano.
  const [fechaCobro, setFechaCobro] = useState(fechaPago);

  // Cheque pendiente al que se le está cargando el número (uno por vez).
  const [editando, setEditando] = useState<{ id: string; numero: string; bancoId: string; cobro: string } | null>(null);
  const elegidasAhora = sinCheque.filter(
    (e) => e.numero_control && seleccion.includes(e.numero_control)
  );
  const importeSeleccion = elegidasAhora.reduce((a, e) => a + e.importe, 0);

  /**
   * La moneda del cheque sale de las FACTURAS, no del proveedor.
   *
   * Antes acá iba `fila.moneda`, que es la moneda preferida del proveedor. Una
   * factura en guaraníes de un proveedor en dólares nacía como un cheque en
   * dólares con el importe en guaraníes, y el flujo después lo multiplicaba por
   * el tipo de cambio. En producción quedó uno así: 128.000 USD por una factura
   * de 128.000 Gs., que proyectaba 819 millones de egreso.
   *
   * `null` = hay facturas de las dos monedas elegidas; no se puede emitir uno
   * solo que las represente.
   */
  const monedaCheque = monedaDeLasFacturas(
    elegidasAhora.map((e) => ({
      numero_control: e.numero_control ?? "",
      moneda: e.moneda,
      importe_imputado: e.importe,
    }))
  ) ?? (elegidasAhora.length === 0 ? fila.moneda : null);

  const revision = revisarCheque({
    moneda: monedaCheque ?? fila.moneda,
    importe: importeSeleccion,
    tipoCambio,
    facturas: elegidasAhora.map((e) => ({
      numero_control: e.numero_control ?? "",
      moneda: e.moneda,
      importe_imputado: e.importe,
    })),
  });
  const monedasMezcladas = monedaCheque === null && elegidasAhora.length > 0;

  async function llamar(url: string, init: RequestInit, alFallar: string) {
    setTrabajando(true);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession(url, init);
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      onCambio();
    } catch (e) {
      setErr(e instanceof Error ? e.message : alFallar);
    } finally {
      setTrabajando(false);
    }
  }

  function emitir() {
    if (seleccion.length === 0) { setErr("Elegí al menos una factura."); return; }
    if (revision.nivel === "error") { setErr(revision.mensaje); return; }
    const elegidas = elegidasAhora;
    void llamar("/api/cheques", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor_id: fila.proveedor_id,
        proveedor_nombre: fila.nombre,
        moneda: monedaCheque ?? fila.moneda,
        importe: importeSeleccion,
        numero: numero.trim() || null,
        entidad_bancaria_id: bancoId || null,
        banco_nombre: bancos.find((b) => b.id === bancoId)?.nombre ?? null,
        fecha_pago_prevista: fechaPago,
        fecha_cobro_prevista: fechaCobro || null,
        facturas: elegidas.map((e) => ({
          numero_control: e.numero_control,
          importe_imputado: e.importe,
        })),
      }),
    }, "No se pudo emitir el cheque.");
  }

  /**
   * Carga el número al cheque que estaba pendiente y lo deja emitido de una.
   * Es el paso que Joaquín hace el día que se sienta a elaborar los cheques.
   */
  function guardarNumero() {
    if (!editando) return;
    if (!editando.numero.trim()) { setErr("Falta el número del cheque."); return; }
    void llamar(`/api/cheques/${editando.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado: "emitido",
        numero: editando.numero.trim(),
        entidad_bancaria_id: editando.bancoId || null,
        banco_nombre: bancos.find((b) => b.id === editando.bancoId)?.nombre ?? null,
        fecha_cobro_prevista: editando.cobro || null,
      }),
    }, "No se pudo cargar el número del cheque.");
    setEditando(null);
  }

  function cambiarEstado(chequeId: string, estado: string, extra: Record<string, unknown> = {}) {
    void llamar(`/api/cheques/${chequeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado, ...extra }),
    }, "No se pudo actualizar el cheque.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{fila.nombre}</h3>
            <p className="text-xs text-slate-500">Pagos del {dia} de {MESES[mes - 1]} {anio}</p>
          </div>
          <button type="button" onClick={onClose} className="text-lg leading-none text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
        )}

        {/* Lo que ya tiene cheque */}
        {entradas.filter((e) => e.tipo === "cheque").map((e) => (
          <div key={e.cheque_id} className={`mb-2 rounded-lg px-3 py-2 ring-1 ${TONO[e.estado] ?? ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                {e.numero_cheque ? `Cheque Nº ${e.numero_cheque}` : "Cheque sin número"}
                {e.banco_nombre ? ` — ${e.banco_nombre}` : ""}
              </span>
              <span className="text-sm font-bold tabular-nums">{importeDe(e)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-line text-[11px] opacity-80">{tooltipDe(e)}</p>
            {e.cheque_id && e.estado !== "anulado" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {e.estado === "pendiente_emision" && (
                  e.numero_cheque ? (
                    <button
                      type="button" disabled={trabajando}
                      onClick={() => cambiarEstado(e.cheque_id!, "emitido")}
                      className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-40"
                    >
                      Marcar emitido
                    </button>
                  ) : (
                    <button
                      type="button" disabled={trabajando}
                      onClick={() => setEditando({
                        id: e.cheque_id!,
                        numero: "",
                        bancoId: bancos.find((b) => b.nombre === e.banco_nombre)?.id ?? "",
                        cobro: e.fecha_cobro ?? fechaPago,
                      })}
                      className="rounded border border-violet-300 bg-white px-2 py-1 text-[11px] font-semibold text-violet-700 disabled:opacity-40"
                    >
                      Cargar número
                    </button>
                  )
                )}
                {e.estado === "emitido" && (
                  <button
                    type="button" disabled={trabajando}
                    onClick={() => cambiarEstado(e.cheque_id!, "cobrado", {
                      fecha_cobro_real: new Date().toISOString().slice(0, 10),
                    })}
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-40"
                  >
                    Marcar cobrado hoy
                  </button>
                )}
                <button
                  type="button" disabled={trabajando}
                  onClick={() => cambiarEstado(e.cheque_id!, "anulado")}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 disabled:opacity-40"
                >
                  Anular
                </button>
              </div>
            )}
            {editando?.id === e.cheque_id && (
              <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-white/60 pt-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase opacity-70">Nº de cheque</span>
                  <input
                    autoFocus value={editando.numero}
                    onChange={(ev) => setEditando((p) => (p ? { ...p, numero: ev.target.value } : p))}
                    className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase opacity-70">Banco</span>
                  <Selector
                    value={editando.bancoId}
                    onChange={(ev) => setEditando((p) => (p ? { ...p, bancoId: ev.target.value } : p))}
                    className="w-36 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value="">—</option>
                    {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </Selector>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase opacity-70">Cobrable desde</span>
                  <input
                    type="date" value={editando.cobro}
                    onChange={(ev) => setEditando((p) => (p ? { ...p, cobro: ev.target.value } : p))}
                    className="w-36 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <button
                  type="button" onClick={guardarNumero} disabled={trabajando}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Emitir
                </button>
                <button
                  type="button" onClick={() => setEditando(null)}
                  className="rounded px-2 py-1.5 text-[11px] font-medium opacity-70 hover:opacity-100"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Facturas sin cheque: se eligen y se emite uno solo para todas */}
        {sinCheque.length > 0 && fila.proveedor_id && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">Emitir cheque</p>
            <ul className="mb-3 space-y-1">
              {sinCheque.map((e) => (
                <li key={e.numero_control} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!e.numero_control && seleccion.includes(e.numero_control)}
                    onChange={() => setSeleccion((prev) =>
                      e.numero_control
                        ? prev.includes(e.numero_control)
                          ? prev.filter((x) => x !== e.numero_control)
                          : [...prev, e.numero_control]
                        : prev
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-600">
                    Factura {e.numero_factura ?? "s/nº"} · {e.numero_control}
                  </span>
                  <span className="tabular-nums font-medium">{importeDe(e)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-slate-500">Nº de cheque</span>
                <input
                  value={numero} onChange={(ev) => setNumero(ev.target.value)}
                  placeholder="opcional"
                  className="w-32 rounded border border-slate-200 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-slate-500">Banco</span>
                <Selector
                  value={bancoId} onChange={(ev) => setBancoId(ev.target.value)}
                  className="w-40 rounded border border-slate-200 px-2 py-1 text-xs"
                >
                  <option value="">—</option>
                  {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </Selector>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-slate-500">Cobrable desde</span>
                <input
                  type="date" value={fechaCobro} onChange={(ev) => setFechaCobro(ev.target.value)}
                  className="w-36 rounded border border-slate-200 px-2 py-1 text-xs"
                />
              </label>
              <button
                type="button" onClick={emitir}
                disabled={trabajando || seleccion.length === 0 || revision.nivel === "error"}
                className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
              >
                {trabajando
                  ? "Guardando…"
                  /* La moneda del botón es la de las FACTURAS, igual que la del
                     cheque: si dijera la del proveedor estaría anunciando un
                     importe en una moneda distinta de la que se va a guardar. */
                  : `Emitir por ${monedaCheque === "USD" ? "US$ " : "Gs. "}${miles(importeSeleccion, monedaCheque === "USD" ? 2 : 0)}`}
              </button>
            </div>

            {/* Lo que no cierra entre el cheque y las facturas que cubre.
                El error frena; el aviso deja seguir, porque un pago parcial es
                legítimo y lo único que hace falta es que no pase en silencio. */}
            {revision.nivel !== "ok" && (
              <p className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-snug ${
                revision.nivel === "error"
                  ? "border-rose-300 bg-rose-50 text-rose-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}>
                {monedasMezcladas ? null : <strong>{revision.nivel === "error" ? "No se puede emitir: " : "Ojo: "}</strong>}
                {revision.mensaje}
              </p>
            )}
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              Sin número el cheque queda <strong>pendiente de emisión</strong> (lila) y se le carga
              después. Con número nace <strong>emitido</strong> (verde). Un cheque cubre varias
              facturas del mismo proveedor. <strong>Cobrable desde</strong> es la fecha a partir de
              la cual el proveedor puede cobrarlo en ventanilla: en un cheque diferido va después
              de la fecha de pago.
            </p>
          </div>
        )}

        {sinCheque.length > 0 && !fila.proveedor_id && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            Esta es la fila agrupada VARIOS: junta varios proveedores, así que el cheque no se
            puede emitir desde acá. Entrá por la fila del proveedor o sacale la marca
            «agrupa en varios».
          </p>
        )}
      </div>
    </div>
  );
}
