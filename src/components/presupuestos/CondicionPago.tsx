"use client";

import Selector from "@/components/ui/Selector";
import {
  FORMA_PAGO_CONTADO,
  esFormaCredito,
  esFormaPagoConocida,
  pideAnticipo,
  type FormaPagoOpcion,
} from "@/lib/presupuestos/formas-pago";

function fmtGs(n: number) {
  return "Gs. " + (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

/**
 * Contado o crédito, la forma de pago y el anticipo (pedido del cliente).
 *
 * Primero se elige la condición —crédito solo si el cliente tiene crédito en
 * su ficha, o lo cotiza administración— y después cómo se paga. Si la forma
 * pide anticipo, abajo se dice cuánto: el de la casa por defecto, o el que se
 * pacte en este presupuesto (50%, 30%, lo que deje el cliente).
 */
export default function CondicionPago({
  formaPago,
  setFormaPago,
  formasPermitidas,
  anticipoPct,
  setAnticipoPct,
  anticipoCasa,
  total,
  inputClass,
  labelClass,
}: {
  formaPago: string;
  setFormaPago: (v: string) => void;
  formasPermitidas: readonly FormaPagoOpcion[];
  /** El anticipo de este presupuesto, como texto ("" = el de la casa). */
  anticipoPct: string;
  setAnticipoPct: (v: string) => void;
  /** El de Configuración → Presupuesto. */
  anticipoCasa: number;
  total: number;
  inputClass: string;
  labelClass: string;
}) {
  const puedeCredito = formasPermitidas.some((f) => esFormaCredito(f.valor));
  const condicion: "contado" | "credito" = esFormaCredito(formaPago) ? "credito" : "contado";
  const opciones = formasPermitidas.filter((f) => (condicion === "credito") === esFormaCredito(f.valor));

  function elegirCondicion(c: "contado" | "credito") {
    if (c === condicion) return;
    const primera = formasPermitidas.find((f) => (c === "credito") === esFormaCredito(f.valor));
    setFormaPago(primera?.valor ?? FORMA_PAGO_CONTADO);
  }

  const conAnticipo = condicion === "contado" && pideAnticipo(formaPago);
  const pct = anticipoPct.trim() === "" ? anticipoCasa : Math.min(100, Math.max(0, Number(anticipoPct.replace(",", ".")) || 0));
  const anticipo = Math.round((total * pct) / 100);

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass}>Condición</span>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {(["contado", "credito"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => elegirCondicion(c)}
              disabled={c === "credito" && !puedeCredito}
              title={c === "credito" && !puedeCredito ? "Este cliente no tiene crédito en su ficha." : undefined}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                condicion === c ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c === "contado" ? "Contado" : "Crédito"}
            </button>
          ))}
        </div>
        {!puedeCredito && (
          <p className="mt-1 text-[11px] text-slate-500">Crédito, solo para clientes con crédito en su ficha.</p>
        )}
      </div>

      <div>
        <label className={labelClass}>Forma de pago</label>
        <Selector
          value={esFormaPagoConocida(formaPago) || formaPago === "" ? formaPago : "__otra__"}
          onChange={(e) => setFormaPago(e.target.value === "__otra__" ? formaPago : e.target.value)}
          className={`${inputClass} bg-white`}
        >
          <option value="">— Elegir —</option>
          {opciones.map((f) => (
            <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
          ))}
          {/* Un presupuesto viejo puede tener una forma escrita a mano: se
              muestra como está en vez de pisarla. */}
          {formaPago !== "" && !esFormaPagoConocida(formaPago) && (
            <option value="__otra__">{formaPago} (cargada a mano)</option>
          )}
        </Selector>
      </div>

      {conAnticipo && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="w-32">
              <span className={labelClass}>Anticipo (%)</span>
              <input
                type="number" min="0" max="100" step="1"
                value={anticipoPct}
                onChange={(e) => setAnticipoPct(e.target.value)}
                placeholder={String(anticipoCasa)}
                className={inputClass}
              />
            </label>
            <div className="text-sm text-slate-700">
              Anticipo <strong className="tabular-nums">{fmtGs(anticipo)}</strong>
              <span className="mx-2 text-slate-300">·</span>
              Saldo <strong className="tabular-nums">{fmtGs(total - anticipo)}</strong>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Vacío, vale el de la casa ({anticipoCasa}%). Sale impreso en la forma de pago y en el anticipo requerido.
          </p>
        </div>
      )}
    </div>
  );
}
