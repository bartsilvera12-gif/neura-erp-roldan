"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { clienteTieneCredito } from "@/lib/presupuestos/formas-pago";
import DatosClienteModal from "@/components/clientes/DatosClienteModal";
import HistorialClienteModal from "@/components/clientes/HistorialClienteModal";

function fmtGs(n: number) {
  return "Gs. " + (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

/**
 * El crédito y los anticipos del cliente elegido, a la vista mientras se
 * cotiza (pedido del cliente): con qué condición compra, hasta cuánto se le
 * fía y cuánto dejó a cuenta.
 */
export default function CreditoCliente({ clienteId }: { clienteId: string | null | undefined }) {
  const [dato, setDato] = useState<{
    credito: boolean; limite: number | null; dias: number | null; anticipos: number | null;
  } | null>(null);
  /** Pedido del cliente: los datos (y el límite) y el historial, sin salir del presupuesto. */
  const [verDatos, setVerDatos] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [nombre, setNombre] = useState("Cliente");

  useEffect(() => {
    if (!clienteId) { setDato(null); return; }
    let vivo = true;
    void (async () => {
      const [rc, ra] = await Promise.all([
        fetchWithSupabaseSession(`/api/clientes/${clienteId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetchWithSupabaseSession(`/api/anticipos/disponibles?cliente=${encodeURIComponent(clienteId)}`, { cache: "no-store" })
          .then((r) => r.json()).catch(() => null),
      ]);
      if (!vivo) return;
      const c = (rc?.data?.cliente ?? rc?.data ?? null) as Record<string, unknown> | null;
      setNombre(String(c?.nombre_facturacion ?? c?.empresa ?? c?.nombre_contacto ?? c?.nombre ?? "Cliente"));
      const limite = c?.limite_credito == null ? null : Number(c.limite_credito);
      const dias = c?.dias_credito == null ? null : Number(c.dias_credito);
      setDato({
        credito: clienteTieneCredito(c),
        limite: limite != null && Number.isFinite(limite) ? limite : null,
        dias: dias != null && Number.isFinite(dias) && dias > 0 ? dias : null,
        anticipos: ra?.success ? Number(ra.data?.saldo) || 0 : null,
      });
    })();
    return () => { vivo = false; };
  }, [clienteId, recarga]);

  if (!clienteId || !dato) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span>
        Compra a <strong className="text-slate-800">{dato.credito ? "crédito" : "contado"}</strong>
        {dato.credito && dato.dias ? ` (${dato.dias} días)` : ""}
      </span>
      <span>
        Límite de crédito: <strong className="tabular-nums text-slate-800">{dato.limite ? fmtGs(dato.limite) : "sin límite cargado"}</strong>
      </span>
      {dato.anticipos != null && (
        <span>
          Anticipos a favor: <strong className={`tabular-nums ${dato.anticipos > 0 ? "text-emerald-700" : "text-slate-800"}`}>{fmtGs(dato.anticipos)}</strong>
        </span>
      )}
      <span className="ml-auto flex gap-2">
        <button type="button" onClick={() => setVerDatos(true)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:border-[#4FAEB2]">
          Datos del cliente
        </button>
        <button type="button" onClick={() => setVerHistorial(true)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:border-[#4FAEB2]">
          Historial de compras
        </button>
      </span>
      {verDatos && (
        <DatosClienteModal clienteId={clienteId} onClose={() => setVerDatos(false)} onGuardado={() => setRecarga((n) => n + 1)} />
      )}
      {verHistorial && (
        <HistorialClienteModal clienteId={clienteId} clienteNombre={nombre} onClose={() => setVerHistorial(false)} />
      )}
    </div>
  );
}
