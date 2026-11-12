"use client";

/**
 * Transformar un prospecto del CRM en cliente, SIN SALIR DEL FUNNEL.
 *
 * ── POR QUÉ UN MODAL ───────────────────────────────────────────────────────
 *   Antes el botón navegaba al alta de clientes con el lead precargado. El
 *   problema no era el formulario: era irse. Quien está trabajando el pipeline
 *   convierte uno, y al volver perdía el scroll, el filtro y la columna donde
 *   estaba. Convertir es un paso dentro del funnel, no un viaje a otra
 *   pantalla.
 *
 * ── POR QUÉ SOLO ESTOS CAMPOS ──────────────────────────────────────────────
 *   El alta completa tiene más de noventa campos: SIFEN, perfil tributario,
 *   suscripciones, redes. Nada de eso se sabe en el momento de convertir un
 *   lead, y pedirlo convierte un paso de diez segundos en un trámite.
 *
 *   Acá van los que de verdad hacen falta para que el cliente exista y se le
 *   pueda vender: el nombre con el que sale en la factura, quién es el
 *   contacto, el RUC, cómo ubicarlo y el rubro —que es el que decide el nivel
 *   de precio que verá el cajero—. Lo demás se completa después en la ficha,
 *   y el modal deja el enlace para ir.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, UserPlus, X } from "lucide-react";
import { apiCreateCliente } from "@/lib/api/client";
import { updateProspecto } from "@/lib/crm/storage";
import CategoriaClienteSelect from "@/components/clientes/CategoriaClienteSelect";
import Selector from "@/components/ui/Selector";
import type { Prospecto } from "@/lib/crm/types";

const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export type ResultadoTransformar = { clienteId: string; nombre: string };

export default function ModalTransformarEnCliente({
  prospecto,
  onCerrar,
  onCreado,
}: {
  prospecto: Prospecto;
  onCerrar: () => void;
  /** Se avisa al funnel para que refresque y marque el lead como convertido. */
  onCreado: (r: ResultadoTransformar) => void;
}) {
  const [tipo, setTipo] = useState<"empresa" | "persona">("empresa");
  const [razonSocial, setRazonSocial] = useState(prospecto.empresa ?? "");
  const [contacto, setContacto] = useState(prospecto.contacto ?? "");
  const [ruc, setRuc] = useState("");
  const [telefono, setTelefono] = useState(prospecto.telefono ?? "");
  const [email, setEmail] = useState(prospecto.email ?? "");
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [nivel, setNivel] = useState<"minorista" | "mayorista" | "distribuidor">("minorista");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<ResultadoTransformar | null>(null);

  // Escape cierra, como cualquier modal del sistema.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !guardando) onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar, guardando]);

  /* El nombre que va a salir en la factura: para una empresa es la razón
     social; para una persona, el contacto. Se muestra para que nadie lo
     descubra recién cuando imprime. */
  const nombreFinal = useMemo(
    () => (tipo === "empresa" ? razonSocial : contacto).trim().toUpperCase(),
    [tipo, razonSocial, contacto]
  );

  async function guardar() {
    setError(null);
    if (!nombreFinal) {
      setError(tipo === "empresa" ? "Escribí la razón social." : "Escribí el nombre de la persona.");
      return;
    }
    setGuardando(true);
    try {
      const creado = await apiCreateCliente({
        tipo_cliente: tipo,
        empresa: tipo === "empresa" ? razonSocial.trim().toUpperCase() : undefined,
        nombre_contacto: (contacto.trim() || razonSocial.trim()).toUpperCase(),
        nivel_precio: nivel,
        categoria_cliente_id: categoriaId,
        ruc: ruc.trim() || undefined,
        telefono: telefono.trim() || undefined,
        email: email.trim() || undefined,
        estado: "activo",
        origen: "CRM",
        prospecto_id: prospecto.id,
      } as Parameters<typeof apiCreateCliente>[0]);

      if (creado.ok !== true) {
        setGuardando(false);
        setError(creado.error || "No se pudo crear el cliente.");
        return;
      }
      const clienteId = creado.data.id as string;

      /* El prospecto queda marcado como convertido. Si esto falla, el cliente
         YA existe: no se deshace nada ni se muestra un error que haría pensar
         que no se creó. Queda dicho en la consola y listo. */
      try {
        await updateProspecto(prospecto.id, { cliente_creado: true });
      } catch (e) {
        console.warn("[transformar] no se pudo marcar el prospecto como convertido:", e);
      }

      const r = { clienteId, nombre: nombreFinal };
      setGuardando(false);
      setHecho(r);
      onCreado(r);
    } catch (e) {
      setGuardando(false);
      setError(e instanceof Error ? e.message : "No se pudo crear el cliente.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onCerrar();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <UserPlus className="h-4 w-4 text-[#2F6E71]" aria-hidden />
              Transformar en cliente
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {prospecto.numero_control} · {prospecto.empresa}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {hecho ? (
          <div className="px-5 py-8 text-center">
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-emerald-50">
              <Check className="h-5 w-5 text-emerald-600" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-slate-900">{hecho.nombre} ya es cliente.</p>
            <p className="mt-1 text-xs text-slate-500">
              El prospecto quedó marcado como convertido.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onCerrar}
                className="rounded-lg bg-[#2F6E71] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#255A5C]"
              >
                Seguir en el funnel
              </button>
              <Link
                href={`/clientes/${hecho.clienteId}`}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-[#4FAEB2] hover:text-[#2F6E71]"
              >
                Abrir la ficha
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className={labelCls}>Tipo de cliente</label>
                <div className="flex gap-2">
                  {(["empresa", "persona"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTipo(t)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                        tipo === t
                          ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                          : "border-slate-200 text-slate-500 hover:border-[#4FAEB2]/50"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {tipo === "empresa" && (
                <div>
                  <label className={labelCls}>Razón social *</label>
                  <input className={inputCls} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
                </div>
              )}

              <div>
                <label className={labelCls}>
                  {tipo === "empresa" ? "Persona de contacto" : "Nombre y apellido *"}
                </label>
                <input className={inputCls} value={contacto} onChange={(e) => setContacto(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>RUC</label>
                  <input className={inputCls} value={ruc} onChange={(e) => setRuc(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Teléfono</label>
                  <input className={inputCls} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Email</label>
                <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Rubro de cliente</label>
                  <CategoriaClienteSelect value={categoriaId} onChange={setCategoriaId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Nivel de precio</label>
                  <Selector
                    value={nivel}
                    onChange={(e) => setNivel(e.target.value as typeof nivel)}
                    className={inputCls}
                  >
                    <option value="minorista">Minorista</option>
                    <option value="mayorista">Mayorista</option>
                    <option value="distribuidor">Distribuidor</option>
                  </Selector>
                </div>
              </div>

              {nombreFinal ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Va a salir en la factura como <b className="text-slate-700">{nombreFinal}</b>.
                </p>
              ) : null}

              {error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
              {/* Para lo que este modal no pide: SIFEN, crédito, direcciones. */}
              <Link
                href={`/clientes/nuevo?from_crm=${encodeURIComponent(prospecto.id)}`}
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-[#2F6E71] hover:underline"
              >
                Necesito el alta completa
              </Link>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCerrar}
                  disabled={guardando}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando || !nombreFinal}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2F6E71] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#255A5C] disabled:opacity-50"
                >
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Crear cliente
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
