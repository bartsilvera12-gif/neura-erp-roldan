"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { hoyParaguay } from "@/lib/pagos/deuda-proveedores";
import Selector from "@/components/ui/Selector";

/**
 * Marcar como pagada UNA factura de proveedor.
 *
 * Estaba dentro de la pantalla de cobros, en la pestaña que mezclaba las
 * cuentas por cobrar con las de pagar. Vive acá para usarse desde Pagos a
 * proveedores, que es donde se mira a quién hay que pagarle.
 *
 * Es también la forma de ir limpiando el histórico: la migración trajo 14.592
 * facturas como impagas, y las que en realidad ya se pagaron se van cerrando
 * desde acá.
 *
 * Para pagar VARIAS facturas con un solo cheque está la orden de pago
 * consolidada, que es otra cosa y tiene su propia pantalla.
 *
 * ── DE QUÉ BANCO SALE, Y LA FOTO DEL CHEQUE ────────────────────────────────
 *   Un cheque y una transferencia salen de una cuenta concreta. Sin ese dato,
 *   la factura queda marcada como pagada y después nadie puede decir de dónde
 *   salió la plata.
 *
 *   El banco, el número y la foto NO se guardan en la factura: se guardan en
 *   el pago, que es la tabla `cheques` (script 78: se llama así por historia,
 *   pero guarda el pago al proveedor, con cualquier medio). Dos razones:
 *
 *     · El flujo de caja lee esa tabla. Un pago que no esté ahí no existe para
 *       la planilla: la plata sale del banco y el flujo no se entera. Era el
 *       agujero que tenía esta ventana.
 *     · Es el mismo lugar donde los deja Armar pago. Si acá se guardaran
 *       aparte, la foto del mismo cheque estaría en dos lados según desde qué
 *       pantalla se lo cargó.
 *
 *   En efectivo no hay banco ni foto: se marca la factura y listo.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

type Medio = "efectivo" | "transferencia" | "tarjeta" | "cheque";

/** Sube la foto del cheque (script 75). Devuelve el error, o null si salió bien. */
async function subirImagenCheque(chequeId: string, file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("cheque_id", chequeId);
  fd.append("file", file);
  try {
    const r = await fetchWithSupabaseSession("/api/cheques/imagen", { method: "POST", body: fd });
    const j = await r.json().catch(() => null);
    return r.ok && j?.success ? null : (j?.error ?? `Error ${r.status}`);
  } catch {
    return "Error de red.";
  }
}

export default function MarcarFacturaPagadaModal({
  factura, onClose, onExito,
}: {
  factura: {
    numero_control: string;
    numero_factura?: string | null;
    proveedor_id?: string | null;
    proveedor_nombre: string;
    total: number;
    moneda?: string;
  };
  onClose: () => void;
  onExito: () => void | Promise<void>;
}) {
  const [metodo, setMetodo] = useState<Medio>("transferencia");
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(() => hoyParaguay());
  const [bancoId, setBancoId] = useState("");
  const [bancos, setBancos] = useState<{ id: string; nombre: string }[]>([]);
  const [imagen, setImagen] = useState<File | null>(null);
  const inputImagen = useRef<HTMLInputElement>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los bancos cargados en el ERP (Configuración → entidades bancarias). Para
  // un pago solo sirven los de tipo banco; si no hay ninguno marcado así se
  // muestran todas, para no dejar el desplegable vacío.
  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/entidades-bancarias")
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        const todas = ((j.data?.entidades ?? []) as Array<{ id: string; nombre?: string; tipo?: string }>)
          .map((e) => ({ id: String(e.id), nombre: String(e.nombre ?? ""), tipo: String(e.tipo ?? "") }))
          .filter((e) => e.nombre);
        const soloBancos = todas.filter((e) => e.tipo === "banco");
        const lista = (soloBancos.length ? soloBancos : todas)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        setBancos(lista.map(({ id, nombre }) => ({ id, nombre })));
        if (lista.length === 1) setBancoId(lista[0].id);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  const fmt = (v: number) =>
    (factura.moneda === "USD" ? "US$ " : "Gs. ") + Math.round(Number(v) || 0).toLocaleString("es-PY");

  /** La transferencia, la tarjeta y el cheque tienen un número que lo prueba. */
  const requiereRef = metodo !== "efectivo";
  const LABEL_REF: Record<string, string> = {
    transferencia: "N° de comprobante de la transferencia",
    tarjeta: "N° de ticket de la tarjeta",
    cheque: "N° del cheque",
  };

  /**
   * El banco y la foto solo se pueden guardar si se sabe de qué proveedor es
   * la factura: el pago se guarda a nombre del proveedor. En las facturas
   * viejas de la migración ese dato a veces no vino.
   */
  const porBanco = metodo === "cheque" || metodo === "transferencia";
  const puedeGuardarPago = porBanco && !!factura.proveedor_id;

  async function confirmar() {
    setError(null);
    if (requiereRef && !referencia.trim()) {
      setError(`Cargá el ${LABEL_REF[metodo].toLowerCase()}.`);
      return;
    }
    if (puedeGuardarPago && !bancoId) {
      setError(
        bancos.length
          ? "Elegí de qué banco sale el pago."
          : "No hay bancos cargados. Cargalos en Configuración → Entidades bancarias."
      );
      return;
    }
    setGuardando(true);
    let avisoPago: string | null = null;
    try {
      // 1) El pago. Va primero porque es el que puede fallar por una regla
      //    —la factura ya tiene un cheque, por ejemplo— y entonces no hay que
      //    marcar nada.
      if (puedeGuardarPago) {
        const rp = await fetchWithSupabaseSession("/api/cheques", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proveedor_id: factura.proveedor_id,
            proveedor_nombre: factura.proveedor_nombre,
            moneda: factura.moneda === "USD" ? "USD" : "PYG",
            importe: Number(factura.total) || 0,
            medio: metodo,
            numero: referencia.trim() || null,
            entidad_bancaria_id: bancoId,
            banco_nombre: bancos.find((b) => b.id === bancoId)?.nombre ?? null,
            // Acá el pago ya se hizo: se escribió y salió el mismo día. No es
            // el caso del cheque diferido, que se arma desde Armar pago.
            fecha_emision: fecha,
            fecha_pago_prevista: fecha,
            fecha_cobro_prevista: fecha,
            facturas: [{ numero_control: factura.numero_control, importe_imputado: Number(factura.total) || 0 }],
          }),
        });
        const jp = await rp.json().catch(() => ({}));
        if (rp.status === 409) {
          // Ya tiene un pago cargado (lo armaron desde Armar pago). La factura
          // se marca igual, pero el banco y la foto ya están en ese pago: no
          // se duplica.
          avisoPago = "Esta factura ya tenía un pago cargado, así que el banco y la foto no se volvieron a guardar.";
        } else if (!rp.ok || !jp?.success) {
          throw new Error(jp?.error ?? `Error ${rp.status}`);
        } else {
          const chequeId = String(jp.data?.cheque_id ?? "");
          if (jp.data?.aviso) avisoPago = String(jp.data.aviso);
          // La foto va después de crear el pago: si falla, el pago igual queda
          // guardado y se la puede subir desde Pagos realizados.
          if (chequeId && imagen) {
            const errImg = await subirImagenCheque(chequeId, imagen);
            if (errImg) {
              avisoPago = `El pago se guardó, pero la foto no se subió: ${errImg}`;
            }
          }
        }
      }

      // 2) La factura queda cerrada.
      const res = await fetchWithSupabaseSession("/api/compras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_control: factura.numero_control,
          estado: "pagada",
          metodo_pago: metodo,
          referencia_pago: referencia.trim() || null,
          fecha_pago: fecha,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);

      if (avisoPago) {
        // Se guardó, pero con un pero: se dice y la ventana queda abierta.
        setError(avisoPago);
        setGuardando(false);
        return;
      }
      await onExito();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setGuardando(false);
    }
  }

  const fld = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">Marcar la factura como pagada</h3>
        <p className="mt-1 text-xs text-slate-500">
          {factura.proveedor_nombre} · {factura.numero_factura || factura.numero_control} ·{" "}
          <strong className="text-slate-700">{fmt(factura.total)}</strong>
        </p>

        {error && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{error}</p>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Cómo se pagó</span>
            <Selector
              value={metodo}
              onChange={(e) => { setMetodo(e.target.value as Medio); setReferencia(""); setImagen(null); }}
              className={fld}
            >
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
            </Selector>
          </label>

          {/* De dónde sale la plata. Para el cheque y para la transferencia:
              las dos salen de una cuenta, y el flujo de caja necesita saber
              de cuál. */}
          {porBanco && (
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">
                {metodo === "cheque" ? "Banco del cheque" : "Banco de donde sale la transferencia"}
              </span>
              <Selector
                value={bancoId}
                onChange={(e) => setBancoId(e.target.value)}
                className={fld}
                disabled={!factura.proveedor_id}
              >
                <option value="">{bancos.length ? "Elegí el banco…" : "No hay bancos cargados"}</option>
                {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </Selector>
              {!factura.proveedor_id && (
                <span className="mt-1 block text-[11px] text-slate-500">
                  Esta factura no tiene proveedor cargado —viene así de la migración—, así que el
                  pago no se puede guardar con banco. La factura se marca igual como pagada.
                </span>
              )}
            </label>
          )}

          {requiereRef && (
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">
                {LABEL_REF[metodo]}
              </span>
              <input
                value={referencia} onChange={(e) => setReferencia(e.target.value)}
                className={fld} placeholder="Queda guardado como prueba del pago"
              />
            </label>
          )}

          {/* La foto. Es el papel que después zanja la discusión cuando el
              proveedor dice que no le pagaron. */}
          {puedeGuardarPago && (
            <div className="block">
              <span className="text-[11px] font-medium text-slate-500">
                {metodo === "cheque" ? "Foto del cheque" : "Comprobante de la transferencia"}{" "}
                <span className="font-normal text-slate-400">(opcional)</span>
              </span>
              {imagen ? (
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#4FAEB2]/50 bg-[#4FAEB2]/5 py-2 pl-3 pr-1 text-sm">
                  <ImagePlus className="h-4 w-4 shrink-0 text-[#3F8E91]" />
                  <span className="truncate text-slate-700" title={imagen.name}>{imagen.name}</span>
                  <button
                    type="button" onClick={() => setImagen(null)} aria-label="Quitar la foto"
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button" onClick={() => inputImagen.current?.click()}
                  className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
                >
                  <ImagePlus className="h-4 w-4" /> Subir imagen o PDF
                </button>
              )}
              <input
                ref={inputImagen} type="file" accept={ACCEPT} className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (f && f.size > MAX_BYTES) { setError("El archivo no puede pesar más de 10 MB."); return; }
                  setImagen(f);
                }}
              />
            </div>
          )}

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Fecha del pago</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={fld} />
          </label>

          {porBanco && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              El pago queda cargado con su banco, así que la salida aparece en el flujo de caja.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={() => void confirmar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Confirmar el pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
