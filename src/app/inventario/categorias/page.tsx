"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
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

  async function eliminar(cat: Categoria) {
    if (!window.confirm(`¿Borrar el rubro "${cat.nombre}"? Esta acción no se puede deshacer.`)) return;
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo borrar.");
  }

  /**
   * Días de cobertura crítica del rubro (punto 1.3).
   *
   * Se pide con un prompt igual que el nombre: es un número suelto y abrir un
   * formulario entero para un campo sería peor. Vacío lo deja sin configurar,
   * que es distinto de cero: significa "usá el umbral general".
   */
  async function editarDiasCritico(cat: Categoria) {
    const actual = cat.dias_critico == null ? "" : String(cat.dias_critico);
    const v = window.prompt(
      `Días de stock por debajo de los cuales "${cat.nombre}" se marca CRÍTICO.\n\n` +
      "En la práctica es lo que tarda reponerlo: si la chapa tarda 15 días, poné 15.\n" +
      "Dejalo vacío para que use el umbral general de Reposición.",
      actual
    );
    if (v == null) return;
    const limpio = v.trim();
    if (limpio === actual) return;
    if (limpio !== "") {
      const n = Number(limpio);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        setError("Los días tienen que ser un número entre 1 y 365.");
        return;
      }
    }
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ dias_critico: limpio === "" ? null : Number(limpio) }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo guardar.");
  }

  /**
   * "Desc. Grupo %" (script 32): descuento que aplica a todos los artículos
   * del rubro. Se pide con un prompt por lo mismo que los días críticos: es
   * un número suelto.
   *
   * Un artículo con descuento propio REEMPLAZA a éste; no se suman. Con la
   * suma, un artículo al 5% dentro de un rubro al 4% saldría al 9%, que no es
   * lo que nadie quiso decir al cargar los dos.
   */
  async function editarDescuentoRubro(cat: Categoria) {
    const actual = cat.descuento_pct ? String(cat.descuento_pct) : "";
    const v = window.prompt(
      `Descuento que se aplica a todos los artículos de "${cat.nombre}", en %.\n\n` +
      "Un artículo con su propio descuento usa el suyo, no la suma de los dos.\n" +
      "Dejalo vacío o en cero para que el rubro no tenga descuento.",
      actual
    );
    if (v == null) return;
    const limpio = v.trim().replace(",", ".");
    if (limpio === actual) return;
    if (limpio !== "") {
      const n = Number(limpio);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError("El descuento tiene que ser un número entre 0 y 100.");
        return;
      }
    }
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ descuento_pct: limpio === "" ? 0 : Number(limpio) }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo guardar.");
  }

  async function startEdit(cat: Categoria) {
    const nuevoNombre = window.prompt("Nuevo nombre del rubro:", cat.nombre);
    if (nuevoNombre == null || nuevoNombre.trim() === "" || nuevoNombre === cat.nombre) return;
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ nombre: nuevoNombre.trim() }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo editar.");
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
                          onClick={() => eliminar(c)}
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
    </div>
  );
}
