"use client";

import { useEffect, useState } from "react";
import { validarAltaCliente } from "@/lib/clientes/identificador";
import { apiCreateCliente } from "@/lib/api/client";
import { useFacultades } from "@/lib/perfiles/use-facultades";
import Selector from "@/components/ui/Selector";

export interface NuevoClienteCreado {
  id: string;
  nombre: string;
  ruc: string | null;
  /** El resto de lo cargado, para que la pantalla que lo pidió no lo vuelva a pedir. */
  telefono?: string | null;
  ciudad?: string | null;
  profesion?: string | null;
  direccion?: string | null;
}

interface Props {
  /** Texto pre-cargado (lo que el operador venía tipeando en el buscador). */
  nombreInicial?: string;
  onClose: () => void;
  onCreado: (c: NuevoClienteCreado) => void;
}

/**
 * Modal minimalista para crear un cliente sin salir del flujo de "Nueva venta".
 * Solo pide los campos indispensables: tipo, razón social/nombre, RUC/CI, teléfono.
 * Cualquier otra edición (dirección, SIFEN, condiciones) se hace después en
 * /clientes/[id] cuando el operador tenga tiempo.
 */
export default function NuevoClienteRapidoModal({ nombreInicial, onClose, onCreado }: Props) {
  const [tipo, setTipo] = useState<"empresa" | "persona">("empresa");
  const [nombre, setNombre] = useState((nombreInicial ?? "").toUpperCase());
  const [ruc, setRuc] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  // Punto 3.2: los campos que pidió el cliente para el alta desde Caja.
  // Van plegados porque el alta rápida se usa con el cliente esperando en el
  // mostrador: el que tiene apuro carga tres datos y sigue, el que tiene
  // tiempo abre y completa.
  const [verMas, setVerMas] = useState(false);
  /**
   * Cuánto se le fía y a cuántos días: solo administrador.
   *
   * El alta rápida la usa el cajero con el cliente enfrente, y ese es
   * justamente el peor momento para fijar una línea de crédito. Se da de alta
   * sin crédito y después lo define quien corresponde. El servidor descarta
   * los dos campos si los manda un usuario común.
   */
  const { tiene: tieneFacultad } = useFacultades();
  const puedeCredito = tieneFacultad("fijar_credito");
  const [ciudad, setCiudad] = useState("");
  const [profesion, setProfesion] = useState("");
  const [direccion, setDireccion] = useState("");
  const [email, setEmail] = useState("");
  const [limiteCredito, setLimiteCredito] = useState("");
  const [diasCredito, setDiasCredito] = useState("");
  const [rubroId, setRubroId] = useState("");
  const [rubros, setRubros] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    fetch("/api/categorias-cliente", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        const lista = (j.data?.categorias ?? j.data?.items ?? []) as Array<{ id: string; nombre: string; activa?: boolean }>;
        setRubros(lista.filter((c) => c.activa !== false).map((c) => ({ id: c.id, nombre: c.nombre })));
      })
      .catch(() => { /* sin rubros el alta sigue funcionando */ });
  }, []);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose, enviando]);

  const nombreTrim = nombre.trim();
  /**
   * El RUC o la cédula son obligatorios. Se valida acá además de en el
   * servidor para que el aviso aparezca antes de mandar: con el cliente
   * esperando en el mostrador, un error que vuelve del servidor son dos
   * segundos más de silencio.
   */
  const identificador = validarAltaCliente(
    {
      ruc: tipo === "empresa" ? ruc : "",
      documento: tipo === "persona" ? documento : "",
      nombre: nombreTrim,
      telefono,
      profesion,
      ciudad,
    },
    tipo === "empresa"
  );
  /**
   * Profesión y ciudad están detrás de "Ver más", y ahora son obligatorias:
   * si faltan, el panel se abre solo. Sin esto, el botón queda deshabilitado
   * por dos campos que no se ven y parece que la pantalla está rota.
   */
  const faltanOcultos = profesion.trim() === "" || ciudad.trim() === "";
  useEffect(() => {
    if (faltanOcultos) setVerMas(true);
  }, [faltanOcultos]);

  const puedeGuardar = nombreTrim.length >= 2 && identificador.ok && !enviando;

  async function handleSubmit() {
    if (!puedeGuardar) return;
    setEnviando(true);
    setError(null);
    const res = await apiCreateCliente({
      tipo_cliente: tipo,
      empresa: tipo === "empresa" ? nombreTrim : undefined,
      nombre_contacto: nombreTrim,
      ruc: tipo === "empresa" ? ruc.trim() || undefined : undefined,
      documento: tipo === "persona" ? documento.trim() || undefined : undefined,
      telefono: telefono.trim() || undefined,
      ciudad: ciudad.trim() || undefined,
      profesion: profesion.trim() || undefined,
      direccion: direccion.trim() || undefined,
      email: email.trim().toLowerCase() || undefined,
      // Vacío queda sin definir, que no es lo mismo que cero.
      limite_credito: !puedeCredito || limiteCredito.trim() === "" ? undefined : Number(limiteCredito) || 0,
      dias_credito: !puedeCredito || diasCredito.trim() === "" ? undefined : Number(diasCredito) || 0,
      categoria_cliente_id: rubroId || undefined,
    });
    setEnviando(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreado({
      id: res.data.id,
      nombre: nombreTrim,
      ruc: (tipo === "empresa" ? ruc.trim() : documento.trim()) || null,
      telefono: telefono.trim() || null,
      ciudad: ciudad.trim() || null,
      profesion: profesion.trim() || null,
      direccion: direccion.trim() || null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onClose();
      }}
    >
      {/* El alto se limita a la pantalla y el cuerpo scrollea: con "Más
          datos" abierto el formulario pasaba de largo y los botones
          quedaban fuera del borde, sin manera de confirmar. */}
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl">
        <div className="shrink-0 px-6 pt-6">
        <h3 className="text-lg font-semibold text-slate-900">Nuevo cliente</h3>
        <p className="mt-1 text-xs text-slate-500">
          Con el nombre alcanza para vender. El resto se puede completar ahora o más tarde desde la ficha.
        </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">

        {/* Tipo */}
        <div className="mt-4 flex gap-2">
          {(["empresa", "persona"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                tipo === t
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t === "empresa" ? "Empresa" : "Persona"}
            </button>
          ))}
        </div>

        {/* Nombre */}
        <label className="mt-4 block text-sm font-medium text-slate-800">
          {tipo === "empresa" ? "Razón social" : "Nombre completo"} <span className="text-rose-600">*</span>
        </label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value.toUpperCase())}
          disabled={enviando}
          placeholder={tipo === "empresa" ? "Ej: TALLER VIDAL S.A." : "Ej: PEDRO GONZALEZ"}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        />

        {/* RUC / documento */}
        <label className="mt-3 block text-sm font-medium text-slate-800">
          {tipo === "empresa" ? "RUC" : "CI / Documento"}
          <span className="ml-1 text-rose-600">*</span>
        </label>
        <input
          value={tipo === "empresa" ? ruc : documento}
          onChange={(e) =>
            tipo === "empresa" ? setRuc(e.target.value) : setDocumento(e.target.value)
          }
          disabled={enviando}
          placeholder={tipo === "empresa" ? "Ej: 80011405-1" : "Ej: 4123456"}
          className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 ${
            identificador.ok ? "border-slate-300 focus:border-[#4FAEB2]" : "border-rose-300 focus:border-rose-400"
          }`}
        />
        {!identificador.ok && (
          <p className="mt-1 text-[11px] leading-snug text-rose-600">{identificador.error}</p>
        )}

        {/* Teléfono */}
        <label className="mt-3 block text-sm font-medium text-slate-800">
          Teléfono <span className="ml-1 text-rose-600">*</span>
        </label>
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          disabled={enviando}
          placeholder="Ej: 0991 234 567"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        />

        {/* Punto 3.2: ciudad, profesión, dirección, correo y límite de crédito. */}
        <button
          type="button"
          onClick={() => setVerMas((v) => !v)}
          className="mt-3 text-xs font-medium text-[#3F8E91] underline-offset-2 hover:underline"
        >
          {verMas ? "− Menos datos" : "+ Más datos (ciudad, profesión, dirección, correo, crédito)"}
        </button>

        {verMas && (
          <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Ciudad</span>
                <input
                  value={ciudad} onChange={(e) => setCiudad(e.target.value.toUpperCase())}
                  disabled={enviando} placeholder="Ej: ÑEMBY"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Profesión</span>
                <input
                  value={profesion} onChange={(e) => setProfesion(e.target.value.toUpperCase())}
                  disabled={enviando} placeholder="Ej: ALBAÑIL"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="font-medium text-slate-800">Dirección</span>
              <input
                value={direccion} onChange={(e) => setDireccion(e.target.value.toUpperCase())}
                disabled={enviando} placeholder="Ej: AVDA. MARISCAL LÓPEZ 1234"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-800">Correo electrónico</span>
              <input
                type="text" inputMode="email" autoComplete="email" value={email}
                onChange={(e) => {
                  // Texto y no type="email": en esos campos el navegador no deja
                  // fijar el cursor, y al pasar a minúsculas saltaba al final
                  // (no se podía escribir antes del "@").
                  const el = e.target;
                  const ini = el.selectionStart, fin = el.selectionEnd;
                  setEmail(el.value.toLowerCase());
                  if (ini != null && fin != null) requestAnimationFrame(() => { try { el.setSelectionRange(ini, fin); } catch { /* nada */ } });
                }}
                disabled={enviando} placeholder="ej: juan@gmail.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm lowercase focus:border-[#4FAEB2] focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              {puedeCredito && (
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Límite de crédito</span>
                <input
                  type="number" min={0} value={limiteCredito}
                  onChange={(e) => setLimiteCredito(e.target.value)}
                  disabled={enviando} placeholder="Gs."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none"
                />
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                  Vacío = sin definir. 0 = no se le vende a crédito.
                </span>
              </label>
              )}
              {/* El plazo va al lado del límite: las dos mitades de "cuánto y
                  hasta cuándo se le fía" se deciden juntas o no se deciden. */}
              {puedeCredito && (
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Días de crédito</span>
                <input
                  type="number" min={0} max={365} value={diasCredito}
                  onChange={(e) => setDiasCredito(e.target.value)}
                  disabled={enviando} placeholder="Ej: 30"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none"
                />
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                  Plazo acordado. Vacío = sin plazo.
                </span>
              </label>
              )}
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Rubro</span>
                <Selector
                  value={rubroId} onChange={(e) => setRubroId(e.target.value)}
                  disabled={enviando}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
                >
                  <option value="">— Sin rubro —</option>
                  {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </Selector>
              </label>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!puedeGuardar}
            className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Guardando…" : "Crear cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}
