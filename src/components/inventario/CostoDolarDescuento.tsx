"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import {
  costoGsDesdeUsd,
  precioDesdeMarkup,
  aUsd,
  descuentoEfectivo,
  precioConDescuento,
} from "@/lib/precios/ficha";

/**
 * Bloque de la ficha de producto con el costo en dólares y los descuentos.
 *
 * Reproduce lo que muestra la ficha del sistema anterior —Costo $, Venta $,
 * Desc. Grupo %, Desc. Art %— con los datos de acá.
 *
 * ── POR QUÉ EL COSTO EN DÓLARES NO PISA EL COSTO EN GUARANÍES ────────────
 *   Se muestra a cuánto equivale a la cotización de hoy, y se ofrece un botón
 *   para copiarlo al campo de costo. No se escribe solo porque la cotización
 *   de hoy no es necesariamente a la que se pagó esa compra: el costo en
 *   guaraníes es el que quedó registrado cuando entró la mercadería, y
 *   pisarlo cada vez que se abre la ficha haría que el costo —y con él todos
 *   los márgenes— cambie sin que nadie lo haya tocado.
 */

interface Props {
  /** Costo en dólares cargado, como string del formulario. */
  costoUsd: string;
  onCostoUsdChange: (v: string) => void;
  /** Precio de VENTA en dólares. Vacío = el producto se vende en guaraníes. */
  precioUsd: string;
  onPrecioUsdChange: (v: string) => void;
  /** Descuento propio del artículo, en porcentaje. */
  descuentoPct: string;
  onDescuentoChange: (v: string) => void;
  /** Descuento del rubro elegido, para poder decir cuál manda. */
  descuentoRubro?: number | null;
  /** Costo y precio en guaraníes que tiene el formulario en este momento. */
  costoGs: string;
  precioGs: string;
  markupPct: string;
  /** Para el botón que copia el costo convertido al campo en guaraníes. */
  onUsarCostoGs?: (gs: number) => void;
  disabled?: boolean;
}

const labelClass = "block text-sm font-medium text-gray-600 mb-1.5";
const inputClass =
  "w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none";

const fmtGs = (n: number) => "Gs. " + Math.round(n).toLocaleString("es-PY");
const fmtUsd = (n: number) => "US$ " + n.toLocaleString("es-PY", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export default function CostoDolarDescuento({
  costoUsd,
  onCostoUsdChange,
  precioUsd,
  onPrecioUsdChange,
  descuentoPct,
  onDescuentoChange,
  descuentoRubro,
  costoGs,
  precioGs,
  markupPct,
  onUsarCostoGs,
  disabled,
}: Props) {
  const [tcVenta, setTcVenta] = useState<number | null>(null);
  const precioUsdNum = Number(String(precioUsd).replace(",", ".")) || 0;
  const [tcCompra, setTcCompra] = useState<number | null>(null);

  useEffect(() => {
    apiFetch("/api/tipos-cambio?limit=1")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.success) return;
        const v = j.data?.vigente;
        if (v) {
          setTcVenta(Number(v.venta) || null);
          setTcCompra(Number(v.compra) || null);
        }
      })
      // Sin cotización el bloque sigue sirviendo: se carga el costo en dólares
      // igual, solo que no se muestra el equivalente.
      .catch(() => {});
  }, []);

  const costoConvertido = costoGsDesdeUsd(costoUsd, tcVenta);
  const ventaUsdDesdeMarkup = precioDesdeMarkup(costoUsd, markupPct);
  const precioEnUsd = aUsd(precioGs, tcCompra);
  const desc = descuentoEfectivo(descuentoPct, descuentoRubro);
  const precioFinal = precioConDescuento(precioGs, desc.pct);
  const precioNum = Number(precioGs) || 0;

  return (
    <div className="mt-6 rounded-xl border-2 border-slate-100 bg-slate-50/60 p-4">
      <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
        Dólares y descuentos
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            Costo en dólares <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">US$</span>
            <input
              type="number"
              value={costoUsd}
              onChange={(e) => onCostoUsdChange(e.target.value)}
              placeholder="Ej: 6.3800"
              step="0.0001"
              min="0"
              disabled={disabled}
              className={`${inputClass} pl-11`}
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            El de la factura del proveedor. Se guarda tal cual para que no cambie cuando se mueve el dólar.
          </p>
        </div>

        <div>
          {/* El costo en dólares se congela al guardar; el PRECIO en dólares
              no. Mientras esté cargado, el precio en guaraníes se recalcula
              al vender con la cotización del día, que es como trabajaba el
              cliente en su sistema anterior. */}
          <label className={labelClass}>
            Precio de venta en dólares <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">US$</span>
            <input
              type="number"
              value={precioUsd}
              onChange={(e) => onPrecioUsdChange(e.target.value)}
              placeholder="Ej: 6.3800"
              step="0.0001"
              min="0"
              disabled={disabled}
              className={`${inputClass} pl-11`}
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {precioUsdNum && precioUsdNum > 0 && tcVenta
              ? `Hoy sale ${fmtGs(precioUsdNum * tcVenta)} al cambio de ${fmtGs(tcVenta)}. Si el dólar se mueve, el precio acompaña solo.`
              : "Cargalo y el precio en guaraníes se calcula al vender, con la cotización del día. Vacío = se vende en guaraníes."}
          </p>
        </div>

        <div>
          <label className={labelClass}>
            Descuento del artículo <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <div className="relative">
            <input
              type="number"
              value={descuentoPct}
              onChange={(e) => onDescuentoChange(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              max="100"
              disabled={disabled}
              className={`${inputClass} pr-8`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {descuentoRubro && descuentoRubro > 0
              ? `El rubro tiene ${descuentoRubro}%. Si acá cargás uno, reemplaza al del rubro (no se suman).`
              : "Si queda en cero, se usa el del rubro."}
          </p>
        </div>
      </div>

      {(costoConvertido !== null || precioEnUsd !== null || desc.pct > 0) && (
        <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-xs">
          {costoConvertido !== null && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">
                Costo equivalente a la cotización de hoy{tcVenta ? ` (${fmtGs(tcVenta)} por dólar)` : ""}
              </dt>
              <dd className="flex items-center gap-2">
                <span className="font-semibold tabular-nums text-slate-700">{fmtGs(costoConvertido)}</span>
                {onUsarCostoGs && Math.round(costoConvertido) !== Math.round(Number(costoGs) || 0) && (
                  <button
                    type="button"
                    onClick={() => onUsarCostoGs(Math.round(costoConvertido))}
                    disabled={disabled}
                    className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5"
                  >
                    Usar como costo
                  </button>
                )}
              </dd>
            </div>
          )}
          {ventaUsdDesdeMarkup !== null && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Venta en dólares con el {Number(markupPct) || 0}% cargado</dt>
              <dd className="font-semibold tabular-nums text-slate-700">{fmtUsd(ventaUsdDesdeMarkup)}</dd>
            </div>
          )}
          {precioEnUsd !== null && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Precio de venta actual, en dólares</dt>
              <dd className="font-semibold tabular-nums text-slate-700">{fmtUsd(precioEnUsd)}</dd>
            </div>
          )}
          {desc.pct > 0 && precioFinal !== null && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1.5">
              <dt className="text-slate-500">
                Con {desc.pct}% de descuento {desc.origen === "rubro" ? "del rubro" : "del artículo"}
              </dt>
              <dd className="font-semibold tabular-nums text-emerald-700">
                {fmtGs(precioFinal)}
                <span className="ml-1 font-normal text-slate-400">(−{fmtGs(precioNum - precioFinal)})</span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
