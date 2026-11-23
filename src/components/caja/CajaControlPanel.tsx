"use client";

/**
 * Panel de Caja para /ventas: soporta MÚLTIPLES cajas activas (Caja 1, Caja 2, …).
 * Muestra el estado de cada caja (abierta / en cierre), totales en vivo y modales
 * para abrir, registrar movimiento, pasar a cierre y cerrar (arqueo) por caja.
 *
 * Paleta turquesa del sistema #4FAEB2.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Lock,
  Unlock,
  Plus,
  ArrowDownRight,
  Wallet,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  ShoppingCart,
} from "lucide-react";
import ComprobantesMovimiento from "@/components/caja/ComprobantesMovimiento";
import MontoInput from "@/components/ui/MontoInput";
import AdjuntosEgreso, { type AdjuntoEgreso } from "@/components/caja/AdjuntosEgreso";
import ArqueoDenominaciones, {
  arqueoVacio,
  cantidadesAArqueo,
  totalArqueo,
  type ArqueoCantidades,
} from "@/components/caja/ArqueoDenominaciones";
import type {
  ArqueoItem,
  CajaResumen,
  MedioPagoCaja,
  TipoMovimientoCaja,
} from "@/lib/caja/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fmtFechaHora(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type ModalKind = null | "abrir" | "cerrar" | "mov" | "en_cierre";

interface Props {
  onStateChange?: () => void;
}

import { TIPOS_EGRESO } from "@/lib/caja/tipos-egreso";
import Selector from "@/components/ui/Selector";
import BuscadorCliente, { type ClienteElegido } from "@/components/clientes/BuscadorCliente";
import { claseMovimiento, ETIQUETA_CLASE, type ClaseMovimiento } from "@/lib/caja/clase-movimiento";

export default function CajaControlPanel({ onStateChange }: Props) {
  const [cajas, setCajas] = useState<CajaResumen[]>([]);
  const [target, setTarget] = useState<CajaResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  /** La última caja que se cerró acá: queda el botón para imprimir su lista de ventas. */
  const [recienCerrada, setRecienCerrada] = useState<{ id: string; numero: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/caja/estado", {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar");
      setCajas((j.data?.cajas ?? []) as CajaResumen[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function notifyOk(msg: string) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 3000);
  }

  const numerosOcupados = cajas.map((c) => c.caja.numero_caja);
  let numeroSugerido = 1;
  while (numerosOcupados.includes(numeroSugerido)) numeroSugerido++;

  async function handleAbrir(
    monto: number,
    observacion: string | null,
    numeroCaja: number,
    arqueo: ArqueoItem[] | null
  ) {
    const r = await fetch("/api/caja/abrir", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monto_apertura: monto,
        observacion,
        numero_caja: numeroCaja,
        arqueo_apertura: arqueo,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    await load();
    notifyOk(`Caja ${numeroCaja} abierta correctamente.`);
    onStateChange?.();
  }
  async function handleCerrar(monto: number, observacion: string | null, arqueo: ArqueoItem[] | null) {
    if (!target) return;
    const r = await fetch("/api/caja/cerrar", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caja_id: target.caja.id,
        monto_cierre_contado: monto,
        observacion,
        arqueo_cierre: arqueo,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    setRecienCerrada({ id: target.caja.id, numero: target.caja.numero_caja });
    notifyOk(`Caja ${target.caja.numero_caja} cerrada correctamente.`);
    onStateChange?.();
  }
  async function handleMov(opts: {
    tipo: TipoMovimientoCaja;
    concepto: string;
    monto: number;
    medio_pago: MedioPagoCaja;
    observacion: string | null;
    /** Punto 5.7. Viaja tal cual al endpoint junto con el resto. */
    tipo_egreso?: string | null;
    /** A quién se le pagó. Solo en egresos (script 58). */
    proveedor?: string | null;
    /** Punto 5.7: factura y recibo ya subidos, con su path. */
    adjuntos?: AdjuntoEgreso[] | null;
    /** Retención: de qué cliente y qué factura. */
    cliente_nombre?: string | null;
    factura?: string | null;
  }) {
    if (!target) return;
    const r = await fetch("/api/caja/movimiento", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caja_id: target.caja.id, ...opts }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    notifyOk("Movimiento registrado.");
  }
  /** Anticipo desde la caja: va a Anticipos, atado a ESTA caja. */
  async function handleAnticipo(opts: { cliente_id: string; monto: number; medio_pago: string; observacion: string | null }) {
    if (!target) return;
    const r = await fetch("/api/anticipos", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caja_id: target.caja.id, ...opts }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    notifyOk(`Anticipo ${j.data?.anticipo?.numero ?? ""} registrado. Ya figura en Anticipos.`);
  }
  async function handleEnCierre() {
    if (!target) return;
    const cr = target;
    const r = await fetch("/api/caja/en-cierre", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caja_id: cr.caja.id }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    notifyOk(`Caja ${cr.caja.numero_caja} en cierre/conteo.`);
    onStateChange?.();
  }

  if (loading && cajas.length === 0) {
    return (
      <div className="rounded-xl border-2 border-[#4FAEB2]/20 bg-white p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />
        <span className="text-sm text-slate-500">Cargando estado de caja...</span>
      </div>
    );
  }

  // === Sin cajas activas ===
  if (cajas.length === 0) {
    return (
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm shadow-amber-300/40">
            <Lock className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-amber-900 leading-none">
              Caja cerrada
            </h2>
            <p className="text-xs text-amber-700 mt-1">
              Abrila antes de operar para que las ventas se registren en el turno.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("abrir")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold px-4 py-2.5 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        >
          <Unlock className="h-4 w-4" />
          Abrir caja
        </button>

        {modal === "abrir" && (
          <ModalAbrir
            onClose={() => setModal(null)}
            onConfirm={handleAbrir}
            error={error}
            numeroSugerido={numeroSugerido}
            numerosOcupados={numerosOcupados}
          />
        )}

        {recienCerrada && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-[#4FAEB2]/40 bg-white px-4 py-2.5 text-sm">
            <span className="text-slate-700">Caja {recienCerrada.numero} cerrada.</span>
            <span className="flex items-center gap-2">
              <a href={`/api/cajas/${recienCerrada.id}/lista-ventas`} target="_blank" rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3F8E91]">
                <FileText className="h-3.5 w-3.5" /> Imprimir lista de ventas
              </a>
              <button type="button" onClick={() => setRecienCerrada(null)} className="text-xs text-slate-400 hover:text-slate-600">Cerrar aviso</button>
            </span>
          </div>
        )}
        {okMsg && <ToastOk msg={okMsg} />}
      </div>
    );
  }

  // === Cajas activas (una o varias) ===
  return (
    <div className="space-y-3">
      {recienCerrada && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-[#4FAEB2]/40 bg-white px-4 py-2.5 text-sm">
          <span className="text-slate-700">Caja {recienCerrada.numero} cerrada.</span>
          <span className="flex items-center gap-2">
            <a href={`/api/cajas/${recienCerrada.id}/lista-ventas`} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3F8E91]">
            <FileText className="h-3.5 w-3.5" /> Imprimir lista de ventas
            </a>
            <button type="button" onClick={() => setRecienCerrada(null)} className="text-xs text-slate-400 hover:text-slate-600">Cerrar aviso</button>
          </span>
        </div>
      )}
      {/* Barra superior: título + abrir otra caja */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
          <Wallet className="h-4 w-4 text-[#4FAEB2]" />
          Cajas ({cajas.length})
        </h2>
        <button
          type="button"
          onClick={() => setModal("abrir")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-xs font-bold px-3 py-2 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        >
          <Unlock className="h-3.5 w-3.5" />
          Abrir otra caja
        </button>
      </div>

      {cajas.map((cr) => {
        const c = cr.caja;
        const enCierre = c.estado === "en_cierre";
        return (
          <div key={c.id} className="rounded-xl border border-2 border-[#4FAEB2]/25 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
            {/* Header por caja */}
            <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shadow-sm ${enCierre ? "bg-amber-500 shadow-amber-500/30" : "bg-[#4FAEB2] shadow-[#4FAEB2]/30"}`}>
                  <Wallet className="h-4.5 w-4.5 text-white" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800 leading-none flex items-center gap-2">
                    Caja {c.numero_caja}
                    {enCierre ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        En cierre
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Abierta
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Abierta el {fmtFechaHora(c.fecha_apertura)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* La hoja del arqueo, para contar.
                    Aparece recién cuando el turno pasa a cierre: con la caja
                    abierta los números siguen cambiando con cada venta, así
                    que la hoja impresa queda vieja antes de que termine de
                    contar. En cierre ya no entran ventas y lo que dice el
                    papel es lo que hay que encontrar en el cajón. */}
                {enCierre && (
                <a
                  href={`/api/cajas/${c.id}/arqueo-a4`}
                  target="_blank"
                  rel="noopener"
                  title="Ver la hoja del arqueo como va a salir, con el turno todavía abierto"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-3 py-2 hover:border-[#4FAEB2] hover:text-[#3F8E91] hover:bg-[#4FAEB2]/5 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Vista previa del arqueo
                </a>
                )}
                {enCierre && (
                  <a
                    href={`/api/cajas/${c.id}/lista-ventas`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71] text-xs font-semibold px-3 py-2 hover:bg-[#4FAEB2]/20 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Imprimir lista de ventas
                  </a>
                )}
                {!enCierre && (
                  <>
                    {/* Acceso rápido a facturar (pedido del cliente): es lo
                        que más se usa, así que va más grande que el resto. */}
                    <Link
                      href="/ventas/nueva"
                      className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-[#4FAEB2]/30 transition-colors hover:bg-[#3F8E91]"
                    >
                      <ShoppingCart className="h-5 w-5" />
                      Nueva venta
                    </Link>
                    <button
                      type="button"
                      onClick={() => { setTarget(cr); setModal("mov"); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-3 py-2 hover:border-[#4FAEB2] hover:text-[#3F8E91] hover:bg-[#4FAEB2]/5 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Movimiento
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTarget(cr); setModal("en_cierre"); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-2 hover:bg-amber-100 transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Pasar a cierre
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setTarget(cr); setModal("cerrar"); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-2 transition-colors shadow-sm"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Cerrar
                </button>
              </div>
            </div>

            {enCierre && (
              <div className="px-5 py-2 bg-amber-50/60 border-b border-amber-100 text-[11px] font-medium text-amber-800">
                En conteo — no recibe nuevas ventas ni movimientos. Cargá el efectivo contado para cerrar.
              </div>
            )}

            {/* Metricas en vivo por caja */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-slate-100">
              <Metric label="Apertura" value={fmtGs(c.monto_apertura)} icon={<Wallet className="h-3.5 w-3.5" />} />
              <Metric label="Ventas" value={String(cr.cantidad_ventas)} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
              <Metric label="Efectivo" value={fmtGs(cr.total_efectivo)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" />} highlight="emerald" />
              <Metric label="Transfer" value={fmtGs(cr.total_transferencia)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-sky-600" />} />
              <Metric label="Tarjeta" value={fmtGs(cr.total_tarjeta)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-violet-600" />} />
              {cr.total_cheque > 0 && (
                <Metric label="Cheque" value={fmtGs(cr.total_cheque)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-amber-600" />} />
              )}
              <Metric label="Esperado efectivo" value={fmtGs(cr.efectivo_esperado)} icon={<Wallet className="h-3.5 w-3.5 text-[#4FAEB2]" />} highlight="turquesa" />
            </div>

            {/* ── De dónde sale el esperado, cuando no sale de las ventas ───
                Un turno con 0 ventas y "esperado Gs. 362.770" se lee como un
                error del sistema. Casi siempre es un anticipo: plata que entró
                al cajón sin ser una venta. Decirlo acá ahorra la pregunta y
                evita que alguien cierre pensando que le sobra. */}
            {cr.total_efectivo === 0 && cr.efectivo_esperado !== 0 && (
              <DesgloseEsperado resumen={cr} montoApertura={c.monto_apertura} />
            )}
            {cr.total_efectivo !== 0 && (cr.diferencia_arrastrada ?? 0) !== 0 && (
              <div className={`border-b px-5 py-2 text-[11px] font-medium ${
                (cr.diferencia_arrastrada ?? 0) > 0
                  ? "border-emerald-100 bg-emerald-50/60 text-emerald-800"
                  : "border-red-100 bg-red-50/60 text-red-700"
              }`}>
                {(cr.diferencia_arrastrada ?? 0) > 0 ? "Sobrante" : "Faltante"} del turno anterior:{" "}
                <span className="tabular-nums font-bold">
                  {(cr.diferencia_arrastrada ?? 0) > 0 ? "+" : "−"}{fmtGs(Math.abs(cr.diferencia_arrastrada ?? 0))}
                </span>{" "}
                (ya está sumado en el esperado).
              </div>
            )}

            <MovimientosAgrupados resumen={cr} />
          </div>
        );
      })}

      {modal === "abrir" && (
        <ModalAbrir
          onClose={() => setModal(null)}
          onConfirm={handleAbrir}
          error={error}
          numeroSugerido={numeroSugerido}
          numerosOcupados={numerosOcupados}
        />
      )}
      {modal === "cerrar" && target && (
        <ModalCerrar
          resumen={target}
          onClose={() => { setModal(null); setTarget(null); }}
          onConfirm={handleCerrar}
        />
      )}
      {modal === "mov" && target && (
        <ModalMovimiento onClose={() => { setModal(null); setTarget(null); }} onConfirm={handleMov} onAnticipo={handleAnticipo} />
      )}
      {modal === "en_cierre" && target && (
        <ModalConfirmar
          title={`Pasar Caja ${target.caja.numero_caja} a cierre`}
          subtitle="Conteo / arqueo del turno"
          mensaje={`La Caja ${target.caja.numero_caja} dejará de recibir ventas y movimientos. Después vas a cargar el efectivo contado para cerrarla. ¿Continuar?`}
          confirmLabel="Pasar a cierre"
          onClose={() => { setModal(null); setTarget(null); }}
          onConfirm={handleEnCierre}
        />
      )}
      {okMsg && <ToastOk msg={okMsg} />}
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

/**
 * De dónde sale el efectivo esperado, renglón por renglón.
 *
 * ── POR QUÉ HACE FALTA ────────────────────────────────────────────────────
 * Un turno con 0 ventas y "esperado Gs. 372.770" se lee como un error del
 * sistema. Casi siempre es un anticipo: plata que entró al cajón sin ser una
 * venta. Decirlo acá ahorra la pregunta y evita que alguien cierre pensando
 * que le sobra.
 *
 * ── POR QUÉ NO ES UNA FRASE ───────────────────────────────────────────────
 * Antes esto era una oración armada con tres sumandos (apertura, anticipos,
 * ingresos) y una resta (egresos y retiros). Pero el esperado tiene DOS
 * componentes más —los ajustes y la diferencia arrastrada del turno anterior—
 * y la frase los ignoraba: con un arrastre de Gs. 62.770 la casilla decía
 * 372.770 y el texto de abajo "el esperado son 310.000". Una explicación de
 * plata que no cierra con el número que explica es peor que no explicar nada.
 *
 * Ahora los renglones salen de los mismos componentes que usa el servidor y el
 * total se suma acá. Si aun así no coincidiera con `efectivo_esperado`, se
 * muestra el renglón de diferencia en vez de callarlo: que se vea que falta
 * algo es mejor que un desglose que miente por omisión.
 */
function DesgloseEsperado({
  resumen,
  montoApertura,
}: {
  resumen: CajaResumen;
  montoApertura: number;
}) {
  const arrastre = resumen.diferencia_arrastrada ?? 0;
  const renglones: Array<{ label: string; monto: number }> = [
    { label: "Apertura", monto: montoApertura },
    { label: "Anticipos cobrados en efectivo", monto: resumen.anticipos_efectivo },
    { label: "Ingresos manuales", monto: resumen.ingresos_efectivo },
    { label: "Egresos", monto: -resumen.egresos_efectivo },
    { label: "Retiros", monto: -resumen.retiros_efectivo },
    { label: "Ajustes", monto: resumen.ajustes_efectivo },
    // Sobrante (+) o faltante (−) del turno anterior: pasa a esta caja.
    { label: arrastre < 0 ? "Faltante del turno anterior" : "Sobrante del turno anterior", monto: arrastre },
  ].filter((r) => Math.round(r.monto) !== 0);

  const suma = renglones.reduce((a, r) => a + r.monto, 0);
  const sinExplicar = Math.round(resumen.efectivo_esperado) - Math.round(suma);

  return (
    <div className="border-b border-[#4FAEB2]/20 bg-[#4FAEB2]/[0.06] px-5 py-2.5 text-[11px] leading-snug text-slate-600">
      <p className="font-semibold text-[#3F8E91]">
        Todavía no hay ventas en efectivo. El esperado sale de acá:
      </p>
      <ul className="mt-1 space-y-0.5">
        {renglones.map((r) => (
          <li key={r.label} className="flex justify-between gap-4">
            <span>{r.label}</span>
            <span className="tabular-nums">
              {r.monto < 0 ? "−" : ""}{fmtGs(Math.abs(r.monto))}
            </span>
          </li>
        ))}
        {sinExplicar !== 0 && (
          <li className="flex justify-between gap-4 text-amber-700">
            <span>Sin explicar (revisar el arqueo)</span>
            <span className="tabular-nums">
              {sinExplicar < 0 ? "−" : ""}{fmtGs(Math.abs(sinExplicar))}
            </span>
          </li>
        )}
        <li className="mt-0.5 flex justify-between gap-4 border-t border-[#4FAEB2]/25 pt-0.5 font-semibold text-[#3F8E91]">
          <span>Esperado en el cajón</span>
          <span className="tabular-nums">{fmtGs(resumen.efectivo_esperado)}</span>
        </li>
      </ul>
    </div>
  );
}

/**
 * Los movimientos del turno, una columna por tipo con su total y sus
 * detalles abajo (pedido del cliente): Cobranzas, Egresos, Retiros,
 * Retenciones y Anticipos —estos con el nombre del cliente—.
 */
function MovimientosAgrupados({ resumen }: { resumen: CajaResumen }) {
  type Linea = { id: string; texto: string; detalle: string; monto: number; extra?: React.ReactNode };
  const grupos = new Map<ClaseMovimiento | "anticipo", Linea[]>();
  for (const m of resumen.movimientos) {
    const clase = claseMovimiento(m);
    const l = grupos.get(clase) ?? [];
    l.push({
      id: m.id,
      texto: clase === "retencion" ? (m.proveedor || m.concepto) : m.concepto,
      detalle: [clase === "retencion" ? m.concepto : m.proveedor, clase === "retencion" ? null : m.medio_pago].filter(Boolean).join(" · "),
      monto: m.monto,
      extra: (m.adjuntos ?? []).some((a) => (a.path ?? "").trim() !== "")
        ? <ComprobantesMovimiento adjuntos={m.adjuntos} />
        : undefined,
    });
    grupos.set(clase, l);
  }
  for (const a of resumen.anticipos_lista ?? []) {
    const l = grupos.get("anticipo") ?? [];
    l.push({
      id: a.id,
      texto: a.cliente_nombre ?? "—",
      detalle: [a.numero, a.medio_pago].filter(Boolean).join(" · "),
      monto: a.monto,
    });
    grupos.set("anticipo", l);
  }
  const orden: Array<[ClaseMovimiento | "anticipo", string, string]> = [
    ["cobranza", ETIQUETA_CLASE.cobranza, "text-emerald-700"],
    ["anticipo", "Anticipos de facturación", "text-emerald-700"],
    ["retencion", ETIQUETA_CLASE.retencion, "text-sky-700"],
    ["egreso", ETIQUETA_CLASE.egreso, "text-red-600"],
    ["retiro", ETIQUETA_CLASE.retiro, "text-red-600"],
    ["ajuste", ETIQUETA_CLASE.ajuste, "text-amber-700"],
  ];
  const visibles = orden.filter(([k]) => (grupos.get(k) ?? []).length > 0);
  if (visibles.length === 0) return null;
  const resta = (k: string) => k === "egreso" || k === "retiro";
  return (
    <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-3">
      <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Movimientos</p>
      <div className={`grid gap-3 sm:grid-cols-2 ${visibles.length >= 3 ? "lg:grid-cols-3" : ""}`}>
        {visibles.map(([k, titulo, color]) => {
          const lineas = grupos.get(k)!;
          const total = lineas.reduce((s, l) => s + Math.abs(l.monto), 0);
          return (
            <div key={k} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
                <span className="text-xs font-bold text-slate-700">{titulo} <span className="font-normal text-slate-400">({lineas.length})</span></span>
                <span className={`text-xs font-bold tabular-nums ${color}`}>{resta(k) ? "−" : ""}{fmtGs(total)}</span>
              </div>
              <ul className="max-h-48 divide-y divide-slate-50 overflow-y-auto">
                {lineas.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 px-3 py-1.5 text-xs">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-700">{l.texto}</span>
                      {l.detalle && <span className="block truncate text-[11px] capitalize text-slate-400">{l.detalle}</span>}
                      {l.extra}
                    </span>
                    <span className={`shrink-0 tabular-nums font-semibold ${color}`}>
                      {resta(k) || l.monto < 0 ? "−" : ""}{fmtGs(Math.abs(l.monto))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  highlight?: "turquesa" | "emerald";
}) {
  const bg =
    highlight === "turquesa"
      ? "bg-[#4FAEB2]/5"
      : highlight === "emerald"
      ? "bg-emerald-50/50"
      : "bg-white";
  return (
    <div className={`${bg} px-3 py-3`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="text-[15px] font-bold text-slate-800 tabular-nums mt-1">{value}</p>
    </div>
  );
}


function ToastOk({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] rounded-xl border-2 border-emerald-200 bg-emerald-50 shadow-lg px-4 py-3 flex items-center gap-2 text-sm text-emerald-800 font-semibold">
      <CheckCircle2 className="h-4 w-4" />
      {msg}
    </div>
  );
}

// ============================================================
// Modales
// ============================================================

function ModalBase({
  title,
  subtitle,
  onClose,
  children,
  maxWidthClass = "max-w-md",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Ancho máximo del modal (default max-w-md). El arqueo usa uno más ancho. */
  maxWidthClass?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl w-full ${maxWidthClass} border-2 border-[#4FAEB2]/20 overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Modal de confirmación genérico (reemplaza al confirm() nativo). */
function ModalConfirmar({
  title,
  subtitle,
  mensaje,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  subtitle?: string;
  mensaje: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }
  return (
    <ModalBase title={title} subtitle={subtitle} onClose={busy ? () => {} : onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-[#E5F4F4] border border-[#4FAEB2]/25 flex items-center justify-center">
            <AlertTriangle className="h-4.5 w-4.5 text-[#3F8E91]" />
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{mensaje}</p>
        </div>
        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </ModalBase>
  );
}

function ModalAbrir({
  onClose,
  onConfirm,
  error,
  numeroSugerido,
  numerosOcupados,
}: {
  onClose: () => void;
  onConfirm: (monto: number, obs: string | null, numeroCaja: number, arqueo: ArqueoItem[] | null) => Promise<void>;
  error: string | null;
  numeroSugerido: number;
  numerosOcupados: number[];
}) {
  const [cant, setCant] = useState<ArqueoCantidades>(arqueoVacio());
  const [obs, setObs] = useState("");
  const [numero, setNumero] = useState(numeroSugerido);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  const totalArq = totalArqueo(cant);
  async function submit() {
    if (numerosOcupados.includes(numero)) {
      setErr(`La Caja ${numero} ya está activa. Elegí otro número.`);
      return;
    }
    const arqueo: ArqueoItem[] = cantidadesAArqueo(cant);
    const montoFinal = totalArq;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(montoFinal, obs.trim() || null, numero, arqueo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }
  // Opciones de caja: Caja 1 y Caja 2, deshabilitando las ya activas.
  const opciones = [1, 2];
  return (
    <ModalBase
      title="Abrir caja"
      subtitle="Elegí el número de caja y cargá el efectivo inicial del turno."
      onClose={busy ? () => {} : onClose}
      maxWidthClass="max-w-2xl"
    >
      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Número de caja
          </label>
          <div className="flex flex-wrap gap-2">
            {opciones.map((n) => {
              const ocupada = numerosOcupados.includes(n);
              const sel = numero === n;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={ocupada}
                  onClick={() => setNumero(n)}
                  className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
                    ocupada ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                    : sel ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Caja {n}
                </button>
              );
            })}
          </div>
        </div>

        {/* Se cuenta billete por billete y no se puede escribir el total de
            una. Un total escrito de memoria es justamente donde se cuela el
            error que después aparece como diferencia de caja sin explicación:
            el que carga 500.000 porque "siempre hay eso" no está contando. */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Conteo de efectivo inicial
          </label>
          <ArqueoDenominaciones value={cant} onChange={setCant} disabled={busy} />
          <p className="mt-1.5 text-[11px] text-slate-400">
            El saldo inicial sale del conteo: {fmtGs(totalArq)}.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Observación (opcional)
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
          />
        </div>
        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Abrir caja
        </button>
      </div>
    </ModalBase>
  );
}

function ModalCerrar({
  resumen,
  onClose,
  onConfirm,
}: {
  resumen: CajaResumen;
  onClose: () => void;
  onConfirm: (monto: number, obs: string | null, arqueo: ArqueoItem[] | null) => Promise<void>;
}) {
  const [cant, setCant] = useState<ArqueoCantidades>(arqueoVacio());
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const esperado = Math.round(resumen.efectivo_esperado);
  const contado = totalArqueo(cant);
  const diferencia = contado - esperado;

  async function submit() {
    const arqueo: ArqueoItem[] = cantidadesAArqueo(cant);
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(contado, obs.trim() || null, arqueo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <ModalBase
      title="Cerrar caja"
      subtitle="Contá el efectivo en mano. El sistema calcula la diferencia."
      onClose={busy ? () => {} : onClose}
      maxWidthClass="max-w-2xl"
    >
      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Resumen del arqueo */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
          <Row label="Apertura" value={fmtGs(resumen.caja.monto_apertura)} />
          <Row label={`Ventas efectivo (${resumen.cantidad_ventas})`} value={fmtGs(resumen.total_efectivo)} />
          {resumen.total_tarjeta > 0 && (
            <Row label="Ventas tarjeta (no suma)" value={fmtGs(resumen.total_tarjeta)} subtle />
          )}
          {resumen.total_transferencia > 0 && (
            <Row label="Ventas transferencia (no suma)" value={fmtGs(resumen.total_transferencia)} subtle />
          )}
          {resumen.total_cheque > 0 && (
            <Row label="Ventas cheque (no suma)" value={fmtGs(resumen.total_cheque)} subtle />
          )}
          {resumen.ingresos_efectivo > 0 && (
            <Row label="+ Ingresos manuales" value={fmtGs(resumen.ingresos_efectivo)} />
          )}
          {resumen.egresos_efectivo > 0 && (
            <Row label="− Egresos manuales" value={`-${fmtGs(resumen.egresos_efectivo)}`} />
          )}
          {resumen.retiros_efectivo > 0 && (
            <Row label="− Retiros" value={`-${fmtGs(resumen.retiros_efectivo)}`} />
          )}
          {/* La diferencia que viene de atrás: el faltante baja lo que se
              espera encontrar y el sobrante lo sube (pedido del cliente). */}
          {resumen.diferencia_arrastrada !== 0 && (
            <Row
              label={resumen.diferencia_arrastrada < 0
                ? "− Faltante del turno anterior"
                : "+ Sobrante del turno anterior"}
              value={`${resumen.diferencia_arrastrada < 0 ? "-" : "+"}${fmtGs(Math.abs(resumen.diferencia_arrastrada))}`}
            />
          )}
          <div className="border-t border-slate-200 mt-2 pt-2">
            <Row
              label="Efectivo esperado"
              value={fmtGs(esperado)}
              bold
              highlightTurquesa
            />
          </div>
        </div>

        {/* Se cuenta billete por billete y no se puede escribir el total de
            una. Escribir el esperado para que la diferencia dé cero no es
            cerrar la caja: es tapar el faltante, y el que lo paga es el cajero
            del turno siguiente. */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Conteo del efectivo en mano
          </label>
          <ArqueoDenominaciones value={cant} onChange={setCant} disabled={busy} />
        </div>

        {/* Vista previa de diferencia */}
        <div
          className={`rounded-xl border-2 px-3 py-3 flex items-center justify-between ${
            diferencia === 0
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
              : diferencia > 0
              ? "border-sky-200 bg-sky-50/60 text-sky-800"
              : "border-red-200 bg-red-50/60 text-red-800"
          }`}
        >
          <span className="text-xs font-semibold flex items-center gap-1.5">
            {diferencia === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            Diferencia
          </span>
          <span className="text-base font-bold tabular-nums">
            {diferencia >= 0 ? "+" : "−"}
            {fmtGs(Math.abs(diferencia))}
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Observación (opcional)
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
            placeholder={
              diferencia !== 0
                ? "Sugerido: explicá la diferencia"
                : "Nota opcional del cierre"
            }
          />
        </div>

        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Cerrar caja
        </button>
      </div>
    </ModalBase>
  );
}

/** Lo que se elige arriba del modal. Cobranza = `ingreso`; Anticipo va a Anticipos. */
type TipoPantalla = "ingreso" | "egreso" | "retiro" | "retencion" | "anticipo";
const TIPOS_PANTALLA: Array<[TipoPantalla, string]> = [
  ["ingreso", "Cobranza"],
  ["egreso", "Egreso"],
  ["retiro", "Retiro"],
  ["retencion", "Retención"],
  ["anticipo", "Anticipo"],
];

function ModalMovimiento({
  onClose,
  onConfirm,
  onAnticipo,
}: {
  onClose: () => void;
  onAnticipo: (opts: { cliente_id: string; monto: number; medio_pago: string; observacion: string | null }) => Promise<void>;
  onConfirm: (opts: {
    tipo: TipoMovimientoCaja;
    concepto: string;
    monto: number;
    medio_pago: MedioPagoCaja;
    observacion: string | null;
    /** Punto 5.7: clasificación del egreso. */
    tipo_egreso?: string | null;
    /** A quién se le pagó. Solo en egresos (script 58). */
    proveedor?: string | null;
    /** Punto 5.7: factura y recibo que lo respaldan. */
    adjuntos?: AdjuntoEgreso[] | null;
    cliente_nombre?: string | null;
    factura?: string | null;
  }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoPantalla>("ingreso");
  /** Retención y anticipo: de qué cliente. */
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  /** Retención: número de la factura retenida. */
  const [factura, setFactura] = useState("");
  // Punto 5.7: qué clase de egreso es. Sin esto no se puede contestar
  // "¿cuánto se fue en fletes este mes?" sin leer los conceptos uno por uno.
  const [tipoEgreso, setTipoEgreso] = useState<string>("proveedor");
  /** A quién se le pagó. Texto libre: ver el script 58. */
  const [proveedor, setProveedor] = useState("");
  const [proveedoresSug, setProveedoresSug] = useState<string[]>([]);
  /**
   * A qué cuenta del plan va cada clase de egreso.
   *
   * Se muestra, no se elige: la imputación la define el administrador en
   * Configuración. Pero mostrarla acá importa, porque es el momento en que
   * alguien elige la clase de egreso y es donde se nota si la clase elegida
   * manda la plata a un renglón que no es.
   */
  const [cuentasEgreso, setCuentasEgreso] = useState<Record<string, string>>({});

  /**
   * Los proveedores del padrón, como sugerencia al escribir.
   *
   * Si falla no pasa nada: el campo es libre igual. Sugerir ahorra tipear y,
   * sobre todo, evita que el mismo proveedor quede cargado de tres maneras
   * distintas, que es lo que arruina el informe de egresos por proveedor.
   */
  useEffect(() => {
    fetch("/api/proveedores", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const filas = Array.isArray(j?.data) ? j.data : (j?.data?.proveedores ?? []);
        const nombres = (filas as Array<Record<string, unknown>>)
          .map((x) => String(x.nombre ?? x.razon_social ?? "").trim())
          .filter(Boolean);
        setProveedoresSug([...new Set(nombres)].sort((a, b) => a.localeCompare(b, "es")));
      })
      .catch(() => { /* sin sugerencias: el campo sigue siendo libre */ });
  }, []);

  useEffect(() => {
    fetch("/api/configuracion/cuentas-egreso", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        const mapa: Record<string, string> = {};
        const cuentas = new Map<string, string>(
          ((j.data?.cuentas ?? []) as Array<Record<string, unknown>>).map((c) => [
            String(c.id),
            `${String(c.cuenta ?? "")} · ${String(c.denominacion ?? "")}`,
          ])
        );
        for (const cl of (j.data?.clases ?? []) as Array<Record<string, unknown>>) {
          const id = cl.cuenta_id ? String(cl.cuenta_id) : "";
          if (id && cuentas.has(id)) mapa[String(cl.tipo_egreso)] = cuentas.get(id)!;
        }
        setCuentasEgreso(mapa);
      })
      // Sin el script 59 esto no existe todavía: el egreso se carga igual.
      .catch(() => { /* la caja no se frena por una configuración contable */ });
  }, []);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("0");
  const [medio, setMedio] = useState<MedioPagoCaja>("efectivo");
  const [obs, setObs] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoEgreso[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pideConcepto = tipo !== "retencion" && tipo !== "anticipo";
  const pideCliente = tipo === "retencion" || tipo === "anticipo";

  async function submit() {
    const n = Number(monto);
    if (pideConcepto && !concepto.trim()) {
      setErr("Concepto requerido.");
      return;
    }
    if (!Number.isFinite(n) || n <= 0) {
      setErr("El monto debe ser mayor a cero.");
      return;
    }
    if (pideCliente && !cliente) {
      setErr("Elegí el cliente.");
      return;
    }
    if (tipo === "retencion" && !factura.trim()) {
      setErr("Poné el número de factura.");
      return;
    }
    if (tipo === "anticipo") {
      setBusy(true);
      setErr(null);
      try {
        await onAnticipo({ cliente_id: cliente!.id, monto: n, medio_pago: medio === "otro" ? "cheque" : medio, observacion: obs.trim() || null });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error");
        setBusy(false);
      }
      return;
    }
    // "Otros" sin explicación es un egreso que nadie va a poder justificar
    // cuando el contador pregunte.
    if (tipo === "egreso" && tipoEgreso === "otros" && !obs.trim()) {
      setErr("Si el egreso es 'Otros', escribí el motivo en las notas.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm({
        tipo,
        concepto: tipo === "retencion" ? "Retención" : concepto.trim(),
        cliente_nombre: tipo === "retencion" ? cliente!.nombre : null,
        factura: tipo === "retencion" ? factura.trim() : null,
        monto: n,
        medio_pago: medio,
        observacion: obs.trim() || null,
        tipo_egreso: tipo === "egreso" ? tipoEgreso : null,
        proveedor: tipo === "egreso" ? (proveedor.trim() || null) : null,
        // Solo en egresos: un ingreso o un retiro no tienen factura de proveedor.
        adjuntos: tipo === "egreso" && adjuntos.length > 0 ? adjuntos : null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <ModalBase
      title="Registrar movimiento"
      subtitle="Cobranzas, egresos, retiros, retenciones y anticipos de la caja (no son ventas)."
      onClose={busy ? () => {} : onClose}
    >
      {/* El cuerpo scrollea; el pie con «Registrar» queda fijo abajo.
          Era el único de los tres modales del panel sin alto máximo, y como
          el contenedor recorta lo que sobra, en una pantalla baja el
          formulario se cortaba y no se podía llegar al botón: el movimiento
          no se podía registrar. */}
      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Tipo
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            {TIPOS_PANTALLA.map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTipo(t); setErr(null); }}
                className={`rounded-lg py-1.5 text-xs font-bold border-2 transition-colors ${
                  tipo === t
                    ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tipo === "anticipo" && (
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              Queda registrado en <strong>Anticipos</strong> a nombre del cliente y entra en el arqueo de esta caja.
            </p>
          )}
          {tipo === "retencion" && (
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              El comprobante de retención que deja el cliente. No es efectivo: no cambia lo que tiene que haber en el cajón.
            </p>
          )}
        </div>

        {pideCliente && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Cliente</label>
            <BuscadorCliente value={cliente} onChange={setCliente} disabled={busy} autoFocus />
          </div>
        )}

        {tipo === "retencion" && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Factura</label>
            <input
              type="text"
              value={factura}
              onChange={(e) => setFactura(e.target.value)}
              placeholder="Ej: 001-001-0001234"
              maxLength={60}
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            />
          </div>
        )}

        {tipo === "egreso" && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Tipo de egreso
            </label>
            <Selector
              value={tipoEgreso}
              onChange={(e) => setTipoEgreso(e.target.value)}
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            >
              {TIPOS_EGRESO.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Selector>
            {tipoEgreso === "otros" && (
              <p className="mt-1 text-[11px] text-amber-600">
                Escribí el motivo en las notas de abajo: es obligatorio para &quot;Otros&quot;.
              </p>
            )}
            {/* A qué cuenta va. Se muestra para que se vea acá, que es cuando
                se elige la clase, si la plata va a parar donde corresponde. */}
            <p className="mt-1 text-[11px] leading-snug">
              {cuentasEgreso[tipoEgreso] ? (
                <span className="text-slate-500">
                  Va a la cuenta <strong className="text-slate-700">{cuentasEgreso[tipoEgreso]}</strong>
                </span>
              ) : (
                <span className="text-amber-700">
                  Esta clase todavía no tiene cuenta contable asignada.
                </span>
              )}
            </p>
          </div>
        )}

        {/* A quién se le pagó.
            El tipo de egreso dice que fue a un proveedor; esto dice a CUÁL.
            Sin este dato, veinte pagos del mes son una lista de "proveedor ·
            1.500.000" y hay que abrir los comprobantes de a uno para saber
            quién cobró.

            Es texto libre con sugerencias, no una lista cerrada: en caja se le
            paga también a quien no está dado de alta —el flete de una vez, el
            service del portón— y obligar a elegir haría que se cargue
            cualquiera con tal de seguir. */}
        {tipo === "egreso" && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              A quién se le pagó{" "}
              <span className="font-normal normal-case text-slate-400">(opcional)</span>
            </label>
            <input
              type="text"
              list="caja-proveedores-sug"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              disabled={busy}
              placeholder="Nombre del proveedor o de quien cobró"
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            />
            <datalist id="caja-proveedores-sug">
              {proveedoresSug.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
        )}

        {pideConcepto && (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Concepto
          </label>
          <input
            type="text"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder={tipo === "ingreso" ? "Ej: Cobro factura 1234 de Pérez" : "Ej: Pago de delivery, Vuelto, etc."}
            maxLength={200}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
          />
        </div>
        )}

        <div className={`grid gap-3 ${tipo === "retencion" ? "grid-cols-1" : "grid-cols-2"}`}>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Monto (Gs.)
            </label>
            <MontoInput
              value={monto}
              onChange={(n) => setMonto(String(n))}
              decimals={false}
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-semibold tabular-nums focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
            />
          </div>
          {tipo !== "retencion" && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Medio de pago
            </label>
            <Selector
              value={medio}
              onChange={(e) => setMedio(e.target.value as MedioPagoCaja)}
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none bg-white"
            >
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
              <option value="otro">{tipo === "anticipo" ? "Cheque" : "Otro"}</option>
            </Selector>
          </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Observación (opcional)
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
          />
        </div>

        {/* Solo en egresos: un ingreso o un retiro no tienen factura de
            proveedor que adjuntar. */}
        {tipo === "egreso" && (
          <AdjuntosEgreso value={adjuntos} onChange={setAdjuntos} disabled={busy} />
        )}

        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Registrar
        </button>
      </div>
    </ModalBase>
  );
}

function Row({
  label,
  value,
  bold,
  subtle,
  highlightTurquesa,
}: {
  label: string;
  value: string;
  bold?: boolean;
  subtle?: boolean;
  highlightTurquesa?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`${bold ? "font-bold text-slate-800" : subtle ? "text-slate-400" : "text-slate-600"}`}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          bold ? "font-bold" : ""
        } ${highlightTurquesa ? "text-[#3F8E91] text-sm" : subtle ? "text-slate-400" : "text-slate-700"}`}
      >
        {value}
      </span>
    </div>
  );
}
