"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import ModalCampo from "@/components/ui/ModalCampo";
import ModalConfirmarAccion from "@/components/ui/ModalConfirmarAccion";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImprimirTablaButton from "@/components/ui/ImprimirTablaButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

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
}

export default function CategoriasProductosPage() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<Categoria[]>([]);
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
      const r = await fetch("/api/inventario/categorias?todas=1", { credentials: "include" });
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
  function editarDescuentoRubro(cat: Categoria) {
    setCampo({
      cat,
      titulo: `Descuento · ${cat.nombre}`,
      descripcion: "Se aplica a todos los artículos del rubro que no tengan uno propio.",
      etiqueta: "Descuento",
      valorInicial: cat.descuento_pct ? String(cat.descuento_pct) : "",
      sufijo: "%",
      tipo: "number",
      ayuda: "Un artículo con su propio descuento usa el suyo, no la suma de los dos. Vacío o cero deja el rubro sin descuento.",
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

  function startEdit(cat: Categoria) {
    setCampo({
      cat,
      titulo: "Renombrar rubro",
      descripcion: `Se cambia en todos los productos que hoy están en "${cat.nombre}".`,
      etiqueta: "Nombre",
      valorInicial: cat.nombre,
      tipo: "text",
      ayuda: "",
      validar: (v) => (v.trim() === "" ? "El nombre no puede quedar vacío." : null),
      cuerpo: (v) => ({ nombre: v }),
    });
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
            Las columnas <strong>Crítico bajo</strong> y <strong>Descuento</strong> se configuran
            haciendo clic sobre su valor, rubro por rubro.
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
            columnas={["Nombre", "Código", "Padre", "Crítico bajo (días)", "Descuento %", "Estado"]}
            filas={items.map((c) => [
              c.nombre,
              c.codigo ?? "",
              items.find((i) => i.id === c.parent_id)?.nombre ?? "",
              c.dias_critico ?? "general",
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
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
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
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Padre</th>
                <th className="text-left px-4 py-2" title="Días de stock por debajo de los cuales el rubro se marca crítico en Reposición">
                  Crítico bajo
                </th>
                <th className="text-left px-4 py-2" title="Descuento que se aplica a todos los artículos del rubro">
                  Descuento
                </th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const parent = items.find((i) => i.id === c.parent_id);
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{c.nombre}</td>
                    <td className="px-4 py-2 text-gray-500">{c.codigo ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{parent?.nombre ?? "—"}</td>
                    <td className="px-4 py-2">
                      {/* Se dibuja como un campo editable y no como texto: con
                          el estilo anterior —gris, subrayado solo al pasar por
                          encima— se leía como un dato y nadie adivinaba que
                          ahí se hace clic para configurarlo. */}
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
                    </td>
                    <td className="px-4 py-2">
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
    </div>
  );
}
