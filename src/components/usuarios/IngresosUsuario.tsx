"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { codigoDeEquipo, nombreDeEquipo, ponerNombreDeEquipo } from "@/lib/usuarios/registrar-ingreso";

type Ingreso = {
  created_at: string; dispositivo_id: string | null; dispositivo_nombre: string | null;
  sistema: string | null; navegador: string | null; ip: string | null;
};

/** dd/mm/aaaa hh:mm en hora de Paraguay. */
function fechaHora(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Desde qué equipo entró este usuario (script 92, pedido del cliente).
 *
 * Cada equipo tiene un código propio; si se le puso nombre ("Caja 1"),
 * sale el nombre. El nombre se pone desde ese mismo equipo, abajo.
 */
export default function IngresosUsuario({ usuarioId }: { usuarioId: string }) {
  const [ingresos, setIngresos] = useState<Ingreso[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [miCodigo, setMiCodigo] = useState<string | null>(null);
  const [miNombre, setMiNombre] = useState("");
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    setMiCodigo(codigoDeEquipo());
    setMiNombre(nombreDeEquipo());
    let vivo = true;
    fetchWithSupabaseSession(`/api/empresas/usuarios/${usuarioId}/ingresos`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.success) { setAviso(j?.error ?? "No se pudieron leer los ingresos."); setIngresos([]); return; }
        setAviso(j.data?.aviso ?? null);
        setIngresos((j.data?.ingresos ?? []) as Ingreso[]);
      })
      .catch(() => { if (vivo) { setAviso("No se pudieron leer los ingresos."); setIngresos([]); } });
    return () => { vivo = false; };
  }, [usuarioId]);

  const corto = (id: string | null) => (id ? id.slice(0, 8) : "—");

  return (
    <div className="space-y-3">
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
      {ingresos == null ? (
        <p className="text-xs text-slate-400 animate-pulse">Buscando…</p>
      ) : ingresos.length === 0 ? (
        !aviso && <p className="text-xs text-slate-400">Todavía no hay ingresos registrados de este usuario.</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Cuándo</th>
                <th className="px-3 py-2 text-left font-semibold">Equipo</th>
                <th className="px-3 py-2 text-left font-semibold">Sistema · navegador</th>
                <th className="px-3 py-2 text-left font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ingresos.map((i, k) => (
                <tr key={k}>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{fechaHora(i.created_at)}</td>
                  <td className="px-3 py-1.5">
                    {i.dispositivo_nombre ? <strong className="text-slate-800">{i.dispositivo_nombre}</strong> : null}
                    <span className={`font-mono text-[11px] text-slate-500 ${i.dispositivo_nombre ? "ml-1" : ""}`}>{corto(i.dispositivo_id)}</span>
                    {i.dispositivo_id && i.dispositivo_id === miCodigo && <span className="ml-1 text-[10px] text-emerald-700">(este equipo)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{[i.sistema, i.navegador].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{i.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-slate-600">
          Este equipo es el <span className="font-mono font-semibold">{corto(miCodigo)}</span>. Ponele un nombre para
          reconocerlo en la lista (por ejemplo «Caja 1»): vale para los próximos ingresos desde acá.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={miNombre}
            onChange={(e) => { setMiNombre(e.target.value); setGuardado(false); }}
            placeholder="Nombre de este equipo"
            className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => { ponerNombreDeEquipo(miNombre); setGuardado(true); }}
            className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
          >
            Guardar
          </button>
          {guardado && <span className="self-center text-xs text-emerald-700">Listo</span>}
        </div>
      </div>
    </div>
  );
}
