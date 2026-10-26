"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createGasto, updateGasto, desgloseIvaGasto } from "@/lib/gastos/actions";
import MontoInput from "@/components/ui/MontoInput";
import type { Gasto, GastoInput } from "@/lib/gastos/actions";
import { hoyAsuncionYmd } from "@/lib/fecha/asuncion";
import { formatearNumeroFactura } from "@/lib/formato/numero-factura";

const fLabel = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInput =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

type Props = {
  gasto?: Gasto | null;
  onSuccess?: () => void;
};

export default function GastoForm({ gasto, onSuccess }: Props) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<GastoInput>({
    categoria: gasto?.categoria ?? "",
    descripcion: gasto?.descripcion ?? "",
    monto: gasto?.monto ?? 0,
    tipo: gasto?.tipo ?? "variable",
    recurrente: gasto?.recurrente ?? false,
    frecuencia: gasto?.frecuencia ?? "",
    fecha: gasto?.fecha ?? hoyAsuncionYmd(),
    beneficiario: gasto?.beneficiario ?? "",
    metodo_pago: gasto?.metodo_pago ?? null,
    tipo_iva: gasto?.tipo_iva === "5" || gasto?.tipo_iva === "10" ? gasto.tipo_iva : "exenta",
    unidad_negocio: gasto?.unidad_negocio ?? "nutricion",
    proveedor_ruc: gasto?.proveedor_ruc ?? "",
    nro_timbrado: gasto?.nro_timbrado ?? "",
    numero_factura: gasto?.numero_factura ?? "",
    // Desglose de IVA (montos con IVA incluido). Prefill desde el gasto al editar;
    // si es un gasto viejo sin buckets, lo derivamos del monto + tipo_iva simple.
    inc_exenta: gasto ? (gasto.monto_exenta ?? 0) || (gasto.tipo_iva === "exenta" ? (gasto.monto ?? 0) : 0) : 0,
    inc_10: gasto ? ((gasto.gravado_10 ?? 0) + (gasto.iva_10 ?? 0)) || (gasto.tipo_iva === "10" ? (gasto.monto ?? 0) : 0) : 0,
    inc_5: gasto ? ((gasto.gravado_5 ?? 0) + (gasto.iva_5 ?? 0)) || (gasto.tipo_iva === "5" ? (gasto.monto ?? 0) : 0) : 0,
  });

  // La unidad de negocio (nutrición/consignataria) llega por ?modo= desde la lista.
  // Se resuelve en el cliente (no en SSR): si viene ?modo=consignataria y es un
  // gasto nuevo, marcamos la unidad como consignataria.
  useEffect(() => {
    if (gasto) return;
    let modo: string | null = null;
    try { modo = new URLSearchParams(window.location.search).get("modo"); } catch { modo = null; }
    if (modo === "consignataria") {
      setForm((prev) => ({ ...prev, unidad_negocio: "consignataria" }));
    }
  }, [gasto]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, recurrente: (e.target as HTMLInputElement).checked }));
    } else if (name === "metodo_pago") {
      const v = value === "efectivo" || value === "transferencia" || value === "tarjeta" ? value : null;
      setForm((prev) => ({ ...prev, metodo_pago: v }));
    } else if (name !== "monto") {
      const normalized = ["categoria", "descripcion", "frecuencia", "beneficiario"].includes(name)
        ? value.toUpperCase()
        : value;
      setForm((prev) => ({ ...prev, [name]: normalized }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const total = (Number(form.inc_exenta) || 0) + (Number(form.inc_10) || 0) + (Number(form.inc_5) || 0);
    if (total <= 0) {
      return setError("Cargá al menos un monto (10%, 5% o exenta).");
    }
    const payload: GastoInput = { ...form, monto: total };

    setGuardando(true);

    try {
      if (gasto) {
        await updateGasto(gasto.id, payload);
      } else {
        await createGasto(payload);
      }
      onSuccess?.();
      router.push("/gastos");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5 pb-2 border-b border-slate-200">
          <span className="text-base">📋</span>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
            Datos del gasto
          </h3>
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            form.unidad_negocio === "consignataria"
              ? "bg-[#4FAEB2]/15 text-[#3F8E91]"
              : "bg-emerald-50 text-emerald-700"
          }`}>
            {form.unidad_negocio === "consignataria" ? "Consignataria" : "Nutrición"}
          </span>
        </div>
        <div className="space-y-4">
          <div>
            <label className={fLabel}>Rubro</label>
            <input
              type="text"
              name="categoria"
              value={form.categoria}
              onChange={handleChange}
              placeholder="Ej: Servicios, Alquiler, Salarios"
              className={fInput}
            />
          </div>
          <div>
            <label className={fLabel}>Descripción</label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              placeholder="Descripción del gasto"
              className={fInput}
              rows={2}
            />
          </div>
          <div>
            <label className={fLabel}>Beneficiario</label>
            <input
              type="text"
              name="beneficiario"
              value={form.beneficiario ?? ""}
              onChange={handleChange}
              placeholder="Ej: ANDE, COPACO, SUPERMERCADO STOCK"
              className={fInput}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Nombre del comercio o empresa a la que se le hizo el pago.
            </p>
          </div>
          {/* Datos del comprobante del proveedor (para el registro del contador). */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={fLabel}>RUC proveedor</label>
              <input
                type="text"
                value={form.proveedor_ruc ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, proveedor_ruc: e.target.value.toUpperCase() }))}
                placeholder="Ej: 80012345-6"
                className={fInput}
              />
            </div>
            <div>
              <label className={fLabel}>N° de timbrado</label>
              <input
                type="text"
                value={form.nro_timbrado ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, nro_timbrado: e.target.value.toUpperCase() }))}
                placeholder="Ej: 16110567"
                className={fInput}
              />
            </div>
            <div>
              <label className={fLabel}>N° de factura</label>
              <input
                type="text"
                value={form.numero_factura ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, numero_factura: formatearNumeroFactura(e.target.value) }))}
                placeholder="Ej: 001-001-0000001"
                className={fInput}
                inputMode="numeric"
              />
            </div>
          </div>
          <div>
            <label className={fLabel}>Método de pago</label>
            <select
              name="metodo_pago"
              value={form.metodo_pago ?? ""}
              onChange={handleChange}
              className={fInput}
            >
              <option value="">Sin especificar</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          {/* Desglose de IVA de la factura (montos con IVA INCLUIDO). Una misma
              factura puede tener partes con distinto IVA: cargás lo que corresponde
              a cada uno y el sistema calcula el total y el IVA de cada tipo. */}
          {(() => {
            const d = desgloseIvaGasto(form.inc_exenta ?? 0, form.inc_10 ?? 0, form.inc_5 ?? 0);
            const fmt = (v: number) => Math.round(v).toLocaleString("es-PY");
            return (
              <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/40">
                <label className={fLabel}>Montos por tipo de IVA (Gs., IVA incluido) *</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
                  <div>
                    <span className="text-[11px] text-slate-500">Gravado 10%</span>
                    <MontoInput value={form.inc_10 ?? 0} onChange={(n) => setForm((p) => ({ ...p, inc_10: n }))} placeholder="0" className={fInput} />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Gravado 5%</span>
                    <MontoInput value={form.inc_5 ?? 0} onChange={(n) => setForm((p) => ({ ...p, inc_5: n }))} placeholder="0" className={fInput} />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500">Exenta</span>
                    <MontoInput value={form.inc_exenta ?? 0} onChange={(n) => setForm((p) => ({ ...p, inc_exenta: n }))} placeholder="0" className={fInput} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-[11px] text-slate-500">
                  <span>IVA 10%: Gs. {fmt(d.iva_10)} · IVA 5%: Gs. {fmt(d.iva_5)}</span>
                  <span>IVA total: <strong>Gs. {fmt(d.monto_iva)}</strong> · Total: <strong className="text-slate-700">Gs. {fmt(d.monto)}</strong></span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Poné el monto que corresponde a cada IVA. Si la factura es de un solo tipo, cargá solo ese.
                </p>
              </div>
            );
          })()}
          <div>
            <label className={fLabel}>Tipo</label>
            <select
              name="tipo"
              value={form.tipo}
              onChange={handleChange}
              className={fInput}
            >
              <option value="variable">Variable</option>
              <option value="fijo">Fijo</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="recurrente"
              name="recurrente"
              checked={form.recurrente}
              onChange={handleChange}
              className="rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
            />
            <label htmlFor="recurrente" className="text-sm text-slate-700">
              Gasto recurrente
            </label>
          </div>
          {form.recurrente && (
            <div>
              <label className={fLabel}>Frecuencia</label>
              <input
                type="text"
                name="frecuencia"
                value={form.frecuencia ?? ""}
                onChange={handleChange}
                placeholder="Ej: Mensual, Semanal"
                className={fInput}
              />
            </div>
          )}
          <div>
            <label className={fLabel}>Fecha *</label>
            <input
              type="date"
              name="fecha"
              value={form.fecha}
              onChange={handleChange}
              className={fInput}
              required
            />
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={guardando}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {guardando ? "Guardando…" : gasto ? "Guardar cambios" : "Crear gasto"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/gastos")}
          className="border border-slate-200 text-sm px-6 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
