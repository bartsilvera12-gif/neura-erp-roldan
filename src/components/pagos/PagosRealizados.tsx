"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import AccionesTabla from "@/components/ui/AccionesTabla";
import Selector from "@/components/ui/Selector";
import { Metrica, FilaDeMetricas } from "@/components/ui/Metrica";
import { ChevronDown, ChevronRight, FileCheck2, Image as ImageIcon, Search, Receipt } from "lucide-react";

/**
 * Pagos realizados a proveedores.
 *
 * Lo que ya se pagó, en un solo lugar: cuándo, a quién, qué facturas cubrió,
 * con qué (cheque y su número, transferencia, efectivo) y el recibo del
 * proveedor. Es lo que se busca cuando un proveedor vuelve a reclamar una
 * factura que ya se le pagó: se escribe el número de factura y aparece el
 * pago con su recibo.
 */

type Factura = { numero_control: string; numero_factura: string | null; fecha_factura: string | null; total: number };
type Pago = {
  clave: string;
  fecha: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string;
  medio: string | null;
  referencia: string | null;
  total: number;
  facturas: Factura[];
  cheque: { id: string; numero: string | null; banco: string | null; numero_recibo: string | null; fecha_recibo: string | null; imagen_path: string | null } | null;
  recibo_path: string | null;
};

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fmt = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
const hoyPy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const masDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MEDIOS: Record<string, string> = {
  cheque: "Cheque", transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta", deposito: "Depósito",
};
const medioTexto = (m: string | null) => (m ? MEDIOS[m] ?? m.charAt(0).toUpperCase() + m.slice(1) : "—");

const PERIODOS = [
  { v: "30", t: "Últimos 30 días" },
  { v: "90", t: "Últimos 3 meses" },
  { v: "365", t: "Último año" },
  { v: "rango", t: "Elegir fechas…" },
  { v: "sin_fecha", t: "Pagadas sin fecha de pago" },
];

async function abrirArchivo(path: string) {
  const w = window.open("", "_blank");
  try {
    const r = await apiFetch(`/api/cheques/recibo?path=${encodeURIComponent(path)}`);
    const j = await r.json().catch(() => null);
    if (w && j?.data?.url) w.location.href = j.data.url;
    else w?.close();
  } catch {
    w?.close();
  }
}

export default function PagosRealizados() {
  const [periodo, setPeriodo] = useState("90");
  const [desde, setDesde] = useState(masDias(hoyPy(), -90));
  const [hasta, setHasta] = useState(hoyPy());
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [medio, setMedio] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const hoy = hoyPy();
      const qs = periodo === "sin_fecha"
        ? "sin_fecha=1"
        : periodo === "rango"
          ? `desde=${desde}&hasta=${hasta}`
          : `desde=${masDias(hoy, -Number(periodo))}&hasta=${hoy}`;
      const r = await apiFetch(`/api/pagos/realizados?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setPagos((j.data?.pagos ?? []) as Pago[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setPagos([]);
    } finally {
      setCargando(false);
    }
  }, [periodo, desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  const proveedores = useMemo(
    () => [...new Set(pagos.map((p) => p.proveedor_nombre))].sort((a, b) => a.localeCompare(b, "es")),
    [pagos]
  );
  const medios = useMemo(() => [...new Set(pagos.map((p) => p.medio ?? ""))].filter(Boolean).sort(), [pagos]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pagos.filter((p) => {
      if (proveedor && p.proveedor_nombre !== proveedor) return false;
      if (medio && (p.medio ?? "") !== medio) return false;
      if (!s) return true;
      const texto = [
        p.proveedor_nombre, p.referencia, p.cheque?.numero, p.cheque?.numero_recibo, p.cheque?.banco,
        ...p.facturas.flatMap((f) => [f.numero_factura, f.numero_control]),
      ].filter(Boolean).join(" ").toLowerCase();
      return texto.includes(s);
    });
  }, [pagos, q, proveedor, medio]);

  const total = visibles.reduce((s, p) => s + p.total, 0);
  const cantFacturas = visibles.reduce((s, p) => s + p.facturas.length, 0);
  const conRecibo = visibles.filter((p) => p.recibo_path || p.cheque?.numero_recibo).length;

  function alternar(k: string) {
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }

  return (
    <div className="space-y-4">
      <FilaDeMetricas>
        <Metrica etiqueta="Pagado" valor={gs(total)} detalle={`${visibles.length} pagos`} cargando={cargando} />
        <Metrica etiqueta="Facturas saldadas" valor={cantFacturas} detalle="en el período" cargando={cargando} />
        <Metrica etiqueta="Con recibo del proveedor" valor={`${conRecibo} de ${visibles.length}`}
          detalle="La prueba si vuelven a reclamar" cargando={cargando} />
      </FilaDeMetricas>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Período (fecha de pago)</span>
          <Selector value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
          </Selector>
        </label>
        {periodo === "rango" && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-500">Desde</span>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-500">Hasta</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Proveedor</span>
          <Selector value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-60 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Todos</option>
            {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
          </Selector>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Medio</span>
          <Selector value={medio} onChange={(e) => setMedio(e.target.value)} className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Todos</option>
            {medios.map((m) => <option key={m} value={m}>{medioTexto(m)}</option>)}
          </Selector>
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Buscar</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="N° de factura, de cheque o de recibo…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
          </span>
        </label>
        <AccionesTabla
          titulo="Pagos realizados a proveedores"
          archivo="pagos-realizados"
          columnas={["Fecha de pago", "Proveedor", "Facturas", "Medio", "N° cheque", "Banco", "N° recibo", "Referencia", "Importe"]}
          filas={visibles.map((p) => [
            fmt(p.fecha),
            p.proveedor_nombre,
            p.facturas.map((f) => f.numero_factura ?? f.numero_control).join(", "),
            medioTexto(p.medio),
            p.cheque?.numero ?? "",
            p.cheque?.banco ?? "",
            p.cheque?.numero_recibo ?? "",
            p.referencia ?? "",
            p.total,
          ])}
          sumar={[8]}
        />
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : visibles.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-14 text-center">
          <Receipt className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 font-medium text-slate-700">
            {pagos.length === 0 ? "No hay pagos registrados en este período." : "Ningún pago coincide con el filtro."}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Un pago aparece acá cuando la factura se marca pagada o cuando se carga el recibo del cheque.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5 font-semibold">Fecha</th>
                  <th className="px-3 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-3 py-2.5 font-semibold">Facturas</th>
                  <th className="px-3 py-2.5 font-semibold">Medio</th>
                  <th className="px-3 py-2.5 font-semibold">Recibo</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Importe</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => {
                  const abierto = abiertos.has(p.clave);
                  const varias = p.facturas.length > 1;
                  return (
                    <FilaPago key={p.clave} p={p} abierto={abierto} varias={varias} onToggle={() => alternar(p.clave)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaPago({ p, abierto, varias, onToggle }: { p: Pago; abierto: boolean; varias: boolean; onToggle: () => void }) {
  const primera = p.facturas[0];
  return (
    <>
      <tr onClick={varias ? onToggle : undefined}
        className={`border-b border-slate-100 align-top ${varias ? "cursor-pointer hover:bg-slate-50" : ""}`}>
        <td className="px-3 py-3 text-slate-400">
          {varias ? (abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
        </td>
        <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">{fmt(p.fecha)}</td>
        <td className="px-3 py-3 font-medium text-slate-900">{p.proveedor_nombre}</td>
        <td className="px-3 py-3 text-slate-700">
          {varias ? (
            <span>{p.facturas.length} facturas</span>
          ) : (
            <span>{primera?.numero_factura ?? "—"} <span className="font-mono text-xs text-slate-400">{primera?.numero_control}</span></span>
          )}
        </td>
        <td className="px-3 py-3 text-slate-700">
          {medioTexto(p.medio)}
          {p.cheque && (
            <span className="block text-xs text-slate-500">
              N° {p.cheque.numero ?? "—"}{p.cheque.banco ? ` · ${p.cheque.banco}` : ""}
            </span>
          )}
          {!p.cheque && p.referencia && <span className="block max-w-[220px] truncate text-xs text-slate-500" title={p.referencia}>{p.referencia}</span>}
        </td>
        <td className="px-3 py-3">
          {p.cheque?.numero_recibo ? (
            <span className="font-medium text-slate-800">N° {p.cheque.numero_recibo}</span>
          ) : p.recibo_path ? (
            <span className="text-slate-600">Adjunto</span>
          ) : (
            <span className="text-xs text-amber-700">Sin recibo</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{gs(p.total)}</td>
        <td className="whitespace-nowrap px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <span className="inline-flex gap-2">
            {p.recibo_path && (
              <button type="button" onClick={() => void abrirArchivo(p.recibo_path!)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/10">
                <FileCheck2 className="h-3.5 w-3.5" /> Recibo
              </button>
            )}
            {p.cheque?.imagen_path && (
              <button type="button" onClick={() => void abrirArchivo(p.cheque!.imagen_path!)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/10">
                <ImageIcon className="h-3.5 w-3.5" /> Cheque
              </button>
            )}
          </span>
        </td>
      </tr>
      {varias && abierto && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td />
          <td colSpan={7} className="px-3 py-2">
            <ul className="divide-y divide-slate-100">
              {p.facturas.map((f) => (
                <li key={f.numero_control} className="flex items-center gap-4 py-1.5 text-xs">
                  <span className="w-28 font-medium text-slate-800">{f.numero_factura ?? "—"}</span>
                  <span className="w-24 font-mono text-slate-400">{f.numero_control}</span>
                  <span className="w-24 tabular-nums text-slate-500">{fmt(f.fecha_factura)}</span>
                  <span className="ml-auto tabular-nums font-medium text-slate-700">{gs(f.total)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
