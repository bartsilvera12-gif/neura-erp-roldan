"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import Selector from "@/components/ui/Selector";

/**
 * A qué cuenta del plan va cada clase de egreso de caja.
 *
 * ── POR QUÉ EXISTE ESTA PANTALLA ──────────────────────────────────────────
 * Los egresos ya se clasificaban —pago a proveedor, flete, sueldo, servicios,
 * impuestos— pero esa clase no estaba atada a ninguna cuenta. Para el contador
 * todos los egresos del mes caían en una sola bolsa, y separar el sueldo del
 * flete y del impuesto era trabajo a mano sobre el extracto.
 */

type Clase = { tipo_egreso: string; label: string; cuenta_id: string | null };
type Cuenta = { id: string; cuenta: string; denominacion: string };
type Datos = {
  clases: Clase[];
  cuentas: Cuenta[];
  sin_imputar: number;
  puede_editar: boolean;
};

export default function CuentasEgresoPage() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/cuentas-egreso", {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setDatos(j.data as Datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(tipo: string, cuentaId: string) {
    setGuardando(tipo);
    setError(null);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/cuentas-egreso", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo_egreso: tipo, cuenta_id: cuentaId || null }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
      setAviso(cuentaId ? "Cuenta guardada." : "Se le sacó la cuenta a esa clase.");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(null);
    }
  }

  const etiqueta = (c: Cuenta) => `${c.cuenta} · ${c.denominacion}`;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">
          ← Configuración
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Cuentas de los egresos de caja</h1>
        <p className="text-slate-600">
          A qué cuenta del plan va cada clase de egreso. Sin esto, todos los egresos del mes caen
          en una sola bolsa y separarlos es trabajo a mano.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{aviso}</div>
      )}

      {datos && datos.cuentas.length === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          No hay cuentas <strong>activas y asentables</strong> en el plan. Las agrupadoras no reciben
          movimientos, así que no se pueden elegir.{" "}
          <Link href="/configuracion/plan-de-cuentas" className="underline">Ver el plan de cuentas</Link>.
        </div>
      )}

      {datos && datos.sin_imputar > 0 && datos.cuentas.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-sm text-amber-900">
          Faltan <strong>{datos.sin_imputar}</strong> de {datos.clases.length} clases por imputar. El
          egreso se registra igual —la caja no se frena por esto— pero esos van a quedar sin cuenta
          en el asiento.
        </div>
      )}

      {datos && !datos.puede_editar && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Solo lectura: elegir la cuenta de un egreso lo hace un administrador.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Clase de egreso</th>
              <th className="px-4 py-2 text-left">Cuenta del plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando ? (
              <tr><td colSpan={2} className="px-4 py-10 text-center text-slate-400">Cargando…</td></tr>
            ) : !datos ? (
              <tr><td colSpan={2} className="px-4 py-10 text-center text-slate-400">Sin datos.</td></tr>
            ) : datos.clases.map((c) => (
              <tr key={c.tipo_egreso} className={c.cuenta_id ? "" : "bg-amber-50/40"}>
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.label}</td>
                <td className="px-4 py-2.5">
                  <Selector
                    value={c.cuenta_id ?? ""}
                    disabled={!datos.puede_editar || guardando === c.tipo_egreso || datos.cuentas.length === 0}
                    onChange={(e) => void guardar(c.tipo_egreso, e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50"
                  >
                    <option value="">— Sin imputar —</option>
                    {datos.cuentas.map((cu) => (
                      <option key={cu.id} value={cu.id}>{etiqueta(cu)}</option>
                    ))}
                  </Selector>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        Solo se ofrecen cuentas <strong>activas y asentables</strong>: una cuenta agrupadora no recibe
        movimientos, y ofrecerla lleva a elegirla y descubrirlo al cerrar el ejercicio. Dejar una
        clase en “Sin imputar” no impide cargar el egreso.
      </p>
    </div>
  );
}
