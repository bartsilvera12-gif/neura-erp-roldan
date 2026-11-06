"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { getClientesPaginado, clienteNombre } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";
import { etiquetaVisibleTipoServicio, type ClienteTipoServicioRow } from "@/lib/clientes/tipo-servicio-catalogo";
import { filasTiposDesdeSistemaEstatico, fetchTiposFormCliente } from "@/lib/clientes/fetch-tipos-servicio-form";

import { Check, Link2, Users } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return ""; }
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeEstado({ estado }: { estado: Cliente["estado"] }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
      estado === "activo"
        ? "bg-green-100 text-green-700"
        : "bg-gray-100 text-gray-500"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${estado === "activo" ? "bg-green-500" : "bg-gray-400"}`} />
      {estado === "activo" ? "Activo" : "Inactivo"}
    </span>
  );
}

function BadgeOrigen({ origen }: { origen: Cliente["origen"] }) {
  const cfg = {
    CRM:    "bg-violet-100 text-violet-700",
    VENTA:  "bg-blue-100 text-blue-700",
    MANUAL: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg[origen]}`}>
      {origen}
    </span>
  );
}

// ── Columnas configurables ────────────────────────────────────────────────────

// v3: nuevas columnas por defecto "Nombre comercial/Sucursal/Local" y "Ciudad"
// (reemplazan a Contacto y Teléfono). Bump de versión para resetear preferencias viejas.
const CLIENTES_COLUMNAS_STORAGE_KEY = "neura.erp.clientes.columnas.v3";

/**
 * Clientes por página.
 *
 * Cincuenta entran en una pantalla sin scroll infinito y una página pesa 27 KB
 * contra la base real. Subirlo a doscientos no mejora nada: nadie lee
 * doscientos renglones, y el que busca a alguien lo busca por nombre.
 */
const POR_PAGINA = 50;

type ClienteColumnKey =
  | "codigo"
  | "empresa_nombre"
  | "nombre_comercial"
  | "ciudad"
  | "contacto"
  | "telefono"
  | "estado"
  | "desde"
  | "creado_por"
  | "ruc_documento"
  | "email"
  | "vendedor_responsable";

type ClienteColumnDef = {
  key: ClienteColumnKey;
  label: string;
  visibleDefault: boolean;
  required?: boolean;
  headerClassName?: string;
  className?: string;
  render: (cliente: Cliente) => ReactNode;
};

const DEFAULT_VISIBLE_COLUMN_KEYS: ClienteColumnKey[] = [
  "codigo",
  "empresa_nombre",
  "nombre_comercial",
  "ciudad",
  "estado",
  "desde",
];

function normalizeVisibleColumnKeys(raw: unknown, columns: ClienteColumnDef[]): ClienteColumnKey[] {
  const validKeys = new Set(columns.map((c) => c.key));
  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);
  const source = Array.isArray(raw) ? raw : DEFAULT_VISIBLE_COLUMN_KEYS;
  const next = source.filter((k): k is ClienteColumnKey => typeof k === "string" && validKeys.has(k as ClienteColumnKey));

  for (const key of requiredKeys) {
    if (!next.includes(key)) next.push(key);
  }
  return next.length > 0 ? next : [...DEFAULT_VISIBLE_COLUMN_KEYS];
}

function documentoCliente(c: Cliente): string {
  return c.ruc?.trim() || c.documento?.trim() || "—";
}

function VendedorResponsableCell({ cliente }: { cliente: Cliente }) {
  const nombre = cliente.vendedor_usuario_nombre?.trim();
  const email = cliente.vendedor_usuario_email?.trim();
  const legacy = cliente.vendedor_asignado?.trim();

  if (cliente.vendedor_usuario_id) {
    return nombre || email || "Usuario ERP asignado";
  }

  if (legacy) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{legacy}</span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Texto libre
        </span>
      </span>
    );
  }

  return <span className="text-slate-400">Sin asignar</span>;
}

function buildClienteColumns(mapNombreTipo: Record<string, string>): ClienteColumnDef[] {
  const th = "text-left text-xs font-semibold text-slate-600 px-5 py-3 whitespace-nowrap";
  const td = "px-5 py-3.5";
  return [
    {
      key: "codigo",
      label: "Código",
      visibleDefault: true,
      headerClassName: th,
      className: td,
      render: (c) => (
        <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
          {c.codigo_cliente}
        </span>
      ),
    },
    {
      key: "empresa_nombre",
      label: "Empresa / Nombre",
      visibleDefault: true,
      required: true,
      headerClassName: th,
      className: td,
      render: (c) => (
        <div className="flex items-center gap-2 min-w-56">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${
            c.tipo_cliente === "empresa" ? "bg-blue-500" : "bg-violet-500"
          }`}>
            {c.tipo_cliente === "empresa" ? "E" : "P"}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-800 group-hover:text-gray-900">
                {clienteNombre(c)}
              </p>
              {c.perfil_tributario_activo && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  Tributario
                </span>
              )}
              {c.origen === "CRM" && (
                <span
                  title="Este cliente fue creado desde el módulo CRM"
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100"
                >
                  <span aria-hidden><Link2 className="h-4 w-4" /></span>
                  Creado desde CRM
                </span>
              )}
            </div>
            {c.tipo_cliente === "empresa" && c.ruc && (
              <p className="text-xs text-gray-400">RUC: {c.ruc}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "nombre_comercial",
      label: "Nombre comercial / Sucursal / Local",
      visibleDefault: true,
      headerClassName: th,
      className: `${td} text-sm text-gray-700`,
      render: (c) => c.nombre_comercial?.trim() || "—",
    },
    {
      key: "ciudad",
      label: "Ciudad",
      visibleDefault: true,
      headerClassName: th,
      className: `${td} text-sm text-gray-600 whitespace-nowrap`,
      render: (c) => c.ciudad?.trim() || "—",
    },
    {
      key: "contacto",
      label: "Contacto",
      visibleDefault: false,
      headerClassName: th,
      className: `${td} text-sm text-gray-700 whitespace-nowrap`,
      render: (c) => (c.tipo_cliente === "empresa" ? c.nombre_contacto : (c.ciudad ?? "—")),
    },
    {
      key: "telefono",
      label: "Teléfono",
      visibleDefault: false,
      headerClassName: th,
      className: `${td} text-sm text-gray-600 whitespace-nowrap`,
      render: (c) => c.telefono ?? "—",
    },
    // Roldán e Hijos: columnas "Plan activo", "Origen" y "Tipo servicio" eliminadas
    // (heredadas de Reserva/Darocha, no aplican al negocio).
    {
      key: "estado",
      label: "Estado",
      visibleDefault: true,
      headerClassName: th,
      className: td,
      render: (c) => <BadgeEstado estado={c.estado} />,
    },
    {
      key: "desde",
      label: "Desde",
      visibleDefault: true,
      headerClassName: th,
      className: `${td} text-xs text-gray-400 whitespace-nowrap`,
      render: (c) => formatFecha(c.created_at),
    },
    {
      key: "creado_por",
      label: "Creado por",
      visibleDefault: false,
      headerClassName: th,
      className: `${td} text-xs text-gray-500 whitespace-nowrap`,
      render: (c) => c.created_by_nombre ?? "—",
    },
    {
      key: "ruc_documento",
      label: "RUC / documento",
      visibleDefault: false,
      headerClassName: th,
      className: `${td} text-sm text-gray-600 whitespace-nowrap`,
      render: documentoCliente,
    },
    {
      key: "email",
      label: "Email",
      visibleDefault: false,
      headerClassName: th,
      className: `${td} text-sm text-gray-600 whitespace-nowrap`,
      render: (c) => c.email ?? "—",
    },
    {
      key: "vendedor_responsable",
      label: "Vendedor responsable",
      visibleDefault: false,
      headerClassName: th,
      className: `${td} text-xs text-gray-500 whitespace-nowrap`,
      render: (c) => <VendedorResponsableCell cliente={c} />,
    },
  ];
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ClientesPage() {
  const searchParams = useSearchParams();
  const [clientes,    setClientes]    = useState<Cliente[]>([]);
  /** Cuántos hay en total con los filtros puestos, no cuántos llegaron. */
  const [total,       setTotal]       = useState<number | null>(null);
  const [totalExacto, setTotalExacto] = useState(true);
  const [pagina,      setPagina]      = useState(1);
  const [paginas,     setPaginas]     = useState(1);
  const [cargando,    setCargando]    = useState(true);
  const [busqueda,    setBusqueda]    = useState("");
  const [bajaOk,      setBajaOk]      = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<"" | "activo" | "inactivo">("");
  const [filtroOrigen, setFiltroOrigen] = useState<"" | "CRM" | "VENTA" | "MANUAL">("");
  const [filtroTipo,   setFiltroTipo]   = useState<"" | "empresa" | "persona">("");
  const [filtroTipoServicio, setFiltroTipoServicio] = useState<"" | string>("");
  // Punto 3.1: filtro por rubro de cliente (ocasional, mayorista, minorista,
  // frecuente, distribuidor). "__sin__" son los que todavía no tienen uno.
  const [filtroRubro, setFiltroRubro] = useState("");
  const [rubros, setRubros] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    fetch("/api/categorias-cliente", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        const lista = (j.data?.categorias ?? j.data?.items ?? []) as Array<{ id: string; nombre: string; activa?: boolean }>;
        setRubros(lista.map((c) => ({ id: c.id, nombre: c.nombre })));
      })
      .catch(() => { /* sin rubros el filtro queda vacío y el listado anda igual */ });
  }, []);
  const [columnasOpen, setColumnasOpen] = useState(false);
  const [columnasInicializadas, setColumnasInicializadas] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<ClienteColumnKey[]>(DEFAULT_VISIBLE_COLUMN_KEYS);
  const [filasTipoCatalogo, setFilasTipoCatalogo] = useState<ClienteTipoServicioRow[]>(() => filasTiposDesdeSistemaEstatico());
  const mapNombreTipo = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of filasTipoCatalogo) m[t.slug] = t.nombre;
    return m;
  }, [filasTipoCatalogo]);
  const clienteColumns = useMemo(() => buildClienteColumns(mapNombreTipo), [mapNombreTipo]);
  const visibleColumnSet = useMemo(() => new Set(visibleColumnKeys), [visibleColumnKeys]);
  const visibleColumns = useMemo(
    () => clienteColumns.filter((col) => visibleColumnSet.has(col.key)),
    [clienteColumns, visibleColumnSet]
  );

  /**
   * Los clientes de UNA página, filtrados y buscados en el servidor.
   *
   * Antes se traían todos y se filtraba en el navegador. Con 21.348 clientes
   * eso no funcionaba de dos maneras a la vez: PostgREST corta en 1000 filas
   * —la pantalla decía "1000 de 1000"— y traerlos todos son 36 MB y 30
   * segundos. Buscar a alguien que había quedado fuera de esas 1000 no daba
   * "no está en el listado", daba "no existe".
   */
  useEffect(() => {
    let cancel = false;
    setCargando(true);
    // Espera a que termine de escribir: sin esto son seis consultas para
    // escribir "PEDRO".
    const id = setTimeout(() => {
      void getClientesPaginado({
        pagina,
        porPagina: POR_PAGINA,
        busqueda,
        estado: filtroEstado,
        origen: filtroOrigen,
        tipoCliente: filtroTipo,
        tipoServicio: filtroTipoServicio,
        categoria: filtroRubro,
      }).then((r) => {
        if (cancel) return;
        setClientes(r.clientes);
        setTotal(r.total);
        setPaginas(r.paginas);
        setTotalExacto(r.total_exacto);
        setCargando(false);
      });
    }, busqueda.trim() === "" ? 0 : 300);
    return () => { cancel = true; clearTimeout(id); };
  }, [pagina, busqueda, filtroEstado, filtroOrigen, filtroTipo, filtroTipoServicio, filtroRubro]);

  // Al cambiar un filtro o la búsqueda se vuelve a la primera página: quedarse
  // en la página 7 de un resultado que ahora tiene dos muestra una tabla vacía
  // que parece "no hay nada".
  useEffect(() => {
    setPagina(1);
  }, [busqueda, filtroEstado, filtroOrigen, filtroTipo, filtroTipoServicio, filtroRubro]);

  useEffect(() => {
    void fetchTiposFormCliente().then(setFilasTipoCatalogo);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CLIENTES_COLUMNAS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      setVisibleColumnKeys(normalizeVisibleColumnKeys(parsed, clienteColumns));
    } catch {
      setVisibleColumnKeys([...DEFAULT_VISIBLE_COLUMN_KEYS]);
    } finally {
      setColumnasInicializadas(true);
    }
  }, [clienteColumns]);

  useEffect(() => {
    if (!columnasInicializadas) return;
    try {
      window.localStorage.setItem(CLIENTES_COLUMNAS_STORAGE_KEY, JSON.stringify(visibleColumnKeys));
    } catch {
      /* localStorage puede fallar en modo privado; los defaults siguen funcionando. */
    }
  }, [visibleColumnKeys, columnasInicializadas]);

  const slugsExtraFiltro = useMemo(() => {
    const known = new Set(filasTipoCatalogo.map((f) => f.slug));
    const u = new Set<string>();
    for (const c of clientes) {
      const t = (c.tipo_servicio_cliente ?? "").trim();
      if (t && !known.has(t)) u.add(t);
    }
    return Array.from(u).sort();
  }, [clientes, filasTipoCatalogo]);

  useEffect(() => {
    if (searchParams?.get("baja_ok") === "1") {
      setBajaOk(true);
      window.history.replaceState({}, "", "/clientes");
      const t = setTimeout(() => setBajaOk(false), 5000);
      return () => clearTimeout(t);
    }
  }, [searchParams]);

  // Lo que llega YA viene filtrado y buscado por el servidor: filtrar de nuevo
  // acá solo filtraría la página que se está viendo.
  const filtrados = clientes;
  const desdeFila = clientes.length === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hastaFila = (pagina - 1) * POR_PAGINA + clientes.length;

  const hayFiltros = busqueda || filtroEstado || filtroOrigen || filtroTipo || filtroTipoServicio || filtroRubro;

  function toggleColumn(key: ClienteColumnKey) {
    const col = clienteColumns.find((c) => c.key === key);
    if (!col || col.required) return;
    setVisibleColumnKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return [...prev, key];
    });
  }

  function resetColumnas() {
    setVisibleColumnKeys([...DEFAULT_VISIBLE_COLUMN_KEYS]);
  }

  return (
    <div className="space-y-6">

      {/* Mensaje de éxito baja operativa */}
      {bajaOk && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-800">
          <Check className="h-5 w-5" aria-hidden />
          <p className="text-sm font-medium">Baja procesada correctamente</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Base
            </p>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Clientes</h1>
          <p className="mt-0.5 text-xs text-slate-500">Base de clientes activos de la empresa</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ImportExcelButton
            entidad="Clientes"
            previewUrl="/api/clientes/import/preview"
            commitUrl="/api/clientes/import/commit"
            templateUrl="/api/clientes/import/template"
            permiteCrearFaltantes
            onCompleted={() => window.location.reload()}
          />
          {/* Quién cambió de categoría y quién dejó de comprar. */}
          <Link
            href="/clientes/categorias"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-[#4FAEB2] hover:text-[#3F8E91]"
          >
            Categorías
          </Link>
          <Link
            href="/clientes/nuevo"
            className="flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Nuevo cliente
          </Link>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm ring-1 ring-[#4FAEB2]/15 p-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Buscar por nombre, sucursal/local, ciudad, RUC, código, email..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none transition-all"
        />
        <FancySelect
          value={filtroEstado}
          onChange={(v) => setFiltroEstado(v as "" | "activo" | "inactivo")}
          ariaLabel="Filtrar por estado"
          className="w-44"
          size="sm"
          options={[
            { value: "", label: "Todos los estados" },
            { value: "activo", label: "Activo" },
            { value: "inactivo", label: "Inactivo" },
          ]}
        />
        <FancySelect
          value={filtroTipo}
          onChange={(v) => setFiltroTipo(v as "" | "empresa" | "persona")}
          ariaLabel="Filtrar por tipo"
          className="w-44"
          size="sm"
          options={[
            { value: "", label: "Todos los tipos" },
            { value: "empresa", label: "Empresa" },
            { value: "persona", label: "Persona" },
          ]}
        />
        <FancySelect
          value={filtroRubro}
          onChange={(v) => setFiltroRubro(v)}
          ariaLabel="Filtrar por rubro de cliente"
          className="w-52"
          size="sm"
          options={[
            { value: "", label: "Todos los rubros" },
            { value: "__sin__", label: "— Sin rubro —" },
            ...rubros.map((r) => ({ value: r.id, label: r.nombre })),
          ]}
        />
        {/* Roldán e Hijos: filtros "Origen" y "Tipo servicio" eliminados (herencia de Reserva). */}
        {hayFiltros && (
          <button
            onClick={() => { setBusqueda(""); setFiltroEstado(""); setFiltroOrigen(""); setFiltroTipo(""); setFiltroTipoServicio(""); setFiltroRubro(""); }}
            className="text-xs text-gray-500 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Contador */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* El contador dice el TOTAL que hay con esos filtros, no cuántos
            llegaron. Antes decía "1000 de 1000" porque mostraba el largo de lo
            que había recibido, y eso tapaba que faltaban 20.348. */}
        <p className="text-sm text-gray-500">
          {total == null ? (
            <><span className="font-semibold text-gray-800">{filtrados.length}</span> clientes</>
          ) : total === 0 ? (
            <>Ningún cliente</>
          ) : (
            <>
              <span className="font-semibold text-gray-800">
                {desdeFila.toLocaleString("es-PY")}–{hastaFila.toLocaleString("es-PY")}
              </span>{" "}
              de <span className="font-semibold text-gray-800">{total.toLocaleString("es-PY")}</span>{" "}
              clientes
              {!totalExacto && <span className="ml-1 text-amber-700">(aproximado)</span>}
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnasOpen((v) => !v)}
              className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg text-xs font-medium shadow-sm transition-colors"
              aria-expanded={columnasOpen}
            >
              <span>Columnas</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {visibleColumns.length}/{clienteColumns.length}
              </span>
            </button>
            {columnasOpen && (
              <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
                <div className="p-4 border-b border-slate-100">
                  <p className="text-sm font-semibold text-slate-800">Columnas</p>
                  <p className="text-xs text-slate-500 mt-1">Personalizá qué información querés ver en esta tabla.</p>
                </div>
                <div className="p-2 max-h-80 overflow-y-auto">
                  {clienteColumns.map((col) => {
                    const checked = visibleColumnSet.has(col.key);
                    return (
                      <label
                        key={col.key}
                        className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                          col.required ? "text-slate-500 bg-slate-50" : "text-slate-700 hover:bg-slate-50 cursor-pointer"
                        }`}
                      >
                        <span>{col.label}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={col.required}
                          onChange={() => toggleColumn(col.key)}
                          className="h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3 p-3 border-t border-slate-100">
                  <p className="text-[11px] text-slate-400">Empresa / Nombre queda siempre visible.</p>
                  <button
                    type="button"
                    onClick={resetColumnas}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Restablecer columnas
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm ring-1 ring-[#4FAEB2]/15">
        {cargando ? (
          <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Cargando clientes…</div>
        ) : filtrados.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Users className="h-10 w-10 mb-3" aria-hidden />
            <p className="font-medium text-gray-600">
              {hayFiltros ? "Sin resultados para los filtros aplicados" : "No hay clientes registrados"}
            </p>
            {!hayFiltros && (
              <Link href="/clientes/nuevo" className="mt-4 inline-block text-sm text-gray-500 underline hover:text-gray-800">
                Crear primer cliente
              </Link>
            )}
          </div>
        ) : /* tabla */ (
          <EdgeScrollArea>
            <table className="w-full min-w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {visibleColumns.map((col) => (
                    <th key={col.key} className={col.headerClassName}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-200 hover:bg-[#4FAEB2]/[0.04] transition-colors cursor-pointer group"
                    onClick={() => window.location.href = `/clientes/${c.id}`}
                  >
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={col.className}>
                        {col.render(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </EdgeScrollArea>
        )}
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-500">
            Página {pagina.toLocaleString("es-PY")} de {paginas.toLocaleString("es-PY")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPagina(1)}
              disabled={pagina <= 1 || cargando}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-40"
            >
              Primera
            </button>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1 || cargando}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-40"
            >
              ← Anterior
            </button>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
              disabled={pagina >= paginas || cargando}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-40"
            >
              Siguiente →
            </button>
            <button
              type="button"
              onClick={() => setPagina(paginas)}
              disabled={pagina >= paginas || cargando}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-40"
            >
              Última
            </button>
          </div>
        </div>
      )}

      <MobileFab href="/clientes/nuevo" label="Nuevo cliente" />
    </div>
  );
}
