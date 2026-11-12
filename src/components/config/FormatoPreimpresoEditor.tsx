"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { FORMATO_POR_DEFECTO, type FormatoPreimpreso, type Punto } from "@/lib/facturacion/preimpresa";

/**
 * Talonario preimpreso: tipo de papel y dónde cae cada dato (en mm).
 *
 * Se imprime la hoja de prueba sobre una factura en blanco, se mide cuánto se
 * corrió cada dato y se corrige acá. Si todo está corrido igual (la impresora
 * toma el papel un poco más arriba, por ejemplo) alcanza con el "corrimiento
 * general".
 */

const inp = "w-20 rounded-md border border-slate-200 px-2 py-1 text-sm tabular-nums";

export default function FormatoPreimpresoEditor() {
  const [tipo, setTipo] = useState<"preimpresa" | "autoimpresor">("preimpresa");
  const [f, setF] = useState<FormatoPreimpreso>(FORMATO_POR_DEFECTO);
  const [aviso, setAviso] = useState<{ ok: boolean; t: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void fetchWithSupabaseSession("/api/configuracion/factura-preimpresa", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        setTipo(j.data.tipo_papel === "autoimpresor" ? "autoimpresor" : "preimpresa");
        setF(j.data.formato as FormatoPreimpreso);
        if (j.data.falta_script) setAviso({ ok: false, t: "Falta correr el script 87 para guardar el formato del talonario." });
      })
      .catch(() => {});
  }, []);

  const punto = (k: keyof FormatoPreimpreso, etiqueta: string) => {
    const p = f[k] as Punto;
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-600">{etiqueta}</span>
        <span className="flex items-center gap-1">
          <span className="text-[11px] text-slate-400">x</span>
          <input type="number" step="0.5" className={inp} value={p.x} onChange={(e) => setF({ ...f, [k]: { ...p, x: Number(e.target.value) } })} />
          <span className="text-[11px] text-slate-400">y</span>
          <input type="number" step="0.5" className={inp} value={p.y} onChange={(e) => setF({ ...f, [k]: { ...p, y: Number(e.target.value) } })} />
        </span>
      </div>
    );
  };
  const numero = (valor: number, set: (n: number) => void, etiqueta: string) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-600">{etiqueta}</span>
      <input type="number" step="0.5" className={inp} value={valor} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/factura-preimpresa", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo_papel: tipo, formato: f }),
      });
      const j = await r.json().catch(() => null);
      setAviso(r.ok && j?.success ? { ok: true, t: "Guardado." } : { ok: false, t: j?.error ?? "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Papel de la factura</h3>
        {aviso && <span className={`text-xs ${aviso.ok ? "text-emerald-600" : "text-red-700"}`}>{aviso.t}</span>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {([
          ["preimpresa", "Talonario preimpreso (imprenta)", "El talonario ya trae timbrado, RUC, número y recuadros. El sistema escribe solo los datos de la venta en su lugar."],
          ["autoimpresor", "Hoja en blanco (autoimpresor)", "El sistema imprime la factura entera. Solo con timbrado de autoimpresor."],
        ] as const).map(([v, t, d]) => (
          <button key={v} type="button" onClick={() => setTipo(v)}
            className={`rounded-lg border px-3 py-2 text-left ${tipo === v ? "border-[#4FAEB2] bg-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]" : "border-slate-200 hover:border-slate-300"}`}>
            <span className="block text-sm font-semibold text-slate-800">{t}</span>
            <span className="block text-xs text-slate-500">{d}</span>
          </button>
        ))}
      </div>

      {tipo === "preimpresa" && (
        <>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Posiciones en <strong>milímetros</strong> desde la esquina superior izquierda de la hoja. En los importes, la
            posición es el <strong>borde derecho</strong> (los números se alinean a la derecha). Imprimí la hoja de prueba
            sobre una factura en blanco, medí cuánto se corrió cada dato y corregilo acá.
          </p>
          <div className="mt-3 grid gap-x-8 gap-y-2 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Hoja</p>
              {numero(f.hoja.ancho, (n) => setF({ ...f, hoja: { ...f.hoja, ancho: n } }), "Ancho de la hoja")}
              {numero(f.hoja.alto, (n) => setF({ ...f, hoja: { ...f.hoja, alto: n } }), "Alto de la hoja")}
              {punto("ajuste", "Corrimiento general")}
              {numero(f.letra, (n) => setF({ ...f, letra: n }), "Tamaño de letra (pt)")}
              <p className="pt-2 text-[11px] font-semibold uppercase text-slate-400">Cabecera</p>
              {punto("fecha", "Fecha")}
              {punto("contado", "X de Contado")}
              {punto("credito", "X de Crédito")}
              {punto("razon_social", "Nombre / razón social")}
              {punto("ruc", "RUC / C.I.")}
              {punto("direccion", "Dirección")}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Productos</p>
              {numero(f.items.y, (n) => setF({ ...f, items: { ...f.items, y: n } }), "Primera fila (y)")}
              {numero(f.items.alto_fila, (n) => setF({ ...f, items: { ...f.items, alto_fila: n } }), "Alto de cada fila")}
              {numero(f.items.max_filas, (n) => setF({ ...f, items: { ...f.items, max_filas: Math.max(1, Math.round(n)) } }), "Renglones del talonario")}
              {numero(f.col.cantidad, (n) => setF({ ...f, col: { ...f.col, cantidad: n } }), "Cantidad (x)")}
              {numero(f.col.descripcion, (n) => setF({ ...f, col: { ...f.col, descripcion: n } }), "Descripción (x)")}
              {numero(f.col.ancho_descripcion, (n) => setF({ ...f, col: { ...f.col, ancho_descripcion: n } }), "Ancho de la descripción")}
              {numero(f.col.precio, (n) => setF({ ...f, col: { ...f.col, precio: n } }), "Precio unitario (borde der.)")}
              {numero(f.col.exentas, (n) => setF({ ...f, col: { ...f.col, exentas: n } }), "Exentas (borde der.)")}
              {numero(f.col.iva5, (n) => setF({ ...f, col: { ...f.col, iva5: n } }), "5% (borde der.)")}
              {numero(f.col.iva10, (n) => setF({ ...f, col: { ...f.col, iva10: n } }), "10% (borde der.)")}
              <p className="pt-2 text-[11px] font-semibold uppercase text-slate-400">Totales</p>
              {numero(f.subtotales_y, (n) => setF({ ...f, subtotales_y: n }), "Subtotales (y)")}
              {punto("total_letras", "Total en letras")}
              {punto("total_numero", "Total a pagar (borde der.)")}
              {punto("liq_iva5", "Liquidación IVA 5%")}
              {punto("liq_iva10", "Liquidación IVA 10%")}
              {punto("liq_total", "Total IVA")}
            </div>
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {tipo === "preimpresa" && (
          <>
            <button type="button" onClick={() => setF(FORMATO_POR_DEFECTO)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Volver a los valores por defecto</button>
            <a href="/api/configuracion/factura-preimpresa?prueba=1" target="_blank" rel="noreferrer"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Imprimir hoja de prueba
            </a>
          </>
        )}
        <button type="button" onClick={() => void guardar()} disabled={guardando}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar papel y posiciones"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">La hoja de prueba usa lo último GUARDADO: guardá antes de imprimirla.</p>
    </div>
  );
}
