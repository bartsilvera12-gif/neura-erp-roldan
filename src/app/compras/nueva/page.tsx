"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import SearchableSelect, { type SearchableSelectHandle } from "@/components/ui/SearchableSelect";
import { saveCompraMulti, uploadComprobante, type CompraItemPayload } from "@/lib/compras/storage";
import { getProveedores, proveedorExiste, createProveedor } from "@/lib/proveedores/storage";
import { getProductos } from "@/lib/inventario/storage";
import type { TipoIva, TipoPago, Moneda } from "@/lib/compras/types";
import {
  MEDIOS_PAGO_COMPRA, normalizarMedioCompra, type MedioPagoCompra,
} from "@/lib/compras/pago-caja";
import type { Proveedor } from "@/lib/proveedores/types";
import type { Producto } from "@/lib/inventario/types";
import { formatearNumeroFactura, errorTimbrado, errorNumeroFactura } from "@/lib/formato/numero-factura";

import { Check } from "lucide-react";
import Selector from "@/components/ui/Selector";
import { aGuaranies } from "@/lib/moneda";
import HistorialPreciosModal from "@/components/compras/HistorialPreciosModal";
import { precioEnDolares, type FilaHistorial } from "@/lib/compras/historial-precios";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { MAX_ITEMS_COMPRA, mensajeTopeCompra } from "@/lib/compras/tope";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}
function margenColor(m: number) {
  if (m >= 40) return "text-green-600";
  if (m >= 20) return "text-yellow-600";
  return "text-red-600";
}
/**
 * IVA INCLUIDO (mismo patrón que Ventas y que las facturas físicas de proveedores):
 * el precio unitario que se carga YA contiene el IVA. El monto de IVA se desglosa
 * "desde adentro" a partir del total, no se suma encima.
 *
 * Total = precio × cantidad
 * IVA   = total − total / (1 + tasa)
 * Base  = total − IVA
 */
function ivaMonto(total: number, iva: TipoIva): number {
  if (iva === "exenta") return 0;
  if (iva === "5") return total - total / 1.05;
  return total - total / 1.10;
}

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#4FAEB2] focus:outline-none bg-white text-sm";
const inputSmClass = inputClass;
const labelClass = "block text-sm font-medium text-slate-700 mb-2";
const labelSmClass = "block text-xs font-medium text-slate-600 mb-1.5";

const ivaLabel: Record<TipoIva, string> = { exenta: "Exenta", "5": "IVA 5%", "10": "IVA 10%" };

/** El IVA es del producto (pedido del cliente): en la compra no se elige. */
function ivaDeProducto(tipo?: string | null): TipoIva {
  return tipo === "EXENTA" ? "exenta" : tipo === "5%" ? "5" : "10";
}

// ── Tipos locales ────────────────────────────────────────────────────────────

type LineaCompra = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number;
  costo_unitario_input: number; // en la moneda de la cabecera
  costo_unitario_pyg: number;
  iva_tipo: TipoIva;
  precio_venta: number;
  /** Precio de venta en dólares, cuando la compra es en USD. */
  precio_venta_usd?: number | null;
  subtotal: number;
  monto_iva: number;
  total: number;
  margen_venta: number | null;
  // Control de lote (solo cuando el producto tiene controla_lote=true).
  controla_lote: boolean;
  lote_numero: string;
  lote_fecha_vencimiento: string;
};

// ── SegmentedControl ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value, options, onChange, small = false,
}: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 font-medium transition-colors ${small ? "py-2 text-xs" : "py-2.5 text-sm"} ${
            value === opt.value ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

/** Fecha corta en hora de Paraguay (UTC−3), sin depender de la tzdata del server. */
function fechaCortaPy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

/**
 * Vencimiento de una factura a crédito: fecha de factura + plazo (punto 6.2).
 * Se calcula en UTC a mediodía para que el cambio de día no se mueva por el
 * huso: solo interesa la fecha, no la hora.
 */
function vencimientoISO(fechaFactura: string, dias: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFactura) || !Number.isFinite(dias)) return null;
  const d = new Date(`${fechaFactura}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Math.trunc(dias));
  return d.toISOString().slice(0, 10);
}

function fechaDiaPy(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** ¿El producto tiene costo o precio cargado en dólares (ficha del producto)? */
function productoEnDolares(p: { costo_usd?: number | null; precio_usd?: number | null }): boolean {
  return Number(p.costo_usd) > 0 || Number(p.precio_usd) > 0;
}

export default function NuevaCompraPage() {
  const router = useRouter();

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  /** Carga por teclado: producto → Enter → cantidad → costo → precio → Enter agrega y vuelve al producto. */
  const buscadorProductoRef = useRef<SearchableSelectHandle>(null);
  const cantidadRef = useRef<HTMLInputElement>(null);
  /** «Ver historial completo» del producto elegido. */
  const [historialAbierto, setHistorialAbierto] = useState(false);

  // Cabecera (compartida por toda la compra)
  const [cab, setCab] = useState({
    proveedor_id: "",
    nro_timbrado: "",
    numero_factura: "",
    tipo_pago: "contado" as TipoPago,
    plazo_dias: "",
    moneda: "PYG" as Moneda,
    tipo_cambio: "",
    fecha_factura: "" as string,
    metodo_pago: "" as "" | MedioPagoCompra,
    ubicacion_id: "",
  });

  /**
   * Cotización vigente (punto 1.5).
   *
   * Se trae una vez al abrir y se usa para pre-cargar el tipo de cambio en
   * cuanto se elige USD. Antes había que tipearlo de memoria cada vez, y dos
   * personas cargando compras el mismo día podían usar cotizaciones distintas
   * sin que nadie se enterara.
   *
   * Se pre-carga el tipo VENDEDOR: una compra al exterior se paga comprando
   * los dólares, y eso se hace al vendedor. Igual queda editable, porque la
   * cotización real de una factura puede ser la que dio el proveedor.
   */
  const [tcVigente, setTcVigente] = useState<{
    compra: number; venta: number; vigente_desde: string; usuario_nombre: string | null;
  } | null>(null);
  const [tcEditado, setTcEditado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/tipos-cambio?moneda=USD&limit=1", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo || !j?.success || !j.data?.vigente) return;
        const v = j.data.vigente as { compra: number; venta: number; vigente_desde: string; usuario_nombre: string | null };
        setTcVigente({
          compra: Number(v.compra) || 0,
          venta: Number(v.venta) || 0,
          vigente_desde: String(v.vigente_desde ?? ""),
          usuario_nombre: v.usuario_nombre ?? null,
        });
      })
      .catch(() => { /* sin cotización se tipea a mano, como antes */ });
    return () => { vivo = false; };
  }, []);

  // Depósitos disponibles para elegir destino de la compra.
  const [ubicaciones, setUbicaciones] = useState<{ id: string; nombre: string; codigo: string | null }[]>([]);

  // Líneas ya agregadas
  const [lineas, setLineas] = useState<LineaCompra[]>([]);

  // Modo edición: ?numero=COMP-XXXXXX en la URL.
  const [numeroEdit, setNumeroEdit] = useState<string | null>(null);
  const editando = numeroEdit !== null;

  /**
   * Tipo de cambio FIJO (pedido del cliente): es la cotización vigente y no se
   * edita acá. Si no hay cotización cargada, se puede escribir (si no, no se
   * podría comprar en dólares). En una compra que se está editando queda el
   * que se guardó con ella.
   */
  const tcFijo = !!tcVigente && tcVigente.venta > 0;
  useEffect(() => {
    if (tcFijo && cab.moneda === "USD" && numeroEdit === null && cab.tipo_cambio !== String(tcVigente!.venta)) {
      setCab((p) => ({ ...p, tipo_cambio: String(tcVigente!.venta) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tcFijo, cab.moneda, numeroEdit]);

  /** A crédito, el pago es siempre con cheque (pedido del cliente). */
  useEffect(() => {
    if (cab.tipo_pago === "credito" && cab.metodo_pago !== "cheque") {
      setCab((p) => ({ ...p, metodo_pago: "cheque" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cab.tipo_pago]);

  /**
   * Elegido el proveedor, se proponen las condiciones de la ÚLTIMA compra que
   * se le hizo (pedido del cliente): contado o crédito y su plazo, guaraníes o
   * dólares, el medio de pago y el depósito. Se pueden cambiar.
   */
  async function traerCompraAnterior(proveedorId: string) {
    if (!proveedorId || numeroEdit !== null) return;
    try {
      const r = await fetch(`/api/compras?ultima_de=${encodeURIComponent(proveedorId)}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      const u = j?.data?.ultima as { tipo_pago?: string; plazo_dias?: number | null; moneda?: string; metodo_pago?: string | null; ubicacion_id?: string | null } | null;
      if (!u) return;
      setCab((p) => {
        const credito = u.tipo_pago === "credito";
        const usd = u.moneda === "USD";
        return {
          ...p,
          tipo_pago: credito ? "credito" : "contado",
          plazo_dias: credito && u.plazo_dias ? String(u.plazo_dias) : p.plazo_dias,
          moneda: (usd ? "USD" : "PYG") as Moneda,
          tipo_cambio: usd ? (tcVigente ? String(tcVigente.venta) : p.tipo_cambio) : "",
          metodo_pago: credito ? "cheque" : (normalizarMedioCompra(u.metodo_pago) ?? p.metodo_pago),
          ubicacion_id: u.ubicacion_id ?? p.ubicacion_id,
        };
      });
    } catch { /* sin la anterior quedan las condiciones del proveedor */ }
  }

  /**
   * Todo por teclado (pedido del cliente): Enter pasa al campo siguiente en
   * vez de mandar el formulario. En un botón, Enter lo aprieta como siempre.
   */
  function enterAlSiguiente(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLButtonElement || t instanceof HTMLTextAreaElement) return;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    if (t instanceof HTMLInputElement && t.type === "file") return;
    const yaManejado = e.defaultPrevented; // p. ej. el buscador eligió una opción
    e.preventDefault();
    const campos = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input:not([disabled]):not([type=hidden]):not([type=file]), select:not([disabled]), button:not([disabled])")
    ).filter((el) => el.offsetParent !== null && !(el as HTMLInputElement).readOnly && el.tabIndex !== -1);
    const i = campos.indexOf(t);
    const sig = i >= 0 ? campos[i + 1] : undefined;
    if (!sig) return;
    window.setTimeout(() => {
      sig.focus();
      if (sig instanceof HTMLInputElement) sig.select();
    }, yaManejado ? 30 : 0);
  }

  const [estadoEdit, setEstadoEdit] = useState<"registrada" | "anulada">("registrada");

  // Editor de la línea en curso
  const [nl, setNl] = useState({
    producto_id: "",
    cantidad: "",
    costo_unitario_input: "",
    iva_tipo: "10" as TipoIva,
    precio_venta: "",
    lote_numero: "",
    lote_fecha_vencimiento: "",
  });

  // Inline crear proveedor / producto
  const [mostrarFormProveedor, setMostrarFormProveedor] = useState(false);
  const [formProveedor, setFormProveedor] = useState({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  const [errorRuc, setErrorRuc] = useState<string | null>(null);
  const [proveedorCreado, setProveedorCreado] = useState<string | null>(null);

  const [mostrarFormProducto, setMostrarFormProducto] = useState(false);
  const [productoCreado, setProductoCreado] = useState<string | null>(null);

  // Comprobante / factura del proveedor (opcional, para toda la compra)
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [comprobanteError, setComprobanteError] = useState<string | null>(null);

  const [errorLinea, setErrorLinea] = useState<string | null>(null);
  const [errorSubmit, setErrorSubmit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleComprobanteChange(e: React.ChangeEvent<HTMLInputElement>) {
    setComprobanteError(null);
    const f = e.target.files?.[0] ?? null;
    if (f && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type)) {
      setComprobanteError("Formato no permitido. Usá JPG, PNG, WebP o PDF.");
      setComprobanteFile(null);
      return;
    }
    if (f && f.size > 10 * 1024 * 1024) {
      setComprobanteError("Archivo demasiado grande (máx. 10 MB).");
      setComprobanteFile(null);
      return;
    }
    setComprobanteFile(f);
  }

  async function recargarProveedores() {
    const data = await getProveedores();
    setProveedores(data.filter((p) => p.estado === "activo"));
  }
  function recargarProductos() { getProductos().then(setProductos); }
  async function recargarUbicaciones() {
    try {
      const r = await fetch("/api/inventario/ubicaciones", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (r.ok && j?.success) {
        const ubis = (j.data?.ubicaciones ?? []) as { id: string; nombre: string; codigo: string | null }[];
        setUbicaciones(ubis);
        if (ubis.length === 1) setCab((prev) => (prev.ubicacion_id ? prev : { ...prev, ubicacion_id: ubis[0].id }));
      }
    } catch { /* silencioso */ }
  }
  useEffect(() => { recargarProveedores(); recargarProductos(); recargarUbicaciones(); }, []);

  // ── «Cargar factura» desde una orden de compra (?orden=) ─────────────────
  // Pedido del cliente: la orden pasa a compra con sus datos (proveedor,
  // condición y productos con su costo estimado). Al guardar, la orden queda
  // facturada con el número de esta compra.
  const [ordenId, setOrdenId] = useState<string | null>(null);
  const [avisoOrden, setAvisoOrden] = useState<string | null>(null);
  useEffect(() => {
    let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get("orden"); } catch { id = null; }
    if (!id) return;
    setOrdenId(id);
    (async () => {
      try {
        const r = await fetch(`/api/ordenes-compra?id=${encodeURIComponent(id!)}`, { credentials: "include" });
        const j = await r.json();
        if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo leer la orden.");
        const o = j.data.orden as Record<string, unknown>;
        const usd = o.moneda === "USD";
        setCab((prev) => ({
          ...prev,
          proveedor_id: o.proveedor_id ? String(o.proveedor_id) : prev.proveedor_id,
          moneda: (usd ? "USD" : "PYG") as Moneda,
          tipo_pago: o.condicion === "credito" ? "credito" : "contado",
        }));
        const prods = await getProductos();
        const items = (Array.isArray(o.items) ? o.items : []) as Array<Record<string, unknown>>;
        const sinProducto: string[] = [];
        const nuevas: LineaCompra[] = [];
        for (const it of items) {
          const pid = it.producto_id ? String(it.producto_id) : "";
          const prod = pid ? prods.find((p) => p.id === pid) : undefined;
          if (!prod) { sinProducto.push(String(it.descripcion ?? "")); continue; }
          const iva: TipoIva = prod.tipo_iva === "EXENTA" ? "exenta" : prod.tipo_iva === "5%" ? "5" : "10";
          const cant = Number(it.cantidad) || 0;
          // En dólares el costo se escribe con la factura: sin cotización no se
          // puede pasar a guaraníes bien.
          const costo = usd ? 0 : Number(it.precio_unitario) || 0;
          const total = cant * costo;
          const montoIva = ivaMonto(total, iva);
          const pv = Number(prod.precio_venta) || 0;
          nuevas.push({
            producto_id: prod.id, producto_nombre: prod.nombre, sku: prod.sku ?? "",
            cantidad: cant, costo_unitario_input: costo, costo_unitario_pyg: costo, iva_tipo: iva,
            precio_venta: pv, subtotal: total - montoIva, monto_iva: montoIva, total,
            margen_venta: pv > 0 && costo > 0 ? ((pv - costo) / pv) * 100 : null,
            controla_lote: false, lote_numero: "", lote_fecha_vencimiento: "",
          });
        }
        setLineas(nuevas);
        setAvisoOrden(
          `Cargando la factura de la orden ${o.numero_control ?? ""}${o.proveedor_id ? "" : " (sin proveedor: elegilo abajo)"}. ` +
          "Revisá cantidades y costos contra la factura." +
          (usd ? " Es en dólares: cargá el costo de cada línea." : "") +
          (sinProducto.length > 0 ? ` No se pasaron ${sinProducto.length} ítems escritos a mano: ${sinProducto.slice(0, 3).join(", ")}.` : "")
        );
      } catch (e) {
        setErrorSubmit(e instanceof Error ? e.message : "No se pudo leer la orden de compra.");
      }
    })();
  }, []);

  // Cargar la compra si estamos editando (?numero=). Prefill de cabecera + líneas.
  useEffect(() => {
    let numero: string | null = null;
    try { numero = new URLSearchParams(window.location.search).get("numero"); } catch { numero = null; }
    if (!numero) return;
    setNumeroEdit(numero);
    (async () => {
      try {
        const res = await fetch(`/api/compras?numero_control=${encodeURIComponent(numero)}`, { credentials: "include" });
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
        const c = j.data.compra as Record<string, unknown>;
        setCab({
          proveedor_id: String(c.proveedor_id ?? ""),
          nro_timbrado: String(c.nro_timbrado ?? ""),
          numero_factura: String(c.numero_factura ?? ""),
          tipo_pago: c.tipo_pago === "credito" ? "credito" : "contado",
          plazo_dias: c.plazo_dias != null ? String(c.plazo_dias) : "",
          moneda: (c.moneda === "USD" ? "USD" : "PYG") as Moneda,
          tipo_cambio: c.moneda === "USD" ? String(c.tipo_cambio ?? "") : "",
          fecha_factura: c.fecha_factura ? String(c.fecha_factura).slice(0, 10) : "",
          metodo_pago: normalizarMedioCompra(c.metodo_pago) ?? "",
          ubicacion_id: typeof c.ubicacion_id === "string" ? c.ubicacion_id : "",
        });
        setEstadoEdit(c.estado === "anulada" ? "anulada" : "registrada");
        const items = (j.data.items ?? []) as Record<string, unknown>[];
        const prods = await getProductos();
        setLineas(items.map((it) => {
          const pid = String(it.producto_id ?? "");
          const prod = prods.find((p) => p.id === pid);
          return {
            producto_id: pid,
            producto_nombre: String(it.producto_nombre ?? ""),
            sku: prod?.sku ?? "",
            cantidad: Number(it.cantidad) || 0,
            costo_unitario_input: Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
            costo_unitario_pyg: Number(it.costo_unitario) || 0,
            iva_tipo: (["exenta", "5", "10"].includes(String(it.iva_tipo)) ? String(it.iva_tipo) : "10") as TipoIva,
            precio_venta: Number(it.precio_venta) || 0,
            subtotal: Number(it.subtotal) || 0,
            monto_iva: Number(it.monto_iva) || 0,
            total: Number(it.total) || 0,
            margen_venta: it.margen_venta != null ? Number(it.margen_venta) : null,
            controla_lote: false,
            lote_numero: "",
            lote_fecha_vencimiento: "",
          };
        }));
      } catch (e) {
        setErrorSubmit(e instanceof Error ? e.message : "No se pudo cargar la compra.");
      }
    })();
  }, []);

  // ── Cálculos de la línea en curso ──────────────────────────────────────────
  const tipoCambioNum = cab.moneda === "USD" ? parseFloat(cab.tipo_cambio) || 0 : 1;
  const nlCant = parseFloat(nl.cantidad) || 0;
  const nlCostoInput = parseFloat(nl.costo_unitario_input) || 0;
  /**
   * El costo en guaraníes, redondeado HACIA ARRIBA.
   *
   * El guaraní no tiene decimales, así que al convertir hay que decidir qué
   * se hace con ellos. Hacia arriba, y no al más cercano: redondeando para
   * abajo siempre falta un guaraní, y el que lo pone es la casa, que es quien
   * puede. En guaraníes no se toca: no hay nada que convertir.
   */
  const nlCostoPYG = cab.moneda === "USD" ? aGuaranies(nlCostoInput, tipoCambioNum) : nlCostoInput;
  const nlPrecio = parseFloat(nl.precio_venta) || 0;
  // IVA incluido: el costo unitario cargado ya contiene el IVA.
  // Total línea = precio × cantidad; IVA se desglosa desde adentro; subtotal = base imponible.
  const nlTotal = nlCant > 0 && nlCostoPYG > 0 ? nlCant * nlCostoPYG : 0;
  const nlIva = ivaMonto(nlTotal, nl.iva_tipo);
  const nlSubtotal = nlTotal - nlIva;
  // El precio de venta está en la moneda de la compra, así que se lo pasa a
  // guaraníes antes de compararlo con el costo. Medir un precio en dólares
  // contra un costo en guaraníes es lo que daba márgenes de -266.566%.
  const nlPrecioPYG = cab.moneda === "USD" ? aGuaranies(nlPrecio, tipoCambioNum) : nlPrecio;
  const nlMargen = nlPrecioPYG > 0 && nlCostoPYG > 0 ? ((nlPrecioPYG - nlCostoPYG) / nlPrecioPYG) * 100 : null;
  const productoSel = productos.find((p) => p.id === nl.producto_id);
  // ¿El producto seleccionado controla lote? Lo tomamos del objeto Producto
  // (el listado de /api/productos incluye controla_lote).
  // Roldán e Hijos: la orden de compra NO pide lote (es solo registro/control, no impacta
  // inventario). El lote/vencimiento se carga aparte desde el producto. Forzamos false
  // para ocultar los inputs de lote y saltar su validación.
  const productoControlaLote = false;
  // Solo informativo: para mostrar el aviso "es materia prima". Ya NO condiciona
  // si se puede agregar — el precio de venta es opcional para cualquier producto.
  const esInsumoNoVendible = !!productoSel && productoSel.es_insumo === true && productoSel.es_vendible !== true;
  // Precio de venta OPCIONAL: la compra no lo exige. Si se deja en 0, el backend
  // conserva el precio actual del producto (UPDATE ... CASE WHEN $3 > 0), no lo
  // pisa con 0. Solo se pide producto, cantidad y costo.
  const lineaLotoOk =
    !productoControlaLote ||
    (nl.lote_numero.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(nl.lote_fecha_vencimiento));
  const lineaLista = !!nl.producto_id && nlCant > 0 && nlCostoPYG > 0 && lineaLotoOk;
  // Motivo por el que el botón está deshabilitado, para no dejar al usuario
  // adivinando.
  const motivoNoAgregar = !nl.producto_id
    ? "Elegí un producto."
    : nlCant <= 0
    ? "Ingresá la cantidad."
    : nlCostoPYG <= 0
    ? "Ingresá el costo unitario."
    : productoControlaLote && nl.lote_numero.trim() === ""
    ? "Este producto controla lote — ingresá el número de lote."
    : productoControlaLote && !/^\d{4}-\d{2}-\d{2}$/.test(nl.lote_fecha_vencimiento)
    ? "Este producto controla lote — ingresá la fecha de vencimiento."
    : null;

  // ── Condición de pago del proveedor elegido (punto 6.2) ────────────────────
  const condicionProveedor = useMemo(() => {
    const pv = proveedores.find((x) => String(x.id) === cab.proveedor_id);
    if (!pv) return null;
    const cond =
      pv.condicion_pago === "credito" ? "crédito"
      : pv.condicion_pago === "contado" ? "contado"
      : pv.condicion_pago === "mixto" ? "mixto"
      : null;
    const dias = pv.plazo_pago_dias != null && pv.plazo_pago_dias > 0 ? `${pv.plazo_pago_dias} días` : null;
    if (!cond && !dias) return null;
    return [cond, dias].filter(Boolean).join(" a ");
  }, [proveedores, cab.proveedor_id]);

  const vencimientoCalculado = useMemo(() => {
    if (cab.tipo_pago !== "credito") return null;
    const dias = parseInt(cab.plazo_dias, 10);
    if (!Number.isFinite(dias) || dias <= 0) return null;
    return vencimientoISO(cab.fecha_factura, dias);
  }, [cab.tipo_pago, cab.plazo_dias, cab.fecha_factura]);

  // ── Totales de la compra ───────────────────────────────────────────────────
  const totales = useMemo(() => {
    return lineas.reduce(
      (acc, l) => ({
        subtotal: acc.subtotal + l.subtotal,
        iva: acc.iva + l.monto_iva,
        total: acc.total + l.total,
      }),
      { subtotal: 0, iva: 0, total: 0 }
    );
  }, [lineas]);

  // Descuento total de la factura (Gs). Se reparte proporcionalmente entre las
  // líneas al guardar, así el IVA y el libro de compras quedan correctos.
  const [descuento, setDescuento] = useState(0);
  const descuentoNum = Math.max(0, Math.min(descuento, totales.total));
  const totalAPagar = totales.total - descuentoNum;
  const factorDescuento = totales.total > 0 ? totalAPagar / totales.total : 1;

  // ── Agregar / quitar línea ──────────────────────────────────────────────────
  function handleAgregarLinea() {
    setErrorLinea(null);
    if (!nl.producto_id) return setErrorLinea("Elegí un producto.");
    if (nlCant <= 0) return setErrorLinea("La cantidad debe ser mayor a 0.");
    if (nlCostoPYG <= 0) return setErrorLinea("El costo unitario debe ser mayor a 0.");
    if (cab.moneda === "USD" && tipoCambioNum <= 0)
      return setErrorLinea("Cargá el tipo de cambio (USD → Gs.) en la cabecera.");
    const prod = productos.find((p) => p.id === nl.producto_id);
    if (!prod) return setErrorLinea("Producto no encontrado. Recargá e intentá de nuevo.");
    if (lineas.length >= MAX_ITEMS_COMPRA) return setErrorLinea(mensajeTopeCompra());

    // Roldán e Hijos: la orden de compra no pide lote. No validamos ni guardamos lote acá.
    const prodCtrlLote = false;

    setLineas((prev) => [
      ...prev,
      {
        producto_id: prod.id,
        producto_nombre: prod.nombre,
        sku: prod.sku,
        cantidad: nlCant,
        costo_unitario_input: nlCostoInput,
        costo_unitario_pyg: nlCostoPYG,
        iva_tipo: nl.iva_tipo,
        // Para insumos sin precio cargado, guardamos el precio actual del producto
        // (no inventamos uno). El backend no sobreescribe productos.precio_venta con 0.
        // En guaraníes para la fila de la compra y para el margen; y, cuando
        // la compra es en dólares, también el precio en dólares, que es el que
        // queda mandando en el producto.
        precio_venta: nlPrecioPYG > 0 ? nlPrecioPYG : (prod.precio_venta ?? 0),
        precio_venta_usd: cab.moneda === "USD" && nlPrecio > 0 ? nlPrecio : null,
        subtotal: nlSubtotal,
        monto_iva: nlIva,
        total: nlTotal,
        margen_venta: nlMargen,
        controla_lote: prodCtrlLote,
        lote_numero: prodCtrlLote ? nl.lote_numero.trim() : "",
        lote_fecha_vencimiento: prodCtrlLote ? nl.lote_fecha_vencimiento : "",
      },
    ]);
    setNl({ producto_id: "", cantidad: "", costo_unitario_input: "", iva_tipo: "10", precio_venta: "", lote_numero: "", lote_fecha_vencimiento: "" });
    setProductoCreado(null);
    setTimeout(() => buscadorProductoRef.current?.abrir(), 0);
  }

  /** Enter en el último campo de la línea (precio de venta): agrega la línea. */
  function enterAgregaLinea(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    handleAgregarLinea();
  }

  function handleQuitarLinea(idx: number) {
    setLineas((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorSubmit(null);
    if (!cab.proveedor_id) return setErrorSubmit("Seleccioná o agregá un proveedor.");
    const errTimbrado = errorTimbrado(cab.nro_timbrado);
    if (errTimbrado) return setErrorSubmit(errTimbrado);
    const errFactura = errorNumeroFactura(cab.numero_factura);
    if (errFactura) return setErrorSubmit(errFactura);
    if (lineas.length === 0) return setErrorSubmit("Agregá al menos un producto a la compra.");
    if (cab.moneda === "USD" && tipoCambioNum <= 0)
      return setErrorSubmit("Cargá el tipo de cambio (USD → Gs.).");

    const proveedor = proveedores.find((p) => String(p.id) === cab.proveedor_id);
    if (!proveedor) return setErrorSubmit("Proveedor no encontrado. Recargá e intentá de nuevo.");

    const items: CompraItemPayload[] = lineas.map((l) => ({
      producto_id: l.producto_id,
      producto_nombre: l.producto_nombre,
      cantidad: l.cantidad,
      // El costo unitario neto refleja el descuento prorrateado (IVA incluido).
      costo_unitario: l.cantidad > 0 ? (l.total * factorDescuento) / l.cantidad : l.costo_unitario_pyg,
      costo_unitario_original: l.costo_unitario_input,
      iva_tipo: l.iva_tipo,
      // Descuento prorrateado: escalar subtotal/IVA/total por el factor mantiene
      // la relación IVA-incluido (iva = total − total/(1+tasa)) intacta.
      subtotal: l.subtotal * factorDescuento,
      monto_iva: l.monto_iva * factorDescuento,
      total: l.total * factorDescuento,
      precio_venta: l.precio_venta,
      margen_venta: l.margen_venta ?? 0,
      // Lote/vencimiento (solo si el producto controla lote). El backend valida
      // que estén presentes cuando corresponden — acá los mandamos siempre para
      // que saveCompraMulti los pase al POST /api/compras.
      ...(l.controla_lote
        ? {
            lote_numero: l.lote_numero,
            lote_fecha_vencimiento: l.lote_fecha_vencimiento,
          }
        : {}),
    } as CompraItemPayload));

    setSubmitting(true);
    try {
      // ── Modo EDICIÓN: reemplaza la compra vía PUT (cabecera + líneas + estado). ──
      if (editando) {
        const putRes = await fetch("/api/compras", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numero_control: numeroEdit,
            proveedor_id: String(proveedor.id),
            proveedor_nombre: proveedor.nombre,
            moneda: cab.moneda,
            tipo_cambio: tipoCambioNum,
            tipo_pago: cab.tipo_pago,
            plazo_dias: cab.tipo_pago === "credito" && cab.plazo_dias ? parseInt(cab.plazo_dias) : null,
            nro_timbrado: cab.nro_timbrado,
            numero_factura: cab.numero_factura || null,
            fecha_factura: cab.fecha_factura || null,
            metodo_pago: cab.metodo_pago || null,
            estado: estadoEdit,
            items,
          }),
        });
        const pj = await putRes.json().catch(() => ({}));
        if (!putRes.ok || !pj?.success) { setErrorSubmit(pj?.error ?? "No se pudo editar la compra."); return; }
        router.push("/compras");
        return;
      }

      // Subir comprobante primero (si hay) para asociarlo a toda la compra.
      let comprobante: { comprobante_storage_path: string; comprobante_nombre: string; comprobante_mime_type: string } | null = null;
      if (comprobanteFile) {
        const up = await uploadComprobante(comprobanteFile);
        if (!up.ok) { setErrorSubmit(`Comprobante: ${up.error}`); return; }
        comprobante = up.data;
      }

      const res = await saveCompraMulti(
        {
          proveedor_id: String(proveedor.id),
          proveedor_nombre: proveedor.nombre,
          moneda: cab.moneda,
          tipo_cambio: tipoCambioNum,
          tipo_pago: cab.tipo_pago,
          plazo_dias: cab.tipo_pago === "credito" && cab.plazo_dias ? parseInt(cab.plazo_dias) : undefined,
          nro_timbrado: cab.nro_timbrado,
          fecha_factura: cab.fecha_factura || null,
          metodo_pago: cab.metodo_pago || null,
          comprobante_storage_path: comprobante?.comprobante_storage_path ?? null,
          comprobante_nombre: comprobante?.comprobante_nombre ?? null,
          comprobante_mime_type: comprobante?.comprobante_mime_type ?? null,
          ubicacion_id: cab.ubicacion_id || null,
        },
        items
      );
      if (!res.success) { setErrorSubmit(res.error); return; }
      if (res.warning) alert(res.warning);
      // La orden de la que salió queda facturada con esta compra.
      if (ordenId) {
        await fetch("/api/ordenes-compra", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: ordenId, compra_numero: res.numero_control || "cargada" }),
        }).catch(() => { /* la compra ya está: la orden se marca a mano */ });
      }
      router.push("/compras");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Inline proveedor ─────────────────────────────────────────────────────────
  function handleProveedorInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.name === "ruc") setErrorRuc(null);
    const { name, value, type } = e.target;
    let normalized = value;
    if (name === "email" || type === "email") normalized = value.toLowerCase();
    else if (["nombre", "contacto"].includes(name)) normalized = value.toUpperCase();
    setFormProveedor((prev) => ({ ...prev, [name]: normalized }));
  }
  async function handleAgregarProveedor() {
    if (!formProveedor.nombre.trim() || !formProveedor.ruc.trim()) return;
    setErrorRuc(null);
    const dup = await proveedorExiste(formProveedor.ruc);
    if (dup) { setErrorRuc(`RUC ya registrado para "${dup.nombre}".`); return; }
    const resultado = await createProveedor({
      nombre: formProveedor.nombre.trim().toUpperCase(), ruc: formProveedor.ruc.trim(),
      telefono: formProveedor.telefono.trim(), email: formProveedor.email.trim(),
      contacto: formProveedor.contacto.trim().toUpperCase(), direccion: "", estado: "activo",
    });
    if (!resultado.ok) { setErrorRuc(resultado.error); return; }
    await recargarProveedores();
    setCab((prev) => ({ ...prev, proveedor_id: String(resultado.proveedor.id) }));
    setProveedorCreado(resultado.proveedor.nombre);
    setMostrarFormProveedor(false);
    setFormProveedor({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  }
  function handleCancelarProveedor() {
    setMostrarFormProveedor(false);
    setFormProveedor({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
    setErrorRuc(null);
  }

  // ── Inline producto ──────────────────────────────────────────────────────────
  /**
   * El producto se crea con la ficha completa de Inventario (en un modal). Al
   * guardar, esa ficha avisa con el producto creado y acá queda elegido en la
   * línea, con su IVA, su costo y su precio.
   */
  useEffect(() => {
    if (!mostrarFormProducto) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { tipo?: string; producto?: Producto } | null;
      if (d?.tipo === "neura:producto-cancelado") { setMostrarFormProducto(false); return; }
      if (d?.tipo !== "neura:producto-creado" || !d.producto) return;
      const creado = d.producto;
      setProductos((prev) => (prev.some((p) => p.id === creado.id) ? prev : [...prev, creado]));
      recargarProductos();
      setNl((prev) => ({
        ...prev,
        producto_id: creado.id,
        iva_tipo: ivaDeProducto(creado.tipo_iva),
        // En una compra en dólares, el costo y el precio de la línea van en
        // dólares: se toman los de la ficha en dólares del producto.
        costo_unitario_input: cab.moneda === "USD"
          ? (creado.costo_usd ? String(creado.costo_usd) : prev.costo_unitario_input)
          : (creado.costo_promedio ? String(Math.round(Number(creado.costo_promedio))) : prev.costo_unitario_input),
        precio_venta: cab.moneda === "USD"
          ? (creado.precio_usd ? String(creado.precio_usd) : prev.precio_venta)
          : (creado.precio_venta ? String(creado.precio_venta) : prev.precio_venta),
      }));
      setProductoCreado(creado.nombre);
      setMostrarFormProducto(false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mostrarFormProducto, cab.moneda]);

  function handleCancelarProducto() {
    setMostrarFormProducto(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{editando ? `Editar compra ${numeroEdit}` : "Nueva compra"}</h1>
        <p className="text-gray-600">
          {editando
            ? "Edición completa (solo admin): cabecera, ítems, montos y estado. No recalcula el costo promedio de los productos."
            : "Una compra puede tener varios productos del mismo proveedor."}
        </p>
      </div>

      {avisoOrden && (
        <div className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{avisoOrden}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-3xl">
        <form className="space-y-8" onSubmit={handleSubmit} onKeyDown={enterAlSiguiente}>

          {/* ── Cabecera ─────────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Comprobante y proveedor</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>N° de timbrado <span className="text-red-500">*</span></label>
                <input type="text" name="nro_timbrado" value={cab.nro_timbrado}
                  onChange={(e) => setCab((p) => ({ ...p, nro_timbrado: e.target.value }))}
                  placeholder="Ej: 16110567" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>N° de factura <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input type="text" name="numero_factura" value={cab.numero_factura}
                  onChange={(e) => setCab((p) => ({ ...p, numero_factura: formatearNumeroFactura(e.target.value) }))}
                  placeholder="Ej: 007-001-0016173" className={inputClass} inputMode="numeric" />
              </div>
              <div>
                <label className={labelClass}>Fecha de la factura <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input
                  type="date"
                  value={cab.fecha_factura}
                  onChange={(e) => setCab((p) => ({ ...p, fecha_factura: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Proveedor <span className="text-red-500">*</span></label>
                <SearchableSelect
                  value={cab.proveedor_id || null}
                  onChange={(id) => {
                    // Se arrastra la condición de pago del proveedor (6.2). Es
                    // una sugerencia: el usuario la puede cambiar en esta compra
                    // sin tocar la ficha del proveedor.
                    const pv = proveedores.find((x) => String(x.id) === id);
                    setCab((p) => ({
                      ...p,
                      proveedor_id: id,
                      tipo_pago:
                        pv?.condicion_pago === "credito"
                          ? "credito"
                          : pv?.condicion_pago === "contado"
                          ? "contado"
                          : p.tipo_pago,
                      plazo_dias:
                        pv?.plazo_pago_dias != null && pv.plazo_pago_dias > 0
                          ? String(pv.plazo_pago_dias)
                          : p.plazo_dias,
                    }));
                    setProveedorCreado(null);
                    void traerCompraAnterior(id);
                  }}
                  options={proveedores.map((p) => ({
                    id: String(p.id),
                    label: p.nombre,
                    hint: p.ruc ? `RUC ${p.ruc}` : null,
                  }))}
                  placeholder="Buscar proveedor…"
                  emptyText="Sin proveedores que coincidan"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Comprobante / factura <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleComprobanteChange}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#4FAEB2] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-[#3F8E91]"
                />
                {comprobanteFile && !comprobanteError && (
                  <p className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-green-600"><Check className="h-4 w-4" /> {comprobanteFile.name} listo para subir al guardar.</p>
                )}
                {comprobanteError && <p className="mt-1.5 text-xs text-red-600">{comprobanteError}</p>}
                <p className="mt-1 text-xs text-gray-400">JPG, PNG, WebP o PDF — máx. 10 MB. Se asocia a toda la compra.</p>
              </div>
            </div>

            {proveedorCreado && (
              <p className="inline-flex items-center gap-1.5 text-xs text-green-600"><Check className="h-4 w-4" /> Proveedor &quot;{proveedorCreado}&quot; creado y seleccionado.</p>
            )}
            {!mostrarFormProveedor ? (
              <button type="button" onClick={() => { setMostrarFormProveedor(true); setProveedorCreado(null); }}
                className="text-xs text-gray-400 hover:text-gray-700 underline transition-colors">
                ¿No encontrás el proveedor? Crear nuevo
              </button>
            ) : (
              <InlineFormBox titulo="Nuevo proveedor" onCancel={handleCancelarProveedor} onSave={handleAgregarProveedor}
                saveDisabled={!formProveedor.nombre.trim() || !formProveedor.ruc.trim()}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelSmClass}>Nombre / Razón social <span className="text-red-500">*</span></label>
                    <input type="text" name="nombre" value={formProveedor.nombre} onChange={handleProveedorInputChange}
                      placeholder="Ej: DISTRIBUIDORA SUR S.A." className={`${inputSmClass} uppercase`} />
                  </div>
                  <div>
                    <label className={labelSmClass}>RUC <span className="text-red-500">*</span></label>
                    <input type="text" name="ruc" value={formProveedor.ruc} onChange={handleProveedorInputChange}
                      placeholder="Ej: 80012345-1" className={`${inputSmClass} ${errorRuc ? "border-red-300 bg-red-50" : ""}`} />
                    {errorRuc && <p className="mt-1 text-xs text-red-600">{errorRuc}</p>}
                  </div>
                  <div>
                    <label className={labelSmClass}>Teléfono</label>
                    <input type="text" name="telefono" value={formProveedor.telefono} onChange={handleProveedorInputChange}
                      placeholder="Ej: 0981 111 222" className={inputSmClass} />
                  </div>
                  <div>
                    <label className={labelSmClass}>Email</label>
                    <input type="email" name="email" value={formProveedor.email} onChange={handleProveedorInputChange}
                      placeholder="Ej: ventas@empresa.com" className={inputSmClass} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelSmClass}>Persona de contacto</label>
                    <input type="text" name="contacto" value={formProveedor.contacto} onChange={handleProveedorInputChange}
                      placeholder="Ej: CARLOS MENDOZA" className={`${inputSmClass} uppercase`} />
                  </div>
                </div>
              </InlineFormBox>
            )}
          </section>

          {/* ── Condiciones + moneda ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Condiciones y moneda</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Tipo de pago</label>
                <SegmentedControl<TipoPago> value={cab.tipo_pago}
                  options={[{ value: "contado", label: "Contado" }, { value: "credito", label: "Crédito" }]}
                  onChange={(v) => setCab((p) => ({ ...p, tipo_pago: v }))} />
                <p className="mt-1 text-[11px] text-slate-500">Contado vs. crédito (plazo).</p>
              </div>
              <div>
                <label className={labelClass}>Método de pago <span className="text-gray-400 font-normal">(opcional)</span></label>
                <Selector
                  value={cab.metodo_pago}
                  disabled={cab.tipo_pago === "credito"}
                  onChange={(e) =>
                    setCab((p) => ({ ...p, metodo_pago: normalizarMedioCompra(e.target.value) ?? "" }))
                  }
                  className={`${inputClass} ${cab.tipo_pago === "credito" ? "bg-slate-50 text-slate-600" : ""}`}
                >
                  <option value="">Sin especificar</option>
                  {MEDIOS_PAGO_COMPRA.map((m) => (
                    <option key={m.clave} value={m.clave}>{m.label}</option>
                  ))}
                </Selector>
                <p className="mt-1 text-[11px] text-slate-500">
                  {cab.tipo_pago === "credito"
                    ? "A crédito se paga con cheque."
                    : "Cómo se hizo el pago. Solo el efectivo baja el efectivo esperado del arqueo."}
                </p>
              </div>
              <div>
                <label className={labelClass}>Moneda</label>
                <SegmentedControl<Moneda> value={cab.moneda}
                  options={[{ value: "PYG", label: "Guaraníes (₲)" }, { value: "USD", label: "Dólares (USD)" }]}
                  onChange={(v) => {
                    // Al pasar a dólares se pre-carga la cotización vigente.
                    const precarga = v === "USD" && tcVigente ? String(tcVigente.venta) : "";
                    setTcEditado(false);
                    setCab((p) => ({ ...p, moneda: v, tipo_cambio: precarga }));
                  }} />
              </div>
              {cab.tipo_pago === "credito" && (
                <div>
                  <label className={labelClass}>Plazo (días)</label>
                  <input type="number" value={cab.plazo_dias} onChange={(e) => setCab((p) => ({ ...p, plazo_dias: e.target.value }))}
                    placeholder="Ej: 30" className={inputClass} min={1} max={365} />
                  {condicionProveedor && (
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">
                      Condición del proveedor: {condicionProveedor}.
                    </p>
                  )}
                  {vencimientoCalculado ? (
                    <p className="mt-1 text-[11px] leading-snug text-slate-600">
                      Vence el <strong>{fechaDiaPy(vencimientoCalculado)}</strong>.
                    </p>
                  ) : cab.plazo_dias && !cab.fecha_factura ? (
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">
                      Sin fecha de factura el vencimiento se cuenta desde hoy.
                    </p>
                  ) : !cab.plazo_dias ? (
                    <p className="mt-1 text-[11px] leading-snug text-amber-600">
                      Sin plazo la factura no vence nunca y no aparece en los pagos a proveedores.
                    </p>
                  ) : null}
                </div>
              )}
              {cab.moneda === "USD" && (
                <div>
                  <label className={labelClass}>Tipo de cambio (USD → Gs.) <span className="text-red-500">*</span></label>
                  {tcFijo || editando ? (
                    <div className={`${inputClass} cursor-not-allowed bg-slate-50 tabular-nums text-slate-700`} title="Es la cotización vigente: no se cambia en la compra.">
                      {Number(cab.tipo_cambio || 0).toLocaleString("es-PY")}
                    </div>
                  ) : (
                    <MontoInput value={cab.tipo_cambio}
                      onChange={(n) => { setTcEditado(true); setCab((p) => ({ ...p, tipo_cambio: String(n) })); }}
                      placeholder="Ej: 7500" className={inputClass} decimals={false} />
                  )}
                  {tcVigente ? (
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">
                      Cotización vigente: vendedor {tcVigente.venta.toLocaleString("es-PY")} ·
                      comprador {tcVigente.compra.toLocaleString("es-PY")}
                      {tcVigente.vigente_desde && <> · cargada el {fechaCortaPy(tcVigente.vigente_desde)}</>}
                      {tcVigente.usuario_nombre && <> por {tcVigente.usuario_nombre}</>}.
                      {tcEditado && Number(cab.tipo_cambio) !== tcVigente.venta && (
                        <>
                          {" "}
                          <button type="button"
                            onClick={() => { setTcEditado(false); setCab((p) => ({ ...p, tipo_cambio: String(tcVigente.venta) })); }}
                            className="underline underline-offset-2 hover:text-slate-800">
                            Volver a la vigente
                          </button>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">
                      No hay cotización cargada. La que pongas acá queda guardada con esta compra.
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                    Es el que se usa para convertir el costo a guaraníes, y queda guardado con la
                    compra: si mañana cambia la cotización, esta factura no se mueve.
                  </p>
                </div>
              )}
              <div>
                <label className={labelClass}>Depósito destino</label>
                <Selector
                  value={cab.ubicacion_id}
                  onChange={(e) => setCab((p) => ({ ...p, ubicacion_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Automático (por producto)</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}{u.codigo ? ` — ${u.codigo}` : ""}
                    </option>
                  ))}
                </Selector>
                <p className="mt-1 text-[11px] text-slate-500">
                  {ubicaciones.length === 0
                    ? "Cargá depósitos en Inventario → Ubicaciones."
                    : cab.ubicacion_id
                      ? "Todas las líneas entran a este depósito."
                      : "Cada producto entra al depósito principal configurado en su ficha."}
                </p>
              </div>
            </div>
          </section>

          {/* ── Productos (líneas) ───────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Productos de la compra</SectionTitle>

            {/* Líneas ya agregadas */}
            {lineas.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="py-2 px-3 font-medium">Producto</th>
                      <th className="py-2 px-3 font-medium text-right">Cant.</th>
                      <th className="py-2 px-3 font-medium text-right">Costo unit.</th>
                      <th className="py-2 px-3 font-medium">IVA</th>
                      <th className="py-2 px-3 font-medium text-right">Precio venta</th>
                      <th className="py-2 px-3 font-medium text-right">Total línea</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l, i) => (
                      <tr key={`${l.producto_id}-${i}`} className="border-t border-slate-100">
                        <td className="py-2 px-3">
                          <div className="font-medium text-gray-800 flex items-center gap-2">
                            {l.producto_nombre}
                            {l.controla_lote && (
                              <span className="inline-block rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold">
                                Lote
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-gray-400">{l.sku}</div>
                          {l.controla_lote && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              #{l.lote_numero} · vence {l.lote_fecha_vencimiento}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.cantidad}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-600">{formatGs(l.costo_unitario_pyg)}</td>
                        <td className="py-2 px-3 text-xs text-gray-500">{ivaLabel[l.iva_tipo]}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-600">{formatGs(l.precio_venta)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-800">{formatGs(l.total)}</td>
                        <td className="py-2 px-3 text-right">
                          <button type="button" onClick={() => handleQuitarLinea(i)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium" aria-label="Quitar línea">
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/60">
                      <td className="py-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500" colSpan={5}>
                        Total compra ({lineas.length} {lineas.length === 1 ? "ítem" : "ítems"})
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-bold text-[#4FAEB2]">{formatGs(totales.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Editor de nueva línea */}
            <div className="rounded-xl border border-dashed border-slate-300 p-4 space-y-4 bg-slate-50/40">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Agregar producto</p>

              <div>
                <label className={labelSmClass}>Producto <span className="text-red-500">*</span></label>
                <SearchableSelect
                  ref={buscadorProductoRef}
                  value={nl.producto_id || null}
                  onChange={(id) => {
                    const p = productos.find((x) => x.id === id);
                    setProductoCreado(null);
                    const insumoNoVendible = !!p && p.es_insumo === true && p.es_vendible !== true;
                    // En una compra en dólares, si el producto tiene costo/precio
                    // en dólares se usan esos; si no, queda para cargar.
                    const usd = cab.moneda === "USD";
                    const costoUsd = Number(p?.costo_usd) || 0;
                    const precioUsd = Number(p?.precio_usd) || 0;
                    setNl((prev) => ({
                      ...prev,
                      producto_id: id,
                      iva_tipo: ivaDeProducto(p?.tipo_iva),
                      costo_unitario_input: !p ? "" : usd ? (costoUsd > 0 ? String(costoUsd) : "") : String(Math.round(Number(p.costo_promedio) || 0)),
                      precio_venta: !p || insumoNoVendible ? "" : usd ? (precioUsd > 0 ? String(precioUsd) : "") : String(p.precio_venta),
                    }));
                    // Elegido el producto, el cursor pasa a la cantidad.
                    setTimeout(() => { cantidadRef.current?.focus(); cantidadRef.current?.select(); }, 40);
                  }}
                  options={productos.map((p) => ({
                    id: p.id,
                    label: p.nombre,
                    hint: `${p.sku} · stock ${p.stock_actual}${productoEnDolares(p) ? " · USD" : ""}`,
                  }))}
                  placeholder="Buscar producto por nombre o SKU…"
                  emptyText="Sin productos que coincidan"
                />
                {productoSel && !productoCreado && (
                  <p className="mt-1.5 text-xs text-gray-400">
                    Costo promedio actual: {formatGs(productoSel.costo_promedio)} · Precio venta actual: {formatGs(productoSel.precio_venta)}
                  </p>
                )}
                {productoSel && productoEnDolares(productoSel) && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">
                    Producto en dólares
                    {Number(productoSel.costo_usd) > 0 && ` · costo US$ ${Number(productoSel.costo_usd).toLocaleString("es-PY", { maximumFractionDigits: 2 })}`}
                    {Number(productoSel.precio_usd) > 0 && ` · precio US$ ${Number(productoSel.precio_usd).toLocaleString("es-PY", { maximumFractionDigits: 2 })}`}
                  </p>
                )}
                {productoSel && !productoCreado && (
                  <UltimasCompras key={productoSel.id} productoId={productoSel.id} onVerTodo={() => setHistorialAbierto(true)} />
                )}
                {historialAbierto && productoSel && (
                  <HistorialPreciosModal
                    productoIdInicial={productoSel.id}
                    productoNombreInicial={productoSel.nombre}
                    onClose={() => setHistorialAbierto(false)}
                  />
                )}
                {productoCreado && (
                  <p className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-green-600"><Check className="h-4 w-4" /> Producto &quot;{productoCreado}&quot; creado y seleccionado.</p>
                )}
                {!mostrarFormProducto ? (
                  <button type="button" onClick={() => { setMostrarFormProducto(true); setProductoCreado(null); }}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-700 underline transition-colors">
                    ¿No encontrás el producto? Crear nuevo
                  </button>
                ) : (
                  /* La ficha COMPLETA del producto (pedido del cliente: «que
                     salgan todos los datos para completar»), solo Reventa, en un
                     modal. Al guardar, el producto queda elegido en la línea. */
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
                    <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                        <p className="text-sm font-semibold text-slate-800">Nuevo producto</p>
                        <button type="button" onClick={handleCancelarProducto}
                          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">Cerrar</button>
                      </div>
                      <iframe src={`/inventario/nuevo?embebido=1${cab.moneda === "USD" ? "&moneda=USD" : ""}`} title="Nuevo producto" className="w-full flex-1 border-0" />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={labelSmClass}>Cantidad <span className="text-red-500">*</span></label>
                  <input ref={cantidadRef} type="number" value={nl.cantidad} onChange={(e) => setNl((p) => ({ ...p, cantidad: e.target.value }))}
                    placeholder="Ej: 50" className={inputSmClass} min={0} step="any" />
                </div>
                <div>
                  <label className={labelSmClass}>Costo unit. ({cab.moneda === "USD" ? "USD" : "Gs."}) <span className="text-red-500">*</span></label>
                  {/* Como número, no como texto: «0.841» (costo en dólares con
                      3 decimales) el campo lo leía como miles y mostraba 841. */}
                  <MontoInput value={nl.costo_unitario_input === "" ? "" : Number(nl.costo_unitario_input) || 0}
                    onChange={(n) => setNl((p) => ({ ...p, costo_unitario_input: String(n) }))}
                    placeholder={cab.moneda === "USD" ? "Ej: 12" : "Ej: 18000"} className={inputSmClass}
                    decimals={cab.moneda === "USD"} />
                </div>
                <div>
                  <label className={labelSmClass}>IVA</label>
                  {/* Fijo: sale de la ficha del producto. */}
                  <div className={`${inputSmClass} cursor-not-allowed bg-slate-50 text-slate-700`} title="El IVA es el de la ficha del producto.">
                    {nl.producto_id ? ivaLabel[nl.iva_tipo] : "—"}
                  </div>
                </div>
                <div onKeyDown={enterAgregaLinea}>
                  {/* El precio de venta sigue la moneda de la compra, igual que
                      el costo. Antes estaba siempre en guaraníes y no lo decía:
                      al lado de un costo en dólares, un 12 se leía como 12 Gs.
                      contra un costo de 32.000 y el margen salía en -266.566%. */}
                  <label className={labelSmClass}>
                    Precio venta {cab.moneda === "USD" ? "(USD)" : "(Gs.)"}{" "}
                    <span className="font-normal text-gray-400">(opcional)</span>
                  </label>
                  <MontoInput value={nl.precio_venta === "" ? "" : Number(nl.precio_venta) || 0}
                    onChange={(n) => setNl((p) => ({ ...p, precio_venta: String(n) }))}
                    placeholder="Opcional" className={inputSmClass}
                    decimals={cab.moneda === "USD"} />
                  {cab.moneda === "USD" && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      {nlPrecio > 0 && tipoCambioNum > 0
                        ? `Se guarda en dólares: hoy sale ${formatGs(nlPrecioPYG)}, y si el dólar se mueve el precio acompaña solo.`
                        : "Se guarda en dólares. El precio en guaraníes se calcula al vender."}
                    </p>
                  )}
                </div>
              </div>

              {productoControlaLote && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-2">
                    <span className="inline-block rounded-full bg-amber-200 text-amber-800 px-2 py-0.5 text-[10px] font-bold">
                      Lote
                    </span>
                    Este producto controla lote y vencimiento
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelSmClass}>
                        Nº de lote <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={nl.lote_numero}
                        onChange={(e) => setNl((p) => ({ ...p, lote_numero: e.target.value }))}
                        placeholder="Ej: LOTE-A123"
                        className={inputSmClass}
                      />
                    </div>
                    <div>
                      <label className={labelSmClass}>
                        Fecha vencimiento <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={nl.lote_fecha_vencimiento}
                        onChange={(e) =>
                          setNl((p) => ({ ...p, lote_fecha_vencimiento: e.target.value }))
                        }
                        className={inputSmClass}
                      />
                    </div>
                  </div>
                </div>
              )}

              {esInsumoNoVendible && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Este producto es materia prima. La compra actualizará stock y costo promedio; el precio de venta no es necesario.
                </p>
              )}

              {(nlSubtotal > 0 || nlMargen !== null) && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-500">
                  {cab.moneda === "USD" && nlCostoPYG > 0 && <span>≈ {formatGs(nlCostoPYG)}/u</span>}
                  {nlSubtotal > 0 && <span>Subtotal: <strong className="text-gray-700">{formatGs(nlSubtotal)}</strong></span>}
                  {nlSubtotal > 0 && <span>Total línea: <strong className="text-gray-700">{formatGs(nlTotal)}</strong></span>}
                  {nlMargen !== null && <span className={margenColor(nlMargen)}>Margen: {nlMargen.toFixed(1)}%</span>}
                </div>
              )}

              {errorLinea && <p className="text-xs text-red-600">{errorLinea}</p>}
              {!errorLinea && !lineaLista && motivoNoAgregar && (
                <p className="text-xs text-amber-600">{motivoNoAgregar}</p>
              )}

              <button type="button" onClick={handleAgregarLinea} disabled={!lineaLista}
                className="w-full rounded-lg bg-[#4FAEB2] py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-40 disabled:cursor-not-allowed">
                + Agregar producto a la compra
              </button>
            </div>
          </section>

          {/* ── Totales generales ────────────────────────────────────────────── */}
          {lineas.length > 0 && (
            <section className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Subtotal (sin IVA)</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-700">{formatGs(totales.subtotal)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">IVA</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-700">{formatGs(totales.iva)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Descuento (Gs.)</label>
                  <MontoInput
                    value={descuento}
                    onChange={(n) => setDescuento(n)}
                    placeholder="0"
                    className="w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">Se reparte entre las líneas (IVA se recalcula solo).</p>
                </div>
                <div className="text-right text-xs text-gray-500 tabular-nums space-y-0.5">
                  <div>Total bruto: <span className="font-medium text-gray-700">{formatGs(totales.total)}</span></div>
                  <div>Descuento: <span className="font-medium text-rose-600">− {formatGs(descuentoNum)}</span></div>
                </div>
              </div>
              <div className="bg-[#4FAEB2] text-white rounded-lg px-3 py-3 text-center">
                <p className="text-xs text-gray-200 mb-1">Total a pagar</p>
                <p className="text-lg font-bold tabular-nums">{formatGs(totalAPagar)}</p>
              </div>
            </section>
          )}

          {editando && (
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
              <Selector value={estadoEdit} onChange={(e) => setEstadoEdit(e.target.value as "registrada" | "anulada")}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="registrada">Activa</option>
                <option value="anulada">Anulada</option>
              </Selector>
            </div>
          )}

          {errorSubmit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorSubmit}</p>
            </div>
          )}

          <div className="flex gap-4 pt-2">
            <button type="submit" disabled={lineas.length === 0 || submitting}
              className="bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
              {submitting ? "Guardando..." : editando ? "Guardar cambios" : "Guardar compra"}
            </button>
            <button type="button" onClick={() => router.push("/compras")}
              className="border border-slate-200 px-5 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

/**
 * Las últimas compras del producto elegido (pedido del cliente: «acá debería
 * haber un historial de precios»), para ver a cuánto se venía comprando antes
 * de cargar el costo. Solo lee; las anuladas no salen.
 */
function UltimasCompras({ productoId, onVerTodo }: { productoId: string; onVerTodo: () => void }) {
  const [filas, setFilas] = useState<FilaHistorial[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Al cambiar de producto el componente se monta de nuevo (key), así
    // arranca vacío sin tener que limpiarlo acá.
    let vivo = true;
    apiFetch(`/api/compras/historial-precios?producto_id=${encodeURIComponent(productoId)}`, { cache: "no-store" })
      .then((r) => r.json().catch(() => null).then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!vivo) return;
        if (!ok || !j?.success) { setError(true); return; }
        setFilas(((j.data?.filas ?? []) as FilaHistorial[]).slice(0, 5));
      })
      .catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [productoId]);

  const fFecha = (iso?: string | null) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Últimas compras</p>
        <button type="button" onClick={onVerTodo} className="text-xs font-medium text-[#3F8E91] hover:underline">
          Ver historial completo
        </button>
      </div>
      {error ? (
        <p className="px-3 py-2 text-xs text-slate-400">No se pudo leer el historial.</p>
      ) : filas === null ? (
        <p className="px-3 py-2 text-xs text-slate-400">Buscando compras anteriores…</p>
      ) : filas.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-400">Este producto todavía no tiene compras.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-1.5 font-medium">Fecha</th>
                <th className="px-3 py-1.5 font-medium">Proveedor</th>
                <th className="px-3 py-1.5 text-right font-medium">Cant.</th>
                <th className="px-3 py-1.5 text-right font-medium">Costo US$</th>
                <th className="px-3 py-1.5 text-right font-medium">Costo Gs.</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const usd = precioEnDolares(f);
                return (
                  <tr key={`${f.numero_control}-${i}`} className="border-t border-slate-50">
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">{fFecha(f.fecha)}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5 text-slate-700">{f.proveedor_nombre || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{Number(f.cantidad) || 0}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {usd != null ? usd.toLocaleString("es-PY", { maximumFractionDigits: 4 }) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {Math.round(Number(f.costo_unitario) || 0).toLocaleString("es-PY")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{children}</h3>;
}

function InlineFormBox({
  titulo, children, onSave, onCancel, saveDisabled,
}: {
  titulo: string; children: React.ReactNode; onSave: () => void; onCancel: () => void; saveDisabled: boolean;
}) {
  return (
    <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-white space-y-4">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{titulo}</p>
      {children}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onSave} disabled={saveDisabled}
          className="bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
          Guardar {titulo.toLowerCase()}
        </button>
        <button type="button" onClick={onCancel}
          className="border border-slate-200 px-4 py-2 rounded-xl text-xs hover:bg-white transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
}
