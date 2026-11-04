"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { Mail, ExternalLink } from "lucide-react";

/**
 * Mandarle la orden al vendedor del proveedor.
 *
 * ── DOS CAMINOS, Y EL SEGUNDO NO ES UN PREMIO CONSUELO ─────────────────────
 *   Si hay servidor de correo configurado, se manda desde el sistema y queda
 *   hecho. Si no lo hay —que es la situación de hoy— se abre el correo de la
 *   persona con el destinatario, el asunto y el cuerpo ya escritos, y ella
 *   aprieta enviar.
 *
 *   El segundo camino tiene una ventaja que el primero no: el proveedor le
 *   responde a ELLA, no a una casilla del sistema que nadie mira. Para un
 *   pedido, que la respuesta llegue a quien lo hizo importa.
 *
 * ── EL MAIL SE PUEDE ESCRIBIR ACÁ ──────────────────────────────────────────
 *   386 de los 418 proveedores no tienen mail cargado. Obligar a ir a la ficha
 *   del proveedor antes de poder mandar un pedido sería trabarlo por un dato
 *   que se puede pedir en el momento.
 */

type Preparado = {
  email: string | null;
  email_valido: boolean;
  contacto: string | null;
  proveedor_nombre: string;
  servidor_configurado: boolean;
  falta_configurar: string | null;
  asunto: string;
  mailto: string | null;
};

export default function EnviarOrdenModal({
  ordenId, numeroControl, onClose, onEnviada,
}: {
  ordenId: string;
  numeroControl: string;
  onClose: () => void;
  onEnviada: (mensaje: string) => void;
}) {
  const [prep, setPrep] = useState<Preparado | null>(null);
  const [email, setEmail] = useState("");
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`/api/ordenes-compra/email?id=${encodeURIComponent(ordenId)}`);
        const j = await r.json();
        if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo preparar el correo.");
        const d = j.data as Preparado;
        setPrep(d);
        setEmail(d.email ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      } finally {
        setCargando(false);
      }
    })();
  }, [ordenId]);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/ordenes-compra/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ordenId, email: email.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const a = j.data?.contacto ? `${j.data.contacto} (${j.data.enviado_a})` : j.data?.enviado_a;
      onEnviada(`${numeroControl} enviada a ${a}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo mandar el correo.");
    } finally {
      setEnviando(false);
    }
  }

  /** El mailto del servidor usa el mail de la ficha; si se escribió otro, se cambia. */
  const mailtoFinal = (() => {
    if (!prep?.mailto) return null;
    const escrito = email.trim();
    if (!escrito || escrito === (prep.email ?? "")) return prep.mailto;
    return prep.mailto.replace(/^mailto:[^?]*/, `mailto:${encodeURIComponent(escrito)}`);
  })();

  const puede = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Mandar {numeroControl}</h2>

        {cargando ? (
          <p className="py-6 text-center text-sm text-slate-500">Preparando…</p>
        ) : !prep ? (
          <p className="py-6 text-center text-sm text-rose-700">{error ?? "No se pudo preparar."}</p>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-slate-500">
              {prep.contacto
                ? <>A <strong>{prep.contacto}</strong>, de {prep.proveedor_nombre}</>
                : <>A {prep.proveedor_nombre}</>}
            </p>

            <label className="mt-4 block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Correo del vendedor
              </span>
              <input
                type="email" value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="vendedor@proveedor.com.py"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              {!prep.email && (
                <span className="mt-1 block text-[11px] text-amber-700">
                  Este proveedor no tiene mail cargado en su ficha. Lo que escribas acá se usa solo
                  para este envío.
                </span>
              )}
            </label>

            {/* El estado del servidor se dice siempre, no solo cuando falla:
                quien manda tiene que saber si sale del sistema o de su Outlook. */}
            {!prep.servidor_configurado && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
                El sistema todavía no puede mandar correos solo (falta configurar{" "}
                <strong>{prep.falta_configurar}</strong>). Por ahora se abre tu programa de correo con
                todo escrito y lo mandás vos — y así el proveedor te contesta a vos.
              </p>
            )}

            {error && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button" onClick={onClose} disabled={enviando}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>

              {prep.servidor_configurado ? (
                <button
                  type="button" onClick={() => void enviar()} disabled={enviando || !puede}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {enviando ? "Mandando…" : "Mandar el correo"}
                </button>
              ) : (
                <a
                  href={puede ? (mailtoFinal ?? "#") : "#"}
                  onClick={(e) => {
                    if (!puede) { e.preventDefault(); setError("Escribí un correo válido."); return; }
                    onEnviada(`Se abrió tu programa de correo con ${numeroControl} lista para mandar.`);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold text-white ${
                    puede ? "bg-[#4FAEB2] hover:bg-[#3F8E91]" : "bg-slate-300"
                  }`}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir mi correo
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
