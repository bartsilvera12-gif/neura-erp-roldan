"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { cargarPlantillaPresupuesto } from "@/lib/presupuestos/cargar-plantilla";
import { useFacultades } from "@/lib/perfiles/use-facultades";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { calcMontoIvaIncluido, type IvaTipoPresupuesto } from "@/lib/presupuestos/types";
import { aplicarCambio, descuentoPorPrecio, descuentoTotalLinea } from "@/lib/presupuestos/descuento-linea";
import { FORMAS_PAGO, esFormaPagoConocida } from "@/lib/presupuestos/formas-pago";
import { validarRucOCedula } from "@/lib/clientes/identificador";
import { faltantesDelPresupuesto, textoFaltantes } from "@/lib/presupuestos/faltantes";
import { useExistencias, ExistenciaLinea, AvisoFaltantes, lineasSinStock } from "@/components/presupuestos/existencias";
import Selector from "@/components/ui/Selector";

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
   * El precio de lista con el que se compara.
   *
   * OJO: en un presupuesto guardado no sabemos a qué precio estaba el artículo
   * el día que se armó — eso no se guarda. Se compara contra el precio de HOY,
   * que es lo único disponible. Si la lista se remarcó desde entonces, el
   * "descuento" que se muestre incluye esa remarcación. Para las líneas que se
   * agreguen ahora el precio es el del momento y la comparación es exacta.
   */
  precio_lista: number;
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
function asIva(v: unknown): IvaTipoPresupuesto {
  return v === "EXENTA" || v === "5%" || v === "10%" ? v : "10%";
}

/** Ver el comentario en `src/app/presupuestos/nuevo/page.tsx`. */
const VALIDEZ_DIAS = 1;

const IVAS: IvaTipoPresupuesto[] = ["10%", "5%", "EXENTA"];
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function EditarPresupuestoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  // Las condiciones comerciales las cambia solo un administrador.
  const { isAdmin, descuentoMaximo } = useIsAdmin();
  /** El descuento lo ve quien puede darlo (igual que en Nuevo presupuesto). */
  const puedeDescontar = isAdmin || (descuentoMaximo ?? 0) > 0;
  // Cotizar por más de lo que hay: facultad, no nivel.
  const { tiene: tieneFacultad } = useFacultades();
  // Cotizar sin stock: solo administración.
  void tieneFacultad;
  const puedeSinStock = isAdmin;

  const [productos, setProductos] = useState<ProductoLite[]>([]);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);

  // Cliente
  const [clienteId, setClienteId] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteRuc, setClienteRuc] = useState("");
  /** Si el presupuesto ya traía RUC cuando se abrió. Se marca al cargarlo. */
  const rucVenia = useRef<boolean | null>(null);
  const [clienteTel, setClienteTel] = useState("");
  const [clienteDir, setClienteDir] = useState("");
  /**
   * Ciudad y profesión se editan acá porque son dos de los datos que dejan a
   * un presupuesto en borrador. Sin estos campos, un borrador al que le falta
   * la ciudad no se podría completar desde ninguna pantalla y quedaría en
   * borrador para siempre.
   */
  const [clienteCiudad, setClienteCiudad] = useState("");
  const [clienteProfesion, setClienteProfesion] = useState("");
  const [esBorrador, setEsBorrador] = useState(false);

  // Items
  const [items, setItems] = useState<Item[]>([]);
  // Puntos 9.1 y 9.2: editar un presupuesto también es cotizar, así que el
  // aviso de faltante tiene que estar acá igual que en el alta.
  const existencias = useExistencias(items.map((it) => it.producto_id));
  const [selProd, setSelProd] = useState("");
  const [usarMayorista, setUsarMayorista] = useState(false);

  // Condiciones
  const [moneda, setMoneda] = useState<"PYG" | "USD">("PYG");
  /**
   * Ya no se pregunta (ver `VALIDEZ_DIAS` en `presupuestos/nuevo`), pero al
   * editar se respeta lo que el presupuesto tenía guardado: cambiarle el
   * vencimiento a uno viejo movería qué stock está reservado. Solo los que no
   * tienen nada guardado toman el valor fijo.
   */
  const [validezDias, setValidezDias] = useState(String(VALIDEZ_DIAS));
  const [formaPago, setFormaPago] = useState("");
  const [plazoEntrega, setPlazoEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [notaInterna, setNotaInterna] = useState("");
  const [faltaMaterial, setFaltaMaterial] = useState(false);
  // Punto 9.4: el texto que obliga, aparte de las notas del producto.
  const [condiciones, setCondiciones] = useState("");

  const [cargando, setCargando] = useState(true);
  const [numero, setNumero] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogos (productos + clientes)
  useEffect(() => {
    fetchWithSupabaseSession("/api/productos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          const list = (j.data?.productos ?? []) as Record<string, unknown>[];
          setProductos(
            list
              .filter((p) => p.es_vendible !== false)
              .map((p) => ({
                id: String(p.id),
                nombre: String(p.nombre),
                sku: String(p.sku ?? ""),
                precio_venta: Number(p.precio_venta) || 0,
                precio_mayorista: Number(p.precio_mayorista) || 0,
                unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
              }))
          );
        }
      })
      .catch(() => {});
    // Los clientes se buscan en el servidor al escribir (ver `buscarClientes`):
    // traer los 21 mil era medio minuto y el buscador no encontraba nada.
  }, []);

  const [buscandoClientes, setBuscandoClientes] = useState(false);
  const pedidoClientes = useRef(0);
  const clienteIdRef = useRef("");
  clienteIdRef.current = clienteId;
  const buscarClientes = useCallback(async (texto: string) => {
    const nro = ++pedidoClientes.current;
    if (texto.length < 2) { setBuscandoClientes(false); return; }
    setBuscandoClientes(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/clientes?q=${encodeURIComponent(texto)}&limite=30`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (nro !== pedidoClientes.current) return;
      const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const encontrados = (Array.isArray(j?.data) ? (j.data as Record<string, unknown>[]) : []).map((c) => ({
        id: String(c.id),
        nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente",
        ruc: s(c.ruc) || null,
        telefono: s(c.telefono) || null,
        direccion: s(c.direccion) || null,
      }));
      setClientes((prev) => {
        const elegido = prev.find((c) => c.id === clienteIdRef.current);
        return elegido && !encontrados.some((c) => c.id === elegido.id) ? [elegido, ...encontrados] : encontrados;
      });
    } finally {
      if (nro === pedidoClientes.current) setBuscandoClientes(false);
    }
  }, []);

  // Presupuesto existente
  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargando(true);
      try {
        const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok || body?.success === false) {
          if (!cancel) setError(body?.error ?? "No se pudo cargar el presupuesto.");
          return;
        }
        if (cancel) return;
        const p = body.data.presupuesto as Record<string, unknown>;
        if (String(p.estado) === "convertido") {
          setError("El presupuesto ya fue convertido; no se puede editar.");
          setItems([]);
          return;
        }
        setNumero(String(p.numero_control ?? ""));
        setClienteId(p.cliente_id ? String(p.cliente_id) : "");
        // El cliente del presupuesto, para que el selector muestre su nombre.
        if (p.cliente_id) {
          setClientes([{
            id: String(p.cliente_id),
            nombre: String(p.cliente_nombre ?? "Cliente"),
            ruc: p.cliente_ruc ? String(p.cliente_ruc) : null,
            telefono: p.cliente_telefono ? String(p.cliente_telefono) : null,
            direccion: p.cliente_direccion ? String(p.cliente_direccion) : null,
          }]);
        }
        setClienteNombre(String(p.cliente_nombre ?? ""));
        setClienteRuc(p.cliente_ruc ? String(p.cliente_ruc) : "");
        // Si este presupuesto venía con RUC, no se puede dejar vacío. Si nunca
        // lo tuvo (es anterior a la regla), se puede seguir editando sin
        // inventarle uno.
        rucVenia.current = !!p.cliente_ruc && String(p.cliente_ruc).trim() !== "";
        setClienteTel(p.cliente_telefono ? String(p.cliente_telefono) : "");
        setClienteDir(p.cliente_direccion ? String(p.cliente_direccion) : "");
        setClienteCiudad(p.cliente_ciudad ? String(p.cliente_ciudad) : "");
        setClienteProfesion(p.cliente_profesion ? String(p.cliente_profesion) : "");
        setEsBorrador(String(p.estado) === "borrador");
        setMoneda(p.moneda === "USD" ? "USD" : "PYG");
        setValidezDias(p.validez_dias == null ? String(VALIDEZ_DIAS) : String(p.validez_dias));
        setFormaPago(p.forma_pago ? String(p.forma_pago) : "");
        setPlazoEntrega(p.plazo_entrega ? String(p.plazo_entrega) : "");
        setObservaciones(p.observaciones ? String(p.observaciones) : "");
        setNotaInterna(p.nota_interna ? String(p.nota_interna) : "");
        setFaltaMaterial(p.falta_material === true);
        setCondiciones(p.condiciones_comerciales ? String(p.condiciones_comerciales) : "");
        // Si este presupuesto no tiene condiciones propias, se imprimen las de
        // la casa: se muestran esas, en vez de un campo vacío.
        if (!p.condiciones_comerciales || !p.forma_pago) {
          void cargarPlantillaPresupuesto().then((pl) => {
            if (!pl) return;
            if (!p.condiciones_comerciales) setCondiciones((prev) => (prev.trim() ? prev : pl.condiciones));
            if (!p.forma_pago) setFormaPago((prev) => (prev.trim() ? prev : pl.formaPago));
          });
        }
        const its = (body.data.items ?? []) as Record<string, unknown>[];
        setItems(
          its.map((it) => ({
            producto_id: it.producto_id ? String(it.producto_id) : null,
            producto_nombre: String(it.producto_nombre ?? ""),
            sku: it.sku ? String(it.sku) : null,
            cantidad: Number(it.cantidad) || 0,
            unidad_medida: it.unidad_medida ? String(it.unidad_medida) : null,
            precio_unitario: Number(it.precio_unitario) || 0,
            iva_tipo: asIva(it.iva_tipo),
            descuento: Number(it.descuento) || 0,
            // El presupuesto guarda el monto, no el %: se deriva al cargar.
            descuento_pct: 0,
            descuento_modo: "monto" as const,
            precio_lista: 0,
          })).map((it) => aplicarCambio(it, { descuento: it.descuento }))
        );
      } catch {
        if (!cancel) setError("Error de red al cargar el presupuesto.");
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  function seleccionarCliente(cid: string | null) {
    const nextId = cid ?? "";
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

  /**
   * El presupuesto guardado no trae el precio de lista: se completa desde el
   * catálogo cuando termina de cargar, para poder decir cuánto se rebajó.
   * Solo toca las líneas que todavía no lo tienen, así no pisa lo que se
   * agregue a mano después.
   */
  useEffect(() => {
    if (productos.length === 0) return;
    setItems((prev) => {
      let cambio = false;
      const sig = prev.map((it) => {
        if (it.precio_lista > 0 || !it.producto_id) return it;
        const p = productos.find((x) => x.id === it.producto_id);
        if (!p) return it;
        const lista = usarMayorista && p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
        if (!(lista > 0)) return it;
        cambio = true;
        return { ...it, precio_lista: lista };
      });
      return cambio ? sig : prev;
    });
  }, [productos, usarMayorista]);

  function precioParaProducto(p: ProductoLite): number {
    if (usarMayorista && p.precio_mayorista > 0) return p.precio_mayorista;
    return p.precio_venta;
  }

  function agregarProducto() {
    const p = productos.find((x) => x.id === selProd);
    if (!p) return;
    if (items.some((it) => it.producto_id === p.id)) return;
    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku || null,
        cantidad: 1,
        unidad_medida: p.unidad_medida,
        precio_unitario: precioParaProducto(p),
        iva_tipo: "10%",
        descuento: 0,
        descuento_pct: 0,
        descuento_modo: "monto" as const,
        precio_lista: precioParaProducto(p),
      },
    ]);
    setSelProd("");
  }

  function agregarManual() {
    setItems((prev) => [
      ...prev,
      { producto_id: null, producto_nombre: "", sku: null, cantidad: 1, unidad_medida: null, precio_unitario: 0, iva_tipo: "10%", descuento: 0, descuento_pct: 0, descuento_modo: "monto", precio_lista: 0 },
    ]);
  }

  function updItem(i: number, patch: Partial<Item>) {
    // Ver `nuevo/page.tsx`: el % y el monto del descuento se mantienen
    // coherentes entre sí.
    setItems((prev) => prev.map((it, idx) => (idx === i ? aplicarCambio(it, patch) : it)));
  }
  function delItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totales = useMemo(() => {
    let subtotal = 0, iva = 0, desc = 0, total = 0;
    for (const it of items) {
      const t = itemTotals(it);
      subtotal += t.subtotal;
      iva += t.iva;
      total += t.total;
      desc += descuentoTotalLinea(it).monto;
    }
    return { subtotal: round2(subtotal), iva: round2(iva), desc: round2(desc), total: round2(total) };
  }, [items]);

  /**
   * El RUC se exige si el presupuesto ya lo tenía: no se puede borrar. Los
   * anteriores a esta regla, que nunca lo tuvieron, se pueden seguir editando
   * sin inventarle uno.
   */
  const identCliente = validarRucOCedula(clienteRuc);
  // En un borrador el RUC puede estar vacío: es justamente lo que le falta.
  const rucOk = identCliente.ok || rucVenia.current === false || esBorrador;

  /**
   * Lo que todavía le falta a este borrador para ser un presupuesto firme.
   *
   * Es la misma cuenta que hace el servidor al guardar: si da vacío, el
   * presupuesto sale de borrador solo y recién ahí se le abre la ficha al
   * cliente. Se muestra acá para que el que está completando sepa cuánto le
   * queda, en vez de guardar y ver si salió.
   */
  const faltaParaFirme = esBorrador
    ? faltantesDelPresupuesto({
        cliente_id: clienteId || null,
        nombre: clienteNombre,
        ruc: clienteRuc,
        telefono: clienteTel,
        profesion: clienteProfesion,
        ciudad: clienteCiudad,
      })
    : [];

  // Mismo criterio que al crear: sin esto se guarda con stock y después se le
  // suben las cantidades desde la edición.
  const sinStock = puedeSinStock ? [] : lineasSinStock(items, existencias);

  const valido =
    clienteNombre.trim().length > 0 &&
    rucOk &&
    sinStock.length === 0 &&
    items.length > 0 &&
    items.every((it) => it.producto_nombre.trim() && it.cantidad > 0 && it.precio_unitario >= 0);

  async function guardar() {
    if (guardando || !valido) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          cliente_nombre: clienteNombre.trim(),
          cliente_ruc: clienteRuc.trim() || null,
          cliente_telefono: clienteTel.trim() || null,
          cliente_direccion: clienteDir.trim() || null,
          cliente_ciudad: clienteCiudad.trim() || null,
          cliente_profesion: clienteProfesion.trim() || null,
          moneda,
          validez_dias: validezDias.trim() === "" ? VALIDEZ_DIAS : parseInt(validezDias, 10),
          forma_pago: formaPago.trim() || null,
          plazo_entrega: plazoEntrega.trim() || null,
          observaciones: observaciones.trim() || null,
          nota_interna: notaInterna.trim() || null,
          falta_material: faltaMaterial,
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
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo guardar el presupuesto.");
        return;
      }
      router.push(`/presupuestos/${id}`);
    } catch {
      setError("Error de red al guardar el presupuesto.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return <div className="p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;
  }

  return (
    <div className="space-y-6">
      <Link href={`/presupuestos/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver al presupuesto
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-7 w-7 text-[#4FAEB2]" />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Editar {numero || "presupuesto"}</h1>
        </div>
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={usarMayorista}
            onChange={(e) => setUsarMayorista(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
          />
          <span>Usar precios mayoristas al agregar</span>
        </label>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Cliente */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Cliente</h2>
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
              options={clientes.map((c) => ({ id: c.id, label: c.nombre, hint: c.ruc ?? undefined }))}
            />
          </div>
          <div>
            <label className={labelClass}>Nombre / Razón social *</label>
            <input value={clienteNombre} onChange={(e) => { setClienteId(""); setClienteNombre(e.target.value); }} className={inputClass} placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className={labelClass}>RUC / CI</label>
            <input
              value={clienteRuc}
              onChange={(e) => setClienteRuc(e.target.value)}
              placeholder="80012345-1 o cédula"
              className={`${inputClass} ${rucOk ? "" : "border-rose-300"}`}
            />
            {!rucOk && (
              <p className="mt-1 text-[11px] leading-snug text-rose-600">{identCliente.error}</p>
            )}
          </div>
          <div>
            <label className={labelClass}>Teléfono</label>
            <input value={clienteTel} onChange={(e) => setClienteTel(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Dirección</label>
            <input value={clienteDir} onChange={(e) => setClienteDir(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Ciudad</label>
            <input
              value={clienteCiudad}
              onChange={(e) => setClienteCiudad(e.target.value.toUpperCase())}
              className={`${inputClass} uppercase`}
            />
          </div>
          <div>
            <label className={labelClass}>Profesión</label>
            <input
              value={clienteProfesion}
              onChange={(e) => setClienteProfesion(e.target.value.toUpperCase())}
              placeholder="ALBAÑIL, ELECTRICISTA…"
              className={`${inputClass} uppercase`}
            />
          </div>
        </div>
        {/* Un borrador dice qué le falta y qué pasa cuando no le falte más. */}
        {esBorrador && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
            {faltaParaFirme.length > 0 ? (
              <>Es un <strong>borrador</strong>: falta{faltaParaFirme.length === 1 ? "" : "n"}{" "}
              <strong>{textoFaltantes(faltaParaFirme)}</strong>. Se puede guardar igual —no se
              pierde nada— pero no se puede mandar, aprobar ni cobrar hasta completarlo.</>
            ) : (
              <>Ya están todos los datos: al guardar pasa a <strong>presupuesto firme</strong> y
              se le abre la ficha al cliente.</>
            )}
          </div>
        )}
      </div>

      {/* Productos */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Productos</h2>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className={labelClass}>Agregar desde inventario</label>
            <SearchableSelect
              value={selProd || null}
              onChange={(v) => setSelProd(v)}
              placeholder="— Buscá un producto por nombre o SKU —"
              options={productos
                .filter((p) => !items.some((it) => it.producto_id === p.id))
                .map((p) => ({ id: p.id, label: p.nombre, hint: p.sku || undefined }))}
            />
          </div>
          <button type="button" onClick={agregarProducto} disabled={!selProd} className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
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
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="0.01" value={it.cantidad || ""} onChange={(e) => updItem(i, { cantidad: Number(e.target.value) })} className={inputClass} />
                        <ExistenciaLinea
                          existencia={it.producto_id ? existencias[it.producto_id] : undefined}
                          cantidad={it.cantidad}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="1" value={it.precio_unitario || ""} onChange={(e) => updItem(i, { precio_unitario: Number(e.target.value) })} className={inputClass} />
                        {(() => {
                          const d = descuentoPorPrecio(it.precio_lista, it.precio_unitario, it.cantidad);
                          if (!d) return null;
                          return (
                            <span className="mt-1 block text-[10px] leading-tight text-emerald-700">
                              {fmtPct(d.pct)} menos que la lista de hoy ({fmtGs(it.precio_lista)})
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-2 px-2">
                        <Selector value={it.iva_tipo} onChange={(e) => updItem(i, { iva_tipo: e.target.value as IvaTipoPresupuesto })} className={`${inputClass} bg-white`}>
                          {IVAS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                        </Selector>
                      </td>
                      {puedeDescontar && <td className="py-2 px-2">
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
                          const d = descuentoTotalLinea(it);
                          if (d.monto <= 0) return null;
                          return (
                            <span className="mt-0.5 block text-[10px] font-normal leading-tight text-emerald-700">
                              Le hiciste {fmtPct(d.pct)} · {fmtGs(d.monto)}
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
      </div>

      {/* Condiciones */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Condiciones comerciales</h2>
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
            <textarea
              value={condiciones}
              onChange={(e) => setCondiciones(e.target.value)}
              rows={10}
              readOnly={!isAdmin}
              className={`${inputClass} ${!isAdmin ? "cursor-default bg-slate-50 text-slate-600" : ""}`}
              placeholder={"Ej:\n- Precios válidos por la vigencia indicada.\n- Flete y descarga por cuenta del comprador."}
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              {isAdmin
                ? "Sale en el presupuesto, bajo el total."
                : "Salen impresas tal cual en el presupuesto. Solo un administrador puede cambiarlas."}
            </p>
          </div>
          {/* ── Lo único que NO se imprime ──────────────────────────────
              Las observaciones y las condiciones van las dos en el PDF que se
              le manda al cliente. Entonces no había dónde anotar lo que es
              asunto de la casa —que falta material, a quién se le pidió—, y
              escribirlo arriba era mandárselo al cliente. */}
          <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <input
                type="checkbox"
                checked={faltaMaterial}
                disabled={!isAdmin}
                onChange={(e) => setFaltaMaterial(e.target.checked)}
                className="h-4 w-4 rounded border-amber-300"
              />
              Falta material para cumplir este presupuesto{!isAdmin && " (lo marca administración)"}
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
      </div>

      <AvisoFaltantes lineas={items} existencias={existencias} puedeSinStock={puedeSinStock} />

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Link href={`/presupuestos/${id}`} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Cancelar
        </Link>
        <button onClick={guardar} disabled={!valido || guardando} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
          {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
