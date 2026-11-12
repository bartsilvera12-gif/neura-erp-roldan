"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";

export interface SearchableOption {
  id: string;
  label: string;
  /** Texto secundario opcional (ej: SKU) que se muestra a la derecha y se incluye en la búsqueda. */
  hint?: string | null;
}

interface Props {
  value: string | null;
  onChange: (id: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Búsqueda en el servidor. Si se pasa, lo que se escribe se manda acá (con
   * una pausa) y `options` son los resultados: no se filtra en el navegador.
   * Para listas grandes, como los 21 mil clientes, que no conviene traer enteras.
   */
  onSearch?: (q: string) => void;
  /** Mientras se busca en el servidor. */
  loading?: boolean;
}

/**
 * Lo que la pantalla puede pedirle al selector desde afuera.
 *
 * Existe por el encadenado con teclado: al agregar una línea, el presupuesto
 * necesita volver el foco acá para escribir la siguiente, y el estado de
 * "abierto" vive adentro del componente.
 */
export type SearchableSelectHandle = { abrir: () => void };

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Select con buscador inline. Reemplazo drop-in del `<select>` nativo cuando
 * la lista tiene decenas/cientos de opciones (recetas, insumos, productos).
 * No trae dependencias externas.
 */
const SearchableSelect = forwardRef<SearchableSelectHandle, Props>(function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Elegí…",
  emptyText = "Sin coincidencias",
  disabled = false,
  className = "",
  onSearch,
  loading = false,
}, ref) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * La lista se dibuja en el <body>, flotando, y no adentro del selector.
   * Adentro quedaba recortada por cualquier tarjeta con `overflow-hidden`
   * (en Nuevo presupuesto no se podía elegir el producto: la lista se escondía).
   */
  const [pos, setPos] = useState<{ top: number; left: number; width: number; arriba: boolean } | null>(null);
  /**
   * ── MANEJO CON TECLADO ─────────────────────────────────────────────────
   *
   * Quien carga un presupuesto no suelta el teclado: escribe el producto,
   * baja con la flecha y confirma con Enter. Antes había que escribir, soltar
   * el teclado, buscar con el mouse y volver — por cada línea.
   *
   * `activo` es la opción resaltada. Arranca en 0: con el primer Enter se
   * elige la primera coincidencia, que es lo que se espera al escribir el
   * nombre casi completo.
   */
  const [activo, setActivo] = useState(0);
  const listaRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const ubicar = () => {
      const r = wrapperRef.current?.getBoundingClientRect();
      if (!r) return;
      const alto = 300;
      const arriba = window.innerHeight - r.bottom < alto && r.top > window.innerHeight - r.bottom;
      setPos({ top: arriba ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width, arriba });
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
    };
  }, [open]);

  useImperativeHandle(ref, () => ({
    abrir: () => {
      setOpen(true);
      setQ("");
      setActivo(0);
    },
  }), []);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    if (onSearch) return options;
    const t = normalizar(q);
    if (!t) return options;
    const terminos = t.split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const heno = normalizar(`${o.label} ${o.hint ?? ""}`);
      return terminos.every((tk) => heno.includes(tk));
    });
  }, [options, q, onSearch]);

  /* Al cambiar lo escrito, el resaltado vuelve a la primera: si no, queda
     apuntando a una opción que ya no está y Enter elige cualquier cosa. */
  useEffect(() => {
    setActivo(0);
  }, [q, options]);

  /* La opción resaltada siempre a la vista: con la flecha se pasa de largo
     del borde de la lista y no se ve a dónde se está yendo. */
  useEffect(() => {
    if (!open) return;
    const el = listaRef.current?.querySelectorAll("li")[activo];
    el?.scrollIntoView({ block: "nearest" });
  }, [activo, open]);

  useEffect(() => {
    if (!onSearch || !open) return;
    const t = window.setTimeout(() => onSearch(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q, open, onSearch]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapperRef.current?.contains(t) && !popupRef.current?.contains(t)) {
        setOpen(false);
        setQ("");
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQ("");
    setActivo(0);
  }

  /** Flechas para moverse, Enter para elegir, Escape para salir. */
  function teclasEnLaBusqueda(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActivo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActivo(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      /* Sin `preventDefault` el Enter llega al formulario de la pantalla y lo
         manda: se guardaba el presupuesto al querer elegir un producto. */
      e.preventDefault();
      const elegida = filtered[activo];
      if (elegida) pick(elegida.id);
    } else if (e.key === "Tab") {
      // Tab sale del selector: se cierra para no dejar la lista colgada.
      setOpen(false);
      setQ("");
    }
  }

  /** Abrir con el teclado desde el botón, sin tener que clickear. */
  function teclasEnElBoton(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={teclasEnElBoton}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-left disabled:cursor-not-allowed disabled:opacity-60 hover:border-gray-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
      >
        <span className={selected ? "truncate text-slate-900" : "truncate text-slate-400"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={popupRef}
          style={{
            position: "fixed",
            left: pos.left,
            width: Math.max(pos.width, 240),
            ...(pos.arriba ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            zIndex: 1000,
          }}
          className="max-h-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={teclasEnLaBusqueda}
              role="combobox"
              aria-expanded
              aria-controls="buscador-opciones"
              aria-activedescendant={filtered[activo] ? `opcion-${filtered[activo].id}` : undefined}
              placeholder="Buscar…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-sm placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Limpiar"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ul ref={listaRef} id="buscador-opciones" role="listbox" className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">
                {loading ? "Buscando…" : onSearch && q.trim().length < 2 ? "Escribí al menos 2 letras para buscar" : emptyText}
              </li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.id} id={`opcion-${o.id}`} role="option" aria-selected={o.id === value}>
                  <button
                    type="button"
                    onClick={() => pick(o.id)}
                    /* El mouse mueve el resaltado: si no, se ve una fila
                       marcada por el teclado y otra por el mouse a la vez. */
                    onMouseEnter={() => setActivo(i)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      i === activo ? "bg-[#4FAEB2]/[0.14]" : ""
                    } ${
                      o.id === value ? "font-medium text-slate-900" : "text-slate-700"
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 font-mono text-[11px] text-slate-400">{o.hint}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
});

export default SearchableSelect;
