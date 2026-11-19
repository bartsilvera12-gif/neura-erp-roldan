"use client";

import { useEffect, useState } from "react";

export type ClienteElegido = { id: string; nombre: string; ruc: string };

/**
 * Buscador de clientes por nombre, RUC o código (el servidor devuelve los 20
 * que coinciden). Mismo criterio que el de Anticipos: con veinte mil
 * clientes un desplegable no sirve.
 */
export default function BuscadorCliente({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: ClienteElegido | null;
  onChange: (c: ClienteElegido | null) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [lista, setLista] = useState<ClienteElegido[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);

  useEffect(() => {
    const t = busqueda.trim();
    if (t.length < 2) { setLista([]); return; }
    const id = setTimeout(() => {
      setBuscando(true);
      fetch(`/api/clientes?limite=20&q=${encodeURIComponent(t)}`, { credentials: "include", cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!j?.success) return;
          const crudo = (Array.isArray(j.data) ? j.data : (j.data?.clientes ?? [])) as Array<Record<string, unknown>>;
          setLista(crudo.map((c) => ({
            id: String(c.id),
            nombre: String(c.nombre_facturacion ?? c.empresa ?? c.nombre_contacto ?? c.nombre ?? ""),
            ruc: c.ruc == null ? "" : String(c.ruc).trim(),
          })).filter((c) => c.nombre));
          setMarcado(0);
        })
        .catch(() => { /* sin resultados */ })
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(id);
  }, [busqueda]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-slate-200 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">{value.nombre}</span>
          <span className="block truncate text-[11px] tabular-nums text-slate-500">RUC {value.ruc || "—"}</span>
        </span>
        {!disabled && (
          <button type="button" onClick={() => { onChange(null); setBusqueda(""); }}
            className="shrink-0 text-xs font-medium text-sky-700 hover:text-sky-900">
            Cambiar
          </button>
        )}
      </div>
    );
  }

  const elegir = (c: ClienteElegido) => { onChange(c); setAbierto(false); };

  return (
    <div>
      <input
        autoFocus={autoFocus}
        disabled={disabled}
        value={busqueda}
        onChange={(e) => { setBusqueda(e.target.value); setAbierto(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => Math.min(m + 1, lista.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
          else if (e.key === "Enter" && lista[marcado]) { e.preventDefault(); elegir(lista[marcado]); }
        }}
        placeholder="Buscar cliente por nombre, RUC o código…"
        className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
      />
      {abierto && busqueda.trim().length >= 2 && (
        <div className="mt-1 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {buscando ? (
            <p className="px-3 py-2 text-xs text-slate-400">Buscando…</p>
          ) : lista.length === 0 ? (
            <p className="px-3 py-2 text-xs text-amber-700">Ningún cliente coincide con “{busqueda.trim()}”.</p>
          ) : (
            lista.map((c, i) => (
              <button key={c.id} type="button" onClick={() => elegir(c)}
                className={`block w-full px-3 py-2 text-left hover:bg-sky-50 ${i === marcado ? "bg-sky-50" : ""}`}>
                <span className="block truncate text-sm text-slate-800">{c.nombre}</span>
                <span className="block truncate text-[11px] tabular-nums text-slate-500">RUC {c.ruc || "—"}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
