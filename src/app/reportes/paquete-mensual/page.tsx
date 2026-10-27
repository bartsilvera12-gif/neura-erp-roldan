"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { mesActualAsuncion, mesAnterior, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";

/**
 * Paquete mensual de contabilidad.
 *
 * Un mes, un botón, un ZIP con todos los informes. Antes el cierre se armaba
 * bajando doce planillas de doce pantallas distintas, acordándose de poner el
 * mismo mes en cada una.
 *
 * ── POR QUÉ TODAS LAS TILDES ARRANCAN MARCADAS ────────────────────────────
 *   Lo normal es querer el paquete completo; destildar es la excepción (volver
 *   a pedir un solo informe que salió mal, o saltear uno que todavía no está
 *   configurado). Arrancar con todo marcado hace que el caso normal sea un
 *   solo clic.
 */

interface ReporteCatalogo {
  id: string;
  nombre: string;
  descripcion: string;
  orden: number;
}

/**
 * El mes propuesto es el ANTERIOR al actual: el que se cierra, no el que está
 * en curso. Se usan los helpers de `asuncion-bounds` y no `new Date()` del
 * navegador porque ahí está resuelto que Paraguay es UTC−3 todo el año: con la
 * hora local, entre las 21:00 y la medianoche del último día del mes la
 * pantalla ya estaría proponiendo cerrar un mes que todavía no empezó.
 */
const mesACerrar = () => mesAnterior(mesActualAsuncion());

export default function PaqueteMensualPage() {
  const [mes, setMes] = useState(mesACerrar());
  const [catalogo, setCatalogo] = useState<ReporteCatalogo[]>([]);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/contabilidad/paquete?catalogo=1")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.success) {
          setError(j?.error ?? `No se pudo leer la lista de informes (${r.status}).`);
          return;
        }
        const reps = (j.data?.reportes ?? []) as ReporteCatalogo[];
        setCatalogo(reps);
        setElegidos(new Set(reps.map((x) => x.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error de red"))
      .finally(() => setCargandoCatalogo(false));
  }, []);

  const todos = elegidos.size === catalogo.length && catalogo.length > 0;

  const alternar = useCallback((id: string) => {
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  // Mismo nombre de mes que el resto del sistema: la etiqueta sale del helper
  // compartido y no de un arreglo copiado acá, que ya había salido escrito con
  // otra ortografía.
  const mesLegible = useMemo(() => (/^\d{4}-\d{2}$/.test(mes) ? mesLabelLargo(mes) : mes), [mes]);

  async function descargar() {
    setError(null);
    setAviso(null);
    setBajando(true);
    try {
      const p = new URLSearchParams({ mes });
      if (!todos) p.set("reportes", [...elegidos].join(","));
      const r = await apiFetch(`/api/contabilidad/paquete?${p.toString()}`);
      if (!r.ok) {
        setError(await r.text().catch(() => `No se pudo armar el paquete (${r.status}).`));
        return;
      }

      // El servidor avisa por cabecera si algún informe quedó afuera, para no
      // tener que abrir el ZIP para enterarse.
      const fallaron = Number(r.headers.get("X-Paquete-Errores") ?? "0");
      const incluidos = Number(r.headers.get("X-Paquete-Informes") ?? "0");

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cierre-${mes}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setAviso(
        fallaron > 0
          ? `Se descargaron ${incluidos} informes, pero ${fallaron} no se pudieron generar. El motivo está en _ERRORES.txt, adentro del ZIP.`
          : `Listo: ${incluidos} informes de ${mesLegible}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al descargar el paquete");
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div>
        <nav className="mb-1 text-xs text-slate-500">
          <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> /{" "}
          <span className="font-semibold text-slate-700">Paquete mensual</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Paquete mensual</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Descarga en un solo ZIP todos los informes del mes, cada uno en su planilla de Excel
          con encabezado, totales y formato listo para imprimir. Es lo que se le manda al
          contador: en vez de bajar doce planillas de doce pantallas, se elige el mes una vez.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs font-semibold text-slate-500">
            Mes a cerrar
            <input
              type="month"
              value={mes}
              max={mesActualAsuncion()}
              onChange={(e) => setMes(e.target.value)}
              className="mt-1 block w-44 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={descargar}
            disabled={bajando || elegidos.size === 0 || cargandoCatalogo}
            className="rounded-xl bg-[#3F8E91] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#357a7d] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bajando ? "Armando el paquete…" : `Descargar ZIP (${elegidos.size})`}
          </button>
          {bajando && (
            <p className="text-xs text-slate-500">
              Se generan de a uno. Con mucho movimiento puede tardar un minuto; no cierres la pantalla.
            </p>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          El paquete sale de tu sucursal. Cada usuario ve solo la suya, así que para el cierre
          de la otra sucursal lo tiene que descargar alguien de ahí.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {aviso && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Qué incluye</h2>
          <button
            onClick={() => setElegidos(todos ? new Set() : new Set(catalogo.map((x) => x.id)))}
            disabled={cargandoCatalogo}
            className="text-xs font-semibold text-[#3F8E91] hover:underline disabled:opacity-50"
          >
            {todos ? "Desmarcar todos" : "Marcar todos"}
          </button>
        </div>

        {cargandoCatalogo ? (
          <p className="px-4 py-6 text-sm text-slate-400">Cargando la lista de informes…</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {catalogo.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={elegidos.has(r.id)}
                    onChange={() => alternar(r.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#3F8E91] focus:ring-[#4FAEB2]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{r.nombre}</span>
                    <span className="block text-xs text-slate-500">{r.descripcion}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-700">Para tener en cuenta</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            Los totales de las planillas son fórmulas <code>SUBTOTAL</code>: si se filtra una
            columna en Excel, el total se recalcula con lo que queda a la vista.
          </li>
          <li>
            <strong>Stock con precios</strong> es una foto del stock de hoy, no del cierre del
            mes: el stock es un saldo y el sistema no lo guarda mes por mes.
          </li>
          <li>
            Si a un informe le falta una configuración, el ZIP se arma igual con los demás y el
            motivo queda escrito en <code>_ERRORES.txt</code>.
          </li>
        </ul>
      </div>
    </div>
  );
}
