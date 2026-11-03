"use client";

import { useState } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";

/**
 * Factura y recibo que respaldan un egreso de caja (punto 5.7).
 *
 * ── POR QUÉ SE SUBEN ANTES DE REGISTRAR EL EGRESO ────────────────────────
 *   El archivo viaja primero y el egreso se guarda después, con la referencia
 *   ya en la mano. Al revés —guardar el egreso y después subir— un corte de
 *   internet en el medio dejaría un egreso diciendo que tiene comprobante
 *   cuando no se subió nada. Así, lo peor que pasa es un archivo huérfano,
 *   que no le miente a nadie.
 *
 * ── DOS TIPOS Y NO UNA LISTA LIBRE ───────────────────────────────────────
 *   La factura es el papel del proveedor y el recibo es el comprobante de que
 *   se pagó. No son lo mismo y el contador pide los dos por separado; una
 *   lista de "archivos" sueltos obligaría a abrirlos para saber cuál es cuál.
 */

export interface AdjuntoEgreso {
  tipo: "factura" | "recibo";
  nombre: string;
  path: string;
}

const TIPOS: { tipo: "factura" | "recibo"; label: string; ayuda: string }[] = [
  { tipo: "factura", label: "Factura", ayuda: "El papel del proveedor" },
  { tipo: "recibo", label: "Recibo", ayuda: "El comprobante de que se pagó" },
];

/** Lo que acepta el servidor (ver `ALLOWED_COMPROBANTE_MIME`). */
const ACEPTADOS = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export default function AdjuntosEgreso({
  value,
  onChange,
  disabled,
}: {
  value: AdjuntoEgreso[];
  onChange: (v: AdjuntoEgreso[]) => void;
  disabled?: boolean;
}) {
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Qué recuadro está listo para recibir un Ctrl+V. */
  const [pegandoEn, setPegandoEn] = useState<"factura" | "recibo" | null>(null);

  async function subir(tipo: "factura" | "recibo", file: File) {
    setSubiendo(tipo);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/caja/comprobante/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setErr(j?.error ?? `No se pudo subir (${r.status}).`);
        return;
      }
      // Reemplaza el del mismo tipo: una factura por egreso, no una pila.
      const resto = value.filter((a) => a.tipo !== tipo);
      onChange([...resto, { tipo, nombre: j.data.nombre, path: j.data.path }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red al subir.");
    } finally {
      setSubiendo(null);
    }
  }

  /**
   * Pegar una captura con Ctrl+V.
   *
   * ── POR QUÉ ──────────────────────────────────────────────────────────────
   * La factura del proveedor llega casi siempre como foto por WhatsApp. Con
   * solo el botón de elegir archivo hay que guardar la imagen en el disco,
   * acordarse de dónde quedó y buscarla: tres pasos para algo que es un
   * Ctrl+V. En la práctica eso termina en egresos sin comprobante.
   *
   * El portapapeles puede traer varias cosas (el texto del chat y la imagen).
   * Se toma el primer archivo que sea imagen o PDF y se ignora el resto.
   *
   * A la captura pegada el navegador le pone `image.png` a todas por igual, así
   * que se renombra con la hora: en el storage, veinte archivos llamados
   * `image.png` no se distinguen entre sí.
   */
  async function pegar(tipo: "factura" | "recibo", e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const archivo = items
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      // Los mismos tipos que acepta el servidor: si se filtrara por
      // `image/*` a secas, un GIF pasaría acá y lo rechazaría el upload con un
      // error que no dice qué hacer.
      .find((f): f is File => !!f && ACEPTADOS.has(f.type));

    if (!archivo) {
      setErr("Lo que pegaste no es una imagen ni un PDF. Copiá la captura y probá de nuevo.");
      return;
    }
    e.preventDefault();

    const ext = archivo.type === "application/pdf" ? "pdf" : (archivo.type.split("/")[1] || "png");
    const ahora = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const sello = `${p2(ahora.getDate())}-${p2(ahora.getMonth() + 1)} ${p2(ahora.getHours())}.${p2(ahora.getMinutes())}.${p2(ahora.getSeconds())}`;
    const conNombre =
      archivo.name && archivo.name !== "image.png"
        ? archivo
        : new File([archivo], `${tipo} pegada ${sello}.${ext}`, { type: archivo.type });

    await subir(tipo, conNombre);
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
        Comprobantes <span className="font-normal normal-case text-slate-400">(opcional)</span>
      </label>
      <p className="mb-1.5 text-[11px] leading-snug text-slate-500">
        Podés <strong>pegar una captura con Ctrl+V</strong>: hacé clic en el recuadro y pegá.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TIPOS.map(({ tipo, label, ayuda }) => {
          const cargado = value.find((a) => a.tipo === tipo);
          const ocupado = subiendo === tipo;
          return (
            <div
              key={tipo}
              /* `tabIndex` para que el recuadro pueda tomar el foco: sin foco
                 el navegador no entrega el evento de pegar. */
              tabIndex={disabled || ocupado ? -1 : 0}
              onPaste={(e) => { if (!disabled && !ocupado) void pegar(tipo, e); }}
              onFocus={() => setPegandoEn(tipo)}
              onBlur={() => setPegandoEn((p) => (p === tipo ? null : p))}
              className={`rounded-lg border-2 border-dashed p-2.5 outline-none transition-colors ${
                pegandoEn === tipo
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/5"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <p className="text-xs font-semibold text-slate-700">{label}</p>
              {cargado ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600" title={cargado.nombre}>
                    {cargado.nombre}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((a) => a.tipo !== tipo))}
                    disabled={disabled || ocupado}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    title="Quitar"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-[11px] text-slate-400">{ayuda}</p>
                  {pegandoEn === tipo && (
                    <p className="text-[11px] font-medium text-[#3F8E91]">
                      Pegá la captura con Ctrl+V
                    </p>
                  )}
                  <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
                    {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                    {ocupado ? "Subiendo…" : "Elegir archivo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      disabled={disabled || ocupado}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        // Se limpia el input para que elegir el mismo archivo
                        // dos veces seguidas vuelva a disparar el evento.
                        e.target.value = "";
                        if (f) subir(tipo, f);
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">Foto (JPG o PNG) o PDF, hasta 10 MB.</p>
      {err && <p className="mt-1.5 text-[11px] text-red-700">{err}</p>}
    </div>
  );
}
