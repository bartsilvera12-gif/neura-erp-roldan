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

const ANTICIPO_RETIRAR = "Anticipo del {anticipo}% y saldo al retirar";
const ANTICIPO_ENTREGA = "Anticipo del {anticipo}% y saldo contra entrega";
const PORCENTAJES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * La forma de pago y el anticipo (pedido del cliente).
 *
 * Ya no está el «Contado / Crédito» arriba: se elige la forma de pago y, si
 * deja anticipo, se tilda «Con anticipo» y se elige el porcentaje. El crédito
 * sigue apareciendo solo para clientes con crédito en su ficha (o para
 * administración).
 *
 * Por dentro se guarda igual que antes: con anticipo, la forma es «Anticipo
 * del {anticipo}% y saldo al retirar» (o «contra entrega» si se eligió contra
 * entrega), y el porcentaje va aparte.
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
  const conAnticipo = pideAnticipo(formaPago) && !esFormaCredito(formaPago);
  // La forma «de base»: lo que se ve en el desplegable.
  const base = conAnticipo
    ? (formaPago === ANTICIPO_ENTREGA ? "Contado contra entrega" : FORMA_PAGO_CONTADO)
    : formaPago;
  const opciones = formasPermitidas.filter((f) => !pideAnticipo(f.valor));
  const esCredito = esFormaCredito(base);

  function elegirBase(v: string) {
    if (conAnticipo && !esFormaCredito(v)) {
      setFormaPago(v === "Contado contra entrega" ? ANTICIPO_ENTREGA : ANTICIPO_RETIRAR);
      return;
    }
    setFormaPago(v);
  }

  function tildarAnticipo(si: boolean) {
    if (si) {
      setFormaPago(base === "Contado contra entrega" ? ANTICIPO_ENTREGA : ANTICIPO_RETIRAR);
    } else {
      setFormaPago(base || FORMA_PAGO_CONTADO);
      setAnticipoPct("");
    }
  }

  const pct = anticipoPct.trim() === "" ? anticipoCasa : Math.min(100, Math.max(0, Number(anticipoPct.replace(",", ".")) || 0));
  const anticipo = Math.round((total * pct) / 100);
  const opcionesPct = PORCENTAJES.includes(pct) ? PORCENTAJES : [...PORCENTAJES, pct].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Forma de pago</label>
        <Selector
          value={esFormaPagoConocida(base) || base === "" ? base : "__otra__"}
          onChange={(e) => elegirBase(e.target.value === "__otra__" ? formaPago : e.target.value)}
          className={`${inputClass} bg-white`}
        >
          <option value="">— Elegir —</option>
          {opciones.map((f) => (
            <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
          ))}
          {/* Un presupuesto viejo puede tener una forma escrita a mano: se
              muestra como está en vez de pisarla. */}
          {base !== "" && !esFormaPagoConocida(base) && (
            <option value="__otra__">{base} (cargada a mano)</option>
          )}
        </Selector>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className={`flex items-center gap-2 text-sm font-medium text-slate-700 ${esCredito ? "opacity-50" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            checked={conAnticipo}
            disabled={esCredito}
            onChange={(e) => tildarAnticipo(e.target.checked)}
            className="h-4 w-4 accent-[#4FAEB2]"
          />
          Con anticipo
        </label>
        {conAnticipo && (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="w-32">
              <span className={labelClass}>Anticipo</span>
              <Selector
                value={String(pct)}
                onChange={(e) => setAnticipoPct(Number(e.target.value) === anticipoCasa ? "" : e.target.value)}
                className={`${inputClass} bg-white`}
              >
                {opcionesPct.map((p) => (
                  <option key={p} value={String(p)}>{p}%{p === anticipoCasa ? " (de la casa)" : ""}</option>
                ))}
              </Selector>
            </label>
            <div className="text-sm text-slate-700">
              Anticipo <strong className="tabular-nums">{fmtGs(anticipo)}</strong>
              <span className="mx-2 text-slate-300">·</span>
              Saldo <strong className="tabular-nums">{fmtGs(total - anticipo)}</strong>
            </div>
          </div>
        )}
        {esCredito && <p className="mt-1 text-[11px] text-slate-500">A crédito no se pide anticipo.</p>}
      </div>
    </div>
  );
}
