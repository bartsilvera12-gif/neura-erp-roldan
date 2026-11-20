"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Descuento de una línea de presupuesto, con tope y pedido de autorización
 * (pedido del cliente: «lo mismo que en la caja»).
 *
 * Cada uno descuenta hasta su tope (el de su perfil y el del artículo, el más
 * chico). Si escribe más, se aplica el tope y aparece «Pedir autorización»: le
 * llega al administrador a la campana, diciendo de qué presupuesto es y cuánto
 * tiene ahora. Si lo aprueba, el descuento se aplica solo.
 */

export type PedidoDescuento = {
  id: string;
  pct: number;
  estado: "pendiente" | "aprobada" | "rechazada" | "usada";
  porQuien?: string | null;
  motivo?: string | null;
};

/** Los pedidos por línea (índice) y el sondeo de sus respuestas. */
export function usePedidosDescuento(onAprobado: (idx: number, pct: number) => void) {
  const [pedidos, setPedidos] = useState<Record<number, PedidoDescuento>>({});
  const [error, setError] = useState<string | null>(null);

  async function pedir(idx: number, linea: {
    producto_id: string | null; producto_nombre: string; sku?: string | null;
    cantidad: number; precio_unitario: number; pct_actual: number;
  }, pct: number, presupuesto: string | null) {
    setError(null);
    if (!linea.producto_id) { setError("El descuento de un ítem manual lo carga un administrador."); return; }
    try {
      const r = await fetchWithSupabaseSession("/api/descuentos/solicitudes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          producto_id: linea.producto_id,
          producto_nombre: linea.producto_nombre,
          sku: linea.sku ?? null,
          cantidad: linea.cantidad,
          precio_lista: linea.precio_unitario,
          precio_pedido: Math.round(linea.precio_unitario * (1 - pct / 100)),
          descuento_pct: pct,
          motivo: `${presupuesto ? `Presupuesto ${presupuesto}` : "Presupuesto nuevo"}: quiere ponerle ${pct}% y ya tiene ${linea.pct_actual}%.`,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo enviar el pedido.");
      setPedidos((prev) => ({ ...prev, [idx]: { id: String(j.data.solicitud.id), pct, estado: "pendiente" } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el pedido.");
    }
  }

  useEffect(() => {
    const pendientes = Object.entries(pedidos).filter(([, p]) => p.estado === "pendiente");
    if (pendientes.length === 0) return;
    let vivo = true;
    const consultar = async () => {
      for (const [idxStr, p] of pendientes) {
        try {
          const r = await fetchWithSupabaseSession(`/api/descuentos/solicitudes/${p.id}`, { cache: "no-store" });
          const j = await r.json();
          if (!vivo || !r.ok || !j?.success) continue;
          const s = j.data.solicitud as { estado: PedidoDescuento["estado"]; resuelta_por_nombre: string | null; respuesta_motivo: string | null; descuento_pct: number };
          if (s.estado === "pendiente") continue;
          const idx = Number(idxStr);
          setPedidos((prev) => ({ ...prev, [idx]: { ...prev[idx]!, estado: s.estado, porQuien: s.resuelta_por_nombre, motivo: s.respuesta_motivo } }));
          if (s.estado === "aprobada") onAprobado(idx, Number(s.descuento_pct));
        } catch { /* se reintenta */ }
      }
    };
    void consultar();
    const id = window.setInterval(consultar, 5_000);
    return () => { vivo = false; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos]);

  /** Si una línea se borra, los pedidos de abajo se corren un lugar. */
  function quitarLinea(idx: number) {
    setPedidos((prev) => {
      const next: Record<number, PedidoDescuento> = {};
      for (const [k, v] of Object.entries(prev)) {
        const n = Number(k);
        if (n < idx) next[n] = v; else if (n > idx) next[n - 1] = v;
      }
      return next;
    });
  }

  const esperando = Object.values(pedidos).filter((p) => p.estado === "pendiente").length;
  return { pedidos, pedir, error, quitarLinea, esperando };
}

/** El aviso y el botón bajo el descuento de una línea. */
export function AvisoTopeDescuento({
  pidio, tope, pedido, onPedir,
}: {
  /** Lo que escribió, si pasó el tope. */
  pidio: number | null;
  tope: number | null;
  pedido: PedidoDescuento | undefined;
  onPedir: () => void;
}) {
  if (pedido) {
    return (
      <p className={`mt-1 text-[10px] font-medium leading-tight ${
        pedido.estado === "pendiente" ? "text-slate-500" : pedido.estado === "rechazada" ? "text-red-700" : "text-emerald-700"
      }`}>
        {pedido.estado === "pendiente" && `Esperando al administrador por ${pedido.pct}%…`}
        {pedido.estado === "rechazada" && <>Rechazado{pedido.porQuien ? ` por ${pedido.porQuien}` : ""}{pedido.motivo ? `: ${pedido.motivo}` : "."}</>}
        {(pedido.estado === "aprobada" || pedido.estado === "usada") && <>Autorizado {pedido.pct}%{pedido.porQuien ? ` por ${pedido.porQuien}` : ""}.</>}
      </p>
    );
  }
  if (pidio == null || tope == null) {
    return tope != null ? <p className="mt-1 text-[10px] text-slate-400">máx {tope}%</p> : null;
  }
  return (
    <div className="mt-1 space-y-1">
      <p className="text-[10px] font-medium leading-tight text-amber-700">
        Pediste {pidio}%, tu tope es {tope}%: se aplicó {tope}%.
      </p>
      <button type="button" onClick={onPedir}
        className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100">
        Pedir autorización
      </button>
    </div>
  );
}
