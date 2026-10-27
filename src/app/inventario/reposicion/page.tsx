"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ArrowLeftRight, Plus, X, Search, Clock, CheckCircle2, Truck, PackageCheck } from "lucide-react";
import AccionesTabla from "@/components/ui/AccionesTabla";

// ── Tipos que devuelve la API ────────────────────────────────────────────────
type Resumen = {
  id: string;
  numero: string;
  estado: string;
  sucursal_origen_id: string;
  sucursal_origen_nombre: string;
  sucursal_destino_id: string;
  sucursal_destino_nombre: string;
  observacion_solicitud: string | null;
  motivo_rechazo: string | null;
  /** REM-XXXXXX del papel que viajó con la mercadería (punto 8.1). */
  numero_remision: string | null;
  solicitada_at: string;
  aprobada_at: string | null;
  rechazada_at: string | null;
  despachada_at: string | null;
  recibida_at: string | null;
  cancelada_at: string | null;
  items_count: number;
  es_solicitante: boolean;
  /** Valor de la mercadería movida, en guaraníes. Lo suma el servidor. */
  total_gs: number;
  solicitada_por_nombre: string | null;
  despachada_por_nombre: string | null;
  recibida_por_nombre: string | null;
};
type ItemDet = {
  id: string;
  producto_destino_id: string;
  producto_origen_id: string | null;
  sku: string;
  nombre: string;
  unidad: string;
  cantidad_solicitada: number;
  cantidad_aprobada: number;
  cantidad_despachada: number;
  cantidad_recibida: number;
  stock_destino: number;
  stock_origen: number | null;
  tiene_equivalencia: boolean;
};
type Sucursal = { id: string; nombre: string; es_principal: boolean };
type ProductoBusq = {
  id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
};

const ESTADO_LABEL: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800" },
  aprobada: { label: "Aprobada", cls: "bg-sky-100 text-sky-800" },
  rechazada: { label: "Rechazada", cls: "bg-red-100 text-red-700" },
  despachada: { label: "En tránsito", cls: "bg-indigo-100 text-indigo-800" },
  recibida: { label: "Recibida", cls: "bg-emerald-100 text-emerald-800" },
  cancelada: { label: "Cancelada", cls: "bg-slate-100 text-slate-600" },
};

function EstadoBadge({ estado }: { estado: string }) {
  const e = ESTADO_LABEL[estado] ?? { label: estado, cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${e.cls}`}>{e.label}</span>;
}

/**
 * Fecha y hora van en columnas separadas, y las dos en hora de Paraguay.
 *
 * El corrimiento va escrito en vez de usar la hora local del navegador: si
 * alguien abre el sistema desde otro huso —o la computadora tiene mal el
 * reloj— una transferencia despachada a las 23:40 aparecería con la fecha del
 * día siguiente, y al cruzar con la remisión en papel no cerraría.
 */
function py(iso: string): Date {
  return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
}
function fmtSoloFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = py(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function fmtHora(iso: string | null): string {
  if (!iso) return "";
  const d = py(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  return `${fmtSoloFecha(iso)} ${fmtHora(iso)}`;
}
const fmtGs = (n: number) => Math.round(n).toLocaleString("es-PY");

/**
 * El movimiento contado desde la sucursal que mira la pantalla.
 *
 * La misma transferencia es una salida para quien manda y una entrada para
 * quien recibe. Decir solo "Casa Central → Sucursal" obliga a pensar de qué
 * lado está uno; escribirlo en palabras lo resuelve de una.
 */
function tipoMovimiento(t: Resumen): string {
  const lado = t.es_solicitante ? "Entrada" : "Salida";
  return `${lado} de mercadería de ${t.sucursal_origen_nombre} a ${t.sucursal_destino_nombre}`;
}
function fmtNum(n: number): string {
  return n.toLocaleString("es-PY", { maximumFractionDigits: 2 });
}

export default function ReposicionPage() {
  const [tab, setTab] = useState<"realizadas" | "recibidas">("realizadas");
  const [transfers, setTransfers] = useState<Resumen[]>([]);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [rol, setRol] = useState<string>("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [crearAbierto, setCrearAbierto] = useState(false);

  // Filtros del punto 8.1. Los aplica el servidor, no el navegador: la lista
  // viene cortada en 500 filas, así que filtrar acá dejaría afuera lo viejo.
  const [fBusqueda, setFBusqueda] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [fUsuario, setFUsuario] = useState("");

  /**
   * Los nombres del selector salen de lo que hay en la lista, no del padrón de
   * usuarios: un usuario que nunca intervino en una transferencia no sirve
   * para filtrar, y el padrón entero llenaría el desplegable de gente de
   * administración que nunca movió mercadería.
   *
   * El costo es que si se filtra por alguien y después se cambia otro filtro,
   * su nombre podría no estar en la lista nueva; por eso el valor elegido se
   * agrega siempre, aunque ya no aparezca.
   */
  const usuariosEnLista = useMemo(() => {
    const set = new Set<string>();
    for (const t of transfers) {
      for (const n of [t.solicitada_por_nombre, t.despachada_por_nombre, t.recibida_por_nombre]) {
        if (n) set.add(n);
      }
    }
    if (fUsuario) set.add(fUsuario);
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [transfers, fUsuario]);

  /**
   * Totales de lo que se está viendo, no de todo.
   *
   * Si los totales ignoraran los filtros, al acotar por fecha el listado
   * diría una cosa y el total otra. Se separan entrada y salida porque sumadas
   * no significan nada: una es mercadería que llegó y la otra que se fue.
   */
  const totales = useMemo(() => {
    let entrada = 0, salida = 0, nEntrada = 0, nSalida = 0;
    for (const t of transfers) {
      if (t.es_solicitante) { entrada += t.total_gs; nEntrada++; }
      else { salida += t.total_gs; nSalida++; }
    }
    return { entrada, salida, nEntrada, nSalida };
  }, [transfers]);

  const esAprobador = useMemo(() => {
    const r = rol.trim().toLowerCase();
    return r === "admin" || r === "administrador" || r === "supervisor" || r === "super_admin";
  }, [rol]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ filtro: tab });
      if (fBusqueda.trim()) qs.set("q", fBusqueda.trim());
      if (fEstado) qs.set("estado", fEstado);
      if (fDesde) qs.set("desde", fDesde);
      if (fHasta) qs.set("hasta", fHasta);
      if (fUsuario) qs.set("usuario", fUsuario);
      const res = await fetchWithSupabaseSession(`/api/transferencias?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo cargar.");
      setTransfers(json?.data?.transferencias ?? []);
      setConteos(json?.data?.conteos ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setCargando(false);
    }
  }, [tab, fBusqueda, fEstado, fDesde, fHasta, fUsuario]);

  // Medio segundo de espera: así escribir "REM-000012" no dispara once
  // consultas, una por tecla.
  useEffect(() => {
    const t = setTimeout(() => { cargar(); }, 400);
    return () => clearTimeout(t);
  }, [cargar]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        const json = await res.json();
        if (res.ok) setRol(json?.usuario?.rol ?? "");
      } catch {
        /* sin rol => solo acciones de usuario */
      }
    })();
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ArrowLeftRight className="h-6 w-6 text-[#4FAEB2]" /> Transferencias entre sucursales
          </h1>
          <p className="mt-1 text-sm text-slate-500">Solicitá mercadería a otra sucursal y seguí el estado de cada transferencia.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Requisito 11.1: el listado de transferencias con su remisión. */}
          <AccionesTabla
            titulo="Transferencias entre sucursales"
            archivo={`transferencias-${fDesde || "inicio"}_${fHasta || "hoy"}`}
            subtitulo={fDesde || fHasta ? `Del ${fDesde || "inicio"} al ${fHasta || "hoy"}` : undefined}
            columnas={["Número", "Remisión", "Fecha", "Hora", "Movimiento", "Origen", "Destino",
                       "Pidió", "Despachó", "Recibió", "Ítems", "Total Gs.", "Nota",
                       "Despachada", "Recibida", "Estado"]}
            filas={transfers.map((t) => [
              t.numero,
              t.numero_remision ?? "",
              fmtSoloFecha(t.solicitada_at),
              fmtHora(t.solicitada_at),
              tipoMovimiento(t),
              t.sucursal_origen_nombre,
              t.sucursal_destino_nombre,
              t.solicitada_por_nombre ?? "",
              t.despachada_por_nombre ?? "",
              t.recibida_por_nombre ?? "",
              t.items_count,
              t.total_gs,
              t.observacion_solicitud ?? "",
              t.despachada_at ? fmtFecha(t.despachada_at) : "",
              t.recibida_at ? fmtFecha(t.recibida_at) : "",
              t.estado,
            ])}
          />
          <button
            onClick={() => setCrearAbierto(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] active:scale-95"
          >
            <Plus className="h-4 w-4" /> Solicitar reposición
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: "pendiente", label: "Pendientes", icon: Clock, color: "text-amber-600" },
          { k: "aprobada", label: "Aprobadas", icon: CheckCircle2, color: "text-sky-600" },
          { k: "despachada", label: "En tránsito", icon: Truck, color: "text-indigo-600" },
          { k: "recibida", label: "Recibidas", icon: PackageCheck, color: "text-emerald-600" },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <Icon className={`h-5 w-5 ${c.color}`} />
                <span className="text-2xl font-bold tabular-nums text-slate-900">{conteos[c.k] ?? 0}</span>
              </div>
              <p className="mt-1 text-xs font-medium text-slate-500">{c.label}</p>
            </div>
          );
        })}
      </div>

      {/* Totales de lo que se está viendo. Entrada y salida van separadas: una
          es mercadería que llegó y la otra que se fue; sumadas no dicen nada. */}
      {transfers.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <div>
            <span className="text-xs text-slate-400">Entró</span>
            <p className="font-bold tabular-nums text-emerald-700">
              Gs. {fmtGs(totales.entrada)}
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                en {totales.nEntrada} transferencia{totales.nEntrada === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-400">Salió</span>
            <p className="font-bold tabular-nums text-slate-700">
              Gs. {fmtGs(totales.salida)}
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                en {totales.nSalida} transferencia{totales.nSalida === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <p className="text-xs text-slate-400">
            Es el total de lo que estás viendo, con los filtros puestos.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {([
          ["realizadas", "Solicitudes realizadas"],
          ["recibidas", "Solicitudes recibidas"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros (punto 8.1) */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={fBusqueda}
              onChange={(e) => setFBusqueda(e.target.value)}
              placeholder="N° de transferencia o remisión…"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
            />
          </div>
          <select
            value={fEstado}
            onChange={(e) => setFEstado(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
          >
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="aprobada">Aprobada</option>
            <option value="despachada">Despachada</option>
            <option value="recibida">Recibida</option>
            <option value="rechazada">Rechazada</option>
            <option value="cancelada">Cancelada</option>
          </select>
          <select
            value={fUsuario}
            onChange={(e) => setFUsuario(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
          >
            <option value="">Todo el personal</option>
            {usuariosEnLista.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-xs text-slate-400">Desde</label>
            <input type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)}
              max={fHasta || undefined}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-xs text-slate-400">Hasta</label>
            <input type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)}
              min={fDesde || undefined}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none" />
          </div>
        </div>
        {(fBusqueda || fEstado || fDesde || fHasta || fUsuario) && (
          <button
            type="button"
            onClick={() => { setFBusqueda(""); setFEstado(""); setFDesde(""); setFHasta(""); setFUsuario(""); }}
            className="mt-2 text-xs text-slate-400 underline transition-colors hover:text-slate-700"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Lista */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {cargando ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">Cargando…</div>
        ) : transfers.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">
            {fBusqueda || fEstado || fDesde || fHasta
              ? "Ninguna transferencia coincide con los filtros."
              : tab === "realizadas"
              ? "Todavía no solicitaste reposiciones."
              : "No hay solicitudes de otras sucursales."}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Número</th>
                <th className="px-4 py-3 font-semibold">Remisión</th>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Hora</th>
                <th className="px-4 py-3 font-semibold">Movimiento</th>
                <th className="px-4 py-3 font-semibold">Personal</th>
                <th className="px-4 py-3 font-semibold text-center">Ítems</th>
                <th className="px-4 py-3 font-semibold text-right">Total Gs.</th>
                <th className="px-4 py-3 font-semibold">Nota</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium tabular-nums text-slate-800">{t.numero}</td>
                  {/* Vacío mientras no se despachó: no hay papel hasta que sale
                      la mercadería. */}
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {t.numero_remision ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{fmtSoloFecha(t.solicitada_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-slate-500">{fmtHora(t.solicitada_at)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className={t.es_solicitante ? "font-medium text-emerald-700" : "font-medium text-slate-700"}>
                      {t.es_solicitante ? "Entrada" : "Salida"}
                    </span>
                    <span className="text-slate-400"> de {t.sucursal_origen_nombre} a {t.sucursal_destino_nombre}</span>
                  </td>
                  {/* Se muestra el último que intervino, con el detalle completo
                      en el title: en el listado interesa quién tocó la
                      transferencia más recientemente, no los tres pasos. */}
                  <td
                    className="px-4 py-3 text-slate-600"
                    title={[
                      t.solicitada_por_nombre ? `Pidió: ${t.solicitada_por_nombre}` : null,
                      t.despachada_por_nombre ? `Despachó: ${t.despachada_por_nombre}` : null,
                      t.recibida_por_nombre ? `Recibió: ${t.recibida_por_nombre}` : null,
                    ].filter(Boolean).join(" · ")}
                  >
                    {t.recibida_por_nombre ?? t.despachada_por_nombre ?? t.solicitada_por_nombre ?? (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{t.items_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {t.total_gs > 0 ? fmtGs(t.total_gs) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 max-w-[18rem] truncate text-slate-500" title={t.observacion_solicitud ?? ""}>
                    {t.observacion_solicitud || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3"><EstadoBadge estado={t.estado} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDetalleId(t.id)} className="text-sm font-medium text-[#4FAEB2] hover:underline">
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {crearAbierto && (
        <ModalCrear
          onClose={() => setCrearAbierto(false)}
          onCreada={() => {
            setCrearAbierto(false);
            setTab("realizadas");
            cargar();
          }}
        />
      )}
      {detalleId && (
        <ModalDetalle
          id={detalleId}
          esAprobador={esAprobador}
          onClose={() => setDetalleId(null)}
          onCambio={() => {
            cargar();
          }}
        />
      )}
    </div>
  );
}

// ── Modal: crear solicitud ───────────────────────────────────────────────────
function ModalCrear({ onClose, onCreada }: { onClose: () => void; onCreada: () => void }) {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [origenId, setOrigenId] = useState("");
  const [obs, setObs] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ProductoBusq[]>([]);
  const [buscandoProd, setBuscandoProd] = useState(false);
  const [lineas, setLineas] = useState<Array<{ producto_destino_id: string; nombre: string; sku: string; stock: number; cantidad: string }>>([]);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetchWithSupabaseSession("/api/sucursales");
      const json = await res.json();
      if (res.ok) {
        const list: Sucursal[] = json?.data?.sucursales ?? [];
        setSucursales(list);
        // Opción inicial: la sucursal principal (es_principal).
        const principal = list.find((s) => s.es_principal);
        if (principal) setOrigenId(principal.id);
      }
    })();
  }, []);

  // Se busca en el catálogo de la sucursal que va a DESPACHAR, no en el
  // propio. Reponer es pedir lo que uno no tiene: buscar entre los productos
  // propios no devolvía lo que hacía falta, y en una sucursal nueva —que no
  // tiene nada cargado— no devolvía absolutamente nada.
  //
  // Sin origen elegido no hay dónde buscar, y se dice en vez de quedarse mudo.
  useEffect(() => {
    if (!origenId) { setResultados([]); return; }
    const q = busqueda.trim();
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscandoProd(true);
      try {
        const sp = new URLSearchParams({ sucursal: origenId, limit: "20" });
        if (q) sp.set("q", q);
        const res = await fetchWithSupabaseSession(`/api/transferencias/productos-origen?${sp}`);
        const json = await res.json();
        if (vivo && res.ok) {
          const items = (json?.data?.productos ?? []) as Array<{ id: string; nombre: string; sku: string; stock_actual: number }>;
          setResultados(items.map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku, stock_actual: p.stock_actual })));
        }
      } catch {
        /* se reintenta al seguir escribiendo */
      } finally {
        if (vivo) setBuscandoProd(false);
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busqueda, origenId]);

  function agregar(p: ProductoBusq) {
    if (lineas.some((l) => l.producto_destino_id === p.id)) return;
    setLineas((prev) => [...prev, { producto_destino_id: p.id, nombre: p.nombre, sku: p.sku, stock: p.stock_actual, cantidad: "" }]);
    setBusqueda("");
    setResultados([]);
  }
  function quitar(id: string) {
    setLineas((prev) => prev.filter((l) => l.producto_destino_id !== id));
  }

  async function guardar() {
    setErr(null);
    if (!origenId) return setErr("Elegí la sucursal de origen.");
    const items = lineas
      .map((l) => ({ producto_origen_id: l.producto_destino_id, cantidad_solicitada: Number(l.cantidad) || 0 }))
      .filter((i) => i.cantidad_solicitada > 0);
    if (items.length === 0) return setErr("Agregá al menos un producto con cantidad mayor a 0.");
    setGuardando(true);
    try {
      const res = await fetchWithSupabaseSession("/api/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursal_origen_id: origenId, observacion: obs.trim() || undefined, items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo crear.");
      onCreada();
    } catch (e) {
      setGuardando(false);
      setErr(e instanceof Error ? e.message : "Error al crear.");
    }
  }

  return (
    <Overlay onClose={onClose} titulo="Solicitar reposición">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Sucursal de origen</label>
          <select
            value={origenId}
            onChange={(e) => setOrigenId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
          >
            <option value="">Seleccioná…</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
                {s.es_principal ? " (principal)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Agregar productos{" "}
            <span className="font-normal text-slate-400">— del catálogo de la sucursal que despacha</span>
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={origenId ? "Buscar por nombre o SKU…" : "Primero elegí la sucursal de origen"}
              disabled={!origenId}
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
            />
            {origenId && resultados.length === 0 && !buscandoProd && (
              <p className="mt-1 text-xs text-slate-500">
                {busqueda.trim()
                  ? "Esa sucursal no tiene ningún producto que coincida."
                  : "Esa sucursal no tiene productos cargados."}
              </p>
            )}
            {resultados.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => agregar(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span>
                      <span className="font-medium text-slate-800">{p.nombre}</span>
                      <span className="ml-2 text-xs text-slate-400">{p.sku}</span>
                    </span>
                    {/* El stock que importa es el del que despacha: de ahí
                        va a salir, si es que hay. */}
                    <span className={`text-xs ${p.stock_actual > 0 ? "text-slate-500" : "text-red-600"}`}>
                      {p.stock_actual > 0 ? `Tiene ${fmtNum(p.stock_actual)}` : "Sin stock allá"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {lineas.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-right font-semibold">Stock actual</th>
                  <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineas.map((l) => (
                  <tr key={l.producto_destino_id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{l.nombre}</div>
                      <div className="text-xs text-slate-400">{l.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtNum(l.stock)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.cantidad}
                        onChange={(e) =>
                          setLineas((prev) => prev.map((x) => (x.producto_destino_id === l.producto_destino_id ? { ...x, cantidad: e.target.value } : x)))
                        }
                        className="w-24 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => quitar(l.producto_destino_id)} className="text-xs text-red-500 hover:underline">
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Observación (opcional)</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
            placeholder="Ej: reposición semanal de góndola"
          />
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Creando…" : "Crear solicitud"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Modal: detalle + acciones ────────────────────────────────────────────────
function ModalDetalle({
  id,
  esAprobador,
  onClose,
  onCambio,
}: {
  id: string;
  esAprobador: boolean;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [cab, setCab] = useState<Resumen | null>(null);
  const [items, setItems] = useState<ItemDet[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  const [aprob, setAprob] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/transferencias/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo cargar.");
      setCab(json?.data?.cabecera ?? null);
      setItems(json?.data?.items ?? []);
      // Prefill aprobación con la cantidad solicitada.
      const pre: Record<string, string> = {};
      for (const it of (json?.data?.items ?? []) as ItemDet[]) pre[it.id] = String(it.cantidad_solicitada);
      setAprob(pre);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error.");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const esOrigen = cab ? !cab.es_solicitante : false;
  const esDestino = cab ? cab.es_solicitante : false;
  const faltaEquivalencia = items.some((i) => i.cantidad_solicitada > 0 && !i.tiene_equivalencia);

  async function accionar(path: string, body?: unknown, confirmar?: string) {
    if (confirmar && !window.confirm(confirmar)) return;
    setAccion(path);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/transferencias/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo procesar.");
      await cargar();
      onCambio();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error.");
    } finally {
      setAccion(null);
    }
  }

  const estado = cab?.estado ?? "";

  return (
    <Overlay onClose={onClose} titulo={cab ? `Transferencia ${cab.numero}` : "Transferencia"}>
      {cargando ? (
        <div className="py-10 text-center text-sm text-slate-400">Cargando…</div>
      ) : !cab ? (
        <div className="py-10 text-center text-sm text-slate-400">No se encontró la transferencia.</div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <EstadoBadge estado={cab.estado} />
            <span className="text-sm text-slate-500">
              {cab.sucursal_origen_nombre} → {cab.sucursal_destino_nombre}
            </span>
            {/* El número de remisión (punto 8.1): el dato que se muestra si
                para el camión un control en la ruta. */}
            {cab.numero_remision && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                Remisión {cab.numero_remision}
              </span>
            )}
          </div>

          {cab.observacion_solicitud && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{cab.observacion_solicitud}</p>
          )}
          {cab.motivo_rechazo && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Rechazo: {cab.motivo_rechazo}</p>
          )}

          {/* Línea de tiempo */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>Solicitada: {fmtFecha(cab.solicitada_at)}</span>
            {cab.aprobada_at && <span>Aprobada: {fmtFecha(cab.aprobada_at)}</span>}
            {cab.despachada_at && <span>Despachada: {fmtFecha(cab.despachada_at)}</span>}
            {cab.recibida_at && <span>Recibida: {fmtFecha(cab.recibida_at)}</span>}
          </div>

          {/* Ítems */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-right font-semibold">Solic.</th>
                  {esOrigen && <th className="px-3 py-2 text-right font-semibold">Stock origen</th>}
                  <th className="px-3 py-2 text-right font-semibold">Aprob.</th>
                  {(estado === "despachada" || estado === "recibida") && (
                    <th className="px-3 py-2 text-right font-semibold">Desp.</th>
                  )}
                  {estado === "recibida" && <th className="px-3 py-2 text-right font-semibold">Recib.</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{it.nombre}</div>
                      <div className="text-xs text-slate-400">{it.sku} · {it.unidad}</div>
                      {esOrigen && !it.tiene_equivalencia && (
                        <div className="mt-1 space-y-1">
                          {/* El mensaje viejo —"producto no encontrado"— no
                              decía qué hacer, y la única salida era rechazar.
                              El equivalente se busca por SKU dentro de la
                              sucursal que despacha: cada sucursal tiene su
                              propia ficha del artículo, con su stock. */}
                          <div className="text-xs font-medium text-red-600">
                            Tu sucursal ({cab?.sucursal_origen_nombre}) no tiene ningún producto con el SKU{" "}
                            <span className="font-mono">{it.sku}</span>. Elegí abajo cuál es el equivalente, o cargá
                            el artículo en tu sucursal y volvé.
                          </div>
                          <ElegirEquivalente
                            transferenciaId={id}
                            itemId={it.id}
                            onResuelto={() => { void cargar(); onCambio(); }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtNum(it.cantidad_solicitada)}</td>
                    {esOrigen && (
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {it.stock_origen == null ? "—" : fmtNum(it.stock_origen)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      {estado === "pendiente" && esAprobador && esOrigen ? (
                        <input
                          type="number"
                          min={0}
                          max={it.cantidad_solicitada}
                          step="any"
                          value={aprob[it.id] ?? ""}
                          onChange={(e) => setAprob((p) => ({ ...p, [it.id]: e.target.value }))}
                          className="w-20 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
                        />
                      ) : (
                        <span className="tabular-nums text-slate-600">{fmtNum(it.cantidad_aprobada)}</span>
                      )}
                    </td>
                    {(estado === "despachada" || estado === "recibida") && (
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtNum(it.cantidad_despachada)}</td>
                    )}
                    {estado === "recibida" && (
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtNum(it.cantidad_recibida)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {esOrigen && estado === "aprobada" && faltaEquivalencia && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Hay productos sin equivalencia en tu sucursal. No se puede despachar hasta resolverlos.
            </p>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}

          {/* Acciones según rol/lado/estado */}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {/* Cancelar: solicitante, pendiente */}
            {esDestino && estado === "pendiente" && (
              <button
                onClick={() => accionar("cancelar", undefined, "¿Cancelar esta solicitud?")}
                disabled={!!accion}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar solicitud
              </button>
            )}
            {/* Aprobar / rechazar: origen, aprobador, pendiente */}
            {esOrigen && esAprobador && estado === "pendiente" && (
              <>
                <button
                  onClick={() => {
                    const motivo = window.prompt("Motivo del rechazo:");
                    if (motivo && motivo.trim()) accionar("rechazar", { motivo: motivo.trim() });
                  }}
                  disabled={!!accion}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Rechazar
                </button>
                <button
                  onClick={() => {
                    const aprobaciones = items.map((it) => ({ item_id: it.id, cantidad_aprobada: Number(aprob[it.id]) || 0 }));
                    accionar("aprobar", { aprobaciones });
                  }}
                  disabled={!!accion}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  Aprobar
                </button>
              </>
            )}
            {/* Despachar: origen, aprobador, aprobada */}
            {esOrigen && esAprobador && estado === "aprobada" && (
              <button
                onClick={() => accionar("despachar", undefined, "¿Despachar? Esto descuenta el stock de tu sucursal.")}
                disabled={!!accion || faltaEquivalencia}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Despachar
              </button>
            )}
            {/* Recibir: destino, aprobador, despachada */}
            {esDestino && esAprobador && estado === "despachada" && (
              <button
                onClick={() => accionar("recibir", undefined, "¿Confirmar la recepción? Esto suma el stock a tu sucursal.")}
                disabled={!!accion}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Confirmar recepción
              </button>
            )}
          </div>
        </div>
      )}
    </Overlay>
  );
}

// ── Overlay reutilizable ─────────────────────────────────────────────────────
function Overlay({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="my-8 w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ──────────────── Elegir el equivalente en la sucursal que despacha ─────── */
/**
 * La equivalencia se resuelve sola por SKU al crear la transferencia: cada
 * sucursal tiene su propia ficha de cada artículo, y se busca la del origen
 * con el mismo código. Cuando el origen no tiene ese SKU —porque la sucursal
 * es nueva, o porque el artículo está cargado con otro código— no hay match.
 *
 * Hasta ahora eso era un callejón sin salida: la pantalla avisaba del problema
 * y los únicos botones eran Aprobar (que después no podía despachar) y
 * Rechazar. La ruta para resolverlo ya existía, pero no estaba en ningún lado.
 *
 * Acá se busca entre los productos de la sucursal que despacha y se elige el
 * que corresponde. Es una decisión de la sucursal de origen, que es la que
 * sabe con qué nombre tiene cargada la cosa.
 */
function ElegirEquivalente({
  transferenciaId, itemId, onResuelto,
}: {
  transferenciaId: string;
  itemId: string;
  onResuelto: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [opciones, setOpciones] = useState<Array<{ id: string; nombre: string; sku: string; stock_actual: number }>>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    let cancel = false;
    // Con menos de dos letras la búsqueda devuelve medio catálogo y no ayuda
    // a nadie; vacío sí, para ver qué hay cuando la sucursal tiene poco.
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const sp = new URLSearchParams({ limit: "20" });
        if (q.trim().length >= 2) sp.set("q", q.trim());
        const r = await fetchWithSupabaseSession(`/api/productos?${sp}`, { cache: "no-store" });
        const j = await r.json();
        if (cancel) return;
        const rows = ((j?.data?.productos ?? []) as Array<Record<string, unknown>>).map((p) => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: String(p.sku ?? ""),
          stock_actual: Number(p.stock_actual) || 0,
        }));
        setOpciones(rows);
      } catch {
        if (!cancel) setOpciones([]);
      } finally {
        if (!cancel) setBuscando(false);
      }
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [abierto, q]);

  async function elegir(productoOrigenId: string) {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/transferencias/${transferenciaId}/equivalencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, producto_origen_id: productoOrigenId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j?.error === "string" ? j.error : "No se pudo asignar.");
      setAbierto(false);
      onResuelto();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
      >
        Elegir el equivalente
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar en tu sucursal por nombre o SKU…"
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-[#4FAEB2]"
      />
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
      <div className="mt-1 max-h-40 overflow-y-auto">
        {buscando ? (
          <p className="px-1 py-2 text-[11px] text-slate-400">Buscando…</p>
        ) : opciones.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-slate-500">
            Tu sucursal no tiene productos que coincidan. Cargalo en Inventario y después volvé acá.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {opciones.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void elegir(o.id)}
                  className="flex w-full items-center justify-between gap-2 px-1 py-1.5 text-left text-xs hover:bg-white disabled:opacity-50"
                >
                  <span>
                    <span className="font-medium text-slate-800">{o.nombre}</span>
                    <span className="block font-mono text-[10px] text-slate-400">{o.sku}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">{o.stock_actual}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="mt-1 text-[11px] text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
      >
        Cancelar
      </button>
    </div>
  );
}
