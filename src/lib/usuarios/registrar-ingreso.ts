"use client";

import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * El equipo desde el que se entra (script 92).
 *
 * El navegador no deja leer el nombre de la computadora, así que cada equipo
 * se identifica con un código que se genera la primera vez y queda guardado
 * en ese navegador. Opcionalmente se le pone un nombre ("Caja 1").
 */
const CLAVE_ID = "neura.equipo.id";
const CLAVE_NOMBRE = "neura.equipo.nombre";

export function codigoDeEquipo(): string | null {
  try {
    let id = localStorage.getItem(CLAVE_ID);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).toUpperCase();
      localStorage.setItem(CLAVE_ID, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function nombreDeEquipo(): string {
  try { return localStorage.getItem(CLAVE_NOMBRE) ?? ""; } catch { return ""; }
}

export function ponerNombreDeEquipo(nombre: string): void {
  try {
    if (nombre.trim()) localStorage.setItem(CLAVE_NOMBRE, nombre.trim().slice(0, 80));
    else localStorage.removeItem(CLAVE_NOMBRE);
  } catch { /* sin almacenamiento: queda sin nombre */ }
}

/** El id de la sesión de Supabase, sacado del token: una vez por inicio de sesión. */
function idDeSesion(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.session_id ?? payload.sub ?? "") || null;
  } catch {
    return null;
  }
}

/**
 * Registra el ingreso una sola vez por inicio de sesión (no en cada recarga).
 * Nunca falla hacia afuera: entrar al sistema no depende de esto.
 */
export async function registrarIngresoUnaVez(accessToken: string | null | undefined): Promise<void> {
  const sesion = idDeSesion(accessToken);
  if (!sesion) return;
  const clave = `neura.ingreso.${sesion}`;
  try {
    if (localStorage.getItem(clave)) return;
    localStorage.setItem(clave, "1");
  } catch {
    return;
  }
  try {
    await fetchWithSupabaseSession("/api/me/ingreso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dispositivo_id: codigoDeEquipo(), dispositivo_nombre: nombreDeEquipo() || null }),
    });
  } catch {
    /* sin registro: no es motivo para no dejar entrar */
  }
}
