"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Aviso = {
  clave: string;
  tipo: "cobrar" | "vence" | "limite" | "cambio" | "stock" | "sobrepedido" | "descuento" | "whatsapp";
  titulo: string;
  detalle: string | null;
  href: string | null;
  fecha: string | null;
};

const COLOR: Record<Aviso["tipo"], string> = {
  cobrar: "bg-emerald-500",
  vence: "bg-amber-500",
  limite: "bg-red-500",
  cambio: "bg-violet-500",
  stock: "bg-orange-500",
  sobrepedido: "bg-orange-500",
  descuento: "bg-sky-500",
  // Rojo: el número de WhatsApp desvinculado deja la atención cortada.
  whatsapp: "bg-red-600",
};

const LS = "neura-avisos-leidos";
function leidasLocales(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS) ?? "[]") as string[]); } catch { return new Set(); }
}
function guardarLocales(claves: string[]) {
  try {
    const s = leidasLocales();
    for (const c of claves) s.add(c);
    localStorage.setItem(LS, JSON.stringify([...s].slice(-3000)));
  } catch { /* sin almacenamiento: vuelve a aparecer, nada más */ }
}

/**
 * La campana de avisos por puesto (pedido del cliente). Un aviso se va cuando
 * la persona ENTRA a verlo: tocarlo lo abre y lo marca leído. El
 * administrador además puede marcarlos como leídos sin entrar.
 */
export default function CampanaAvisos() {
  const router = useRouter();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [puedeMarcar, setPuedeMarcar] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/notificaciones", { cache: "no-store" });
      const j = await r.json();
      if (!j?.success) return;
      const locales = leidasLocales();
      setAvisos(((j.data.notificaciones ?? []) as Aviso[]).filter((a) => !locales.has(a.clave)));
      setPuedeMarcar(j.data.puede_marcar === true);
    } catch { /* se reintenta en la próxima vuelta */ }
  }, []);

  useEffect(() => {
    void cargar();
    const id = window.setInterval(() => void cargar(), 60_000);
    return () => window.clearInterval(id);
  }, [cargar]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  async function marcar(claves: string[]) {
    if (claves.length === 0) return;
    setAvisos((prev) => prev.filter((a) => !claves.includes(a.clave)));
    guardarLocales(claves);
    try {
      await fetchWithSupabaseSession("/api/notificaciones/leer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claves }),
      });
    } catch { /* quedó en la computadora */ }
  }

  function entrar(a: Aviso) {
    if (!a.href) return;
    setAbierto(false);
    void marcar([a.clave]);
    router.push(a.href);
  }

  const cantidad = avisos.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
        aria-label={`Avisos${cantidad > 0 ? ` (${cantidad})` : ""}`}
        title="Avisos"
      >
        <Bell className="h-5 w-5" />
        {cantidad > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {cantidad > 99 ? "99+" : cantidad}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Avisos</p>
              <p className="text-[11px] text-slate-500">
                {puedeMarcar ? "Tocá uno para abrirlo, o marcalo como leído." : "Tocá uno para abrirlo: se va cuando entrás a verlo."}
              </p>
            </div>
            {puedeMarcar && cantidad > 0 && (
              <button type="button" onClick={() => void marcar(avisos.filter((a) => a.tipo !== "descuento").map((a) => a.clave))}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                <CheckCheck className="h-3.5 w-3.5" /> Marcar todo
              </button>
            )}
          </div>
          {cantidad === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">No hay avisos.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {avisos.map((a) => (
                <li key={a.clave} className="flex items-start gap-2 px-4 py-2.5 hover:bg-slate-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COLOR[a.tipo]}`} />
                  <button type="button" onClick={() => entrar(a)} disabled={!a.href}
                    className="min-w-0 flex-1 text-left disabled:cursor-default">
                    <span className="block text-[13px] font-medium leading-snug text-slate-800">{a.titulo}</span>
                    {a.detalle && <span className="block truncate text-[11px] text-slate-500">{a.detalle}</span>}
                    {a.tipo === "descuento" && <span className="block text-[11px] text-sky-700">Se contesta en «Descuentos para autorizar».</span>}
                  </button>
                  {puedeMarcar && a.tipo !== "descuento" && (
                    <button type="button" onClick={() => void marcar([a.clave])} title="Marcar como leído"
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700">
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
