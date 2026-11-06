"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchableSelect from "@/components/ui/SearchableSelect";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { formatearMoneda } from "@/lib/moneda";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import CargarReciboChequeModal from "@/components/pagos/CargarReciboChequeModal";
import Selector from "@/components/ui/Selector";
import {
  Printer, FileCheck2, Banknote, ImagePlus, X, Eye, Search, ArrowUpDown,
  CheckCircle2, Info, ChevronDown, ChevronRight,
} from "lucide-react";

/**
 * Orden de pago consolidada.
 *
 * ── PARA QUÉ EXISTE ────────────────────────────────────────────────────────
 *   Se eligen varias facturas de un proveedor, se emite UN cheque por el
 *   total, se imprime la orden que las detalla, y cuando el proveedor entrega
 *   su recibo se carga acá con su número.
 *
 *   Joaquín: "hay proveedores que traspapelan los documentos, entonces te
 *   piden de vuelta el cobro de esa factura como que vos estabas deudando".
 *   El número de recibo —que lo emite ÉL— es lo que termina esa discusión.
 *
 * ── CÓMO SE USA ────────────────────────────────────────────────────────────
 *   Con cientos de facturas pendientes, buscarlas casilla por casilla no
 *   servía: hay buscador (n° de factura, de carga o importe), filtros por
 *   estado y por fechas, orden por columna, y la barra para armar el cheque
 *   queda fija abajo apenas se elige algo, sin tener que bajar hasta el final.
 *   "Elegir todas" elige solo las que se están viendo con el filtro.
 */

type Factura = {
  numero_control: string;
  numero_factura: string | null;
  fecha: string | null;
  vencimiento: string | null;
  moneda: string;
  total: number;
  vencida: boolean;
};

/** Lo que tiene adentro una factura: la compra y sus productos. */
type ItemCompra = {
  producto_nombre: string;
  cantidad: number;
  costo_unitario: number;
  total: number;
};
type DetalleFactura = {
  cargando: boolean;
  error: string | null;
  items: ItemCompra[];
  fecha_factura: string | null;
  tipo_pago: string | null;
  estado: string | null;
};

type Cheque = {
  id: string; numero: string | null; numero_recibo?: string | null;
  fecha_recibo?: string | null; recibo_storage_path?: string | null;
  imagen_storage_path?: string | null; imagen_nombre?: string | null;
  banco_nombre: string | null; moneda: string; importe: number; estado: string;
  proveedor_nombre: string;
};

type Estado = "todas" | "vencidas" | "semana" | "al_dia";
type Orden = { col: "vencimiento" | "fecha" | "total" | "numero_factura"; asc: boolean };

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Los valores de la base, en castellano.
 *
 * En las columnas se guardan sin tilde y en minúscula ("credito",
 * "registrada"): mostrarlos crudos deja la pantalla hablando como la base.
 */
const PALABRAS: Record<string, string> = {
  credito: "a crédito",
  contado: "al contado",
  registrada: "registrada",
  pagada: "pagada",
  anulada: "anulada",
};
const enPalabras = (v: string) => PALABRAS[v] ?? v;

/**
 * Los importes de una compra están SIEMPRE en guaraníes.
 *
 * Esto decía `US$` cuando la compra se había pactado en dólares, pero el
 * número que le pasaba era el total en guaraníes: una factura de
 * Gs. 28.371.693 se leía "US$ 28.371.693", siete mil veces más plata. Lo que
 * está en dólares es el precio unitario pactado (`costo_unitario_original`),
 * no el total.
 */
const gs = (v: number) => formatearMoneda(v, "PYG");
const fmt = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
const hoyPy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const masDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const soloDigitos = (s: string) => s.replace(/\D/g, "");

/** Sube la foto del cheque (script 75). Devuelve el error, o null si salió bien. */
async function subirImagenCheque(chequeId: string, file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("cheque_id", chequeId);
  fd.append("file", file);
  try {
    const r = await apiFetch("/api/cheques/imagen", { method: "POST", body: fd });
    const j = await r.json().catch(() => null);
    return r.ok && j?.success ? null : (j?.error ?? `Error ${r.status}`);
  } catch {
    return "Error de red.";
  }
}

/** Abre un archivo guardado con una URL firmada, en otra pestaña. */
async function abrirArchivo(path: string) {
  const w = window.open("", "_blank");
  try {
    const r = await apiFetch(`/api/cheques/recibo?path=${encodeURIComponent(path)}`);
    const j = await r.json().catch(() => null);
    if (w && j?.data?.url) w.location.href = j.data.url;
    else w?.close();
  } catch {
    w?.close();
  }
}

/**
 * Vive adentro de Pagos a proveedores, en la pestaña "Armar pago". Antes era
 * una pantalla aparte con su propio ítem de menú, y desde Pagos a
 * proveedores un botón mandaba ahí: dos lugares para la misma tarea.
 */
export default function OrdenDePago({ proveedorInicial = "", onPagoArmado }: {
  /** Llega elegido desde la tarjeta del proveedor ("Armar pago"). */
  proveedorInicial?: string;
  /** Para que la pestaña Por pagar se actualice cuando se arma un pago. */
  onPagoArmado?: () => void;
}) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState(proveedorInicial);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<Estado>("todas");
  const [campoFecha, setCampoFecha] = useState<"vencimiento" | "fecha">("vencimiento");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState<Orden>({ col: "vencimiento", asc: true });

  // El cheque
  /**
   * Con qué se paga.
   *
   * La pantalla solo sabía armar cheques, y una transferencia no se podía
   * registrar en ningún lado. Como el flujo de caja se arma leyendo los pagos,
   * una transferencia que no se escribe acá no existe para la planilla: la
   * plata sale del banco y el flujo no se entera.
   */
  const [medio, setMedio] = useState<"cheque" | "transferencia" | "efectivo">("cheque");
  /** El día en que se cobra. En un cheque diferido no es el día que se firmó. */
  const [fechaCobro, setFechaCobro] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [bancos, setBancos] = useState<{ id: string; nombre: string }[]>([]);
  const [fechaPago, setFechaPago] = useState(hoyPy);
  const [imagenCheque, setImagenCheque] = useState<File | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const inputImagen = useRef<HTMLInputElement>(null);

  // El pago recién armado
  /**
   * El detalle abierto de cada factura.
   *
   * Se pide una sola vez y queda guardado: abrir y cerrar la misma fila no
   * vuelve a consultar, y con 417 facturas eso importa.
   */
  const [detalles, setDetalles] = useState<Record<string, DetalleFactura>>({});
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const verDetalle = useCallback(async (numeroControl: string) => {
    setAbiertas((prev) => {
      const n = new Set(prev);
      if (n.has(numeroControl)) n.delete(numeroControl);
      else n.add(numeroControl);
      return n;
    });
    if (detalles[numeroControl]) return;   // ya se pidió

    setDetalles((d) => ({ ...d, [numeroControl]: { cargando: true, error: null, items: [], fecha_factura: null, tipo_pago: null, estado: null } }));
    try {
      const r = await apiFetch(`/api/compras?numero_control=${encodeURIComponent(numeroControl)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo traer la compra.");
      const c = (j.data?.compra ?? {}) as Record<string, unknown>;
      const items = ((j.data?.items ?? []) as Array<Record<string, unknown>>).map((i) => ({
        producto_nombre: String(i.producto_nombre ?? "—"),
        cantidad: Number(i.cantidad ?? 0),
        costo_unitario: Number(i.costo_unitario ?? 0),
        total: Number(i.total ?? 0),
      }));
      setDetalles((d) => ({
        ...d,
        [numeroControl]: {
          cargando: false, error: null, items,
          fecha_factura: (c.fecha_factura as string) ?? null,
          tipo_pago: (c.tipo_pago as string) ?? null,
          estado: (c.estado as string) ?? null,
        },
      }));
    } catch (e) {
      setDetalles((d) => ({
        ...d,
        [numeroControl]: {
          cargando: false, items: [], fecha_factura: null, tipo_pago: null, estado: null,
          error: e instanceof Error ? e.message : "No se pudo traer la compra.",
        },
      }));
    }
  }, [detalles]);

  const [chequeCreado, setChequeCreado] = useState<Cheque | null>(null);
  const [cargandoRecibo, setCargandoRecibo] = useState(false);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const inputImagenDespues = useRef<HTMLInputElement>(null);

  useEffect(() => { void getProveedores().then(setProveedores); }, []);

  // Los bancos cargados en el ERP (Configuración → entidades). Para un cheque
  // solo sirven los de tipo banco; si no hay ninguno marcado así, se muestran
  // todas las entidades activas para no dejar el desplegable vacío.
  useEffect(() => {
    let cancel = false;
    apiFetch("/api/entidades-bancarias")
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        const todas = ((j.data?.entidades ?? []) as Array<{ id: string; nombre?: string; tipo?: string }>)
          .map((e) => ({ id: String(e.id), nombre: String(e.nombre ?? ""), tipo: String(e.tipo ?? "") }))
          .filter((e) => e.nombre);
        const soloBancos = todas.filter((e) => e.tipo === "banco");
        const lista = (soloBancos.length ? soloBancos : todas)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        setBancos(lista.map(({ id, nombre }) => ({ id, nombre })));
        if (lista.length === 1) setBancoId(lista[0].id);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  const cargar = useCallback(async () => {
    if (!proveedorId) { setFacturas([]); return; }
    setCargando(true);
    setError(null);
    setElegidas(new Set());
    try {
      const r = await apiFetch(`/api/pagos/orden-pago?proveedor_id=${encodeURIComponent(proveedorId)}`);
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudieron cargar las facturas.");
      setFacturas((j.data?.facturas ?? []) as Factura[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setFacturas([]);
    } finally {
      setCargando(false);
    }
  }, [proveedorId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = hoyPy();
  const enUnaSemana = masDias(hoy, 7);
  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;

  // ── Resumen del proveedor (sin filtros) ───────────────────────────────
  const resumen = useMemo(() => {
    let total = 0, vencido = 0, vencidas = 0, semana = 0;
    for (const f of facturas) {
      total += f.total;
      if (f.vencida) { vencido += f.total; vencidas++; }
      else if (f.vencimiento && f.vencimiento <= enUnaSemana) semana++;
    }
    return { total, vencido, vencidas, semana };
  }, [facturas, enUnaSemana]);

  // ── Lo que se ve con los filtros ──────────────────────────────────────
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const qDig = soloDigitos(q);
    const lista = facturas.filter((f) => {
      if (estado === "vencidas" && !f.vencida) return false;
      if (estado === "semana" && (f.vencida || !f.vencimiento || f.vencimiento > enUnaSemana)) return false;
      if (estado === "al_dia" && f.vencida) return false;
      const fc = (campoFecha === "vencimiento" ? f.vencimiento : f.fecha) ?? "";
      if (desde && (!fc || fc < desde)) return false;
      if (hasta && (!fc || fc > hasta)) return false;
      if (q) {
        const enTexto = `${f.numero_factura ?? ""} ${f.numero_control}`.toLowerCase().includes(q);
        const enImporte = qDig.length >= 3 && String(Math.round(f.total)).includes(qDig);
        if (!enTexto && !enImporte) return false;
      }
      return true;
    });
    const dir = orden.asc ? 1 : -1;
    return lista.sort((a, b) => {
      if (orden.col === "total") return (a.total - b.total) * dir;
      const va = String(a[orden.col] ?? ""), vb = String(b[orden.col] ?? "");
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      return va.localeCompare(vb, "es", { numeric: true }) * dir;
    });
  }, [facturas, busqueda, estado, campoFecha, desde, hasta, orden, enUnaSemana]);

  const seleccionadas = useMemo(
    () => facturas.filter((f) => elegidas.has(f.numero_control)),
    [facturas, elegidas]
  );
  const total = seleccionadas.reduce((s, f) => s + f.total, 0);
  /**
   * El cheque va en guaraníes, siempre.
   *
   * Antes tomaba la moneda de las facturas elegidas, y eso estaba mal: el
   * importe que suma es `compras.total`, que está guardado en guaraníes
   * aunque la compra se haya pactado en dólares. Lo comprobé sobre 500
   * líneas marcadas USD: en las 500 el total coincide con el precio en
   * guaraníes por la cantidad, en ninguna con el precio en dólares.
   *
   * Dejarlo como estaba emitía un cheque en dólares por el número en
   * guaraníes: Gs. 28.371.693 se convertían en US$ 28.371.693.
   */
  const moneda = "PYG";
  const ocultasElegidas = seleccionadas.length - visibles.filter((f) => elegidas.has(f.numero_control)).length;

  const todasVisiblesElegidas = visibles.length > 0 && visibles.every((f) => elegidas.has(f.numero_control));
  const hayFiltro = !!(busqueda || estado !== "todas" || desde || hasta);

  function alternar(nc: string) {
    setElegidas((prev) => {
      const n = new Set(prev);
      if (n.has(nc)) n.delete(nc); else n.add(nc);
      return n;
    });
  }
  function alternarVisibles(on: boolean) {
    setElegidas((prev) => {
      const n = new Set(prev);
      for (const f of visibles) { if (on) n.add(f.numero_control); else n.delete(f.numero_control); }
      return n;
    });
  }
  function ordenarPor(col: Orden["col"]) {
    setOrden((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: col !== "total" }));
  }
  function limpiarFiltros() {
    setBusqueda(""); setEstado("todas"); setDesde(""); setHasta("");
  }

  async function emitir() {
    if (!proveedor || seleccionadas.length === 0) return;
    setEmitiendo(true);
    setError(null);
    try {
      const r = await apiFetch("/api/cheques", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedor.id,
          proveedor_nombre: proveedor.nombre,
          moneda,
          importe: total,
          medio,
          numero: numeroCheque.trim() || null,
          entidad_bancaria_id: bancoId || null,
          banco_nombre: bancos.find((b) => b.id === bancoId)?.nombre ?? null,
          // La fecha en que se hace el pago, y la fecha en que se cobra. En un
          // cheque diferido no son la misma, y de la segunda depende en qué
          // semana del flujo de caja cae la salida.
          fecha_emision: fechaPago,
          fecha_pago_prevista: fechaCobro || fechaPago,
          fecha_cobro_prevista: fechaCobro || fechaPago,
          facturas: seleccionadas.map((f) => ({
            numero_control: f.numero_control,
            importe_imputado: f.total,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const id = String(j.data?.cheque_id ?? "");

      // La foto va después de crear el cheque: si falla, el pago igual queda
      // armado y se puede volver a subir desde el aviso de arriba.
      const errImg = imagenCheque ? await subirImagenCheque(id, imagenCheque) : null;

      const det = await apiFetch(`/api/pagos/orden-pago?cheque_id=${encodeURIComponent(id)}`);
      const dj = await det.json();
      setChequeCreado((dj?.data?.cheque ?? null) as Cheque | null);
      setAviso(
        `Pago armado por ${gs(total)} sobre ${seleccionadas.length} ` +
        `${seleccionadas.length === 1 ? "factura" : "facturas"}.`
      );
      if (errImg) setError(`El pago quedó armado, pero la foto del cheque no se subió: ${errImg}`);
      setImagenCheque(null);
      setNumeroCheque("");
      await cargar();
      onPagoArmado?.();
      document.getElementById("neura-main-content")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar el pago.");
    } finally {
      setEmitiendo(false);
    }
  }

  async function subirDespues(file: File) {
    if (!chequeCreado) return;
    if (file.size > MAX_BYTES) { setError("El archivo no puede pesar más de 10 MB."); return; }
    setSubiendoImagen(true);
    setError(null);
    const err = await subirImagenCheque(chequeCreado.id, file);
    if (err) setError(err);
    else {
      const det = await apiFetch(`/api/pagos/orden-pago?cheque_id=${encodeURIComponent(chequeCreado.id)}`);
      const dj = await det.json().catch(() => null);
      if (dj?.data?.cheque) setChequeCreado(dj.data.cheque as Cheque);
    }
    setSubiendoImagen(false);
  }

  const cabecera = (col: Orden["col"], texto: string, derecha = false) => (
    <th className={`px-3 py-2.5 font-semibold ${derecha ? "text-right" : "text-left"}`}>
      <button
        type="button" onClick={() => ordenarPor(col)}
        className={`inline-flex items-center gap-1 uppercase hover:text-slate-800 ${orden.col === col ? "text-slate-800" : ""}`}
      >
        {texto}
        <ArrowUpDown className={`h-3 w-3 ${orden.col === col ? "opacity-100" : "opacity-30"}`} />
      </button>
    </th>
  );

  const chips: Array<{ v: Estado; t: string; n?: number }> = [
    { v: "todas", t: "Todas", n: facturas.length },
    { v: "vencidas", t: "Vencidas", n: resumen.vencidas },
    { v: "semana", t: "Vencen en 7 días", n: resumen.semana },
    { v: "al_dia", t: "No vencidas", n: facturas.length - resumen.vencidas },
  ];

  return (
    <div className="space-y-4">

      {/* ── Proveedor y resumen ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Proveedor</span>
          <SearchableSelect
            value={proveedorId}
            onChange={(v) => { setProveedorId(v); setChequeCreado(null); setAviso(null); limpiarFiltros(); }}
            options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
            placeholder="Buscá el proveedor…"
            className="w-80 max-w-full"
          />
        </label>
        {proveedorId && !cargando && facturas.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-6">
            <div>
              <p className="text-[11px] font-medium text-slate-500">Pendiente sin cheque</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">
                {gs(resumen.total)}
              </p>
              <p className="text-xs text-slate-500">{facturas.length} facturas</p>
            </div>
            {resumen.vencidas > 0 && (
              <div>
                <p className="text-[11px] font-medium text-rose-500">Vencido</p>
                <p className="text-sm font-semibold tabular-nums text-rose-600">
                  {gs(resumen.vencido)}
                </p>
                <p className="text-xs text-rose-500">{resumen.vencidas} facturas</p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {!chequeCreado && aviso && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {aviso}
        </p>
      )}

      {/* ── El pago recién armado ─────────────────────────────────────── */}
      {chequeCreado && (
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{aviso}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Imprimí dos: una queda firmada en la carpeta y la otra se la lleva el proveedor. Las
                facturas pasan a pagadas al cargar su recibo.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={`/api/pagos/orden-pago/imprimir?cheque_id=${chequeCreado.id}`}
                  target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-4 w-4" /> Imprimir la orden
                </a>
                {chequeCreado.imagen_storage_path && (
                  <button
                    type="button" onClick={() => void abrirArchivo(chequeCreado.imagen_storage_path!)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-4 w-4" /> Ver el cheque
                  </button>
                )}
                <button
                  type="button" onClick={() => inputImagenDespues.current?.click()} disabled={subiendoImagen}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <ImagePlus className="h-4 w-4" />
                  {subiendoImagen ? "Subiendo…" : chequeCreado.imagen_storage_path ? "Cambiar la foto" : "Subir la foto del cheque"}
                </button>
                <input
                  ref={inputImagenDespues} type="file" accept={ACCEPT} className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void subirDespues(f); }}
                />
                <button
                  type="button" onClick={() => setCargandoRecibo(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
                >
                  <FileCheck2 className="h-4 w-4" /> Cargar el recibo del proveedor
                </button>
              </div>
            </div>
            <button
              type="button" onClick={() => { setChequeCreado(null); setAviso(null); }} aria-label="Cerrar"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Las facturas pendientes ───────────────────────────────────── */}
      {!proveedorId ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-14 text-center">
          <Banknote className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 font-medium text-slate-700">Elegí un proveedor</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Se listan sus facturas a crédito pendientes. Las que ya tienen un cheque no aparecen,
            para que no se pueda pagar dos veces la misma.
          </p>
        </div>
      ) : cargando ? (
        <p className="py-14 text-center text-sm text-slate-500">Cargando…</p>
      ) : facturas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-14 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-2 font-medium text-slate-700">
            {proveedor?.nombre} no tiene facturas pendientes sin cheque.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Filtros */}
          <div className="space-y-3 border-b border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por N° de factura, N° de carga o importe…"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
                />
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <Selector
                  value={campoFecha} onChange={(e) => setCampoFecha(e.target.value as "vencimiento" | "fecha")}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-600"
                  aria-label="Qué fecha filtrar"
                >
                  <option value="vencimiento">Vencimiento</option>
                  <option value="fecha">Fecha factura</option>
                </Selector>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde"
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm" />
                <span className="text-slate-400">a</span>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta"
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.v} type="button" onClick={() => setEstado(c.v)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    estado === c.v
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {c.t}
                  {c.n != null && <span className={`ml-1.5 tabular-nums ${estado === c.v ? "text-white/70" : "text-slate-400"}`}>{c.n}</span>}
                </button>
              ))}
              {hayFiltro && (
                <button type="button" onClick={limpiarFiltros} className="ml-1 text-xs font-medium text-[#3F8E91] hover:underline">
                  Limpiar filtros
                </button>
              )}
              <span className="ml-auto text-xs text-slate-500">
                {visibles.length === facturas.length ? `${facturas.length} facturas` : `${visibles.length} de ${facturas.length} facturas`}
              </span>
            </div>
          </div>

          {visibles.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">Ninguna factura coincide con el filtro.</p>
          ) : (
            <EdgeScrollArea>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox" checked={todasVisiblesElegidas}
                        onChange={(e) => alternarVisibles(e.target.checked)}
                        title={hayFiltro ? "Elegir las que se ven" : "Elegir todas"}
                        className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]"
                      />
                    </th>
                    {cabecera("numero_factura", "N° factura")}
                    <th className="px-3 py-2.5 text-left font-semibold uppercase">N° carga</th>
                    {cabecera("fecha", "Fecha")}
                    {cabecera("vencimiento", "Vencimiento")}
                    {cabecera("total", "Importe", true)}
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    const on = elegidas.has(f.numero_control);
                    const dias = f.vencimiento ? diasEntre(hoy, f.vencimiento) : null;
                    const abierta = abiertas.has(f.numero_control);
                    const det = detalles[f.numero_control];
                    return (
                      <Fragment key={f.numero_control}>
                      <tr
                        onClick={() => alternar(f.numero_control)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors ${
                          on ? "bg-[#4FAEB2]/10 hover:bg-[#4FAEB2]/15" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox" checked={on}
                            onChange={() => alternar(f.numero_control)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{f.numero_factura ?? "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{f.numero_control}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">{fmt(f.fecha)}</td>
                        <td className="px-3 py-2.5">
                          <span className="tabular-nums text-slate-700">{fmt(f.vencimiento)}</span>
                          {dias != null && (
                            f.vencida || dias < 0 ? (
                              <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                                vencida {dias < 0 ? `hace ${-dias} d` : ""}
                              </span>
                            ) : dias <= 7 ? (
                              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                {dias === 0 ? "vence hoy" : `en ${dias} d`}
                              </span>
                            ) : null
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                          {gs(f.total)}
                        </td>
                        {/* El clic en la fila sigue eligiendo la factura, que
                            es para lo que está la pantalla. Lo que abre el
                            detalle es este botón, con su propio clic. */}
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void verDetalle(f.numero_control); }}
                            aria-expanded={abiertas.has(f.numero_control)}
                            title="Ver de qué es esta factura"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            {abiertas.has(f.numero_control)
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>

                      {/* De qué es esta factura: la compra y lo que entró. */}
                      {abierta && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td />
                          <td colSpan={6} className="px-3 py-3">
                            {det?.cargando ? (
                              <p className="text-xs text-slate-500">Buscando la compra…</p>
                            ) : det?.error ? (
                              <p className="text-xs text-rose-700">{det.error}</p>
                            ) : !det || det.items.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                Esta factura no tiene productos cargados. Puede ser una compra
                                vieja que entró en la migración sin el detalle.
                              </p>
                            ) : (
                              <>
                                <p className="mb-2 text-[11px] text-slate-500">
                                  Compra <span className="font-mono text-slate-700">{f.numero_control}</span>
                                  {det.fecha_factura ? ` · factura del ${fmt(det.fecha_factura)}` : ""}
                                  {det.tipo_pago ? ` · ${enPalabras(det.tipo_pago)}` : ""}
                                  {det.estado ? ` · ${enPalabras(det.estado)}` : ""}
                                </p>
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                      <th className="px-2 py-1 text-left font-medium">Producto</th>
                                      <th className="w-24 px-2 py-1 text-right font-medium">Cantidad</th>
                                      <th className="w-32 px-2 py-1 text-right font-medium">Costo unit.</th>
                                      <th className="w-32 px-2 py-1 text-right font-medium">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {det.items.map((it, k) => (
                                      <tr key={k} className="border-t border-slate-100">
                                        <td className="px-2 py-1 text-slate-800">{it.producto_nombre}</td>
                                        <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                                          {it.cantidad.toLocaleString("es-PY")}
                                        </td>
                                        <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                                          {gs(it.costo_unitario)}
                                        </td>
                                        <td className="px-2 py-1 text-right font-medium tabular-nums text-slate-800">
                                          {gs(it.total)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </EdgeScrollArea>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Las facturas que ya tienen un cheque no se listan, para no pagar dos veces lo mismo. Pasan
          a <strong>pagadas</strong> al cargar el recibo del proveedor, no al emitir el cheque: su número
          de recibo es lo que termina la discusión si después reclama una factura.
        </span>
      </p>

      {/* ── Barra para armar el cheque: fija abajo apenas se elige algo ─ */}
      {seleccionadas.length > 0 && (
        <div className="sticky bottom-0 z-20 max-md:bottom-16">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_-8px_30px_-12px_rgba(15,23,42,0.25)]">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="mr-2 min-w-[180px]">
                <p className="text-xs text-slate-500">
                  {seleccionadas.length} {seleccionadas.length === 1 ? "factura elegida" : "facturas elegidas"}
                  {ocultasElegidas > 0 && <span className="text-slate-400"> ({ocultasElegidas} fuera del filtro)</span>}
                </p>
                <p className="text-xl font-semibold tabular-nums text-slate-900">
                  {gs(total)}
                </p>
                <button type="button" onClick={() => setElegidas(new Set())} className="text-xs font-medium text-slate-400 hover:text-rose-600">
                  Quitar selección
                </button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">Con qué se paga</span>
                <Selector
                  value={medio}
                  onChange={(e) => setMedio(e.target.value as typeof medio)}
                  className="h-[38px] w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
                >
                  <option value="cheque">Cheque</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                </Selector>
              </label>

              {medio !== "efectivo" && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-500">
                    {medio === "cheque" ? "N° de cheque" : "N° de comprobante"}{" "}
                    <span className="font-normal normal-case text-slate-400">(opcional)</span>
                  </span>
                  <input
                    value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)}
                    placeholder={medio === "cheque" ? "0001234" : "N° de la transferencia"}
                    className="h-[38px] w-36 rounded-lg border border-slate-200 px-3 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
                  />
                </label>
              )}

              {/* El banco también para la transferencia: es de dónde sale la
                  plata, y sin eso el pago no se puede conciliar después. */}
              {medio !== "efectivo" && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-500">
                    {medio === "cheque" ? "Banco" : "Banco de donde sale"}
                  </span>
                  <Selector
                    value={bancoId} onChange={(e) => setBancoId(e.target.value)}
                    className={`h-[38px] w-44 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 ${bancoId ? "text-slate-800" : "text-slate-400"}`}
                  >
                    <option value="">{bancos.length ? "Elegí el banco…" : "No hay bancos cargados"}</option>
                    {bancos.map((b) => <option key={b.id} value={b.id} className="text-slate-800">{b.nombre}</option>)}
                  </Selector>
                </label>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-500">
                  {medio === "cheque" ? "Fecha del cheque" : "Fecha del pago"}
                </span>
                <input
                  type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
                  className="h-[38px] rounded-lg border border-slate-200 px-3 text-sm"
                />
              </label>

              {/* La fecha de cobro, que es la que manda en el flujo de caja: un
                  cheque diferido se firma hoy y sale del banco en otra semana. */}
              {medio === "cheque" && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-500">
                    Fecha de cobro{" "}
                    <span className="font-normal normal-case text-slate-400">(si es diferido)</span>
                  </span>
                  <input
                    type="date" value={fechaCobro} min={fechaPago}
                    onChange={(e) => setFechaCobro(e.target.value)}
                    className="h-[38px] rounded-lg border border-slate-200 px-3 text-sm"
                  />
                </label>
              )}
              <div className={`flex flex-col gap-1 ${medio === "cheque" ? "" : "hidden"}`}>
                <span className="text-[11px] font-medium text-slate-500">
                  Foto del cheque <span className="font-normal normal-case text-slate-400">(opcional)</span>
                </span>
                {imagenCheque ? (
                  <div className="flex h-[38px] w-52 items-center gap-2 rounded-lg border border-[#4FAEB2]/50 bg-[#4FAEB2]/5 pl-3 pr-1 text-sm">
                    <ImagePlus className="h-4 w-4 shrink-0 text-[#3F8E91]" />
                    <span className="truncate text-slate-700" title={imagenCheque.name}>{imagenCheque.name}</span>
                    <button
                      type="button" onClick={() => setImagenCheque(null)} aria-label="Quitar la foto"
                      className="ml-auto rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button" onClick={() => inputImagen.current?.click()}
                    className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-500 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
                  >
                    <ImagePlus className="h-4 w-4" /> Imagen o PDF
                  </button>
                )}
                <input
                  ref={inputImagen} type="file" accept={ACCEPT} className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (f && f.size > MAX_BYTES) { setError("El archivo no puede pesar más de 10 MB."); return; }
                    setImagenCheque(f);
                  }}
                />
              </div>

              <button
                type="button" onClick={() => void emitir()}
                disabled={emitiendo}
                className="ml-auto h-[38px] rounded-lg bg-[#4FAEB2] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50"
              >
                {emitiendo ? "Armando…" : "Armar el pago"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cargandoRecibo && chequeCreado && (
        <CargarReciboChequeModal
          chequeId={chequeCreado.id}
          numeroCheque={chequeCreado.numero}
          importe={chequeCreado.importe}
          moneda={chequeCreado.moneda}
          proveedor={chequeCreado.proveedor_nombre}
          onClose={() => setCargandoRecibo(false)}
          onCargado={(m) => {
            setCargandoRecibo(false);
            setAviso(m);
            setChequeCreado(null);
            void cargar();
            onPagoArmado?.();
          }}
        />
      )}
    </div>
  );
}
