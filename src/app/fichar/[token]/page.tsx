"use client";

import { use, useEffect, useState } from "react";

export const dynamic = "force-dynamic";

type EstadoVista =
  | { tipo: "form" }
  | { tipo: "ok"; nombre: string; tipoMarca: "entrada" | "salida"; hora: string; fecha: string }
  | { tipo: "error"; msg: string };

type Coords = { lat: number; lng: number } | null;

function obtenerCoords(): Promise<Coords> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    const timeoutId = window.setTimeout(() => resolve(null), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timeoutId);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        window.clearTimeout(timeoutId);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 }
    );
  });
}

export default function FicharKioscoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [tokenOk, setTokenOk] = useState<null | boolean>(null);
  const [documento, setDocumento] = useState("");
  const [enviando, setEnviando] = useState<null | "entrada" | "salida">(null);
  const [estado, setEstado] = useState<EstadoVista>({ tipo: "form" });
  const [reloj, setReloj] = useState<string>("");

  useEffect(() => {
    let cancel = false;
    fetch(`/api/public/fichar/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { success?: boolean };
        if (cancel) return;
        setTokenOk(!!(r.ok && j.success));
      })
      .catch(() => { if (!cancel) setTokenOk(false); });
    return () => { cancel = true; };
  }, [token]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setReloj(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-reset del estado "ok": dejamos la confirmación 5s a la vista y
  // volvemos al formulario solo. Así el próximo empleado abre el link y ya
  // tiene la pantalla lista, sin tener que tocar "Marcar a otro empleado".
  const [autoReset, setAutoReset] = useState(5);
  useEffect(() => {
    if (estado.tipo !== "ok") return;
    setAutoReset(5);
    const tick = window.setInterval(() => {
      setAutoReset((s) => {
        if (s <= 1) {
          setEstado({ tipo: "form" });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [estado.tipo]);

  // Si el usuario vuelve a la pestaña tras haber dejado el link abierto,
  // reseteamos al form. Cubre el caso "varias personas comparten el celular".
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") {
        setEstado((prev) => (prev.tipo === "ok" ? { tipo: "form" } : prev));
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  async function marcar(tipo: "entrada" | "salida") {
    const doc = documento.trim();
    if (!doc) {
      setEstado({ tipo: "error", msg: "Tipeá tu DNI antes de marcar." });
      return;
    }
    setEnviando(tipo);
    setEstado({ tipo: "form" });
    const coords = await obtenerCoords();
    // Hora y fecha locales del dispositivo del empleado — evita el desfase
    // por timezone del servidor (UTC en Vercel vs PY/ES del usuario).
    const ahora = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fechaLocal = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
    const horaLocal  = `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
    try {
      const r = await fetch(`/api/public/fichar/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documento: doc,
          tipo,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          fecha: fechaLocal,
          hora: horaLocal,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { nombre?: string; hora?: string; fecha?: string }; error?: string };
      if (!r.ok || !j.success) {
        setEstado({ tipo: "error", msg: j.error ?? "No se pudo registrar el fichaje." });
        return;
      }
      setEstado({
        tipo: "ok",
        nombre: j.data?.nombre ?? "",
        tipoMarca: tipo,
        hora: j.data?.hora ?? "",
        fecha: j.data?.fecha ?? "",
      });
      setDocumento("");
    } catch {
      setEstado({ tipo: "error", msg: "Error de red. Probá de nuevo." });
    } finally {
      setEnviando(null);
    }
  }

  if (tokenOk === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6 text-sm text-slate-500">
        Cargando…
      </div>
    );
  }
  if (tokenOk === false) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xl">⚠</div>
          <h1 className="text-base font-semibold text-slate-900">Link no válido</h1>
          <p className="mt-2 text-sm text-slate-600">
            Este link de fichaje no existe o fue revocado. Pedile a RRHH el link actualizado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-gradient-to-b from-[#E5F4F4] to-slate-50 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <header className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#4FAEB2] text-white shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 7v5l3 2" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Fichaje de empleados</h1>
          <p className="mt-1 text-sm text-slate-600">Marcá tu entrada o salida del día.</p>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-[#3F8E91]">{reloj || "--:--:--"}</p>
        </header>

        <main className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {estado.tipo === "ok" ? (
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-2xl">✓</div>
              <h2 className="text-lg font-semibold text-slate-900">¡Listo, {estado.nombre.split(" ")[0]}!</h2>
              <p className="mt-1 text-sm text-slate-600">
                {estado.tipoMarca === "entrada" ? "Entrada registrada" : "Salida registrada"} a las{" "}
                <strong className="font-mono text-slate-900">{estado.hora}</strong>.
              </p>
              <button
                type="button"
                onClick={() => setEstado({ tipo: "form" })}
                className="mt-5 w-full rounded-xl bg-[#4FAEB2] px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#3F8E91]"
              >
                Marcar a otro empleado
              </button>
              <p className="mt-2 text-[11px] text-slate-400">
                Volvemos solos en {autoReset}s…
              </p>
            </div>
          ) : (
            <>
              <label className="block text-sm font-medium text-slate-700">Tu DNI</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="Ej. 12345678"
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg tabular-nums outline-none transition focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/30"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Sin puntos ni espacios. Si no funciona, pedile a RRHH que cargue tu DNI.
              </p>

              {estado.tipo === "error" && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {estado.msg}
                </div>
              )}

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void marcar("entrada")}
                  disabled={enviando !== null}
                  className="inline-flex min-h-[64px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
                >
                  {enviando === "entrada" ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-5 w-5 animate-spin" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                        <path d="M17 10a7 7 0 0 1-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Marcando…
                    </span>
                  ) : (
                    <>
                      <span className="text-xl">→</span> Marcar entrada
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void marcar("salida")}
                  disabled={enviando !== null}
                  className="inline-flex min-h-[64px] items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98] disabled:opacity-50"
                >
                  {enviando === "salida" ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-5 w-5 animate-spin" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                        <path d="M17 10a7 7 0 0 1-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Marcando…
                    </span>
                  ) : (
                    <>
                      <span className="text-xl">←</span> Marcar salida
                    </>
                  )}
                </button>
              </div>

              <p className="mt-4 text-center text-[11px] text-slate-400">
                Al marcar se registra tu ubicación si autorizás el permiso del navegador.
              </p>
            </>
          )}
        </main>

        <footer className="mt-6 text-center text-xs text-slate-400">
          NCG · Control horario
        </footer>
      </div>
    </div>
  );
}
