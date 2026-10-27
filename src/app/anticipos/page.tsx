"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import AccionesTabla from "@/components/ui/AccionesTabla";

/**
 * Anticipos de clientes (punto 5.6).
 *
 * Plata que el cliente dejó a cuenta y todavía no se facturó. Mientras está
 * activa es una deuda de la empresa: mercadería que se le debe.
 *
 * Por eso lo primero que se ve arriba es cuánto hay sin usar, y el listado
 * arranca filtrado en activos: los usados y los anulados ya no deben nada.
 */

type Anticipo = {
  id: string; numero: string | null; cliente_id: string | null; cliente_nombre: string;
  fecha: string; monto: number; medio_pago: string; estado: string;
  usuario_nombre: string; observacion: string;
  anulado_motivo: string | null; anulado_por: string | null;
};
type PorCliente = { cliente_id: string; nombre: string; total: number; cantidad: number };
type Respuesta = {
  anticipos: Anticipo[];
  por_cliente: PorCliente[];
  resumen: { total: number; activos: number; monto_activo: number; utilizados: number; anulados: number };
};
type ClienteLite = { id: string; nombre: string };

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

function fechaPy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

const BADGE: Record<string, string> = {
  activo: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  utilizado: "bg-slate-100 text-slate-600 ring-slate-200",
  anulado: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function AnticiposPage() {
  const { isAdmin } = useIsAdmin();
  const [estado, setEstado] = useState("activo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (estado) sp.set("estado", estado);
      if (desde) sp.set("desde", desde);
      if (hasta) sp.set("hasta", hasta);
      if (q) sp.set("q", q);
      const r = await fetchWithSupabaseSession(`/api/anticipos?${sp}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudieron cargar los anticipos.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [estado, desde, hasta, q]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function anular(a: Anticipo) {
    const motivo = window.prompt(
      `Anular el anticipo ${a.numero} de ${a.cliente_nombre} por ${gs(a.monto)}.\n\n` +
      "¿Por qué? Queda guardado: si el cliente reclama, esto es lo que se le muestra."
    );
    if (motivo == null) return;
    if (!motivo.trim()) { alert("Hace falta el motivo."); return; }
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/anticipos/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "anular", motivo: motivo.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo anular.");
      setAviso(`Anticipo ${a.numero} anulado.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  }

  const r = data?.resumen;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Anticipos de clientes</h1>
          <p className="text-sm text-slate-500">
            Plata que dejaron a cuenta y todavía no se facturó.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Requisito 11.1. Los anulados van con su motivo: la planilla tiene
              que poder explicar por qué ese número no suma. */}
          <AccionesTabla
            titulo="Anticipos de clientes"
            archivo={`anticipos-${desde || "inicio"}_${hasta || "hoy"}`}
            subtitulo={desde || hasta ? `Del ${desde || "inicio"} al ${hasta || "hoy"}` : undefined}
            columnas={["Número", "Fecha", "Cliente", "Monto", "Medio", "Estado", "Registró", "Observación", "Motivo de anulación"]}
            filas={(data?.anticipos ?? []).map((a) => [
              a.numero ?? "",
              fechaPy(a.fecha),
              a.cliente_nombre,
              a.monto,
              a.medio_pago,
              a.estado,
              a.usuario_nombre ?? "",
              a.observacion ?? "",
              a.anulado_motivo ?? "",
            ])}
          />
          <button
            type="button"
            onClick={() => setNuevo(true)}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            + Registrar anticipo
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {aviso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{aviso}</div>}

      {r && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tarjeta label="Se debe en mercadería" valor={gs(r.monto_activo)} destacado
            sub={`${r.activos} anticipo${r.activos === 1 ? "" : "s"} sin usar`} />
          <Tarjeta label="Activos" valor={String(r.activos)} />
          <Tarjeta label="Utilizados" valor={String(r.utilizados)} />
          <Tarjeta label="Anulados" valor={String(r.anulados)} />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="activo">Activos</option>
            <option value="utilizado">Utilizados</option>
            <option value="anulado">Anulados</option>
            <option value="">Todos</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Desde</span>
          <input type="date" value={desde} max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Hasta</span>
          <input type="date" value={hasta} min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <form className="flex flex-1 flex-col gap-1"
          onSubmit={(e) => { e.preventDefault(); setQ(qDraft.trim()); }}>
          <span className="text-[11px] font-semibold uppercase text-slate-500">Buscar</span>
          <div className="flex gap-2">
            <input type="text" value={qDraft} onChange={(e) => setQDraft(e.target.value)}
              placeholder="Número, cliente o nota…"
              className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <button type="submit"
              className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#4FAEB2]">
              Buscar
            </button>
          </div>
        </form>
      </div>

      {/* Acumulado por cliente */}
      {data && data.por_cliente.length > 0 && estado === "activo" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Acumulado por cliente
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.por_cliente.map((c) => (
              <span key={c.cliente_id}
                className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
                {c.nombre}
                <b className="ml-1.5 text-[#3F8E91]">{gs(c.total)}</b>
                <span className="ml-1 text-slate-400">({c.cantidad})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3">Medio</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Registró</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">Cargando…</td></tr>
              ) : (data?.anticipos.length ?? 0) === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  No hay anticipos con esos filtros.
                </td></tr>
              ) : data!.anticipos.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{a.numero ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fechaPy(a.fecha)}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{a.cliente_nombre}</p>
                    {a.observacion && <p className="text-[11px] text-slate-400">{a.observacion}</p>}
                    {a.estado === "anulado" && a.anulado_motivo && (
                      <p className="text-[11px] text-rose-600">
                        Anulado por {a.anulado_por}: {a.anulado_motivo}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">{gs(a.monto)}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-500">{a.medio_pago}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${BADGE[a.estado] ?? BADGE.utilizado}`}>
                      {a.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{a.usuario_nombre || "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {a.estado === "activo" && isAdmin && (
                      <button type="button" onClick={() => void anular(a)}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100">
                        Anular
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
        Un anticipo <strong>activo</strong> es plata que el cliente dejó y que todavía se le debe en
        mercadería. <strong>Utilizado</strong> es el que ya se aplicó a una venta y{" "}
        <strong>anulado</strong> el que se devolvió o se canceló. Los anulados no se borran: el
        registro queda con su número, su monto y el motivo, porque esa plata sí entró el día que
        entró y aparece en el arqueo de ese turno.
      </p>

      {nuevo && (
        <ModalNuevo
          onClose={() => setNuevo(false)}
          onCreado={(msg) => { setAviso(msg); void cargar(); }}
        />
      )}
    </div>
  );
}

function ModalNuevo({ onClose, onCreado }: { onClose: () => void; onCreado: (m: string) => void }) {
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [observacion, setObservacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clientes", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        const lista = (j.data?.clientes ?? []) as Array<Record<string, unknown>>;
        setClientes(lista.map((c) => ({
          id: String(c.id),
          nombre: String(c.nombre_facturacion ?? c.empresa ?? c.nombre_contacto ?? c.nombre ?? ""),
        })).filter((c) => c.nombre));
      })
      .catch(() => { /* se puede escribir el nombre a mano igual */ });
  }, []);

  async function guardar() {
    const m = Number(monto);
    if (!Number.isFinite(m) || m <= 0) { setError("El monto tiene que ser mayor a cero."); return; }
    if (!clienteId) { setError("Elegí el cliente."); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/anticipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, monto: m, medio_pago: medio, observacion }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo registrar.");
      const d = j.data as { anticipo: { numero: string }; en_caja: boolean };
      onCreado(
        `Anticipo ${d.anticipo.numero} registrado.` +
        (d.en_caja ? " Entra en el arqueo del turno abierto." : " No hay turno de caja abierto: no entra en ningún arqueo.")
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Registrar anticipo</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
            La plata entra al turno de caja abierto, pero queda como deuda con el cliente hasta
            que se use en una venta.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Cliente</span>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">— Elegir —</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Monto</span>
              <input type="number" min={1} value={monto} onChange={(e) => setMonto(e.target.value)}
                placeholder="Gs." className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Medio</span>
              <select value={medio} onChange={(e) => setMedio(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="cheque">Cheque</option>
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-slate-800">Nota <span className="text-slate-400">(opcional)</span></span>
            <input type="text" value={observacion} onChange={(e) => setObservacion(e.target.value)}
              placeholder="Ej: seña por 20 chapas C24"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <button type="button" onClick={onClose} disabled={guardando}
            className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={() => void guardar()} disabled={guardando}
            className="flex-1 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {guardando ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tarjeta({ label, valor, sub, destacado = false }: {
  label: string; valor: string; sub?: string; destacado?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${destacado ? "border-[#4FAEB2]/40" : "border-slate-200"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${destacado ? "text-[#3F8E91]" : "text-slate-900"}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
