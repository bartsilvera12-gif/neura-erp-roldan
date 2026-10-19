"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import { getProducto, productoExiste, productoPorCodigoBarras, updateProducto } from "@/lib/inventario/storage";
import type { MetodoValuacion, TipoIvaProducto } from "@/lib/inventario/types";
import ProductImageUploader from "@/components/inventario/ProductImageUploader";
import SelectFromList from "@/components/inventario/SelectFromList";
import ProveedoresCostos from "@/components/inventario/ProveedoresCostos";
import LotesProducto from "@/components/inventario/LotesProducto";
import { MargenPorCanal } from "@/components/inventario/MargenPorCanal";
import PreciosCategoriaEditor from "@/components/inventario/PreciosCategoriaEditor";
import { useRequireAdmin } from "@/lib/auth/use-require-admin";

// Opciones estándar de unidad de medida (UX simplificada gastro)
const UNIDADES_OPCIONES = [
  "UNIDAD","BOLSA","KG","G","LT","ML","CAJA","PAQUETE","DOCENA","LATA","BOTELLA","PORCION","COMBO",
] as const;


interface CatRow { id: string; nombre: string }
interface UbiRow { id: string; nombre: string; tipo: string }
interface ProvRow { id: string; nombre: string }

export default function EditarProductoPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";

  // Edición de productos: solo admin. Un no-admin es redirigido al detalle.
  const { isAdmin, loaded: rolCargado } = useRequireAdmin(id ? `/inventario/${id}` : "/inventario");

  const [cargando, setCargando] = useState(true);
  const [errorDuplicado, setErrorDuplicado] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Advertencia (no bloquea) de código de barras repetido + confirmación.
  const [avisoCodigo, setAvisoCodigo] = useState<string | null>(null);
  const [confirmarCodigoDup, setConfirmarCodigoDup] = useState(false);

  // descripcion live separately because form se inicializa al cargar
  const [descripcion, setDescripcion] = useState("");
  const [form, setForm] = useState({
    nombre: "",
    sku: "",
    codigo_barras: "",
    codigo_barras_interno: false,
    costo_promedio: "",
    markup: "",
    precio_venta: "",
    precio_mayorista: "",
    cantidad_minima_mayorista: "",
    precio_distribuidor: "",
    stock_actual: "",
    stock_minimo: "",
    unidad_medida: "",
    metodo_valuacion: "CPP" as MetodoValuacion,
    tipo_iva: "10%" as TipoIvaProducto,
  });
  const [imagenPath, setImagenPath] = useState<string | null>(null);
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [codigoOriginal, setCodigoOriginal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);
  const [generandoSku, setGenerandoSku] = useState(false);
  const [skuPatrones, setSkuPatrones] = useState<{ prefix: string; siguiente: string }[]>([]);

  // Relaciones
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<CatRow[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbiRow[]>([]);
  const [proveedores, setProveedores] = useState<ProvRow[]>([]);

  // Clasificación gastronómica
  const [esVendible, setEsVendible] = useState(true);
  const [esInsumo, setEsInsumo] = useState(false);

  // Tipo gastro inferido a partir de los flags (para UX simplificada)
  type TipoGastro = "reventa" | "menu" | "materia";
  const [tipoGastro, setTipoGastro] = useState<TipoGastro>("reventa");
  // Si el producto tiene una receta asociada (para advertir al cambiar el tipo).
  const [tieneReceta, setTieneReceta] = useState(false);
  const [modoReceta, setModoReceta] = useState<"preparado_al_vender" | "produccion_previa">("preparado_al_vender");

  // Configuración gastronómica
  const [controlaStock, setControlaStock] = useState(true);
  // Control de lotes y vencimientos (perecederos).
  const [controlaLote, setControlaLote] = useState(false);

  // Cambia tipo → sincroniza flags automáticamente. Se salta la primera
  // corrida (el useEffect que carga el producto ya seteó los flags).
  const primeraSyncRef = useRef(true);
  useEffect(() => {
    if (primeraSyncRef.current) { primeraSyncRef.current = false; return; }
    if (tipoGastro === "reventa") {
      setEsVendible(true); setEsInsumo(false); setControlaStock(true);
    } else if (tipoGastro === "menu") {
      setEsVendible(true); setEsInsumo(false); setControlaStock(false);
    } else if (tipoGastro === "materia") {
      setEsVendible(false); setEsInsumo(true); setControlaStock(true);
    }
  }, [tipoGastro]);

  /** Cambia el tipo de producto y aplica los flags correctos (igual que en Nuevo producto). */
  const [valorizado, setValorizado] = useState(true);
  const [unidadCompra, setUnidadCompra] = useState("");
  const [unidadReceta, setUnidadReceta] = useState("");
  const [factorCompraReceta, setFactorCompraReceta] = useState("1");
  const [tiempoPrepMinutos, setTiempoPrepMinutos] = useState("0");

  useEffect(() => {
    let cancel = false;
    async function load(url: string) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const j = await r.json();
        return r.ok && j?.success ? j.data : null;
      } catch { return null; }
    }
    (async () => {
      const [cats, ubis, provs] = await Promise.all([
        load("/api/inventario/categorias"),
        load("/api/inventario/ubicaciones"),
        load("/api/proveedores"),
      ]);
      if (cancel) return;
      if (cats?.categorias) setCategorias(cats.categorias as CatRow[]);
      if (ubis?.ubicaciones) setUbicaciones(ubis.ubicaciones as UbiRow[]);
      if (provs?.proveedores) setProveedores(provs.proveedores as ProvRow[]);
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/productos/sku-sugerencias?tipo=${tipoGastro}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel && j?.success) setSkuPatrones(j.data?.patrones ?? []); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [tipoGastro]);

  async function handleGenerarSku() {
    if (generandoSku) return;
    setGenerandoSku(true);
    setErrorDuplicado(null);
    try {
      const res = await fetch(`/api/productos/sku-sugerencias?tipo=${tipoGastro}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.sugerido) {
        setForm((prev) => ({ ...prev, sku: json.data.sugerido as string }));
        setSkuPatrones(json.data.patrones ?? []);
      }
    } catch { /* no bloquea */ } finally {
      setGenerandoSku(false);
    }
  }

  function handleSelectPatron(e: React.ChangeEvent<HTMLSelectElement>) {
    const sig = e.target.value;
    if (sig) setForm((prev) => ({ ...prev, sku: sig }));
    e.target.value = "";
  }

  async function handleGenerarCodigoBarras() {
    if (generandoCodigo) return;
    setGenerandoCodigo(true);
    setErrorDuplicado(null);
    setErrorGeneral(null);
    try {
      const res = await fetch("/api/productos/codigo-barras", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.codigo) {
        setForm((prev) => ({
          ...prev,
          codigo_barras: json.data.codigo as string,
          codigo_barras_interno: false,
        }));
      } else {
        setErrorGeneral(json?.error ?? "No se pudo generar el código de barras.");
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "Error de red");
    } finally {
      setGenerandoCodigo(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getProducto(id).then((p) => {
      if (cancelled || !p) return;
      const costo = p.costo_promedio;
      const precio = p.precio_venta;
      const markup = costo > 0 ? ((precio - costo) / costo) * 100 : 0;
      setForm({
        nombre: p.nombre,
        sku: p.sku,
        codigo_barras: p.codigo_barras ?? "",
        codigo_barras_interno: p.codigo_barras_interno === true,
        costo_promedio: String(p.costo_promedio),
        markup: markup.toFixed(2),
        precio_venta: String(p.precio_venta),
        precio_mayorista: p.precio_mayorista != null ? String(p.precio_mayorista) : "",
        cantidad_minima_mayorista: p.cantidad_minima_mayorista != null ? String(p.cantidad_minima_mayorista) : "",
        precio_distribuidor: p.precio_distribuidor != null ? String(p.precio_distribuidor) : "",
        stock_actual: String(p.stock_actual),
        stock_minimo: String(p.stock_minimo),
        unidad_medida: p.unidad_medida,
        metodo_valuacion: p.metodo_valuacion,
        tipo_iva: (p.tipo_iva ?? "10%") as TipoIvaProducto,
      });
      setCodigoOriginal(p.codigo_barras ?? null);
      setImagenPath(p.imagen_path ?? null);
      setImagenUrl(p.imagen_url ?? null);
      setCategoriaId(p.categoria_principal_id ?? null);
      setUbicacionId(p.ubicacion_principal_id ?? null);
      setProveedorId(p.proveedor_principal_id ?? null);
      const esVend = p.es_vendible ?? true;
      const esIns = p.es_insumo ?? false;
      const ctrlStock = p.controla_stock ?? true;
      setEsVendible(esVend);
      setEsInsumo(esIns);
      setControlaStock(ctrlStock);
      setControlaLote((p as unknown as { controla_lote?: boolean }).controla_lote === true);
      setModoReceta(p.modo_receta === "produccion_previa" ? "produccion_previa" : "preparado_al_vender");
      setDescripcion(p.descripcion ?? "");
      setValorizado(p.valorizado ?? true);
      setUnidadCompra(p.unidad_compra ?? "");
      setUnidadReceta(p.unidad_receta ?? "");
      setFactorCompraReceta(String(p.factor_compra_receta ?? 1));
      setTiempoPrepMinutos(String(p.tiempo_prep_minutos ?? 0));
      // Inferir tipo gastro a partir de los flags
      if (esIns) setTipoGastro("materia");
      else if (esVend && !ctrlStock) setTipoGastro("menu");
      else setTipoGastro("reventa");
    }).finally(() => {
      if (!cancelled) setCargando(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  // ¿El producto tiene receta asociada? (para advertir al cambiar el tipo)
  useEffect(() => {
    if (!id) return;
    let cancel = false;
    fetch("/api/recetas", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        const recs = (j?.data?.recetas ?? j?.data ?? []) as Array<{ producto_id?: string }>;
        setTieneReceta(Array.isArray(recs) && recs.some((r) => r.producto_id === id));
      })
      .catch(() => { /* la advertencia es informativa, no bloquea */ });
    return () => { cancel = true; };
  }, [id]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    if (e.target.name === "codigo_barras") {
      // El código de barras siempre es real/escaneable (no interno).
      // Al cambiarlo, se descarta la advertencia previa: el nuevo valor se
      // vuelve a chequear al guardar.
      setAvisoCodigo(null);
      setConfirmarCodigoDup(false);
      setForm((prev) => ({ ...prev, codigo_barras: e.target.value, codigo_barras_interno: false }));
      return;
    }
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleCostoChange(costo: number) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    const precio = parseFloat(form.precio_venta);
    // Al cambiar el costo NO movemos el precio (es lo que el cliente cobra).
    // Recalculamos markup a partir del gap precio-costo cuando ambos son válidos.
    if (!isNaN(costo) && costo > 0 && !isNaN(precio) && precio > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({ ...prev, costo_promedio: String(costo), markup: nuevoMarkup.toFixed(2) }));
    } else {
      setForm((prev) => ({ ...prev, costo_promedio: String(costo) }));
    }
  }

  function handleMarkupChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    const markup = parseFloat(e.target.value);
    const costo = parseFloat(form.costo_promedio);
    if (!isNaN(markup) && !isNaN(costo) && costo > 0) {
      const nuevoPrecio = costo * (1 + markup / 100);
      setForm((prev) => ({ ...prev, markup: e.target.value, precio_venta: nuevoPrecio.toFixed(0) }));
    } else {
      setForm((prev) => ({ ...prev, markup: e.target.value }));
    }
  }

  function handlePrecioChange(precio: number) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    const costo = parseFloat(form.costo_promedio);
    if (!isNaN(precio) && !isNaN(costo) && costo > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({ ...prev, precio_venta: String(precio), markup: nuevoMarkup.toFixed(2) }));
    } else {
      setForm((prev) => ({ ...prev, precio_venta: String(precio) }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    console.log("[inventario/editar] handleSubmit start", { id });
    if (submitting) return;
    setErrorDuplicado(null);
    setErrorGeneral(null);
    setSubmitting(true);

    const showAviso = (msg: string) => {
      setAvisoCodigo(msg);
      setConfirmarCodigoDup(true);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };

    const showErr = (msg: string) => {
      setErrorGeneral(msg);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };

    try {
      const codigoIngresado = form.codigo_barras.trim();

      // Pre-chequeo de duplicado: tolerante a fallos de red — si la consulta falla,
      // seguimos. El backend igual valida unicidad en el PATCH.
      try {
        const duplicado = await productoExiste(form.sku, form.nombre);
        if (duplicado && duplicado.id !== id) {
          setErrorDuplicado(`Ya existe "${duplicado.nombre}" con SKU ${duplicado.sku}.`);
          try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
          return;
        }
      } catch (err) {
        console.warn("[inventario/editar] productoExiste failed, ignorando:", err);
      }

      // Advertencia (no bloquea) de código de barras repetido. Si otro producto
      // ya usa el mismo código, avisamos y pedimos confirmación: al segundo
      // intento (confirmarCodigoDup=true) se guarda igual.
      if (codigoIngresado && !confirmarCodigoDup) {
        try {
          const dupCod = await productoPorCodigoBarras(codigoIngresado, id);
          if (dupCod) {
            showAviso(
              `Ya existe "${dupCod.nombre}" (SKU ${dupCod.sku}) con el código de barras ${codigoIngresado}. Podés guardar igual si es a propósito.`
            );
            return;
          }
        } catch (err) {
          console.warn("[inventario/editar] chequeo código de barras falló, ignorando:", err);
        }
      }

      const cambioCodigo = codigoIngresado !== (codigoOriginal ?? "");
      const updatePayload: Parameters<typeof updateProducto>[1] = {
        nombre: form.nombre.trim().toUpperCase(),
        sku: form.sku.trim().toUpperCase(),
        costo_promedio: parseFloat(form.costo_promedio) || 0,
        precio_venta: parseFloat(form.precio_venta) || 0,
        precio_mayorista: form.precio_mayorista.trim() !== "" ? parseFloat(form.precio_mayorista) || null : null,
        cantidad_minima_mayorista: form.cantidad_minima_mayorista.trim() !== "" ? parseFloat(form.cantidad_minima_mayorista) || null : null,
        precio_distribuidor: form.precio_distribuidor.trim() !== "" ? parseFloat(form.precio_distribuidor) || null : null,
        stock_actual: parseInt(form.stock_actual) || 0,
        stock_minimo: parseInt(form.stock_minimo) || 0,
        unidad_medida: form.unidad_medida.trim().toUpperCase() || "UNIDAD",
        metodo_valuacion: form.metodo_valuacion,
        categoria_principal_id: categoriaId,
        ubicacion_principal_id: ubicacionId,
        proveedor_principal_id: proveedorId,
        es_vendible: esVendible,
        es_insumo: esInsumo,
        controla_stock: controlaStock,
        controla_lote: controlaLote,
        valorizado: valorizado,
        unidad_compra: unidadCompra.trim() || null,
        unidad_receta: unidadReceta.trim() || null,
        factor_compra_receta: Math.max(parseFloat(factorCompraReceta) || 1, 0.0001),
        tiempo_prep_minutos: Math.max(parseInt(tiempoPrepMinutos) || 0, 0),
        descripcion: descripcion.trim() || null,
        // Modo de receta solo aplica a Menú con receta; en otros tipos se mantiene el default.
        modo_receta: tipoGastro === "menu" && tieneReceta ? modoReceta : "preparado_al_vender",
        tipo_iva: form.tipo_iva,
      };
      if (cambioCodigo) {
        updatePayload.codigo_barras = codigoIngresado || null;
        updatePayload.codigo_barras_interno = false; // los códigos de barras son reales (no internos)
      }

      console.log("[inventario/editar] sending PATCH", { id, payloadKeys: Object.keys(updatePayload) });
      const actualizado = await updateProducto(id, updatePayload);
      console.log("[inventario/editar] PATCH result:", actualizado ? { id: actualizado.id, nombre: actualizado.nombre } : "null");
      if (actualizado) {
        router.push("/inventario");
      } else {
        showErr("No se pudo guardar los cambios. Revisá los datos e intentá nuevamente.");
      }
    } catch (err) {
      console.error("[inventario/editar] handleSubmit error:", err);
      showErr(err instanceof Error ? err.message : "No se pudieron guardar los cambios.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-gray-500 transition-colors text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  // Mientras carga el producto o se resuelve el rol, o si no es admin (será
  // redirigido), no se muestra el formulario de edición.
  if (cargando || !rolCargado || !isAdmin) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold text-gray-800">Editar producto</h1>
        <p className="text-gray-500 animate-pulse">Cargando…</p>
      </div>
    );
  }

  // Stock visible siempre que el producto lo controle (reventa, materia prima
  // y Menú con producción previa). Antes se ocultaba en todos los Menú, así que
  // no había forma de editar la cantidad desde el form.
  const showStock = tipoGastro === "reventa" || tipoGastro === "materia" || controlaStock === true;
  const showPrecioVenta = tipoGastro !== "materia";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Editar producto</h1>
        <p className="text-gray-600">Modifica los datos del producto</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-5xl">
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>
          {errorGeneral && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorGeneral}</p>
            </div>
          )}
          {errorDuplicado && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-red-700">{errorDuplicado}</p>
            </div>
          )}
          {avisoCodigo && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800">⚠️ Código de barras repetido</p>
              <p className="mt-1 text-sm text-amber-700">{avisoCodigo}</p>
              <p className="mt-1 text-xs text-amber-600">
                Volvé a tocar “Guardar de todos modos” para confirmar, o cambiá el código.
              </p>
            </div>
          )}

          {/* Tipo de producto — al cambiarlo se re-clasifica en Reventa/Menú/Materia */}
          <div>
            <label className={labelClass}>Tipo de producto</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["reventa", "menu", "materia"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipoGastro(t)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    tipoGastro === t
                      ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6F72]"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {t === "reventa" && "Reventa (compra y vende)"}
                  {t === "menu" && "Menú (fabricado)"}
                  {t === "materia" && "Materia prima (insumo)"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {tipoGastro === "reventa" && "Producto que comprás y revendés tal cual."}
              {tipoGastro === "menu" && "Producto que fabricás y vendés al cliente final."}
              {tipoGastro === "materia" && "Insumo para producir menú."}
            </p>
          </div>

          <div>
            <label className={labelClass}>Nombre del producto</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              className={`${inputClass} uppercase`}
              required
            />
          </div>

          <div>
            <label className={labelClass}>
              Descripción
              {tipoGastro === "menu" && <span className="text-xs font-normal text-amber-700 ml-2">(visible al cliente)</span>}
            </label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={
                tipoGastro === "menu"
                  ? "Ej: Pan, carne, huevo, doble queso, lechuga, tomate, mayonesa."
                  : "Descripción opcional del producto"
              }
              rows={tipoGastro === "menu" ? 3 : 2}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>
                SKU interno{tipoGastro === "reventa" ? "" : <span className="text-xs font-normal text-gray-400 ml-1">(opcional)</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  placeholder="Ej: REV-0001"
                  className={`${inputClass} uppercase flex-1`}
                  required={tipoGastro === "reventa"}
                />
                <button
                  type="button"
                  onClick={handleGenerarSku}
                  disabled={generandoSku}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/5 disabled:opacity-50"
                >
                  {generandoSku ? "…" : "Generar SKU"}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <select
                  onChange={handleSelectPatron}
                  defaultValue=""
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                >
                  <option value="">Usar patrón existente…</option>
                  {skuPatrones.map((p) => (
                    <option key={p.prefix} value={p.siguiente}>{p.prefix} → {p.siguiente}</option>
                  ))}
                </select>
                <span className="text-[11px] text-gray-400">Código interno editable. Podés ajustar el número final.</span>
              </div>
            </div>
            <div className={tipoGastro === "menu" ? "hidden" : ""}>
              <label className={labelClass}>Unidad de medida</label>
              <select
                name="unidad_medida"
                value={form.unidad_medida}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
                required={tipoGastro !== "menu"}
              >
                {(() => {
                  const cur = (form.unidad_medida ?? "").trim().toUpperCase();
                  const opts = (UNIDADES_OPCIONES as readonly string[]).includes(cur) || !cur
                    ? UNIDADES_OPCIONES
                    : [...UNIDADES_OPCIONES, cur];
                  return opts.map((u) => (
                    <option key={u} value={u}>
                      {u}
                      {!((UNIDADES_OPCIONES as readonly string[]).includes(u)) ? " (actual)" : ""}
                    </option>
                  ));
                })()}
              </select>
            </div>
          </div>

          {/* Codigo de barras */}
          <div className="border-t border-slate-100 pt-5">
            <label className={labelClass}>Código de barras</label>
            <div className="flex gap-2">
              <input
                type="text"
                name="codigo_barras"
                value={form.codigo_barras}
                onChange={handleChange}
                placeholder="Escaneá, escribí o generá (EAN-13)"
                className={`${inputClass} flex-1`}
                inputMode="numeric"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleGenerarCodigoBarras}
                disabled={generandoCodigo}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.431l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                </svg>
                {generandoCodigo ? "Generando…" : "Generar código de barras"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              Código escaneable para lector o etiqueta (EAN-13). Si se repite, avisa pero deja guardar. (opcional)
            </p>
          </div>

          {/* Imagen del producto */}
          <div>
            <label className={labelClass}>Imagen del producto</label>
            <ProductImageUploader
              productoId={id}
              initialUrl={imagenUrl}
              initialPath={imagenPath}
              onChange={(info) => {
                setImagenPath(info.imagen_path);
                setImagenUrl(info.imagen_url);
              }}
            />
          </div>

          {/* Clasificación, Proveedor, Ubicación */}
          <div className="border-t border-slate-100 pt-6">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
                Clasificación y ubicación
              </p>
              <span className="text-xs text-gray-400">Opcional</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Categoría principal</label>
                <SelectFromList
                  value={categoriaId}
                  onChange={setCategoriaId}
                  options={categorias.map((c) => ({ id: c.id, label: c.nombre }))}
                  emptyShort="Sin categorías"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {categorias.length === 0 ? "Todavía no cargaste categorías." : `${categorias.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/categorias"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>
              <div className={`md:col-span-4 min-w-0 ${tipoGastro === "menu" ? "hidden" : ""}`}>
                <label className={labelClass}>Proveedor principal</label>
                <SelectFromList
                  value={proveedorId}
                  onChange={setProveedorId}
                  options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
                  emptyShort="Sin proveedores"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {proveedores.length === 0 ? "Todavía no cargaste proveedores." : `${proveedores.length} disponibles`}
                  </span>
                  <Link
                    href="/proveedores/nuevo"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>
              {/* Ubicación / Depósito principal donde vive el stock. */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Depósito principal</label>
                <SelectFromList
                  value={ubicacionId}
                  onChange={setUbicacionId}
                  options={ubicaciones.map((u) => ({ id: u.id, label: u.nombre, sublabel: u.tipo }))}
                  emptyShort="Sin ubicaciones"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {ubicaciones.length === 0 ? "Todavía no cargaste ubicaciones." : `${ubicaciones.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/ubicaciones"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>
            </div>

            {/* Clasificación — oculta (presets vienen del tipo gastro inferido) */}
            <div className="hidden mt-5 pt-4 border-t border-gray-100">
              <label className={labelClass}>Clasificación</label>
              <div className="flex flex-wrap gap-4 mt-1">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={esVendible}
                    onChange={(e) => setEsVendible(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Vendible (se vende al cliente final)
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={esInsumo}
                    onChange={(e) => setEsInsumo(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Insumo (se usa en recetas)
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Puede ser ambos (producto mixto).
              </p>
            </div>

            {/* Configuración gastronómica — oculta (no relevante en UX simplificada) */}
            <div className="hidden mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">
                Configuración gastronómica
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={controlaStock}
                    onChange={(e) => setControlaStock(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Controlar stock
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={valorizado}
                    onChange={(e) => setValorizado(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Valorizado
                </label>
                <div>
                  <label className={labelClass}>Unidad de compra</label>
                  <input
                    type="text"
                    value={unidadCompra}
                    onChange={(e) => setUnidadCompra(e.target.value)}
                    placeholder='Ej: "Bolsa 25kg"'
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Unidad de receta</label>
                  <input
                    type="text"
                    value={unidadReceta}
                    onChange={(e) => setUnidadReceta(e.target.value)}
                    placeholder='Ej: "g"'
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Factor compra → receta</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={factorCompraReceta}
                    onChange={(e) => setFactorCompraReceta(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Tiempo preparación (min)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={tiempoPrepMinutos}
                    onChange={(e) => setTiempoPrepMinutos(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Ejemplo: Harina se compra por bolsa de 25kg, pero se usa en recetas por gramos. En ese caso unidad compra = bolsa 25kg, unidad receta = g, factor = 25000.
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
              {showPrecioVenta ? "Precios" : "Costo de adquisición"}
            </p>
            <div className={`grid grid-cols-1 gap-6 ${showPrecioVenta ? "sm:grid-cols-3" : ""}`}>
              <div>
                <label className={labelClass}>{showPrecioVenta ? "Costo promedio (Gs.)" : "Costo promedio / adquisición (Gs.)"}</label>
                <MontoInput
                  value={form.costo_promedio}
                  onChange={handleCostoChange}
                  className={inputClass}
                  decimals={false}
                  required
                />
              </div>
              {showPrecioVenta && (
              <div>
                <label className={labelClass}>Markup s/costo (%)</label>
                <input
                  type="number"
                  name="markup"
                  value={form.markup}
                  onChange={handleMarkupChange}
                  className={inputClass}
                  step="0.01"
                />
              </div>
              )}
              <div className={showPrecioVenta ? "" : "hidden"}>
                <label className={labelClass}>Precio de venta (Gs.)</label>
                <MontoInput
                  value={form.precio_venta}
                  onChange={handlePrecioChange}
                  className={inputClass}
                  decimals={false}
                  required={showPrecioVenta}
                />
              </div>
            </div>
            {showPrecioVenta && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Precio mayorista (Gs.) <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <MontoInput
                    value={form.precio_mayorista}
                    onChange={(n) => setForm((prev) => ({ ...prev, precio_mayorista: String(n) }))}
                    placeholder="Ej: 22000"
                    className={inputClass}
                    decimals={false}
                  />
                </div>
                <div>
                  <label className={labelClass}>Cantidad mínima mayorista <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.cantidad_minima_mayorista}
                    onChange={(e) => setForm((prev) => ({ ...prev, cantidad_minima_mayorista: e.target.value }))}
                    placeholder="Ej: 10"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Precio distribuidor (Gs.) <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <MontoInput
                    value={form.precio_distribuidor}
                    onChange={(n) => setForm((prev) => ({ ...prev, precio_distribuidor: String(n) }))}
                    placeholder="Ej: 18000"
                    className={inputClass}
                    decimals={false}
                  />
                </div>
                <p className="sm:col-span-2 text-xs text-gray-400">
                  Precios por canal: en Ventas el cajero elige Minorista, Mayorista o Distribuidor. El precio distribuidor es comercial (no es el costo).
                </p>
                <div className="sm:col-span-2">
                  <label className={labelClass}>IVA aplicado al vender</label>
                  <select
                    value={form.tipo_iva}
                    onChange={(e) => setForm((prev) => ({ ...prev, tipo_iva: e.target.value as TipoIvaProducto }))}
                    className={inputClass}
                  >
                    <option value="10%">IVA 10%</option>
                    <option value="5%">IVA 5%</option>
                    <option value="EXENTA">Exenta</option>
                  </select>
                  <p className="mt-1.5 text-xs text-gray-400">
                    Se copia automáticamente a la línea de venta y a la factura. Cambiarlo acá afecta ventas futuras.
                  </p>
                </div>
              </div>
            )}
            {showPrecioVenta && (
              <MargenPorCanal
                costo={form.costo_promedio}
                canales={[
                  { label: "Minorista", precio: form.precio_venta },
                  { label: "Mayorista", precio: form.precio_mayorista },
                  { label: "Distribuidor", precio: form.precio_distribuidor },
                ]}
              />
            )}
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 ${showStock ? "" : "hidden"}`}>
            <div>
              <label className={labelClass}>Stock actual</label>
              <input
                type="number"
                name="stock_actual"
                value={form.stock_actual}
                onChange={handleChange}
                className={inputClass}
                min={0}
                required={showStock}
              />
              <p className="mt-1 text-xs text-gray-400">
                Para ajustes de stock, preferí registrar un <Link href="/inventario/movimientos/nuevo" className="underline">movimiento</Link>.
              </p>
            </div>
            <div>
              <label className={labelClass}>Stock mínimo</label>
              <input
                type="number"
                name="stock_minimo"
                value={form.stock_minimo}
                onChange={handleChange}
                className={inputClass}
                min={0}
                required={showStock}
              />
            </div>
          </div>

          {/* Control de lote y vencimiento (perecederos). */}
          <div className="border-t border-slate-100 pt-5">
            <label className="inline-flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={controlaLote}
                onChange={(e) => setControlaLote(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="text-sm font-medium text-slate-700">
                  Requiere control de lote y vencimiento
                </span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  Al activar, cada compra pedirá el número de lote y la fecha de
                  vencimiento. Se avisa cuando faltan 15 días o menos.
                </span>
              </span>
            </label>
          </div>

          {/* Método de valuación — oculto en instancia Neura ERP Roldán e Hijos (siempre CPP). */}
          <div className="hidden">
            <label className={labelClass}>Método de valuación</label>
            <select
              name="metodo_valuacion"
              value={form.metodo_valuacion}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="CPP">CPP — Costo Promedio Ponderado</option>
              <option value="FIFO">FIFO — Primero en entrar, primero en salir</option>
              <option value="LIFO">LIFO — Último en entrar, primero en salir</option>
            </select>
          </div>

          {/* Precios por categoría de cliente — panel autónomo, se guarda con su propio botón. */}
          {id && <PreciosCategoriaEditor productoId={id} />}

          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className={`${avisoCodigo ? "bg-amber-600 hover:bg-amber-500" : "bg-gray-900 hover:bg-gray-700"} text-white px-5 py-3 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {submitting ? "Guardando..." : avisoCodigo ? "Guardar de todos modos" : "Guardar cambios"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/inventario")}
              className="border border-gray-300 px-5 py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>

      {id && <ProveedoresCostos productoId={id} />}
      {id && controlaLote && <LotesProducto productoId={id} />}
    </div>
  );
}
