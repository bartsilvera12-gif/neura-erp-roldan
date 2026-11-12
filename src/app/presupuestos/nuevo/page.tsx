"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Loader2, History } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import SeccionForm from "@/components/ui/SeccionForm";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SearchableSelect, { type SearchableSelectHandle } from "@/components/ui/SearchableSelect";
import { calcMontoIvaIncluido, type IvaTipoPresupuesto } from "@/lib/presupuestos/types";
import { aplicarCambio, descuentoPorPrecio, descuentoTotalLinea } from "@/lib/presupuestos/descuento-linea";
import { FORMAS_PAGO, esFormaPagoConocida } from "@/lib/presupuestos/formas-pago";
import { validarRucOCedula } from "@/lib/clientes/identificador";
import { faltantesDelPresupuesto, textoFaltantes } from "@/lib/presupuestos/faltantes";
import { useExistencias, ExistenciaLinea, AvisoFaltantes, lineasSinStock } from "@/components/presupuestos/existencias";

import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { useFacultades } from "@/lib/perfiles/use-facultades";
import NuevoClienteRapidoModal, { type NuevoClienteCreado } from "@/app/ventas/nueva/NuevoClienteRapidoModal";
import Selector from "@/components/ui/Selector";
import { getSession } from "@/lib/auth";
import { cargarPlantillaPresupuesto } from "@/lib/presupuestos/cargar-plantilla";
type ProductoLite = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  precio_mayorista: number;
  unidad_medida: string;
};
type ClienteLite = {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  direccion: string | null;
};
type Item = {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  iva_tipo: IvaTipoPresupuesto;
  descuento: number;
  /** El % equivalente al descuento, para mostrarlo. */
  descuento_pct: number;
  /** Si se pactó un % o un monto fijo. Ver `descuento-linea.ts`. */
  descuento_modo: "monto" | "pct";
  /**
   * El precio que propuso el sistema al agregar la línea. Si el administrador
   * escribe uno más bajo, la diferencia es el descuento que dio por precio y
   * se puede mostrar. 0 en las líneas escritas a mano: no hay con qué
   * comparar.
   */
  precio_lista: number;
  tipo_precio: "mayorista" | "minorista";
};

function fmtPct(n: number) {
  const x = Number(n) || 0;
  return `${x.toLocaleString("es-PY", { maximumFractionDigits: 2 })}%`;
}
function fmtGs(n: number) {
  return "Gs. " + (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function itemTotals(it: Item) {
  const bruto = (Number(it.precio_unitario) || 0) * (Number(it.cantidad) || 0);
  const total = Math.max(0, bruto - (Number(it.descuento) || 0));
  const iva = round2(calcMontoIvaIncluido(it.iva_tipo, total));
  return { total: round2(total), iva, subtotal: round2(total - iva) };
}

/**
 * Todos los presupuestos valen lo mismo, así que no se pregunta: el campo se
 * sacó de la pantalla y el valor sale de acá.
 *
 * ES UN DÍA, CONTANDO HOY. Es lo que ya decía el documento impreso: "hasta el
 * término de la jornada de la presente fecha" (Configuración → Presupuesto).
 * La pantalla, en cambio, venía con 15 días por defecto: el papel decía que la
 * oferta vencía ese mismo día y el sistema la daba por vigente dos semanas,
 * reservando stock todo ese tiempo.
 *
 * NO ES SOLO UN TEXTO: de este número sale la fecha de vencimiento, y del
 * vencimiento depende qué presupuestos aprobados siguen reservando stock (ver
 * `src/lib/presupuestos/server/reservas.ts`). Por eso se sigue mandando en vez
 * de dejarlo en null, que dejaría los presupuestos sin vencer nunca.
 *
 * Si alguna vez se cambia, hay que cambiar también esa frase del documento, o
 * el papel va a decir una cosa y el sistema otra.
 */
const VALIDEZ_DIAS = 1;

const IVAS: IvaTipoPresupuesto[] = ["10%", "5%", "EXENTA"];
const labelClass = "mb-1 block text-[11px] font-medium text-slate-500";
const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function NuevoPresupuestoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState<ProductoLite[]>([]);
  /**
   * El botón «Agregar», para encadenar el teclado.
   *
   * La carga de un presupuesto es repetitiva: diez, veinte líneas. Elegido el
   * producto, el foco salta acá, así que la secuencia completa es escribir,
   * bajar con la flecha, Enter para elegir y Enter para agregar — sin tocar
   * el mouse en ningún momento.
   */
  const btnAgregarRef = useRef<HTMLButtonElement>(null);
  const buscadorProductoRef = useRef<SearchableSelectHandle>(null);
  /** Por qué no hay inventario para elegir. `null` = llegó bien. */
  const [errorProductos, setErrorProductos] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);

  // Cliente
  const [clienteId, setClienteId] = useState("");
  const clienteIdRef = useRef("");
  clienteIdRef.current = clienteId;
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteRuc, setClienteRuc] = useState("");
  const [clienteTel, setClienteTel] = useState("");
  const [clienteDir, setClienteDir] = useState("");
  const [clienteCiudad, setClienteCiudad] = useState("");
  const [clienteProfesion, setClienteProfesion] = useState("");
  /** El catálogo de oficios, para sugerir y no escribir cualquier cosa. */
  const [profesiones, setProfesiones] = useState<string[]>([]);
  useEffect(() => {
    fetchWithSupabaseSession("/api/profesiones?solo_activas=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        setProfesiones(
          ((j.data?.profesiones ?? []) as { nombre?: string }[])
            .map((x) => String(x.nombre ?? "").trim())
            .filter(Boolean)
        );
      })
      .catch(() => { /* sin catálogo, se escribe a mano */ });
  }, []);
  /** Alta de cliente sin salir del presupuesto, como ya se hace en Caja. */
  const [nuevoClienteOpen, setNuevoClienteOpen] = useState(false);

  // Items
  const [items, setItems] = useState<Item[]>([]);
  const [selProd, setSelProd] = useState("");

  // El tilde "Usar precios mayoristas por defecto" se sacó de la pantalla a
  // pedido del cliente: cada ítem entra con el precio de venta (minorista).
  // El precio por rubro del cliente sigue aplicándose aparte.
  const usarMayorista = false;

  // Condiciones
  const [formaPago, setFormaPago] = useState("");
  const [plazoEntrega, setPlazoEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [notaInterna, setNotaInterna] = useState("");
  const [faltaMaterial, setFaltaMaterial] = useState(false);

  /**
   * Quién mira la pantalla.
   *
   * El precio lo escribe el administrador, no el vendedor: un precio escrito
   * a mano es un descuento sin pedirlo a nadie. El vendedor arma el
   * presupuesto con los precios de su sucursal y, si hace falta otro número,
   * lo pide.
   */
  const { isAdmin, loaded: rolCargado, descuentoMaximo } = useIsAdmin();
  /**
   * El descuento lo ve quien puede darlo: administración o un perfil con
   * descuento máximo cargado. Al usuario normal no se le muestra la columna.
   */
  const puedeDescontar = isAdmin || (descuentoMaximo ?? 0) > 0;
  /**
   * Cotizar por más de lo que hay: facultad `cotizar_sin_stock`.
   *
   * Antes era "es administrador". Ahora el vendedor externo y el call
   * center la tienen —venden con entrega a plazo— sin ser administradores.
   */
  const { tiene: tieneFacultad } = useFacultades();
  const puedeSinStock = tieneFacultad("cotizar_sin_stock");

  /** La sucursal del usuario, para que se vea de dónde salen los precios. */
  const [sucursalNombre, setSucursalNombre] = useState<string | null>(null);

  /** De quién va a ser el presupuesto. Solo el administrador puede cambiarlo. */
  const [vendedorId, setVendedorId] = useState("");
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/usuarios/empresa-activos", { cache: "no-store", credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        const filas = (Array.isArray(j) ? j : j?.usuarios ?? j?.data ?? []) as Record<string, unknown>[];
        setVendedores(
          filas
            .map((u) => ({
              id: String(u.id ?? ""),
              nombre: String(u.nombre || u.email || "").trim(),
            }))
            .filter((u) => u.id && u.nombre)
        );
      })
      .catch(() => { /* si falla, queda a nombre de quien lo carga */ });
  }, [isAdmin]);

  useEffect(() => {
    fetchWithSupabaseSession("/api/me/rol", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const n = j?.data?.sucursal_nombre ?? j?.sucursal_nombre ?? null;
        if (typeof n === "string" && n.trim()) setSucursalNombre(n.trim());
      })
      .catch(() => { /* el nombre es informativo */ });
  }, []);
  // Punto 9.4: el texto que obliga (garantía, flete, validez del precio). Es
  // otra cosa que las observaciones, que son las notas del producto.
  const [condiciones, setCondiciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * El presupuesto a medio armar se guarda solo en este navegador.
   *
   * Antes, salir de la pantalla —otro menú, un F5, cerrar la pestaña— tiraba
   * todo lo cargado. Ahora cada cambio se guarda (localStorage, por usuario,
   * para que en una PC compartida uno no vea el de otro) y al volver se
   * recupera tal cual. Se borra al guardar el presupuesto o con "Empezar de
   * cero".
   *
   * Además, apenas tiene cliente y un producto, se guarda en el SISTEMA como
   * borrador (pestaña Borradores) y se sigue actualizando ese mismo. Ver
   * `guardarEnSistema` más abajo.
   */
  const claveBorrador = useRef<string | null>(null);
  const [borradorListo, setBorradorListo] = useState(false);
  const [recuperado, setRecuperado] = useState<string | null>(null);
  /** El borrador en el sistema que se va actualizando (null = todavía no hay). */
  const [borradorId, setBorradorId] = useState<string | null>(null);
  const [borradorNumero, setBorradorNumero] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void getSession().then((ses) => {
      if (cancel) return;
      const clave = `neura:presupuesto-en-curso:${ses?.user?.id ?? "anon"}`;
      claveBorrador.current = clave;
      try {
        const crudo = localStorage.getItem(clave);
        const b = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : null;
        if (b && b.v === 1) {
          const txt = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
          setClienteId(txt("clienteId"));
          setClienteNombre(txt("clienteNombre"));
          setClienteRuc(txt("clienteRuc"));
          setClienteTel(txt("clienteTel"));
          setClienteDir(txt("clienteDir"));
          setClienteCiudad(txt("clienteCiudad"));
          setClienteProfesion(txt("clienteProfesion"));
          if (Array.isArray(b.items)) setItems(b.items as Item[]);
          if (txt("formaPago")) setFormaPago(txt("formaPago"));
          setPlazoEntrega(txt("plazoEntrega"));
          setObservaciones(txt("observaciones"));
          setNotaInterna(txt("notaInterna"));
          setFaltaMaterial(b.faltaMaterial === true);
          setVendedorId(txt("vendedorId"));
          if (txt("condiciones")) setCondiciones(txt("condiciones"));
          if (txt("borradorId")) setBorradorId(txt("borradorId"));
          if (txt("borradorNumero")) setBorradorNumero(txt("borradorNumero"));
          const cuando = typeof b.at === "number" ? new Date(b.at) : null;
          setRecuperado(cuando
            ? cuando.toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
            : "antes");
        }
      } catch { /* sin localStorage (modo privado): se trabaja igual, sin autoguardado */ }
      setBorradorListo(true);
    });
    return () => { cancel = true; };
  }, []);

  const hayAlgoCargado =
    clienteNombre.trim().length > 0 || items.length > 0 ||
    plazoEntrega.trim().length > 0 || observaciones.trim().length > 0 || notaInterna.trim().length > 0;

  /**
   * Lo último que hay en pantalla, listo para escribir. Se guarda en cada
   * cambio (sin demora) y otra vez al salir —otro menú, cerrar o recargar—
   * por si el navegador cortó algo a mitad de camino.
   */
  const ultimo = useRef<string | null>(null);
  const yaGuardado = useRef(false);

  const escribirBorrador = () => {
    const clave = claveBorrador.current;
    if (!clave || yaGuardado.current) return;
    try {
      if (ultimo.current == null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, ultimo.current);
    } catch { /* lleno o bloqueado: no se guarda, nada más */ }
  };

  useEffect(() => {
    if (!borradorListo) return;
    ultimo.current = hayAlgoCargado
      ? JSON.stringify({
          v: 1, at: Date.now(),
          clienteId, clienteNombre, clienteRuc, clienteTel, clienteDir, clienteCiudad, clienteProfesion,
          items, usarMayorista, formaPago, plazoEntrega, observaciones, notaInterna, faltaMaterial,
          vendedorId, condiciones, borradorId, borradorNumero,
        })
      : null;
    escribirBorrador();
  }, [borradorListo, hayAlgoCargado, clienteId, clienteNombre, clienteRuc, clienteTel, clienteDir, clienteCiudad,
      clienteProfesion, items, usarMayorista, formaPago, plazoEntrega, observaciones, notaInterna, faltaMaterial,
      vendedorId, condiciones, borradorId, borradorNumero]);

  useEffect(() => {
    const alSalir = () => escribirBorrador();
    window.addEventListener("pagehide", alSalir);
    window.addEventListener("beforeunload", alSalir);
    return () => {
      window.removeEventListener("pagehide", alSalir);
      window.removeEventListener("beforeunload", alSalir);
      alSalir(); // salir a otro menú desmonta la página
    };
  }, []);

  /** Tirar lo recuperado y arrancar en blanco. */
  function empezarDeCero() {
    const aviso = borradorNumero
      ? `¿Empezar uno nuevo? El ${borradorNumero} queda en Borradores (lo podés borrar desde ahí).`
      : "¿Descartar el presupuesto que estabas armando?";
    if (!window.confirm(aviso)) return;
    yaGuardado.current = true;
    try { if (claveBorrador.current) localStorage.removeItem(claveBorrador.current); } catch { /* nada */ }
    window.location.reload();
  }

  /**
   * ── SI EL INVENTARIO NO LLEGA, HAY QUE DECIRLO ─────────────────────────
   *
   * Esto antes hacía `if (j?.success)` y `.catch(() => {})`: ante cualquier
   * problema —sesión vencida, usuario sin sucursal asignada, error del
   * servidor— dejaba la lista vacía y no decía nada.
   *
   * El resultado en la pantalla era un buscador de productos que no encuentra
   * NINGUNO, sin un solo mensaje. Quien lo usa no tiene forma de distinguir
   * "no hay productos cargados" de "no se pudieron traer", y quien tiene que
   * arreglarlo tampoco: el síntoma es el mismo y no deja rastro.
   *
   * Ahora se guarda el motivo y se muestra arriba del buscador. El servidor
   * ya manda mensajes accionables —por ejemplo, que el usuario no tiene
   * sucursal asignada y que un administrador se la ponga desde Usuarios—, y
   * eso es justamente lo que hay que leer.
   */
  useEffect(() => {
    let vivo = true;
    fetchWithSupabaseSession("/api/productos", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !j?.success) {
          /* 401 es el caso frecuente y tiene arreglo de un clic: la sesión se
             venció con la pestaña abierta. El ayudante intenta renovarla solo,
             pero si tampoco puede manda la llamada sin credenciales y el
             servidor contesta "No autenticado". Decir eso no ayuda a nadie;
             decir "recargá" sí. */
          setErrorProductos(
            r.status === 401
              ? "Tu sesión venció. Recargá la página (F5) y, si sigue igual, volvé a entrar."
              : j?.error?.message ||
                  j?.error ||
                  `No se pudo traer el inventario (${r.status}).`
          );
          return;
        }
        const list = (j.data?.productos ?? []) as Record<string, unknown>[];
        const vendibles = list.filter((p) => p.es_vendible !== false);
        setErrorProductos(
          vendibles.length === 0
            ? "No hay productos disponibles para tu sucursal."
            : null
        );
        setProductos(
          vendibles.map((p) => ({
            id: String(p.id),
            nombre: String(p.nombre),
            sku: String(p.sku ?? ""),
            precio_venta: Number(p.precio_venta) || 0,
            precio_mayorista: Number(p.precio_mayorista) || 0,
            unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
          }))
        );
      })
      .catch((e) => {
        if (vivo) setErrorProductos(e instanceof Error ? e.message : "No se pudo traer el inventario.");
      });
    /**
     * Las condiciones de la casa, precargadas.
     *
     * ── POR QUÉ FALTABA ────────────────────────────────────────────────
     *   Al rehacer el PDF con el formato del cliente, las condiciones pasaron
     *   a salir de la plantilla que se edita en Configuración. Este campo
     *   quedó desconectado: el vendedor escribía acá y no salía impreso.
     *
     *   Ahora el formulario arranca con lo mismo que va a imprimirse. Si el
     *   vendedor lo cambia, para ESE presupuesto manda lo que escribió; la
     *   plantilla sigue siendo el texto por defecto de todos los demás.
     */
    // La forma de pago viene con el marcador {anticipo}, igual que las opciones.
    void cargarPlantillaPresupuesto().then((pl) => {
      if (!pl) return; // sin plantilla, el PDF igual imprime la suya
      if (pl.condiciones.trim()) setCondiciones((prev) => (prev.trim() ? prev : pl.condiciones));
      if (pl.formaPago.trim()) setFormaPago((prev) => (prev.trim() ? prev : pl.formaPago));
    });

    // El `return` va AL FINAL. Estaba arriba, justo después del inventario, y
    // todo lo de abajo —la precarga de las condiciones y la forma de pago—
    // nunca se ejecutaba: el formulario salía con esos campos vacíos.
    return () => { vivo = false; };

    // Los clientes ya no se traen todos (son más de 21 mil: 36 MB y medio
    // minuto, y mientras tanto el buscador decía "Sin coincidencias"). Se
    // buscan en el servidor a medida que se escribe: ver `buscarClientes`.
  }, []);

  const [buscandoClientes, setBuscandoClientes] = useState(false);
  const pedidoClientes = useRef(0);
  const buscarClientes = useCallback(async (texto: string) => {
    const nro = ++pedidoClientes.current;
    if (texto.length < 2) { setBuscandoClientes(false); return; }
    setBuscandoClientes(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/clientes?q=${encodeURIComponent(texto)}&limite=30`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (nro !== pedidoClientes.current) return; // llegó tarde: ya se escribió otra cosa
      const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const encontrados = (Array.isArray(j?.data) ? (j.data as Record<string, unknown>[]) : []).map((c) => ({
        id: String(c.id),
        nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente",
        ruc: s(c.ruc) || null,
        telefono: s(c.telefono) || null,
        direccion: s(c.direccion) || null,
      }));
      // El elegido se conserva aunque no esté en esta búsqueda, para que se
      // siga viendo su nombre en el selector.
      setClientes((prev) => {
        const elegido = prev.find((c) => c.id === clienteIdRef.current);
        return elegido && !encontrados.some((c) => c.id === elegido.id) ? [elegido, ...encontrados] : encontrados;
      });
    } finally {
      if (nro === pedidoClientes.current) setBuscandoClientes(false);
    }
  }, []);

  function seleccionarCliente(id: string | null) {
    const nextId = id ?? "";
    setClienteId(nextId);
    if (!nextId) return;
    const c = clientes.find((x) => x.id === nextId);
    if (c) {
      setClienteNombre(c.nombre);
      setClienteRuc(c.ruc ?? "");
      setClienteTel(c.telefono ?? "");
      setClienteDir(c.direccion ?? "");
    }
  }

  /** El cliente recién creado queda elegido, sin tener que buscarlo de nuevo. */
  function clienteReciénCreado(c: NuevoClienteCreado) {
    setNuevoClienteOpen(false);
    setClientes((prev) => [{ id: c.id, nombre: c.nombre, ruc: c.ruc, telefono: null, direccion: null }, ...prev]);
    setClienteId(c.id);
    setClienteNombre(c.nombre);
    setClienteRuc(c.ruc ?? "");
  }

  function precioParaProducto(p: ProductoLite): number {
    if (usarMayorista && p.precio_mayorista > 0) return p.precio_mayorista;
    return p.precio_venta;
  }

  /** Consulta al backend el precio a aplicar para este producto según la
   *  rubro del cliente (si tiene) y el precio configurado en
   *  precios_por_categoria. Si no hay match, cae al precio_venta. */
  async function resolverPrecioPorCategoria(productoId: string): Promise<number | null> {
    if (!clienteId) return null;
    try {
      const r = await fetch(`/api/productos/${productoId}/precio-para-cliente?cliente_id=${encodeURIComponent(clienteId)}`, {
        cache: "no-store", credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j.success && j.data.fuente === "categoria") {
        const p = Number(j.data.precio);
        return Number.isFinite(p) && p > 0 ? p : null;
      }
    } catch { /* silencioso: cae al fallback */ }
    return null;
  }

  async function agregarProducto() {
    const p = productos.find((x) => x.id === selProd);
    if (!p) return;
    if (items.some((it) => it.producto_id === p.id)) return;
    const usaMay = usarMayorista && p.precio_mayorista > 0;

    // Prioridad: precio por rubro del cliente → mayorista → precio_venta.
    const precioCategoria = await resolverPrecioPorCategoria(p.id);
    const precio = precioCategoria ?? precioParaProducto(p);
    const tipo_precio: "minorista" | "mayorista" | "distribuidor" =
      precioCategoria != null ? "minorista" : (usaMay ? "mayorista" : "minorista");

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku || null,
        cantidad: 1,
        unidad_medida: p.unidad_medida,
        precio_unitario: precio,
        iva_tipo: "10%",
        descuento: 0,
        descuento_pct: 0,
        descuento_modo: "monto",
        precio_lista: precio,
        tipo_precio,
      },
    ]);
    setSelProd("");
    /* Agregada la línea, el foco vuelve al buscador para escribir la que
       sigue. Sin esto el foco queda en un botón ya deshabilitado —`selProd`
       se limpió— y el teclado se pierde justo cuando más se usa. */
    setTimeout(() => buscadorProductoRef.current?.abrir(), 0);
  }

  function agregarManual() {
    setItems((prev) => [
      ...prev,
      {
        producto_id: null,
        producto_nombre: "",
        sku: null,
        cantidad: 1,
        unidad_medida: null,
        precio_unitario: 0,
        iva_tipo: "10%",
        descuento: 0,
        descuento_pct: 0,
        descuento_modo: "monto",
        precio_lista: 0,
        tipo_precio: usarMayorista ? "mayorista" : "minorista",
      },
    ]);
  }

  function updItem(i: number, patch: Partial<Item>) {
    // Pasa por `aplicarCambio` para que el % y el monto del descuento queden
    // siempre coherentes: escribir uno recalcula el otro, y cambiar la
    // cantidad o el precio respeta cómo se pactó el descuento.
    setItems((prev) => prev.map((it, idx) => (idx === i ? aplicarCambio(it, patch) : it)));
  }
  function delItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  // La reserva la calcula el servidor desde los presupuestos aprobados
  // vigentes; acá solo se muestra (puntos 9.1 y 9.2).
  const existencias = useExistencias(items.map((it) => it.producto_id));

  const totales = useMemo(() => {
    let subtotal = 0,
      iva = 0,
      desc = 0,
      total = 0;
    for (const it of items) {
      const t = itemTotals(it);
      subtotal += t.subtotal;
      iva += t.iva;
      total += t.total;
      desc += descuentoTotalLinea(it).monto;
    }
    return { subtotal: round2(subtotal), iva: round2(iva), desc: round2(desc), total: round2(total) };
  }, [items]);

  // Mismo criterio que el servidor, acá para que el aviso salga antes de
  // guardar: sin RUC ni cédula el presupuesto no se puede facturar después.
  const identCliente = validarRucOCedula(clienteRuc);

  /**
   * Lo que falta para que sea un presupuesto FIRME.
   *
   * Solo cuando se escribió a mano: si salió del catálogo, ya tiene sus datos
   * cargados y no se le vuelven a pedir.
   *
   * Faltar ya no impide guardar. Antes sí, y el resultado era el contrario del
   * buscado: el que no tenía el RUC del cliente no podía guardar, la
   * cotización salía a mano y no quedaba registrada en ninguna parte. Ahora se
   * guarda como borrador y no avanza hasta completarse.
   */
  const faltanDatosCliente = faltantesDelPresupuesto({
    cliente_id: clienteId || null,
    nombre: clienteNombre,
    ruc: clienteRuc,
    telefono: clienteTel,
    profesion: clienteProfesion,
    ciudad: clienteCiudad,
  });
  const seraBorrador = faltanDatosCliente.length > 0;

  /**
   * Lo mínimo para guardar algo: un nombre a quién cotizarle y qué cotizarle.
   *
   * Sin nombre no se puede ni buscar después, y sin ítems no hay cotización.
   * El resto de los datos del cliente lo decide `seraBorrador`.
   */
  /**
   * Cotizar más de lo que hay: solo el administrador.
   *
   * El servidor lo vuelve a validar —la pantalla se puede saltear— pero acá
   * el botón se apaga, para no cargar veinte líneas y enterarse al guardar.
   */
  const sinStock = puedeSinStock ? [] : lineasSinStock(items, existencias);

  const valido =
    clienteNombre.trim().length > 0 &&
    items.length > 0 &&
    sinStock.length === 0 &&
    items.every((it) => it.producto_nombre.trim() && it.cantidad > 0 && it.precio_unitario >= 0);

  /** Lo que se manda al servidor, igual para el autoguardado y para Guardar. */
  const cuerpo = () => ({
          cliente_id: clienteId || null,
          cliente_nombre: clienteNombre.trim(),
          cliente_ruc: clienteRuc.trim() || null,
          cliente_telefono: clienteTel.trim() || null,
          cliente_direccion: clienteDir.trim() || null,
          cliente_ciudad: clienteCiudad.trim() || null,
          cliente_profesion: clienteProfesion.trim() || null,
          moneda: "PYG",
          validez_dias: VALIDEZ_DIAS,
          forma_pago: formaPago.trim() || null,
          plazo_entrega: plazoEntrega.trim() || null,
          observaciones: observaciones.trim() || null,
          nota_interna: notaInterna.trim() || null,
          falta_material: faltaMaterial,
          vendedor_usuario_id: vendedorId || null,
          vendedor_nombre: vendedores.find((v) => v.id === vendedorId)?.nombre ?? null,
          condiciones_comerciales: condiciones.trim() || null,
          items: items.map((it) => ({
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre.trim(),
            sku: it.sku,
            cantidad: Number(it.cantidad),
            unidad_medida: it.unidad_medida,
            precio_unitario: Number(it.precio_unitario),
            iva_tipo: it.iva_tipo,
            descuento: Number(it.descuento) || 0,
            tipo_precio: it.tipo_precio,
          })),
  });

  /**
   * GUARDADO EN EL SISTEMA, COMO BORRADOR
   *
   * Lo que importa es que quede en la pestaña Borradores, no solo en esta
   * computadora. Apenas hay cliente y un producto, se crea el borrador
   * (POST con `autoguardado`) y desde ahí se actualiza ese mismo (PATCH),
   * dos segundos después del último cambio y otra vez al salir.
   *
   * `autoguardado` le dice al servidor que es lo que se está escribiendo:
   * sigue siendo borrador, no da de alta al cliente y no frena por stock.
   * Todo eso pasa al apretar Guardar, que actualiza este mismo borrador.
   */
  const listoParaSistema =
    clienteNombre.trim().length > 0 && items.length > 0 &&
    items.every((it) => it.producto_nombre.trim() && it.cantidad > 0 && it.precio_unitario >= 0);
  const [estadoSistema, setEstadoSistema] = useState<
    { tipo: "ok"; hora: string } | { tipo: "guardando" } | { tipo: "error"; texto: string } | null
  >(null);
  const enCurso = useRef<Promise<void> | null>(null);
  const idRef = useRef<string | null>(null);
  const sucio = useRef(false);
  const detenido = useRef(false);
  useEffect(() => { idRef.current = borradorId; }, [borradorId]);

  const cuerpoRef = useRef(cuerpo);
  cuerpoRef.current = cuerpo;

  async function guardarEnSistema(alSalir = false): Promise<void> {
    if (detenido.current || yaGuardado.current) return;
    if (enCurso.current) { await enCurso.current; if (!sucio.current) return; }
    sucio.current = false;
    const tarea = (async () => {
      if (!alSalir) setEstadoSistema({ tipo: "guardando" });
      const id = idRef.current;
      try {
        const res = await fetchWithSupabaseSession(id ? `/api/presupuestos/${id}` : "/api/presupuestos", {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...cuerpoRef.current(), autoguardado: true }),
          keepalive: alSalir,
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 404 && id) {
          // Lo borraron desde la lista: el próximo cambio crea otro.
          idRef.current = null; setBorradorId(null); setBorradorNumero(null);
          sucio.current = true;
          return;
        }
        if (res.status === 409 && id) {
          // Ya no es borrador (lo completaron desde Editar): no se pisa.
          detenido.current = true;
          if (!alSalir) setEstadoSistema({ tipo: "error", texto: "Ese borrador ya se completó desde otra pantalla; esto no lo modifica más." });
          return;
        }
        if (!res.ok || j?.success === false) {
          if (!alSalir) setEstadoSistema({ tipo: "error", texto: j?.error ?? `Error ${res.status}` });
          return;
        }
        if (!id) {
          const nuevoId = String(j?.data?.id ?? "");
          if (nuevoId) {
            idRef.current = nuevoId;
            setBorradorId(nuevoId);
            setBorradorNumero(j?.data?.numero_control ? String(j.data.numero_control) : null);
          }
        }
        if (!alSalir) {
          setEstadoSistema({ tipo: "ok", hora: new Date().toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" }) });
        }
      } catch {
        if (!alSalir) setEstadoSistema({ tipo: "error", texto: "Sin conexión" });
        sucio.current = true;
      }
    })();
    enCurso.current = tarea;
    await tarea;
    if (enCurso.current === tarea) enCurso.current = null;
  }
  const guardarEnSistemaRef = useRef(guardarEnSistema);
  guardarEnSistemaRef.current = guardarEnSistema;

  useEffect(() => {
    if (!borradorListo || !listoParaSistema) return;
    sucio.current = true;
    const t = window.setTimeout(() => { void guardarEnSistemaRef.current(); }, 2000);
    return () => window.clearTimeout(t);
  }, [borradorListo, listoParaSistema, clienteId, clienteNombre, clienteRuc, clienteTel, clienteDir, clienteCiudad,
      clienteProfesion, items, formaPago, plazoEntrega, observaciones, notaInterna, faltaMaterial, vendedorId, condiciones]);

  // Al salir a otro menú, lo que quedó sin mandar se manda igual.
  useEffect(() => () => {
    if (sucio.current) void guardarEnSistemaRef.current(true);
  }, []);

  async function guardar() {
    if (guardando || !valido) return;
    setGuardando(true);
    setError(null);
    // Que ningún autoguardado corra en paralelo y cree un duplicado.
    detenido.current = true;
    if (enCurso.current) await enCurso.current;
    try {
      const id = idRef.current;
      const res = await fetchWithSupabaseSession(id ? `/api/presupuestos/${id}` : "/api/presupuestos", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo()),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo guardar el presupuesto.");
        detenido.current = false;
        return;
      }
      // Ya está en la base: que el guardado al salir no lo vuelva a escribir.
      yaGuardado.current = true;
      try { if (claveBorrador.current) localStorage.removeItem(claveBorrador.current); } catch { /* nada */ }
      router.push(`/presupuestos/${id ?? body.data.id}`);
    } catch {
      setError("Error de red al guardar el presupuesto.");
      detenido.current = false;
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/presupuestos"
        backLabel="Volver a presupuestos"
        eyebrow="Presupuestos"
        title="Nuevo presupuesto"
        description="Se guarda solo mientras lo armás: si salís, al volver lo encontrás como lo dejaste."
      />

      {/*
        Las opciones del presupuesto, juntas.

        Estaban desparramadas: el tilde de precios mayoristas flotaba arriba a
        la derecha compitiendo con el título, y "Precios de Casa Central" vivía
        en su propia tarjeta al lado de un combo, con el texto sin alinear con
        el campo. Son tres cosas del mismo tipo —cómo se arma este presupuesto,
        no qué lleva— así que van en una sola fila.
      */}
      {(sucursalNombre || (isAdmin && vendedores.length > 0)) && (
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        {sucursalNombre && (
          <div>
            <p className="text-[11px] font-medium text-slate-500">Precios de</p>
            <p className="mt-1 flex h-[38px] items-center text-sm font-semibold text-slate-800">
              {sucursalNombre}
            </p>
          </div>
        )}
        {isAdmin && vendedores.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Presupuesto a nombre de</span>
            <Selector
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              className="h-[38px] w-56 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">Mío</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>{v.nombre}</option>
              ))}
            </Selector>
          </label>
        )}
      </div>
      )}

      {/* El aviso del borrador recuperado: una línea, no un bloque. */}
      {recuperado && hayAlgoCargado && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 px-3 py-2 text-xs text-slate-600">
          <History className="h-3.5 w-3.5 shrink-0 text-[#3F8E91]" />
          <span className="flex-1">
            Seguís con el presupuesto que estabas armando del {recuperado}
          </span>
          <button type="button" onClick={empezarDeCero}
            className="font-medium text-[#3F8E91] hover:underline">
            Empezar de cero
          </button>
          <button type="button" onClick={() => setRecuperado(null)} className="text-slate-400 hover:text-slate-600">
            Ocultar
          </button>
        </div>
      )}
      {borradorListo && hayAlgoCargado && (
        <p className="-mt-3 text-xs">
          {!listoParaSistema ? (
            <span className="text-slate-400">Cuando tenga cliente y al menos un producto, se guarda en <strong className="font-medium">Borradores</strong>.</span>
          ) : estadoSistema?.tipo === "guardando" ? (
            <span className="text-slate-500">Guardando en Borradores…</span>
          ) : estadoSistema?.tipo === "error" ? (
            <span className="text-amber-700">No se pudo guardar en el sistema ({estadoSistema.texto}). Queda guardado en esta computadora.</span>
          ) : borradorNumero ? (
            <span className="text-emerald-700">
              Guardado en Borradores como <strong className="font-mono">{borradorNumero}</strong>
              {estadoSistema?.tipo === "ok" ? ` · ${estadoSistema.hora}` : ""}
            </span>
          ) : (
            <span className="text-slate-500">Se va a guardar en Borradores en unos segundos…</span>
          )}
        </p>
      )}

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <SeccionForm
        paso={1}
        titulo="Cliente"
        descripcion="Con el teléfono y el RUC o la cédula, el presupuesto se puede mandar y cobrar; sin eso queda como borrador."
        completa={!seraBorrador}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Cliente existente (opcional)</label>
            <SearchableSelect
              value={clienteId || null}
              onChange={(v) => seleccionarCliente(v)}
              placeholder="— Seleccioná un cliente —"
              onSearch={buscarClientes}
              loading={buscandoClientes}
              emptyText="No hay clientes con ese nombre, RUC o teléfono"
              options={clientes.map((c) => ({
                id: c.id,
                label: c.nombre,
                hint: c.ruc ?? undefined,
              }))}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-gray-400">O completá los campos de abajo manualmente si es un cliente nuevo.</p>
              {/* Dar de alta el cliente acá mismo: si solo se completan los
                  campos de abajo, el presupuesto sale pero el cliente no queda
                  en el sistema, y el seguimiento después no tiene a quién
                  colgarse. */}
              <button
                type="button"
                onClick={() => setNuevoClienteOpen(true)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                + Crear cliente
              </button>
            </div>
          </div>
          <div>
            <label className={labelClass}>Nombre / Razón social *</label>
            <input value={clienteNombre} onChange={(e) => { setClienteId(""); setClienteNombre(e.target.value); }} className={inputClass} placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className={labelClass}>RUC / CI *</label>
            <input
              value={clienteRuc}
              onChange={(e) => setClienteRuc(e.target.value)}
              placeholder="80012345-1 o cédula"
              className={`${inputClass} ${identCliente.ok ? "" : "border-rose-300"}`}
            />
            {!identCliente.ok && clienteRuc.trim() !== "" && (
              <p className="mt-1 text-[11px] leading-snug text-rose-600">{identCliente.error}</p>
            )}
          </div>
          <div>
            <label className={labelClass}>Teléfono *</label>
            <input
              value={clienteTel}
              onChange={(e) => setClienteTel(e.target.value)}
              className={`${inputClass} ${clienteTel.trim() ? "" : "border-amber-300"}`}
              placeholder="Obligatorio"
            />
            {!clienteTel.trim() && (
              <p className="mt-1 text-[11px] text-amber-700">
                Sin teléfono no se puede hacer el seguimiento del presupuesto.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>Profesión</label>
            <input
              value={clienteProfesion}
              list="profesiones-presupuesto"
              onChange={(e) => setClienteProfesion(e.target.value.toUpperCase())}
              className={`${inputClass} uppercase`}
              placeholder="ALBAÑIL, HERRERO…"
            />
            <datalist id="profesiones-presupuesto">
              {profesiones.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className={labelClass}>Ciudad</label>
            <input
              value={clienteCiudad}
              onChange={(e) => setClienteCiudad(e.target.value)}
              className={inputClass}
              placeholder="Para saber si se entrega y con qué flete"
            />
          </div>
          <div>
            <label className={labelClass}>Dirección</label>
            <input value={clienteDir} onChange={(e) => setClienteDir(e.target.value)} className={inputClass} />
          </div>
        </div>
      </SeccionForm>

      <SeccionForm
        paso={2}
        titulo="Productos"
        descripcion="Del inventario, o escritos a mano si todavía no están cargados."
        completa={items.length > 0}
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className={labelClass}>Agregar desde inventario</label>
            {errorProductos ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {errorProductos} Igual podés cargar ítems a mano con «Ítem manual».
              </p>
            ) : null}
            <SearchableSelect
              ref={buscadorProductoRef}
              value={selProd || null}
              onChange={(v) => {
                setSelProd(v);
                /* Después del render, si no el botón todavía está deshabilitado
                   —depende de `selProd`— y no puede recibir el foco. */
                setTimeout(() => btnAgregarRef.current?.focus(), 0);
              }}
              placeholder="— Buscá un producto por nombre o SKU —"
              options={productos
                .filter((p) => !items.some((it) => it.producto_id === p.id))
                .map((p) => ({ id: p.id, label: p.nombre, hint: p.sku || undefined }))}
            />
          </div>
          <button
            ref={btnAgregarRef}
            type="button"
            onClick={agregarProducto}
            disabled={!selProd}
            className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Agregar
          </button>
          <button type="button" onClick={agregarManual} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Ítem manual
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Sin ítems. Agregá productos del inventario o ítems manuales.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Descripción</th>
                  <th className="py-2 px-2 w-32">Cant.</th>
                  <th className="py-2 px-2 w-32">Precio unit.</th>
                  <th className="py-2 px-2 w-24">IVA</th>
                  {puedeDescontar && <th className="py-2 px-2 w-36">Descuento</th>}
                  <th className="py-2 px-2 w-32 text-right">Total</th>
                  <th className="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, i) => {
                  const t = itemTotals(it);
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-2 pr-2">
                        <input value={it.producto_nombre} onChange={(e) => updItem(i, { producto_nombre: e.target.value })} className={inputClass} placeholder="Descripción" />
                        {it.tipo_precio === "mayorista" && (
                          <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Mayorista</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="0.01" value={it.cantidad || ""} onChange={(e) => updItem(i, { cantidad: Number(e.target.value) })} className={inputClass} />
                        <ExistenciaLinea
                          existencia={it.producto_id ? existencias[it.producto_id] : undefined}
                          cantidad={it.cantidad}
                        />
                      </td>
                      <td className="py-2 px-2">
                        {/* El vendedor ve el precio que sale de la lista de su
                            sucursal, pero no lo escribe: eso es un descuento
                            que nadie autorizó. */}
                        {isAdmin || !rolCargado ? (
                          <>
                            <input type="number" min="0" step="1" value={it.precio_unitario || ""} onChange={(e) => updItem(i, { precio_unitario: Number(e.target.value) })} className={inputClass} />
                            {/* Escribir un precio más bajo que el de lista ES un
                                descuento, aunque no se cargue en la columna de
                                descuentos. Acá se dice cuánto, al lado de donde
                                se escribió. */}
                            {(() => {
                              const d = descuentoPorPrecio(it.precio_lista, it.precio_unitario, it.cantidad);
                              if (!d) return null;
                              return (
                                <span className="mt-1 block text-[10px] leading-tight text-emerald-700">
                                  {fmtPct(d.pct)} menos que la lista ({fmtGs(it.precio_lista)})
                                </span>
                              );
                            })()}
                          </>
                        ) : (
                          <div
                            className={`${inputClass} bg-slate-50 text-slate-700 tabular-nums cursor-not-allowed`}
                            title="El precio sale de la lista. Para cambiarlo, pedíselo a un administrador."
                          >
                            {(it.precio_unitario || 0).toLocaleString("es-PY")}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {/* El IVA es un dato fiscal del artículo, no algo que
                            se negocie: solo lo cambia un administrador. El
                            servidor lo fuerza igual al del producto, así que
                            esto es para que se vea, no la defensa. */}
                        {isAdmin ? (
                          <Selector value={it.iva_tipo} onChange={(e) => updItem(i, { iva_tipo: e.target.value as IvaTipoPresupuesto })} className={`${inputClass} bg-white`}>
                            {IVAS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                          </Selector>
                        ) : (
                          <div
                            className={`${inputClass} bg-slate-50 text-slate-700 cursor-not-allowed`}
                            title="El IVA sale del producto. Para cambiarlo, pedíselo a un administrador."
                          >
                            {it.iva_tipo}
                          </div>
                        )}
                      </td>
                      {puedeDescontar && <td className="py-2 px-2">
                        {/* Dos maneras de escribir lo mismo: el % y los
                            guaraníes. Se escribe en cualquiera de las dos y la
                            otra se actualiza sola. */}
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min="0" max="100" step="0.01"
                            value={it.descuento_pct || ""}
                            onChange={(e) => updItem(i, { descuento_pct: Number(e.target.value) })}
                            className={`${inputClass} px-2 tabular-nums`}
                            placeholder="%"
                            aria-label="Descuento en porcentaje"
                          />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                        <input
                          type="number" min="0" step="1"
                          value={it.descuento || ""}
                          onChange={(e) => updItem(i, { descuento: Number(e.target.value) })}
                          className={`${inputClass} mt-1 px-2 tabular-nums`}
                          placeholder="Gs."
                          aria-label="Descuento en guaraníes"
                        />
                      </td>}
                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                        {fmtGs(t.total)}
                        {(() => {
                          // Lo que se le hizo en total: el precio rebajado más
                          // el descuento cargado. El precio rebajado ya está
                          // dentro del total, así que acá solo se informa.
                          const d = descuentoTotalLinea(it);
                          if (d.monto <= 0) return null;
                          const porPrecio = descuentoPorPrecio(it.precio_lista, it.precio_unitario, it.cantidad);
                          return (
                            <span className="mt-0.5 block text-[10px] font-normal leading-tight text-emerald-700">
                              Le hiciste {fmtPct(d.pct)} · {fmtGs(d.monto)}
                              {porPrecio ? (
                                <span className="block text-slate-500">
                                  de lista {fmtGs(it.precio_lista)}
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <button onClick={() => delItem(i)} className="text-red-600 hover:text-red-700" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 ml-auto w-full sm:w-72 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal (sin IVA)</span><span className="tabular-nums">{fmtGs(totales.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">IVA</span><span className="tabular-nums">{fmtGs(totales.iva)}</span></div>
            {totales.desc > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500" title="Incluye lo que se resignó bajando el precio unitario, que ya está dentro del total.">
                  Descuentos otorgados
                </span>
                <span className="tabular-nums">{fmtGs(totales.desc)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-base"><span>Total</span><span className="tabular-nums text-[#4FAEB2]">{fmtGs(totales.total)}</span></div>
          </div>
        )}
      </SeccionForm>

      <SeccionForm
        paso={3}
        titulo="Condiciones comerciales"
        descripcion="Lo que se discute si después hay un reclamo: cómo se paga, en cuánto se entrega y qué se firma."
        completa={formaPago.trim() !== ""}
      >
        {/* Dos columnas desde que se sacó "Validez (días)": con tres quedaba un
            hueco a la derecha. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Forma de pago</label>
            {/* Lista cerrada: antes era texto libre y cada vendedor escribía la
                suya ("50% anticipo", "mitad y mitad"), así que el documento que
                firma el cliente decía algo distinto cada vez. Son condiciones
                comerciales: las define la casa, no quien atiende. */}
            <Selector
              value={esFormaPagoConocida(formaPago) || formaPago === "" ? formaPago : "__otra__"}
              onChange={(e) => setFormaPago(e.target.value === "__otra__" ? formaPago : e.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="">— Elegir —</option>
              {FORMAS_PAGO.map((f) => (
                <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
              ))}
              {/* Un presupuesto viejo puede tener una forma escrita a mano: se
                  muestra como está en vez de pisarla. Cambiarla a la fuerza
                  cambiaría la condición de un documento que el cliente ya
                  tiene. */}
              {formaPago !== "" && !esFormaPagoConocida(formaPago) && (
                <option value="__otra__">{formaPago} (cargada a mano)</option>
              )}
            </Selector>
            {formaPago.includes("{anticipo}") && (
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                El porcentaje sale de Configuración → Presupuesto, así cambiarlo no obliga a
                rehacer cada presupuesto.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>Plazo de entrega</label>
            <input value={plazoEntrega} onChange={(e) => setPlazoEntrega(e.target.value)} className={inputClass} placeholder="Ej: 5 días hábiles" />
            {/* Esto no es solo un dato interno: entra en una de las
                condiciones impresas. Los días hábiles cambian según la
                disponibilidad y el tipo de producto, así que se escribe por
                presupuesto en vez de quedar fijo en el texto. */}
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Sale impreso en las condiciones: “el plazo de procesamiento es de
              <strong> {plazoEntrega.trim() || "el plazo acordado con el vendedor"}</strong>”.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>
              Condiciones comerciales
              {!isAdmin && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                  las fija la casa
                </span>
              )}
            </label>
            {/* ── Quién puede tocarlas ──────────────────────────────────────
                Son las que se discuten si después hay un reclamo: quién paga
                el flete, qué tolerancia tienen las chapas, en qué plazo se
                retira. Un vendedor que las ablanda para cerrar una venta
                compromete a la casa sin que nadie se entere hasta el reclamo.

                Al vendedor le salen cargadas y a la vista —tiene que saber qué
                está firmando el cliente— pero no las puede editar. El candado
                de verdad está en el servidor: esconder el campo no alcanza. */}
            <textarea
              value={condiciones}
              onChange={(e) => setCondiciones(e.target.value)}
              rows={10}
              readOnly={!isAdmin}
              className={`${inputClass} ${!isAdmin ? "cursor-default bg-slate-50 text-slate-600" : ""}`}
              placeholder={"Ej:\n- Precios válidos por la vigencia indicada.\n- Flete y descarga por cuenta del comprador.\n- Garantía de fábrica contra defectos."}
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              {isAdmin ? (
                <>
                  Vienen cargadas las condiciones de la casa, que son las que salen
                  impresas bajo el total. Si acá se cambian, el cambio vale{" "}
                  <strong>solo para este presupuesto</strong>; para cambiarlas en todos,
                  se editan en Configuración → Presupuesto.
                </>
              ) : (
                <>
                  Estas son las condiciones de la casa y salen impresas tal cual en el
                  presupuesto. <strong>Solo un administrador puede cambiarlas.</strong>
                </>
              )}
            </p>
          </div>
          {/* ── Lo único que NO se imprime ──────────────────────────────
              Las observaciones y las condiciones van las dos en el PDF que se
              le manda al cliente. Entonces no había dónde anotar lo que es
              asunto de la casa —que falta material, a quién se le pidió—, y
              escribirlo arriba era mandárselo al cliente. */}
          <div className={`sm:col-span-2 rounded-xl border-2 p-4 transition-colors ${
            faltaMaterial ? "border-amber-400 bg-amber-50" : "border-amber-200 bg-amber-50/50"
          }`}>
            <label className="flex items-center gap-3 text-base font-bold text-amber-900 cursor-pointer">
              <input
                type="checkbox"
                checked={faltaMaterial}
                onChange={(e) => setFaltaMaterial(e.target.checked)}
                className="h-5 w-5 rounded border-amber-400"
              />
              Falta material para cumplir este presupuesto
            </label>
            <label className={`${labelClass} mt-3`}>Nota interna</label>
            <textarea
              value={notaInterna}
              onChange={(e) => setNotaInterna(e.target.value)}
              rows={2}
              placeholder="Ej: faltan 40 m de cinta, pedido al proveedor el 28/10"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] font-medium leading-snug text-amber-800">
              Esto queda para adentro: no sale en el PDF ni lo ve el cliente.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Observaciones</label>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className={inputClass} />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Notas sobre la mercadería o el pedido, no condiciones.
            </p>
          </div>
        </div>
      </SeccionForm>

      <AvisoFaltantes lineas={items} existencias={existencias} puedeSinStock={puedeSinStock} />

      {/* Qué falta, y qué pasa si falta. Se dice todo antes de guardar: que la
          cotización no se pierde, y que así no se puede cobrar. */}
      {seraBorrador && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-sm text-amber-900">
          Falta{faltanDatosCliente.length === 1 ? "" : "n"}{" "}
          <strong>{textoFaltantes(faltanDatosCliente)}</strong>, así que se va a guardar como{" "}
          <strong>borrador</strong>: queda registrado y se puede imprimir, pero no se puede
          mandar, aprobar ni cobrar hasta completarlo. Tampoco se le abre la ficha al cliente
          todavía.
        </div>
      )}

      {/*
        La barra de abajo queda fija.

        Esta pantalla es de scroll largo: el total y el botón de guardar
        estaban al final, así que para ver cuánto daba el presupuesto había que
        bajar hasta el fondo, y para corregir un precio había que subir y
        volver a bajar. Acá el total se ve mientras se cargan los ítems, que es
        cuando sirve.
      */}
      <div className="sticky bottom-0 -mx-4 mt-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">
              Total{items.length > 0 ? ` · ${items.length} ${items.length === 1 ? "ítem" : "ítems"}` : ""}
            </p>
            <p className="text-xl font-semibold leading-tight text-slate-900">{fmtGs(totales.total)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/presupuestos" className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancelar
            </Link>
            <button
              onClick={guardar}
              disabled={!valido || guardando}
              // Ámbar cuando va a quedar borrador: el color dice qué botón es
              // antes de leerlo, y es la diferencia entre una cotización
              // cobrable y una que todavía no.
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                seraBorrador ? "bg-amber-600 hover:bg-amber-700" : "bg-[#4FAEB2] hover:bg-[#3F8E91]"
              }`}
            >
              {guardando
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</>
                : seraBorrador ? "Guardar como borrador" : "Guardar presupuesto"}
            </button>
          </div>
        </div>
      </div>
    {nuevoClienteOpen && (
        <NuevoClienteRapidoModal
          nombreInicial={clienteNombre}
          onClose={() => setNuevoClienteOpen(false)}
          onCreado={clienteReciénCreado}
        />
      )}
    </div>
  );
}
