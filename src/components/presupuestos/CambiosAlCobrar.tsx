"use client";

/**
 * Lo que se le cambió al presupuesto en la caja.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "que salga la modificación del presupuesto a la hora de cobrar en alguna
 *    parte de presupuesto."
 *
 * ── CÓMO SE LEE ────────────────────────────────────────────────────────────
 *   Arriba, cuánto cambió el total: es lo que se mira primero, porque de ahí
 *   sale la comisión y es lo que el cliente terminó pagando. Abajo, línea por
 *   línea, qué se tocó.
 *
 *   No es rojo. Que se cambie un presupuesto en la caja no es un error: faltó
 *   mercadería, el cliente se llevó menos, se arregló un precio. Es algo que
 *   hay que saber, no una alarma.
 */

import Link from "next/link";
import { ArrowRight, Receipt } from "lucide-react";
import { textoCambio, type Cambio } from "@/lib/presupuestos/cambios-al-cobrar";
import { formatFecha } from "@/lib/fecha/asuncion";

export type AvisoCambios = {
  id: string;
  presupuesto_id?: string;
  presupuesto_numero?: string | null;
  venta_id: string | null;
  venta_numero: string | null;
  vendedor_nombre?: string | null;
  cobrado_por_nombre: string | null;
  cambios: Cambio[] | null;
  total_presupuesto: number | string;
  total_cobrado: number | string;
  created_at: string;
  visto_at: string | null;
};

const gs = (v: number | string) =>
  `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;

/** El color del tipo de cambio: lo mismo en el detalle y en la lista. */
const TONO: Record<Cambio["tipo"], string> = {
  quitado: "bg-amber-50 text-amber-800 border-amber-200",
  agregado: "bg-sky-50 text-sky-800 border-sky-200",
  cantidad: "bg-slate-50 text-slate-700 border-slate-200",
  precio: "bg-violet-50 text-violet-800 border-violet-200",
};

export function CambiosAlCobrar({
  aviso,
  conPresupuesto = false,
}: {
  aviso: AvisoCambios;
  /** En la lista de avisos hace falta decir de qué presupuesto se habla. */
  conPresupuesto?: boolean;
}) {
  const cambios = Array.isArray(aviso.cambios) ? aviso.cambios : [];
  const dif = (Number(aviso.total_cobrado) || 0) - (Number(aviso.total_presupuesto) || 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Receipt className="h-4 w-4 text-slate-400" />
            Se cobró distinto a lo presupuestado
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {conPresupuesto && aviso.presupuesto_numero ? (
              <>
                <Link
                  href={`/presupuestos/${aviso.presupuesto_id}`}
                  className="font-medium text-[#4FAEB2] hover:underline"
                >
                  {aviso.presupuesto_numero}
                </Link>
                {" · "}
              </>
            ) : null}
            {formatFecha(aviso.created_at)}
            {aviso.cobrado_por_nombre ? ` · cobró ${aviso.cobrado_por_nombre}` : ""}
          </p>
        </div>
        {/* El número de la venta y no un enlace: no hay pantalla de una venta
            sola. Con el número se la busca en Historial de ventas, que es
            donde se la anula o se la edita. */}
        {aviso.venta_numero && (
          <Link
            href={`/reportes/historial-ventas?q=${encodeURIComponent(aviso.venta_numero)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Buscar la venta {aviso.venta_numero} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* El total primero: es lo que se mira. */}
      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-2 border-t border-slate-100 pt-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Se presupuestó</p>
          <p className="text-base text-slate-700">{gs(aviso.total_presupuesto)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Se cobró</p>
          <p className="text-base font-semibold text-slate-900">{gs(aviso.total_cobrado)}</p>
        </div>
        {dif !== 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Diferencia</p>
            <p className={`text-base font-semibold ${dif > 0 ? "text-emerald-700" : "text-amber-700"}`}>
              {dif > 0 ? "+" : "−"} {gs(Math.abs(dif))}
            </p>
          </div>
        )}
      </div>

      {cambios.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {cambios.map((c, i) => (
            <li
              key={i}
              className={`rounded-lg border px-2.5 py-1 text-xs ${TONO[c.tipo] ?? TONO.cantidad}`}
            >
              {textoCambio(c)}
            </li>
          ))}
        </ul>
      )}

      {/* El presupuesto sigue siendo de quien lo armó: cobrarlo no se lo
          transfiere al que cobró. Sin esta línea, el que mira la pantalla
          puede leer el nombre de arriba como el dueño del presupuesto. */}
      {aviso.vendedor_nombre && (
        <p className="mt-3 text-[11px] text-slate-500">
          El presupuesto sigue a nombre de {aviso.vendedor_nombre}.
        </p>
      )}
    </div>
  );
}
