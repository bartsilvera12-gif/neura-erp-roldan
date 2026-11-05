"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Search } from "lucide-react";
import ModalCampo from "@/components/ui/ModalCampo";
import EditarRubroModal from "@/components/inventario/EditarRubroModal";
import ModalConfirmarAccion from "@/components/ui/ModalConfirmarAccion";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImprimirTablaButton from "@/components/ui/ImprimirTablaButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import Selector from "@/components/ui/Selector";

interface Categoria {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
  /** Punto 1.3: días bajo los cuales el rubro es crítico. null = umbral general. */
  dias_critico?: number | null;
  descuento_pct?: number | null;
  /** Remarcación de referencia del rubro, en % (script 56). */
  markup_pct?: number | null;
}

/**
 * Lo que muestra un GRUPO en las columnas de política del rubro (crítico,
 * remarcación, descuento).
 *
 * ── POR QUÉ NO SE EDITA ACÁ ───────────────────────────────────────────────
 * Estas tres son del rubro mayor: "un rubro tiene la misma remarcación para
 * todos sus grupos". Dejar el lápiz en cada grupo invita a cargar nueve
 * números distintos donde debería haber uno, que es justo el desorden que se
 * quiso sacar. Se editan en el padre y los grupos muestran lo que les toca.
 *
 * ── PERO NO SE TAPA UN VALOR PROPIO ───────────────────────────────────────
 * Hoy hay grupos con su propio valor distinto al del padre: CHAPA ACANALADA
 * COLOR está al 24% y su padre al 16%. Mostrar el del padre a secas sería
 * decir un número que no es el que está guardado. Cuando el grupo tiene uno
 * propio se muestra ESE, marcado como propio, con el del padre al lado. Así se
 * ve dónde falta emparejar en vez de esconderlo.
 */
function ValorDelPadre({
  propio,
  delPadre,
  sufijo = "",
  vacio = "—",
  resaltar = false,
}: {
  propio: number | null | undefined;
  delPadre: number | null | undefined;
  sufijo?: string;
  vacio?: string;
  resaltar?: boolean;
}) {
  const tieneP = propio != null;
  const tieneH = delPadre != null;
  const difiere = tieneP && tieneH && Number(propio) !== Number(delPadre);

  if (!tieneP && !tieneH) {
    return <span className="px-2 text-xs text-slate-300">{vacio}</span>;
  }

  if (difiere) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 text-xs"
        title={`Este grupo tiene ${propio}${sufijo} propio; su rubro está en ${delPadre}${sufijo}. Para emparejarlos, cambialo en el rubro padre.`}
      >
        <span className={`font-semibold tabular-nums ${resaltar ? "text-emerald-700" : "text-amber-700"}`}>
          {propio}{sufijo}
        </span>
        <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-800">
          propio
        </span>
      </span>
    );
  }

  return (
    <span className="px-2 text-xs tabular-nums text-slate-400">
      {tieneP ? propio : delPadre}{sufijo}
    </span>
  );
}

export default function CategoriasProductosPage() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<Categoria[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "activos" | "inactivos">("todos");
  const [soloConDescuento, setSoloConDescuento] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form alta
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // `no-store`: sin esto el navegador sirve la lista guardada y los
      // cambios hechos por SQL no se ven hasta vaciar la cache.
      const r = await fetch("/api/inventario/categorias?todas=1", {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok && j?.success) setItems(j.data.categorias as Categoria[]);
      else setError(j?.error ?? "No se pudo cargar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          parent_id: parentId || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear.");
      } else {
        setNombre(""); setCodigo(""); setParentId("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(cat: Categoria) {
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ activo: !cat.activo }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  /**
   * Borrar es la única acción de esta pantalla que no se deshace, así que la
   * confirmación no va por `window.confirm`: ese cuadro se parece a los
   * avisos que uno descarta todo el día y se acepta de memoria.
   */
  const [aBorrar, setABorrar] = useState<Categoria | null>(null);

  async function eliminar(cat: Categoria) {
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo borrar.");
    setABorrar(null);
    load();
  }

  /**
   * Los tres campos que se editan de a uno —nombre, días críticos y
   * descuento— comparten modal. Cada uno define su texto, su validación y qué
   * manda al servidor; el modal pone la caja, el foco y el error.
   *
   * Antes eran `window.prompt`. Ese cuadro no se puede maquillar: sale con el
   * título "roldanehijos.neura.com.py dice" y los colores del sistema. Y si
   * el valor estaba mal había que avisar con otro cuadro, perdiendo lo
   * escrito; acá el error se muestra adentro y el texto queda.
   */
  type CampoEnEdicion = {
    cat: Categoria;
    titulo: string;
    descripcion: string;
    etiqueta: string;
    valorInicial: string;
    sufijo?: string;
    tipo: "text" | "number";
    ayuda: string;
    validar: (v: string) => string | null;
    cuerpo: (v: string) => Record<string, unknown>;
  };
  const [campo, setCampo] = useState<CampoEnEdicion | null>(null);
  const [editando, setEditando] = useState<Categoria | null>(null);
  /** Rubros padre plegados. Vacío = todos abiertos. */
  const [plegados, setPlegados] = useState<Set<string>>(new Set());

  function alternarPlegado(id: string) {
    setPlegados((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });
  }

  /**
   * Lo que se ve en la tabla. Los rubros se acumulan —los de proveedor se
   * importan solos— y a la vuelta de unos meses la lista no entra en pantalla,
   * así que se busca por nombre, código y rubro padre: no siempre uno recuerda
   * por cuál de los tres lo cargó.
   */
  const coincide = useCallback(
    (c: Categoria) => {
      const q = busqueda.trim().toLowerCase();
      if (filtroEstado === "activos" && !c.activo) return false;
      if (filtroEstado === "inactivos" && c.activo) return false;
      if (soloConDescuento && !(Number(c.descuento_pct ?? 0) > 0)) return false;
      if (!q) return true;
      const padre = items.find((i) => i.id === c.parent_id)?.nombre ?? "";
      return (
        c.nombre.toLowerCase().includes(q) ||
        (c.codigo ?? "").toLowerCase().includes(q) ||
        padre.toLowerCase().includes(q)
      );
    },
    [items, busqueda, filtroEstado, soloConDescuento]
  );

  /**
   * Los rubros ordenados como árbol: cada padre seguido de sus grupos.
   *
   * ── POR QUÉ NO ALFABÉTICO A SECAS ─────────────────────────────────────
   * Con los 70 rubros en una lista plana, los cuatro caños quedaban separados
   * por CEMENTO y las chapas desparramadas entre medio: para saber qué cuelga
   * de qué había que leer la columna Padre renglón por renglón. Anidados se ve
   * de un vistazo, y la columna Padre deja de hacer falta.
   *
   * ── BUSCANDO SE APLANA ────────────────────────────────────────────────
   * Si hay búsqueda o filtro, se muestran las coincidencias sueltas: esconder
   * un grupo porque su padre no coincide sería no encontrarlo. Ahí sí se
   * muestra de qué rubro es, porque sin el anidado no se vería.
   *
   * Un grupo cuyo padre no está en la lista se trata como raíz en vez de
   * desaparecer.
   */
  const hayFiltro =
    busqueda.trim() !== "" || filtroEstado !== "todos" || soloConDescuento;

  const filas = useMemo(() => {
    const porNombre = (a: Categoria, b: Categoria) => a.nombre.localeCompare(b.nombre, "es");

    if (hayFiltro) {
      return items.filter(coincide).sort(porNombre).map((c) => ({ cat: c, nivel: 0, hijos: 0 }));
    }

    const existe = new Set(items.map((i) => i.id));
    const hijosDe = new Map<string, Categoria[]>();
    const raices: Categoria[] = [];
    for (const c of items) {
      const padre = c.parent_id && existe.has(c.parent_id) ? c.parent_id : null;
      if (padre) {
        const l = hijosDe.get(padre) ?? [];
        l.push(c);
        hijosDe.set(padre, l);
      } else {
        raices.push(c);
      }
    }

    const salida: Array<{ cat: Categoria; nivel: number; hijos: number }> = [];
    const vistos = new Set<string>();
    const bajar = (lista: Categoria[], nivel: number) => {
      for (const c of [...lista].sort(porNombre)) {
        if (vistos.has(c.id)) continue;
        vistos.add(c.id);
        const hijos = hijosDe.get(c.id) ?? [];
        salida.push({ cat: c, nivel, hijos: hijos.length });
        // Un padre plegado no muestra sus grupos, pero sigue diciendo cuántos.
        if (hijos.length > 0 && !plegados.has(c.id)) bajar(hijos, nivel + 1);
      }
    };
    bajar(raices, 0);
    return salida;
  }, [items, coincide, hayFiltro, plegados]);

  /** Para el Excel y el contador, que no les importa el anidado. */
  const visibles = useMemo(() => items.filter(coincide), [items, coincide]);

  /** Los rubros que tienen grupos adentro, para el botón de abrir/cerrar todos. */
  const padresConHijos = useMemo(() => {
    const conHijos = new Set<string>();
    for (const c of items) if (c.parent_id) conHijos.add(c.parent_id);
    return items.filter((c) => conHijos.has(c.id)).map((c) => c.id);
  }, [items]);

  async function guardarCampo(valor: string) {
    if (!campo) return;
    const r = await fetch(`/api/inventario/categorias/${campo.cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(campo.cuerpo(valor.trim())),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
    setCampo(null);
    load();
  }

  /**
   * Días de cobertura crítica del rubro (punto 1.3).
   *
   * Vacío lo deja sin configurar, que es distinto de cero: significa "usá el
   * umbral general de Reposición".
   */
  function editarDiasCritico(cat: Categoria) {
    setCampo({
      cat,
      titulo: `Crítico bajo · ${cat.nombre}`,
      descripcion: "Días de stock por debajo de los cuales este rubro se marca CRÍTICO en Reposición.",
      etiqueta: "Días",
      valorInicial: cat.dias_critico == null ? "" : String(cat.dias_critico),
      sufijo: "días",
      tipo: "number",
      ayuda: "En la práctica es lo que tarda reponerlo: si la chapa tarda 15 días, poné 15. Vacío usa el umbral general.",
      validar: (v) => {
        const t = v.trim();
        if (t === "") return null;
        const n = Number(t);
        if (!Number.isFinite(n) || n < 1 || n > 365) return "Tiene que ser un número entre 1 y 365.";
        return null;
      },
      cuerpo: (v) => ({ dias_critico: v === "" ? null : Number(v) }),
    });
  }

  /**
   * "Desc. Grupo %" (script 32): descuento que aplica a todos los artículos
   * del rubro.
   *
   * Un artículo con descuento propio REEMPLAZA a éste; no se suman. Con la
   * suma, un artículo al 5% dentro de un rubro al 4% saldría al 9%, que no es
   * lo que nadie quiso decir al cargar los dos.
   */
  /**
   * La remarcación de referencia del rubro.
   *
   * ── NO CAMBIA NINGÚN PRECIO ──────────────────────────────────────────────
   * Es el porcentaje del grupo: el que se le propone a un producto nuevo de
   * este rubro, y el que heredan las subcategorías que no tengan el suyo. Los
   * productos que ya existen quedan con el precio que tienen: cambiar esto no
   * los toca.
   *
   * Unificar los que ya existen a este número es otra cosa, y se hace aparte
   * (script 57) justamente porque eso sí mueve plata.
   */
  function editarRemarcacionRubro(cat: Categoria) {
    const padre = items.find((i) => i.id === cat.parent_id);
    setCampo({
      cat,
      titulo: `Remarcación · ${cat.nombre}`,
      descripcion:
        padre && padre.markup_pct != null
          ? `Si se deja vacío, este grupo usa la de ${padre.nombre} (${padre.markup_pct}%).`
          : "Es el porcentaje con el que se carga un producto nuevo de este rubro.",
      etiqueta: "Remarcación",
      valorInicial: cat.markup_pct == null ? "" : String(cat.markup_pct),
      sufijo: "%",
      tipo: "number",
      ayuda:
        "No cambia el precio de los productos que ya están cargados: es el valor de referencia del rubro.",
      validar: (v) => {
        const t = v.trim().replace(",", ".");
        if (t === "") return null;
        const n = Number(t);
        if (!Number.isFinite(n) || n < 0) return "Tiene que ser un número mayor o igual a cero.";
        return null;
      },
      cuerpo: (v) => {
        const t = v.replace(",", ".");
        return { markup_pct: t === "" ? null : Number(t) };
      },
    });
  }

  function editarDescuentoRubro(cat: Categoria) {
    setCampo({
      cat,
      titulo: `Descuento máximo · ${cat.nombre}`,
      descripcion:
        "Hasta cuánto se puede descontar cualquier artículo del rubro que no tenga su propio tope. " +
        "No es un descuento que se aplique solo: en la venta el precio sigue siendo el de lista.",
      etiqueta: "Descuento máximo",
      valorInicial: cat.descuento_pct ? String(cat.descuento_pct) : "",
      sufijo: "%",
      tipo: "number",
      ayuda: "Un artículo con su propio tope usa el suyo, no la suma de los dos. Vacío o cero deja el rubro sin tope, y entonces vale solo el tope de cada usuario.",
      validar: (v) => {
        const t = v.trim().replace(",", ".");
        if (t === "") return null;
        const n = Number(t);
        if (!Number.isFinite(n) || n < 0 || n > 100) return "Tiene que ser un número entre 0 y 100.";
        return null;
      },
      cuerpo: (v) => {
        const t = v.replace(",", ".");
        return { descuento_pct: t === "" ? 0 : Number(t) };
      },
    });
  }

  /**
   * El lápiz abre el rubro ENTERO.
   *
   * Antes abría "Renombrar rubro", con el nombre y nada más: el código, la
   * descripción, de quién cuelga y si está activo no se podían tocar desde
   * ninguna pantalla. Los tres números siguen teniendo su atajo haciendo clic
   * en la columna, que sirve para corregir uno solo sin abrir todo.
   */
  function startEdit(cat: Categoria) {
    setEditando(cat);
  }


  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Rubros de productos</h1>
          <p className="text-gray-600">Clasificá tus productos para reportes y búsqueda.</p>
          {/* Las dos columnas configurables no se descubren solas: el valor
              parece un dato de la fila y no un control. Se dice en una línea
              en vez de esperar que alguien pruebe hacerle clic. */}
          <p className="mt-1 text-xs text-slate-500">
            Las columnas <strong>Crítico bajo</strong> y <strong>Descuento máx.</strong> se
            configuran haciendo clic sobre su valor, rubro por rubro.
          </p>
          <div className="mt-3 max-w-2xl rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Estos rubros aparecen en el selector <strong>Rubro principal</strong> de Nuevo producto.
            Los <Link href="/proveedores/categorias" className="underline font-medium">rubros de proveedor</Link>{" "}
            también se importan automáticamente acá, así no tenés que cargarlos dos veces.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-start gap-2">
            <ExportExcelButton url="/api/inventario/categorias/export" />
            <ImprimirTablaButton
            titulo="Rubros"
            columnas={["Nombre", "Código", "Padre", "Crítico bajo (días)", "Remarcación %", "Descuento máx. %", "Estado"]}
            filas={visibles.map((c) => [
              c.nombre,
              c.codigo ?? "",
              items.find((i) => i.id === c.parent_id)?.nombre ?? "",
              c.dias_critico ?? "general",
              c.markup_pct ?? (items.find((i) => i.id === c.parent_id)?.markup_pct ?? ""),
              c.descuento_pct ?? 0,
              c.activo ? "Activo" : "Inactivo",
            ])}
          />
          </span>
          <ImportExcelButton
            entidad="Rubros"
            previewUrl="/api/inventario/categorias/import/preview"
            commitUrl="/api/inventario/categorias/import/commit"
            templateUrl="/api/inventario/categorias/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={load}
          />
          <Link href="/inventario" className="text-sm text-sky-700 hover:text-sky-900 underline">
            ← Volver a Inventario
          </Link>
        </div>
      </div>

      {/* Alta */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
          Nuevo rubro
        </p>
        <form onSubmit={handleCrear} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: BEBIDAS"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Código (opcional)</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: BEB"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Rubro padre (opcional)</label>
            <Selector
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </Selector>
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear rubro"}
            </button>
          </div>
        </form>
        {error && (
          <p className="mt-2 text-xs text-red-700">{error}</p>
        )}
      </div>

      {/* Lista */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Todavía no cargaste rubros.</p>
        ) : (
          <>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar rubro por nombre, código o padre…"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
            </div>
            <Selector
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as "todos" | "activos" | "inactivos")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="todos">Todos los estados</option>
              <option value="activos">Solo activos</option>
              <option value="inactivos">Solo inactivos</option>
            </Selector>
            {/* El tope del rubro es lo que Caja ofrece como descuento máximo
                de la línea, así que conviene ver de un vistazo cuáles lo
                tienen puesto. */}
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={soloConDescuento}
                onChange={(e) => setSoloConDescuento(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Solo con descuento máximo
            </label>
            {/* Abrir o cerrar todos los rubros padre de una. Sin esto, ver
                solo los nueve rubros mayores son nueve clics. */}
            {!hayFiltro && padresConHijos.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setPlegados((prev) =>
                    prev.size >= padresConHijos.length
                      ? new Set()
                      : new Set(padresConHijos)
                  )
                }
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-[#4FAEB2] hover:text-[#3F8E91]"
              >
                {plegados.size >= padresConHijos.length ? "Abrir todos" : "Cerrar todos"}
              </button>
            )}
            {/* La regla, dicha una vez, en vez de que cada uno la deduzca de
                ver los lápices solo en algunos renglones. */}
            {!hayFiltro && padresConHijos.length > 0 && (
              <span className="text-[11px] leading-snug text-slate-500">
                El crítico, la remarcación y el descuento se cargan en el rubro mayor: sus grupos
                los heredan.
              </span>
            )}
            <span className="text-xs text-slate-500">
              {visibles.length === items.length
                ? `${items.length} rubro${items.length === 1 ? "" : "s"}`
                : `${visibles.length} de ${items.length} rubros`}
            </span>
          </div>
          {visibles.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">
              Ningún rubro coincide con los filtros.
            </p>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Rubro</th>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2" title="Días de stock por debajo de los cuales el rubro se marca crítico en Reposición">
                  Crítico bajo
                </th>
                <th className="text-left px-4 py-2" title="Remarcación de referencia del rubro. No cambia los precios ya cargados.">
                  Remarcación
                </th>
                <th className="text-left px-4 py-2" title="Hasta cuánto se puede descontar un artículo del rubro. No se aplica solo: en la venta el precio es el de lista.">
                  Descuento máx.
                </th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ cat: c, nivel, hijos }) => {
                const esPadre = hijos > 0;
                const plegado = plegados.has(c.id);
                const parent = items.find((i) => i.id === c.parent_id);
                /** Cuelga de un rubro mayor: las políticas las pone el padre. */
                const esGrupo = !!parent;
                return (
                  <tr
                    key={c.id}
                    className={`border-t border-slate-100 ${
                      esPadre ? "bg-slate-50/70" : ""
                    } ${!c.activo ? "opacity-60" : ""}`}
                  >
                    {/* El anidado reemplaza a la columna Padre: se ve de dónde
                        cuelga cada grupo sin tener que leer otra columna. */}
                    <td className="px-4 py-2">
                      <span
                        className="flex items-center gap-1.5"
                        style={{ paddingLeft: nivel * 22 }}
                      >
                        {esPadre ? (
                          <button
                            type="button"
                            onClick={() => alternarPlegado(c.id)}
                            aria-label={plegado ? `Abrir ${c.nombre}` : `Cerrar ${c.nombre}`}
                            className="-ml-1 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                          >
                            {plegado ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        ) : nivel > 0 ? (
                          <span className="select-none text-slate-300" aria-hidden>└</span>
                        ) : (
                          <span className="w-4" aria-hidden />
                        )}
                        <span className={esPadre ? "font-semibold text-slate-800" : "font-medium text-slate-700"}>
                          {c.nombre}
                        </span>
                        {esPadre && (
                          <span className="rounded-full bg-[#4FAEB2]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#3F8E91]">
                            {hijos} {hijos === 1 ? "grupo" : "grupos"}
                          </span>
                        )}
                        {/* Buscando se aplana, así que ahí sí hace falta decir
                            de qué rubro es: sin el anidado no se vería. */}
                        {hayFiltro && parent && (
                          <span className="text-[11px] text-slate-400">· en {parent.nombre}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{c.codigo ?? "—"}</td>
                    {/* Las tres columnas de política del rubro se editan SOLO
                        en el padre. Ver `ValorDelPadre`. */}
                    <td className="px-4 py-2">
                      {esGrupo ? (
                        <ValorDelPadre
                          propio={c.dias_critico}
                          delPadre={parent?.dias_critico}
                          sufijo=" d"
                          vacio="general"
                        />
                      ) : (
                      /* Se dibuja como un campo editable y no como texto: con
                         el estilo anterior —gris, subrayado solo al pasar por
                         encima— se leía como un dato y nadie adivinaba que
                         ahí se hace clic para configurarlo. */
                      <button
                        onClick={() => editarDiasCritico(c)}
                        className="group inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs transition-colors hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5"
                        title="Clic para cambiar los días de cobertura crítica de este rubro"
                      >
                        {c.dias_critico == null ? (
                          <span className="text-slate-400 group-hover:text-[#3F8E91]">general</span>
                        ) : (
                          <span className="font-semibold text-slate-700 tabular-nums group-hover:text-[#3F8E91]">
                            {c.dias_critico} d
                          </span>
                        )}
                        <Pencil className="h-3 w-3 text-slate-300 group-hover:text-[#4FAEB2]" />
                      </button>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {esGrupo ? (
                        <ValorDelPadre
                          propio={c.markup_pct}
                          delPadre={parent?.markup_pct}
                          sufijo="%"
                          vacio="sin definir"
                        />
                      ) : (
                      <button
                        onClick={() => editarRemarcacionRubro(c)}
                        className="group inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs transition-colors hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5"
                        title="Clic para cambiar la remarcación de referencia del rubro. No cambia los precios ya cargados."
                      >
                        {c.markup_pct != null ? (
                          <span className="font-semibold tabular-nums text-slate-700 group-hover:text-[#3F8E91]">
                            {c.markup_pct}%
                          </span>
                        ) : (() => {
                          const padre = items.find((i) => i.id === c.parent_id);
                          return padre && padre.markup_pct != null ? (
                            <span className="tabular-nums text-slate-400 group-hover:text-[#3F8E91]">
                              {padre.markup_pct}% (del padre)
                            </span>
                          ) : (
                            <span className="text-slate-400 group-hover:text-[#3F8E91]">sin definir</span>
                          );
                        })()}
                        <Pencil className="h-3 w-3 text-slate-300 group-hover:text-[#4FAEB2]" />
                      </button>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {esGrupo ? (
                        <ValorDelPadre
                          propio={c.descuento_pct ? c.descuento_pct : null}
                          delPadre={parent?.descuento_pct ? parent.descuento_pct : null}
                          sufijo="%"
                          vacio="sin desc."
                          resaltar
                        />
                      ) : (
                      <button
                        onClick={() => editarDescuentoRubro(c)}
                        className="group inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs transition-colors hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5"
                        title="Clic para cambiar el descuento que se aplica a todos los artículos de este rubro"
                      >
                        {c.descuento_pct ? (
                          <span className="font-semibold text-emerald-700 tabular-nums">
                            {c.descuento_pct}%
                          </span>
                        ) : (
                          <span className="text-slate-400 group-hover:text-[#3F8E91]">sin desc.</span>
                        )}
                        <Pencil className="h-3 w-3 text-slate-300 group-hover:text-[#4FAEB2]" />
                      </button>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {c.activo ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Activo</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-3">
                        <button
                          onClick={() => startEdit(c)}
                          className="text-xs text-sky-700 hover:text-sky-900 underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleActivo(c)}
                          className="text-xs text-slate-700 hover:text-slate-900 underline"
                        >
                          {c.activo ? "Desactivar" : "Activar"}
                        </button>
                        <button
                          onClick={() => setABorrar(c)}
                          className="text-xs text-red-600 hover:text-red-800 underline"
                        >
                          Borrar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
          </>
        )}
      </div>

      {aBorrar && (
        <ModalConfirmarAccion
          titulo={`Borrar el rubro "${aBorrar.nombre}"`}
          detalle="No se puede deshacer. Los productos que estaban en este rubro quedan sin rubro."
          onConfirmar={() => eliminar(aBorrar)}
          onCerrar={() => setABorrar(null)}
        />
      )}

      {campo && (
        <ModalCampo
          titulo={campo.titulo}
          descripcion={campo.descripcion}
          etiqueta={campo.etiqueta}
          valorInicial={campo.valorInicial}
          sufijo={campo.sufijo}
          tipo={campo.tipo}
          ayuda={campo.ayuda || undefined}
          validar={campo.validar}
          onGuardar={guardarCampo}
          onCerrar={() => setCampo(null)}
        />
      )}

      {editando && (
        <EditarRubroModal
          rubro={editando}
          todos={items}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); load(); }}
        />
      )}
    </div>
  );
}
