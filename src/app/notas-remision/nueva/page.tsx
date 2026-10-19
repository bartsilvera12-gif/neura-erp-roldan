"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck, Send } from "lucide-react";
import { fetchDepositos, fetchStockDeposito, crearNR, type Deposito, type StockItem } from "@/lib/multideposito/client";

function fmt(n: number) { return n.toLocaleString("es-PY"); }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

export default function EmitirNRPage() {
  const router = useRouter();
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [stockOrigen, setStockOrigen] = useState<StockItem[]>([]);
  const [motivo, setMotivo] = useState<"traslado" | "venta" | "devolucion">("traslado");
  const [emisor, setEmisor] = useState("");
  const [obs, setObs] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [productosAgregados, setProductosAgregados] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [dropdownAbierto, setDropdownAbierto] = useState(false);
  const [transportista, setTransportista] = useState("");
  const [rucTransp, setRucTransp] = useState("");
  const [conductor, setConductor] = useState("");
  const [ciConductor, setCiConductor] = useState("");
  const [chapa, setChapa] = useState("");
  const [fechaInicio, setFechaInicio] = useState(hoyISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState<{ id: string; numero: string; destinoNombre: string } | null>(null);

  // Cargar depósitos
  useEffect(() => {
    (async () => {
      const r = await fetchDepositos();
      if (!r.ok) { setError(r.error); return; }
      setDepositos(r.data.depositos);
      // Default sensato: Central → Abasto Norte (el flujo más común: reponer
      // planchas al depósito de venta). Si no encontramos alguno por código,
      // caemos al primero/segundo disponible.
      const central = r.data.depositos.find((d) => d.codigo === "CENTRAL");
      const abasto = r.data.depositos.find((d) => d.codigo === "ABASTO-N");
      if (r.data.depositos.length > 0) {
        setOrigen(central?.id ?? r.data.depositos[0].id);
        setDestino(abasto?.id ?? r.data.depositos[1]?.id ?? r.data.depositos[0].id);
      }
    })();
  }, []);

  const cargarStock = useCallback(async (ubicacionId: string) => {
    if (!ubicacionId) return;
    const r = await fetchStockDeposito(ubicacionId, { soloConStock: true });
    if (!r.ok) { setError(r.error); return; }
    setStockOrigen(r.data.items);
  }, []);

  useEffect(() => { if (origen) cargarStock(origen); }, [origen, cargarStock]);

  const total = useMemo(
    () => Object.values(cantidades).reduce((s, n) => s + (n || 0), 0),
    [cantidades]
  );

  const nombreUbic = (id: string) => depositos.find((d) => d.id === id)?.nombre ?? "—";

  async function emitir() {
    setError(null);
    if (origen === destino) { setError("Origen y destino no pueden ser iguales."); return; }
    if (!emisor.trim()) { setError("Emisor obligatorio."); return; }
    const items = productosAgregados
      .map((pid) => ({ producto_id: pid, cantidad: Number(cantidades[pid] ?? 0) }))
      .filter((i) => i.cantidad > 0);
    if (items.length === 0) { setError("Cargá al menos 1 producto con cantidad > 0."); return; }
    setEnviando(true);
    const r = await crearNR({
      emisor: emisor.trim(),
      ubicacion_origen_id: origen,
      ubicacion_destino_id: destino,
      motivo,
      items,
      transportista: transportista.trim() || undefined,
      ruc_transportista: rucTransp.trim() || undefined,
      conductor: conductor.trim() || undefined,
      ci_conductor: ciConductor.trim() || undefined,
      chapa: chapa.trim() || undefined,
      fecha_inicio_traslado: fechaInicio || undefined,
      fecha_fin_traslado: fechaFin || undefined,
      observaciones: obs.trim() || undefined,
    });
    setEnviando(false);
    if (!r.ok) { setError(r.error); return; }
    setCreada({
      id: r.data.nota_remision.id,
      numero: r.data.nota_remision.numero,
      destinoNombre: nombreUbic(destino),
    });
  }

  if (creada) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm text-emerald-900">
          <h2 className="text-lg font-semibold">✓ Nota de Remisión {creada.numero} emitida</h2>
          <p className="mt-2 text-sm">Queda en estado <strong>pendiente</strong> hasta que {creada.destinoNombre} confirme la recepción.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/notas-remision" className="rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">Ver historial</Link>
            <button
              type="button"
              onClick={() => { setCreada(null); setCantidades({}); setProductosAgregados([]); setEmisor(""); setObs(""); }}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >Emitir otra</button>
            <button type="button" onClick={() => router.push("/notas-remision/recepcion")} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Ir a Recepción</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-amber-50/40 to-amber-50/60 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-100/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-800">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600" /> Nueva emisión
          </span>
        </div>
        <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <span className="rounded-lg bg-white p-1.5 ring-1 ring-amber-300/40 shadow-sm">
            <Truck className="h-5 w-5 text-amber-700" />
          </span>
          Emitir Nota de Remisión
        </h1>
        <p className="mt-1 text-sm text-slate-500">Traslado de mercadería entre depósitos. Queda pendiente hasta que el destino confirme.</p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Datos generales</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Depósito Origen *">
            <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              {depositos.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </Field>
          <Field label="Depósito Destino *">
            <select value={destino} onChange={(e) => setDestino(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              {depositos.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </Field>
          <Field label="Motivo">
            <select value={motivo} onChange={(e) => setMotivo(e.target.value as typeof motivo)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="traslado">Traslado</option>
              <option value="venta">Venta</option>
              <option value="devolucion">Devolución</option>
            </select>
          </Field>
          <Field label="Emisor *">
            <input type="text" value={emisor} onChange={(e) => setEmisor(e.target.value)} placeholder="Ej: Marcial (Central)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </Field>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Transporte (opcional)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Transportista"><input type="text" value={transportista} onChange={(e) => setTransportista(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
          <Field label="RUC transportista"><input type="text" value={rucTransp} onChange={(e) => setRucTransp(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
          <Field label="Conductor"><input type="text" value={conductor} onChange={(e) => setConductor(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
          <Field label="CI conductor"><input type="text" value={ciConductor} onChange={(e) => setCiConductor(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
          <Field label="Chapa vehículo"><input type="text" value={chapa} onChange={(e) => setChapa(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
          <Field label="Inicio traslado"><input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
          <Field label="Fin traslado"><input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></Field>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Productos a trasladar</h2>
            <p className="text-xs text-slate-500">Buscando en <strong>{nombreUbic(origen)}</strong></p>
          </div>
          <div className="relative">
            <input
              type="text"
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setDropdownAbierto(true); }}
              onFocus={() => setDropdownAbierto(true)}
              onBlur={() => setTimeout(() => setDropdownAbierto(false), 150)}
              placeholder="Buscar producto por nombre o SKU…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            {dropdownAbierto && (() => {
              const q = busqueda.trim().toLowerCase();
              const disponibles = stockOrigen
                .filter((p) => !productosAgregados.includes(p.producto_id))
                .filter((p) => q === "" || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
                .slice(0, 8);
              if (disponibles.length === 0) return null;
              return (
                <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {disponibles.map((p) => (
                    <button
                      key={p.producto_id}
                      type="button"
                      onMouseDown={() => {
                        setProductosAgregados([...productosAgregados, p.producto_id]);
                        setBusqueda(""); setDropdownAbierto(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-emerald-50 text-left border-b border-slate-100 last:border-0"
                    >
                      <div>
                        <div className="font-semibold text-slate-800">{p.nombre}</div>
                        {p.sku && <div className="text-[11px] text-slate-500 font-mono">{p.sku}</div>}
                      </div>
                      <div className="text-xs text-emerald-700 font-semibold">Disp: {fmt(p.stock)}</div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Producto</th>
                <th className="px-5 py-3 text-right">Disponible</th>
                <th className="px-5 py-3 text-right w-40">Cantidad</th>
                <th className="px-5 py-3 text-right w-14"></th>
              </tr>
            </thead>
            <tbody>
              {productosAgregados.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400 italic">
                    Buscá y agregá los productos a trasladar desde el buscador de arriba.
                  </td>
                </tr>
              ) : productosAgregados.map((pid) => {
                const p = stockOrigen.find((x) => x.producto_id === pid);
                if (!p) return null;
                const cant = cantidades[pid] ?? 0;
                return (
                  <tr key={pid} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-semibold text-slate-700">
                      {p.nombre}
                      {p.sku && <span className="ml-2 text-[10px] text-slate-500 font-mono font-normal">{p.sku}</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(p.stock)}</td>
                    <td className="px-5 py-3">
                      <input
                        type="number" min={0} max={p.stock}
                        value={cant === 0 ? "" : cant}
                        placeholder="0"
                        onChange={(e) => setCantidades({ ...cantidades, [pid]: Number(e.target.value) || 0 })}
                        className={`w-full rounded-md border px-2 py-1 text-right text-sm ${cant > p.stock ? "border-rose-400 bg-rose-50" : "border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"}`}
                      />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setProductosAgregados(productosAgregados.filter((x) => x !== pid));
                          const c = { ...cantidades }; delete c[pid]; setCantidades(c);
                        }}
                        className="text-rose-600 hover:bg-rose-50 rounded-md w-8 h-8 inline-flex items-center justify-center"
                        title="Quitar"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
              {productosAgregados.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-slate-700">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3"></td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmt(total)}</td>
                  <td className="px-5 py-3"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="text-xs font-medium text-slate-600">Observaciones</label>
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.push("/notas-remision")} className="rounded-md border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
        <button type="button" onClick={emitir} disabled={enviando} className="rounded-md bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:shadow-md inline-flex items-center gap-2 disabled:opacity-60">
          <Send className="h-4 w-4" />
          {enviando ? "Emitiendo…" : "Emitir NR"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
