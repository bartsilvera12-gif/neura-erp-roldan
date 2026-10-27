"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import AccionesTabla from "@/components/ui/AccionesTabla";
import DetalleVentaModal, { type VentaDetalleLite } from "@/components/ventas/DetalleVentaModal";
import type { CajaReporteRow, CajaDetalleVenta, CajaDetalleMovimiento } from "@/lib/caja/types";

/**
 * Detalle de un cierre de caja, en pantalla.
 *
 * ── POR QUÉ NO ALCANZABA CON EL ARQUEO A4 ─────────────────────────────────
 *   "Ver cierre" abría el PDF directamente. La hoja está bien para archivar y
 *   firmar, pero no para revisar: para saber qué tenía una venta del turno
 *   había que imprimirla y después buscar esa venta a mano en otra pantalla.
 *
 *   Acá se ve lo mismo, con las ventas clickeables: cada una abre su detalle
 *   —qué se vendió, ediciones y devoluciones— sin salir del cierre. La hoja
 *   sigue estando, en el botón de arriba.
 */

const gs = (n: number | null | undefined) =>
  n == null ? "—" : `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** Paraguay es UTC−3 todo el año. */
function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const MEDIO: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", cheque: "Cheque", mixto: "Pago mixto",
};

const TIPO_MOV: Record<string, string> = {
  ingreso: "Ingreso", egreso: "Egreso", retiro: "Retiro", ajuste: "Ajuste",
};

interface Respuesta {
  caja: CajaReporteRow;
  ventas: CajaDetalleVenta[];
  movimientos: CajaDetalleMovimiento[];
  items_por_venta: Record<string, VentaDetalleLite["items"]>;
}

function Tarjeta({ titulo, valor, pie, color }: { titulo: string; valor: string; pie?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`text-xl font-bold ${color ?? "text-slate-900"}`}>{valor}</p>
      {pie && <p className="text-xs text-slate-500">{pie}</p>}
    </div>
  );
}

export default function DetalleCierreCajaPage() {
  const params = useParams();
  const id = (params?.id as string) ?? "";

  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<VentaDetalleLite | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    setCargando(true);
    setError(null);
    fetchWithSupabaseSession(`/api/cajas/${id}/detalle`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancel) return;
        if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el cierre.");
        setData(j.data as Respuesta);
      })
      .catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : "Error de red."); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [id]);

  if (cargando) return <p className="p-6 text-sm text-slate-400">Cargando cierre…</p>;
  if (error || !data) {
    return (
      <div className="space-y-4 p-1">
        <Link href="/reportes/cajas" className="text-xs font-medium text-slate-500 hover:text-slate-800">
          ← Volver a cierres de caja
        </Link>
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "No se encontró el turno."}
        </p>
      </div>
    );
  }

  const { caja: c, ventas, movimientos, items_por_venta } = data;
  const abiertaAun = c.estado !== "cerrada";
  const dif = c.diferencia;
  const anuladas = ventas.filter((v) => v.estado === "anulada");
  const vigentes = ventas.filter((v) => v.estado !== "anulada");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/reportes/cajas" className="text-xs font-medium text-slate-500 hover:text-slate-800">
            ← Volver a cierres de caja
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Caja {c.numero_caja}
            {abiertaAun && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 align-middle text-xs font-semibold text-emerald-800">
                abierta
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            Abrió {fechaHora(c.fecha_apertura)} · {c.abierta_por_nombre || "—"}
            {c.fecha_cierre && ` — Cerró ${fechaHora(c.fecha_cierre)} · ${c.cerrada_por_nombre || "—"}`}
          </p>
        </div>
        <a
          href={`/api/cajas/${id}/arqueo-a4`}
          target="_blank" rel="noopener"
          className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
        >
          Arqueo A4 para firmar
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta
          titulo="Vendido"
          valor={gs(c.total_vendido)}
          pie={`${c.cantidad_ventas} venta${c.cantidad_ventas === 1 ? "" : "s"}${anuladas.length ? ` · ${anuladas.length} anulada${anuladas.length === 1 ? "" : "s"}` : ""}`}
        />
        <Tarjeta titulo="Efectivo esperado" valor={gs(c.efectivo_esperado)} pie={`Apertura ${gs(c.monto_apertura)}`} />
        <Tarjeta titulo="Contado al cerrar" valor={gs(c.monto_cierre_contado)} pie={abiertaAun ? "El turno sigue abierto" : undefined} />
        <Tarjeta
          titulo="Diferencia"
          valor={dif == null ? "—" : dif === 0 ? "Cuadra" : gs(dif)}
          pie={dif == null ? undefined : dif < 0 ? "Faltante" : dif > 0 ? "Sobrante" : undefined}
          color={dif == null ? "text-slate-400" : dif < 0 ? "text-red-600" : dif > 0 ? "text-amber-600" : "text-emerald-700"}
        />
      </div>

      {c.observacion_cierre && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <strong>Observación del cierre:</strong> {c.observacion_cierre}
        </p>
      )}

      {/* ── Ventas del turno ─────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Ventas del turno</h2>
            <p className="text-xs text-slate-500">
              Tocá una venta para ver qué se vendió, sus ediciones y sus devoluciones.
            </p>
          </div>
          <AccionesTabla
            titulo={`Ventas de la caja ${c.numero_caja}`}
            archivo={`cierre-caja-${c.numero_caja}-${(c.fecha_apertura ?? "").slice(0, 10)}`}
            subtitulo={`Turno abierto el ${fechaHora(c.fecha_apertura)}`}
            columnas={["Hora", "Comprobante", "Cliente", "Vendedor", "Cajero", "Condición", "Medio", "Estado", "Motivo de anulación", "Total"]}
            filas={ventas.map((v) => [
              fechaHora(v.fecha).slice(11),
              v.numero_control ?? "",
              v.cliente_nombre ?? "Consumidor final",
              v.vendedor_nombre ?? "",
              v.usuario_nombre ?? "",
              v.tipo_venta ?? "",
              MEDIO[v.metodo_pago ?? ""] ?? v.metodo_pago ?? "",
              v.estado === "anulada" ? "Anulada" : "Vigente",
              v.anulacion_motivo ?? "",
              v.estado === "anulada" ? 0 : v.total,
            ])}
            sumar={[9]}
          />
        </div>
        {ventas.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No se registraron ventas en este turno.</p>
        ) : (
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Hora</th>
                <th className="px-4 py-3 font-semibold">Comprobante</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Vendedor</th>
                <th className="px-4 py-3 font-semibold">Cajero</th>
                <th className="px-4 py-3 font-semibold">Medio</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ventas.map((v) => {
                const anul = v.estado === "anulada";
                return (
                  <tr
                    key={v.id}
                    onClick={() =>
                      setAbierta({
                        id: v.id,
                        numero_control: v.numero_control ?? "",
                        fecha: v.fecha,
                        total: v.total,
                        estado: v.estado,
                        tipo_venta: v.tipo_venta,
                        metodo_pago: v.metodo_pago,
                        cliente_nombre: v.cliente_nombre ?? null,
                        vendedor_nombre: v.vendedor_nombre ?? null,
                        usuario_nombre: v.usuario_nombre,
                        anulacion_motivo: v.anulacion_motivo ?? null,
                        items: items_por_venta[v.id] ?? [],
                      })
                    }
                    className={`cursor-pointer ${anul ? "bg-rose-50/40 hover:bg-rose-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-500">{fechaHora(v.fecha).slice(11)}</td>
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-800">
                      {v.numero_control ?? "—"}
                      {anul && (
                        <span className="block text-[11px] font-normal text-rose-600">
                          ANULADA{v.anulacion_motivo ? `: ${v.anulacion_motivo}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {v.cliente_nombre || <span className="text-slate-400">Consumidor final</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{v.vendedor_nombre || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{v.usuario_nombre || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{MEDIO[v.metodo_pago ?? ""] ?? v.metodo_pago ?? ""}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${anul ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {gs(v.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 text-sm">
              <tr>
                <td colSpan={6} className="px-4 py-2 text-right font-medium text-slate-600">
                  Total vigente ({vigentes.length} de {ventas.length})
                </td>
                <td className="px-4 py-2 text-right text-base font-bold text-slate-900">
                  {gs(vigentes.reduce((s, v) => s + (Number(v.total) || 0), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* ── Movimientos manuales ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Ingresos, egresos y retiros</h2>
            <p className="text-xs text-slate-500">Todo lo que entró o salió del cajón sin ser una venta.</p>
          </div>
          <AccionesTabla
            titulo={`Movimientos de la caja ${c.numero_caja}`}
            archivo={`movimientos-caja-${c.numero_caja}-${(c.fecha_apertura ?? "").slice(0, 10)}`}
            columnas={["Hora", "Tipo", "Clase de egreso", "Concepto", "Medio", "Usuario", "Observación", "Monto"]}
            filas={movimientos.map((m) => [
              fechaHora(m.created_at).slice(11),
              TIPO_MOV[m.tipo] ?? m.tipo,
              m.tipo_egreso ?? "",
              m.concepto ?? "",
              MEDIO[m.medio_pago ?? ""] ?? m.medio_pago ?? "",
              m.usuario_nombre ?? m.usuario_email ?? "",
              m.observacion ?? "",
              m.monto,
            ])}
            sumar={[7]}
          />
        </div>
        {movimientos.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Este turno no tuvo movimientos manuales.</p>
        ) : (
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Hora</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Concepto</th>
                <th className="px-4 py-3 font-semibold">Usuario</th>
                <th className="px-4 py-3 text-right font-semibold">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movimientos.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-500">{fechaHora(m.created_at).slice(11)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {TIPO_MOV[m.tipo] ?? m.tipo}
                    {m.tipo_egreso && <span className="block text-[11px] text-slate-400">{m.tipo_egreso}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {m.concepto}
                    {m.observacion && <span className="block text-[11px] text-slate-400">{m.observacion}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.usuario_nombre || m.usuario_email || "—"}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${m.tipo === "ingreso" ? "text-emerald-700" : "text-slate-800"}`}>
                    {gs(m.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {abierta && <DetalleVentaModal venta={abierta} onClose={() => setAbierta(null)} />}
    </div>
  );
}
