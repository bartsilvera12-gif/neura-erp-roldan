"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import ReciboProveedor from "@/components/pagos/ReciboProveedor";
import MarcarFacturaPagadaModal from "@/components/pagos/MarcarFacturaPagadaModal";
import {
  agruparDeuda, textoVencimiento,
  type FacturaClasificada, type FacturaProveedor, type ProveedorDeuda,
} from "@/lib/pagos/deuda-proveedores";
import { ChevronDown, ChevronRight, FileText, Printer, Search, Wallet } from "lucide-react";

/**
 * Pagos a proveedores: a quién hay que pagarle y cuánto.
 *
 * ── QUÉ CAMBIÓ Y POR QUÉ ───────────────────────────────────────────────────
 *   "pagos a proveedores se ve raro porque no se entiende."
 *
 *   Antes esto era un "Estado de cuenta" con una tabla dentro de otra tabla:
 *   se abría un proveedor y aparecía una sub-tabla de ocho columnas con N° de
 *   control, N° de factura y el medio de pago pegado con puntos. Para MV
 *   ACEROS eso son 3.050 filas de una vez.
 *
 *   Ahora cada proveedor es una tarjeta con lo único que se necesita para
 *   decidir —cuánto se le debe, cuánto está vencido y desde cuándo— y el
 *   botón que sigue: armar la orden de pago. Las facturas se abren si se
 *   quieren ver, de a 20, la más urgente primero.
 *
 * ── EL NÚMERO GRANDE NO ERA REAL ───────────────────────────────────────────
 *   La migración trajo 14.592 facturas a crédito como impagas, de 2019 a 2026,
 *   por Gs. 42.355.932.033. Esa pantalla decía que la empresa debe 42 mil
 *   millones. Por eso ahora hay una ventana de trabajo —lo que vence o venció
 *   hace poco— y el resto se cuenta aparte, con su aviso.
 */

type FacturaApi = {
  numero_control: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  plazo_dias: number | null;
  estado: string;
  metodo_pago: string | null;
  referencia_pago: string | null;
  fecha_pago: string | null;
  recibo_storage_path: string | null;
  recibo_nombre: string | null;
  recibo_subido_at: string | null;
  total: number;
  vencimiento: string | null;
};

type ProveedorApi = {
  proveedor_id: string | null;
  proveedor_nombre: string;
  facturas: FacturaApi[];
};

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fmt = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

/** Las ventanas de trabajo. `null` = sin corte, entra todo el histórico. */
const VENTANAS: { dias: number | null; label: string }[] = [
  { dias: 60, label: "Último mes y medio" },
  { dias: 120, label: "Últimos 4 meses" },
  { dias: 365, label: "Último año" },
  { dias: null, label: "Todo el histórico" },
];

/** Cuántas facturas se muestran por proveedor antes de pedir más. */
const TANDA = 20;

export default function PagosProveedoresPage() {
  const [facturas, setFacturas] = useState<FacturaProveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dias, setDias] = useState<number | null>(120);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [cuantas, setCuantas] = useState<Record<string, number>>({});
  const [pagando, setPagando] = useState<FacturaClasificada | null>(null);
  // false = falta el script 68 y la base todavía no tiene dónde guardar el
  // recibo. Se dice, en vez de mostrar un botón que va a fallar.
  const [recibosDisponibles, setRecibosDisponibles] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/pagos/proveedores-estado-cuenta", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const provs = (j.data?.proveedores ?? []) as ProveedorApi[];
      // La API ya agrupa, pero el corte por ventana y el orden por urgencia se
      // hacen acá sobre la lista plana, para poder cambiar la ventana sin
      // volver a pedir las 14.592 filas.
      setFacturas(
        provs.flatMap((p) =>
          (p.facturas ?? []).map((f) => ({
            ...f,
            proveedor_id: p.proveedor_id,
            proveedor_nombre: p.proveedor_nombre,
          }))
        )
      );
      setRecibosDisponibles(j.data?.recibos_disponibles !== false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const resumen = useMemo(() => agruparDeuda(facturas, { diasAtras: dias }), [facturas, dias]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    const con = resumen.proveedores.filter((p) => p.cantidad > 0 || p.historico_cantidad > 0);
    return s ? con.filter((p) => p.proveedor_nombre.toLowerCase().includes(s)) : con;
  }, [resumen, q]);

  function toggle(clave: string) {
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(clave)) n.delete(clave);
      else n.add(clave);
      return n;
    });
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Pagos"
        title="Pagos a proveedores"
        description="A quién hay que pagarle, cuánto y desde cuándo"
        actions={
          <Link
            href="/pagos/orden-pago"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            <Wallet className="h-4 w-4" /> Armar orden de pago
          </Link>
        }
      />

      {/* ── Los tres números de la ventana ────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Vencido</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rose-800">{gs(resumen.vencido)}</p>
          <p className="text-[11px] text-rose-600">Es lo que se paga primero</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Total a pagar</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-800">{gs(resumen.pendiente)}</p>
          <p className="text-[11px] text-amber-600">{resumen.cantidad} facturas sin pagar</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proveedores</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{visibles.length}</p>
          <p className="text-[11px] text-slate-500">
            {resumen.corte ? `Con vencimiento desde el ${fmt(resumen.corte)}` : "Todo el histórico"}
          </p>
        </div>
      </div>

      {/* ── El aviso que explica el número de 42 mil millones ─────────── */}
      {resumen.historico_cantidad > 0 && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">
            Hay {resumen.historico_cantidad.toLocaleString("es-PY")} facturas más viejas sin marcar como
            pagadas, por {gs(resumen.historico_monto)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            No están contadas arriba a propósito. Son anteriores al {fmt(resumen.corte)} y vienen de la
            migración, que no trajo el estado de pago: todas las compras a crédito entraron como impagas,
            incluso las de 2019. Hasta que se revisen, ese monto no es deuda real. Se van cerrando de a
            una con <strong>Marcar pagada</strong>, o se puede ver el histórico completo cambiando el
            período acá abajo.
          </p>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Período</span>
          <select
            value={dias == null ? "todo" : String(dias)}
            onChange={(e) => setDias(e.target.value === "todo" ? null : Number(e.target.value))}
            className="w-52 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {VENTANAS.map((v) => (
              <option key={v.label} value={v.dias == null ? "todo" : String(v.dias)}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proveedor</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…"
              className="w-64 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm"
            />
          </div>
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : visibles.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">
            {q ? "Ningún proveedor con ese nombre." : "No hay nada por pagar en el período."}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Probá con un período más largo si estás buscando una factura vieja.
          </p>
        </div>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {visibles.map((p) => {
            const clave = p.proveedor_id ?? `nombre:${p.proveedor_nombre}`;
            return (
              <TarjetaProveedor
                key={clave}
                p={p}
                abierto={abiertos.has(clave)}
                onToggle={() => toggle(clave)}
                mostrar={cuantas[clave] ?? TANDA}
                onMostrarMas={() => setCuantas((c) => ({ ...c, [clave]: (c[clave] ?? TANDA) + TANDA }))}
                recibosDisponibles={recibosDisponibles}
                onRecargar={() => void cargar()}
                onPagar={setPagando}
              />
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Para pagar <strong>varias facturas de un proveedor con un solo cheque</strong>, usá{" "}
        <strong>Armar orden de pago</strong>: junta las que elijas, imprime la orden que las detalla y
        después se carga el recibo que firma el proveedor, con su número. Eso es lo que termina la
        discusión cuando un proveedor traspapela un documento y vuelve a reclamar una factura ya pagada.
      </p>

      {pagando && (
        <MarcarFacturaPagadaModal
          factura={pagando}
          onClose={() => setPagando(null)}
          onExito={async () => { setPagando(null); await cargar(); }}
        />
      )}
    </div>
  );
}

function TarjetaProveedor({
  p, abierto, onToggle, mostrar, onMostrarMas, recibosDisponibles, onRecargar, onPagar,
}: {
  p: ProveedorDeuda;
  abierto: boolean;
  onToggle: () => void;
  mostrar: number;
  onMostrarMas: () => void;
  recibosDisponibles: boolean;
  onRecargar: () => void;
  onPagar: (f: FacturaClasificada) => void;
}) {
  const hayMas = p.facturas.length > mostrar;

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button" onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={abierto}
        >
          {abierto
            ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900">{p.proveedor_nombre}</span>
            <span className="block text-[11px] text-slate-500">
              {p.cantidad} {p.cantidad === 1 ? "factura" : "facturas"}
              {p.cantidad_vencida > 0 && (
                <> · <span className="font-semibold text-rose-600">
                  {p.cantidad_vencida} vencida{p.cantidad_vencida === 1 ? "" : "s"}
                  {p.dias_mas_vieja > 0 ? `, la más vieja hace ${p.dias_mas_vieja} días` : ""}
                </span></>
              )}
              {p.proximo_vencimiento && p.cantidad_vencida === 0 && (
                <> · próximo vencimiento {fmt(p.proximo_vencimiento)}</>
              )}
            </span>
          </span>
        </button>

        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-slate-900">{gs(p.pendiente)}</p>
          {p.vencido > 0 && (
            <p className="text-[11px] font-semibold tabular-nums text-rose-600">{gs(p.vencido)} vencido</p>
          )}
        </div>

        {p.proveedor_id && p.cantidad > 0 && (
          <Link
            href={`/pagos/orden-pago?proveedor=${encodeURIComponent(p.proveedor_id)}`}
            className="shrink-0 rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91]"
          >
            Armar orden de pago
          </Link>
        )}
      </div>

      {p.historico_cantidad > 0 && (
        <p className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-500">
          Además tiene {p.historico_cantidad.toLocaleString("es-PY")} facturas más viejas sin marcar
          como pagadas por {gs(p.historico_monto)}, que vienen de la migración.
        </p>
      )}

      {abierto && (
        <div className="border-t border-slate-200">
          {p.facturas.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No tiene facturas en el período: lo que debe es todo del histórico migrado.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-slate-100 p-0">
              {p.facturas.slice(0, mostrar).map((f) => (
                <li key={f.numero_control} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      {f.numero_factura || f.numero_control}
                    </span>
                    <span className={`block text-[11px] ${f.estado_calc === "vencida" ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                      {fmt(f.vence)} · {textoVencimiento(f.dias)}
                    </span>
                  </span>

                  <span className="text-right text-sm font-semibold tabular-nums text-slate-900">
                    {gs(f.total)}
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    <ReciboProveedor
                      numeroControl={f.numero_control}
                      path={f.recibo_storage_path ?? null}
                      nombre={f.recibo_nombre ?? null}
                      disponible={recibosDisponibles}
                      onCambio={onRecargar}
                    />
                    <button
                      type="button" onClick={() => onPagar(f)}
                      className="rounded-lg border border-[#4FAEB2] px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10"
                    >
                      Marcar pagada
                    </button>
                    <button
                      type="button" onClick={() => void imprimirOrdenSuelta(f.numero_control)}
                      title="Imprimir la orden de esta factura sola"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {hayMas && (
            <button
              type="button" onClick={onMostrarMas}
              className="w-full border-t border-slate-100 bg-slate-50 py-2 text-[11px] font-medium text-[#3F8E91] hover:bg-slate-100"
            >
              Mostrar {Math.min(TANDA, p.facturas.length - mostrar)} más
              {" "}({p.facturas.length - mostrar} sin mostrar)
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** La orden de UNA factura. La consolidada —varias en un cheque— es otra pantalla. */
async function imprimirOrdenSuelta(numeroControl: string) {
  try {
    const r = await fetchWithSupabaseSession(
      `/api/compras/orden-pago?numero_control=${encodeURIComponent(numeroControl)}`
    );
    if (!r.ok) { alert("No se pudo generar la orden."); return; }
    const html = await r.text();
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  } catch {
    alert("No se pudo generar la orden.");
  }
}
