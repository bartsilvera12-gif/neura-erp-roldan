"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import SelectFromList from "@/components/inventario/SelectFromList";
import { MargenPorCanal } from "@/components/inventario/MargenPorCanal";
import CostoDolarDescuento from "@/components/inventario/CostoDolarDescuento";
import { productoExiste, productoPorCodigoBarras, saveProducto } from "@/lib/inventario/storage";
import { useRequireAdmin } from "@/lib/auth/use-require-admin";
import type { MetodoValuacion, TipoIvaProducto } from "@/lib/inventario/types";
// Opciones estándar de unidad de medida para gastro
const UNIDADES_OPCIONES = [
  "UNIDAD","BOLSA","KG","G","LT","ML","CAJA","PAQUETE","DOCENA","LATA","BOTELLA","PORCION","COMBO",
] as const;

interface CatRow { id: string; nombre: string; descuento_pct?: number | null }
interface UbiRow { id: string; nombre: string; tipo: string }
interface ProvRow { id: string; nombre: string }

export default function NuevoProductoPage() {
  const router = useRouter();
  // Alta de productos: solo admin. Un no-admin es redirigido al listado.
  const { isAdmin, loaded: rolCargado } = useRequireAdmin("/inventario");
  const [errorDuplicado, setErrorDuplicado] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Advertencia (no bloquea) de código de barras repetido + confirmación.
  const [avisoCodigo, setAvisoCodigo] = useState<string | null>(null);
  const [confirmarCodigoDup, setConfirmarCodigoDup] = useState(false);

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    sku: "",
    codigo_barras: "",
    costo_promedio: "",
    markup: "",
    // Ficha en dolares y descuentos (script 32). El markup ya se calculaba en
    // pantalla; lo que se agrega es guardarlo, para poder volver a aplicarlo
    // cuando se mueve la cotizacion.
    costo_usd: "",
    descuento_pct: "",
    precio_venta: "",
    precio_mayorista: "",
    precio_distribuidor: "",
    cantidad_minima_mayorista: "",
    stock_actual: "",
    stock_minimo: "",
    unidad_medida: "",
    metodo_valuacion: "CPP" as MetodoValuacion,
    tipo_iva: "10%" as TipoIvaProducto,
  });
  const [submitting, setSubmitting] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);
  const [generandoSku, setGenerandoSku] = useState(false);
  const [skuPatrones, setSkuPatrones] = useState<{ prefix: string; siguiente: string }[]>([]);

  // Relaciones opcionales
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);

  // Clasificación gastronómica
  const [esVendible, setEsVendible] = useState(true);
  const [esInsumo, setEsInsumo] = useState(false);

    type TipoGastro = "reventa" | "menu" | "materia";
  // Roldán e Hijos compra y revende: no fabrica ni maneja insumos, así que el
  // selector de tipo (reventa / menú / materia prima) no tenía sentido acá y se
  // quitó. Queda fijo para no tocar las ramas que dependen de él.
  const tipoGastro: TipoGastro = "reventa";

  // Configuración gastronómica
  const [controlaStock, setControlaStock] = useState(true);

  // Sincroniza los flags internos cuando cambia el tipo gastronómico.
  // Reventa: vendible + stock; Menú (preparado al vender): vendible sin stock;
  // Materia prima: insumo con stock, no vendible al cliente.
  useEffect(() => {
    if (tipoGastro === "reventa") {
      setEsVendible(true); setEsInsumo(false); setControlaStock(true);
    } else if (tipoGastro === "menu") {
      setEsVendible(true); setEsInsumo(false); setControlaStock(false);
    } else if (tipoGastro === "materia") {
      setEsVendible(false); setEsInsumo(true); setControlaStock(true);
    }
  }, [tipoGastro]);
  // Control de lotes y vencimientos. Por defecto apagado — se enciende en
  // productos perecederos (alimentos, medicamentos, etc.).
  const [controlaLote, setControlaLote] = useState(false);
  const [valorizado, setValorizado] = useState(true);
  const [unidadCompra, setUnidadCompra] = useState("");
  const [unidadReceta, setUnidadReceta] = useState("");
  const [factorCompraReceta, setFactorCompraReceta] = useState("1");
  const [tiempoPrepMinutos, setTiempoPrepMinutos] = useState("0");
  const [categorias, setCategorias] = useState<CatRow[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbiRow[]>([]);
  const [proveedores, setProveedores] = useState<ProvRow[]>([]);

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

  /** Cuál de los tres "+ Crear" está abierto. */
  const [crear, setCrear] = useState<"categoria" | "proveedor" | "deposito" | null>(null);

  /** Relee los depósitos sin recargar la página. */
  async function recargarUbicaciones() {
    try {
      const r = await fetch("/api/inventario/ubicaciones", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (r.ok && j?.success && j.data?.ubicaciones) setUbicaciones(j.data.ubicaciones as UbiRow[]);
    } catch { /* si falla, queda la lista que ya estaba */ }
  }

  /** Relee los proveedores sin recargar la página. */
  async function recargarProveedores() {
    try {
      const r = await fetch("/api/proveedores", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (r.ok && j?.success && j.data?.proveedores) setProveedores(j.data.proveedores as ProvRow[]);
    } catch { /* si falla, queda la lista que ya estaba */ }
  }

  /** Relee los rubros sin recargar la página, para el botón "Recargar". */
  async function recargarCategorias() {
    try {
      const r = await fetch("/api/inventario/categorias", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (r.ok && j?.success && j.data?.categorias) setCategorias(j.data.categorias as CatRow[]);
    } catch { /* si falla, queda la lista que ya estaba */ }
  }

  // Imagen pendiente de subir (se sube luego de crear el producto, con su ID).
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [imagenError, setImagenError] = useState<string | null>(null);

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  const MAX_IMG_BYTES = 5 * 1024 * 1024;

  function handleImagenChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImagenError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setImagenFile(null);
      setImagenPreview(null);
      return;
    }
    if (!ALLOWED_MIME.includes(f.type)) {
      setImagenError("Formato no permitido. Usá JPG, PNG o WebP.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_IMG_BYTES) {
      setImagenError("Imagen demasiado grande (máx. 5 MB).");
      e.target.value = "";
      return;
    }
    setImagenFile(f);
    setImagenPreview(URL.createObjectURL(f));
  }

  function quitarImagen() {
    setImagenFile(null);
    setImagenPreview(null);
    setImagenError(null);
  }

  // Patrones de SKU según el tipo elegido (para "Generar SKU" y el dropdown).
  useEffect(() => {
    if (!tipoGastro) return;
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
      const res = await fetch(`/api/productos/sku-sugerencias?tipo=${tipoGastro ?? "reventa"}`, {
        credentials: "include",
        cache: "no-store",
      });
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
    e.target.value = ""; // volver al placeholder del dropdown
  }

  /** Genera un código de barras REAL (EAN-13) escaneable. */
  async function handleGenerarCodigoBarras() {
    if (generandoCodigo) return;
    setGenerandoCodigo(true);
    setErrorDuplicado(null);
    setErrorGeneral(null);
    try {
      const res = await fetch("/api/productos/codigo-barras", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.codigo) {
        setForm((prev) => ({ ...prev, codigo_barras: json.data.codigo as string }));
      } else {
        setErrorGeneral(json?.error ?? "No se pudo generar el código de barras.");
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "Error de red");
    } finally {
      setGenerandoCodigo(false);
    }
  }

  // Campos sin lógica reactiva
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    if (e.target.name === "codigo_barras") {
      // Al cambiar el código se descarta la advertencia previa: el nuevo valor
      // se vuelve a chequear al guardar.
      setAvisoCodigo(null);
      setConfirmarCodigoDup(false);
    }
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  /**
   * Al cambiar costo: NO movemos el precio (es lo que el cliente paga).
   * Recalculamos markup a partir del gap precio-costo cuando ambos son válidos.
   */
  function handleCostoChange(costo: number) {
    setErrorDuplicado(null);
    const precio = parseFloat(form.precio_venta);

    if (!isNaN(costo) && costo > 0 && !isNaN(precio) && precio > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({
        ...prev,
        costo_promedio: String(costo),
        markup: nuevoMarkup.toFixed(2),
      }));
    } else {
      setForm((prev) => ({ ...prev, costo_promedio: String(costo) }));
    }
  }

  /**
   * Al cambiar markup → recalcula precio_venta (permite markup negativo = venta a pérdida)
   */
  function handleMarkupChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorDuplicado(null);
    const markup = parseFloat(e.target.value);
    const costo = parseFloat(form.costo_promedio);

    if (!isNaN(markup) && !isNaN(costo) && costo > 0) {
      const nuevoPrecio = costo * (1 + markup / 100);
      setForm((prev) => ({
        ...prev,
        markup: e.target.value,
        precio_venta: nuevoPrecio.toFixed(0),
      }));
    } else {
      setForm((prev) => ({ ...prev, markup: e.target.value }));
    }
  }

  /**
   * Al cambiar precio → recalcula markup (puede resultar negativo si precio < costo)
   */
  function handlePrecioChange(precio: number) {
    setErrorDuplicado(null);
    const costo = parseFloat(form.costo_promedio);

    if (!isNaN(precio) && !isNaN(costo) && costo > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({
        ...prev,
        precio_venta: String(precio),
        markup: nuevoMarkup.toFixed(2),
      }));
    } else {
      setForm((prev) => ({ ...prev, precio_venta: String(precio) }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    console.log("[inventario/nuevo] handleSubmit start", { tipoGastro });
    if (submitting) return;
    setErrorDuplicado(null);
    setErrorGeneral(null);
    setSubmitting(true);

    const showErr = (msg: string) => {
      setErrorGeneral(msg);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };

    const showAviso = (msg: string) => {
      setAvisoCodigo(msg);
      setConfirmarCodigoDup(true);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };

    try {
      // Validaciones básicas en JS (HTML5 desactivado con noValidate).
      const nombreT = form.nombre.trim();
      if (!nombreT) { showErr("El nombre es obligatorio."); return; }
      // SKU opcional para todos los tipos. Si viene vacío, el backend puede
      // autogenerar uno o dejarlo null (ver saveProducto).

      // Código de barras: se guarda tal cual (escaneable). Vacío → null (sin barcode).
      const codigoEnInput = form.codigo_barras.trim();

      // Pre-chequeo duplicado tolerante a fallos de red.
      try {
        const duplicado = await productoExiste(form.sku, form.nombre);
        if (duplicado) {
          setErrorDuplicado(`Ya existe "${duplicado.nombre}" con SKU ${duplicado.sku}.`);
          try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
          return;
        }
      } catch (err) {
        console.warn("[inventario/nuevo] productoExiste failed, ignorando:", err);
      }

      // Advertencia (no bloquea) de código de barras repetido. Si otro producto
      // ya usa el mismo código, avisamos y pedimos confirmación: al segundo
      // intento (confirmarCodigoDup=true) se guarda igual.
      if (codigoEnInput && !confirmarCodigoDup) {
        try {
          const dupCod = await productoPorCodigoBarras(codigoEnInput);
          if (dupCod) {
            showAviso(
              `Ya existe "${dupCod.nombre}" (SKU ${dupCod.sku}) con el código de barras ${codigoEnInput}. Podés guardar igual si es a propósito.`
            );
            return;
          }
        } catch (err) {
          console.warn("[inventario/nuevo] chequeo código de barras falló, ignorando:", err);
        }
      }

      const codigo: string | null = codigoEnInput || null;
      const interno = false; // ya no se autogeneran códigos internos; el barcode es real

      let guardado;
      try {
        guardado = await saveProducto({
          nombre: form.nombre.trim().toUpperCase(),
          descripcion: form.descripcion.trim() || null,
          sku: form.sku.trim().toUpperCase(),
          costo_promedio: parseFloat(form.costo_promedio) || 0,
          precio_venta: parseFloat(form.precio_venta) || 0,
          precio_mayorista: form.precio_mayorista.trim() !== "" ? parseFloat(form.precio_mayorista) || null : null,
          precio_distribuidor: form.precio_distribuidor.trim() !== "" ? parseFloat(form.precio_distribuidor) || null : null,
          costo_usd: form.costo_usd.trim() !== "" ? parseFloat(form.costo_usd) || null : null,
          markup_pct: form.markup.trim() !== "" ? parseFloat(form.markup) : null,
          descuento_pct: form.descuento_pct.trim() !== "" ? parseFloat(form.descuento_pct) || 0 : 0,
          cantidad_minima_mayorista: form.cantidad_minima_mayorista.trim() !== "" ? parseFloat(form.cantidad_minima_mayorista) || null : null,
          stock_actual: parseInt(form.stock_actual) || 0,
          stock_minimo: parseInt(form.stock_minimo) || 0,
          unidad_medida: form.unidad_medida.trim().toUpperCase(),
          metodo_valuacion: form.metodo_valuacion,
          codigo_barras: codigo,
          codigo_barras_interno: interno,
          categoria_principal_id: categoriaId,
          ubicacion_principal_id: ubicacionId,
          proveedor_principal_id: proveedorId,
          // tipo_gastro va como campo autoritativo — el API forza los flags según este valor.
          tipo_gastro: tipoGastro,
          es_vendible: esVendible,
          es_insumo: esInsumo,
          controla_stock: controlaStock,
          controla_lote: controlaLote,
          valorizado: valorizado,
          unidad_compra: unidadCompra.trim() || null,
          unidad_receta: unidadReceta.trim() || null,
          factor_compra_receta: Math.max(parseFloat(factorCompraReceta) || 1, 0.0001),
          tiempo_prep_minutos: Math.max(parseInt(tiempoPrepMinutos) || 0, 0),
          tipo_iva: form.tipo_iva,
        });
      } catch (err) {
        console.error("[inventario/nuevo] saveProducto error:", err);
        showErr(err instanceof Error ? err.message : "No se pudo guardar el producto.");
        return;
      }

      if (!guardado) {
        showErr("No se pudo guardar el producto. Revisá los datos e intentá nuevamente.");
        return;
      }

      // Subir imagen (post-creacion, con producto_id real)
      if (imagenFile) {
        try {
          const fd = new FormData();
          fd.append("file", imagenFile);
          const up = await fetch(`/api/productos/${guardado.id}/imagen`, {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const upJson = await up.json();
          if (!up.ok || !upJson?.success) {
            // Producto creado, imagen falló. No perder el producto: ir a editar con aviso.
            const msg = upJson?.error ?? "No se pudo subir la imagen.";
            alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
            router.push(`/inventario/${guardado.id}/editar`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Error de red";
          alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
          router.push(`/inventario/${guardado.id}/editar`);
          return;
        }
      }

      router.push("/inventario");
    } catch (err) {
      console.error("[inventario/nuevo] handleSubmit error:", err);
      showErr(err instanceof Error ? err.message : "No se pudo guardar el producto.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
  const labelClass = "block text-sm font-medium text-slate-700 mb-2";

  // Todo producto acá se compra y se revende: maneja stock y tiene precio.
  const showStock = true;
  const showPrecioVenta = true;

  // Mientras se resuelve el rol, o si no es admin (será redirigido), no se
  // muestra el formulario de alta.
  if (!rolCargado || !isAdmin) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
        <p className="text-gray-500 animate-pulse">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
        <p className="text-gray-600">Producto de reventa · se compra y se vende tal cual.</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-5xl">
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>

          {/* Error general (validacion de codigo, duplicado de codigo barras, etc.) */}
          {errorGeneral && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorGeneral}</p>
            </div>
          )}

          {/* Error de duplicado (mismo SKU o mismo nombre) */}
          {errorDuplicado && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
              <p className="text-sm font-semibold text-red-700">
                Este producto ya existe en el inventario.
              </p>
              <p className="text-xs text-red-600">{errorDuplicado}</p>
              <p className="text-xs text-red-500">
                Para modificar su stock debés registrar un movimiento de inventario.
              </p>
              <Link
                href="/inventario/movimientos"
                className="inline-block mt-2 text-xs text-red-700 underline hover:text-red-900"
              >
                Ir a Movimientos →
              </Link>
            </div>
          )}

          {/* Advertencia (no bloquea) de código de barras repetido */}
          {avisoCodigo && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800">⚠️ Código de barras repetido</p>
              <p className="mt-1 text-sm text-amber-700">{avisoCodigo}</p>
              <p className="mt-1 text-xs text-amber-600">
                Volvé a tocar “Guardar de todos modos” para confirmar, o cambiá el código.
              </p>
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className={labelClass}>Nombre del producto</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Ej: HAMBURGUESA CASERA"
              className={`${inputClass} uppercase`}
              required
            />
          </div>

          {/* Descripción */}
          <div>
            <label className={labelClass}>Descripción</label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              placeholder="Descripción opcional del producto"
              rows={2}
              className={inputClass}
            />
          </div>

          {/* SKU + Unidad de medida */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>
                SKU interno <span className="text-xs font-normal text-gray-400 ml-1">(opcional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  placeholder="Ej: REV-0001"
                  className={`${inputClass} uppercase flex-1`}
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

            <div>
              <label className={labelClass}>Unidad de medida</label>
              <select
                name="unidad_medida"
                value={form.unidad_medida}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
                required
              >
                {UNIDADES_OPCIONES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Código de barras (escaneable, separado del SKU) */}
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
                autoComplete="off"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={handleGenerarCodigoBarras}
                disabled={generandoCodigo}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generandoCodigo ? "Generando…" : "Generar código de barras"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              Código escaneable para lector o etiqueta (EAN-13). Si se repite, avisa pero deja guardar. <span className="italic">(opcional)</span>
            </p>
          </div>

          {/* Imagen del producto */}
          <div>
            <label className={labelClass}>Imagen del producto</label>
            <div className="flex items-start gap-4">
              <div className="w-28 h-28 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {imagenPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenPreview} alt="Vista previa" className="w-full h-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-slate-300">
                    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors">
                    {imagenFile ? "Cambiar imagen" : "Seleccionar imagen"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImagenChange}
                    />
                  </label>
                  {imagenFile && (
                    <button
                      type="button"
                      onClick={quitarImagen}
                      className="text-sm text-red-600 hover:text-red-800 px-3 py-2 rounded-lg border border-slate-200 hover:bg-red-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  JPG, PNG o WebP — máx. 5 MB. Se asociará al producto al guardarlo.
                </p>
                {imagenError && (
                  <p className="mt-1.5 text-xs text-red-600">{imagenError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Costo (+ Markup + Precio en productos comerciales) — bloque reactivo */}
          <div>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
              {showPrecioVenta ? "Precios — los tres campos son reactivos entre sí" : "Costo de adquisición"}
            </p>
            <div className={`grid grid-cols-1 gap-6 ${showPrecioVenta ? "sm:grid-cols-3" : ""}`}>

              <div>
                <label className={labelClass}>{showPrecioVenta ? "Costo promedio (Gs.)" : "Costo promedio / adquisición (Gs.)"}</label>
                <MontoInput
                  value={form.costo_promedio}
                  onChange={handleCostoChange}
                  placeholder="Ej: 52000"
                  className={inputClass}
                  decimals={false}
                  required
                />
              </div>

              {showPrecioVenta && (
              <div>
                <label className={labelClass}>Markup s/costo (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    name="markup"
                    value={form.markup}
                    onChange={handleMarkupChange}
                    placeholder="Ej: 50.00"
                    className={`${inputClass} pr-8`}
                    step="0.01"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
                    %
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-gray-400">(precio − costo) / costo</p>
              </div>
              )}

              <div className={showPrecioVenta ? "" : "hidden"}>
                <label className={labelClass}>Precio de venta (Gs.)</label>
                <MontoInput
                  value={form.precio_venta}
                  onChange={handlePrecioChange}
                  placeholder="Ej: 78000"
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

            {/* Rentabilidad por canal en tiempo real (no aplica a materia prima) */}
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

            {showPrecioVenta && (
              <CostoDolarDescuento
                costoUsd={form.costo_usd}
                onCostoUsdChange={(v) => setForm((prev) => ({ ...prev, costo_usd: v }))}
                descuentoPct={form.descuento_pct}
                onDescuentoChange={(v) => setForm((prev) => ({ ...prev, descuento_pct: v }))}
                descuentoRubro={categorias.find((c) => c.id === categoriaId)?.descuento_pct ?? null}
                costoGs={form.costo_promedio}
                precioGs={form.precio_venta}
                markupPct={form.markup}
                onUsarCostoGs={(gs) => handleCostoChange(gs)}
                disabled={submitting}
              />
            )}
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
              {/* Rubro — 4 cols */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Rubro principal</label>
                <SelectFromList
                  value={categoriaId}
                  onChange={setCategoriaId}
                  options={categorias.map((c) => ({ id: c.id, label: c.nombre }))}
                  emptyShort="Sin rubros"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {categorias.length === 0 ? "Todavía no cargaste rubros." : `${categorias.length} disponibles`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCrear("categoria")}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-sky-200 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50 hover:text-sky-900"
                  >
                    + Crear
                  </button>
                </div>
              </div>

              {/* Proveedor — 4 cols. */}
              <div className="md:col-span-4 min-w-0">
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
                  <button
                    type="button"
                    onClick={() => setCrear("proveedor")}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-sky-200 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50 hover:text-sky-900"
                  >
                    + Crear
                  </button>
                </div>
              </div>

              {/* Ubicación principal / Depósito donde entra el stock inicial. */}
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
                  <button
                    type="button"
                    onClick={() => setCrear("deposito")}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-sky-200 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50 hover:text-sky-900"
                  >
                    + Crear
                  </button>
                </div>
              </div>
            </div>

            {/* Clasificación gastronómica — oculta (presets aplicados por el tipo seleccionado) */}
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
                Puede ser ambos (producto mixto). Por defecto: vendible.
              </p>
            </div>

            {/* Configuración gastronómica — oculta (campos técnicos no necesarios en UX gastro simplificada) */}
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

          {/* Control de lotes y vencimientos — para productos perecederos.
              Se guarda como productos.controla_lote y habilita la sección de
              lotes en el detalle y los campos de lote/vencimiento en compras. */}
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
                  Al activar esta opción, cada compra pedirá el número de lote y la
                  fecha de vencimiento. Se avisa cuando faltan 15 días o menos.
                </span>
              </span>
            </label>
          </div>

          {/* Stock actual + Stock mínimo — solo para Reventa (Menú/Materia no controlan stock en UX simple) */}
          <div className={showStock ? "" : "hidden"}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Stock actual</label>
                <input
                  type="number"
                  name="stock_actual"
                  value={form.stock_actual}
                  onChange={handleChange}
                  placeholder="Ej: 50"
                  className={inputClass}
                  min={0}
                  required={showStock}
                />
              </div>

              <div>
                <label className={labelClass}>Stock mínimo</label>
                <input
                  type="number"
                  name="stock_minimo"
                  value={form.stock_minimo}
                  onChange={handleChange}
                  placeholder="Ej: 10"
                  className={inputClass}
                  min={0}
                  required={showStock}
                />
              </div>
            </div>
            {parseInt(form.stock_actual) > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Se generará automáticamente un movimiento de inventario inicial con {form.stock_actual} unidades al guardar.
              </p>
            )}
          </div>

          {/* Método de valuación — oculto en instancia Neura ERP Roldán e Hijos.
              Se mantiene siempre 'CPP' (default del state form.metodo_valuacion) y se envía al backend tal cual. */}
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

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className={`${avisoCodigo ? "bg-amber-600 hover:bg-amber-500" : "bg-[#0EA5E9] hover:bg-[#0284C7]"} text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {submitting ? "Guardando..." : avisoCodigo ? "Guardar de todos modos" : "Guardar producto"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/inventario")}
              className="border border-slate-200 px-5 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

      {crear && (
        <ModalCrearRapido
          tipo={crear}
          onClose={() => setCrear(null)}
          onCreado={async (id) => {
            // Se recarga la lista y se deja elegido lo recién creado, que es
            // para lo que se abrió el modal.
            if (crear === "categoria") { await recargarCategorias(); setCategoriaId(id); }
            if (crear === "proveedor") { await recargarProveedores(); setProveedorId(id); }
            if (crear === "deposito")  { await recargarUbicaciones(); setUbicacionId(id); }
            setCrear(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Alta rápida de rubro, proveedor o depósito sin salir del formulario.
 *
 * Antes cada "+ Crear" era un link: en la misma pestaña se perdía todo lo
 * cargado del producto, y en otra pestaña había que volver y recargar a mano.
 * Acá se crea, se recarga la lista y queda elegido, que es lo único que se
 * quería hacer.
 *
 * Solo pide el nombre. El resto de los campos de cada entidad se completan
 * después desde su propia pantalla: este atajo existe para no cortar la carga
 * del producto, no para reemplazar esas pantallas.
 */
function ModalCrearRapido({
  tipo, onClose, onCreado,
}: {
  tipo: "categoria" | "proveedor" | "deposito";
  onClose: () => void;
  onCreado: (id: string) => void | Promise<void>;
}) {
  const CONFIG = {
    categoria: { titulo: "Nuevo rubro", label: "Nombre del rubro", url: "/api/inventario/categorias", clave: "categoria" },
    proveedor: { titulo: "Nuevo proveedor", label: "Razón social / nombre",  url: "/api/proveedores",            clave: "proveedor" },
    deposito:  { titulo: "Nuevo depósito",  label: "Nombre del depósito",    url: "/api/inventario/ubicaciones", clave: "ubicacion" },
  } as const;
  const cfg = CONFIG[tipo];

  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function guardar() {
    const n = nombre.trim();
    if (!n) { setErr("Escribí un nombre."); return; }
    setGuardando(true);
    setErr(null);
    try {
      const r = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nombre: n }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setErr(j?.error ?? "No se pudo crear."); return; }
      const creado = (j.data?.[cfg.clave] ?? j.data) as { id?: string } | undefined;
      if (!creado?.id) { setErr("Se creó, pero no se pudo seleccionar. Elegilo de la lista."); return; }
      await onCreado(String(creado.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-800">{cfg.titulo}</h3>
          <button type="button" onClick={onClose} className="text-lg leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
        )}

        <label className="text-[11px] font-semibold uppercase text-slate-500">{cfg.label}</label>
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void guardar(); } }}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          maxLength={120}
        />

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Creando…" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}
