"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { signOut } from "@/lib/auth";
import { useBoot } from "@/components/BootContext";
import { diasRestantes, nivelPorDias, type NivelVencimiento } from "@/lib/lotes/nivel";
import { nombreUsuarioDisplay } from "@/lib/usuarios/hweber";
import SucursalSwitcher from "@/components/layout/SucursalSwitcher";
import AutorizacionesDescuento from "./AutorizacionesDescuento";
import { getModuleAccessCached } from "@/lib/modulos/module-access-cache";
import { isModuleSlugGranted } from "@/lib/modulos/route-slug-map";

/**
 * Slug del único destino al que apunta la campanita ("Productos a vencer").
 * Si la empresa no tiene este módulo, la campanita se oculta: de lo contrario
 * el enlace "Ver todos →" llevaba a una ruta bloqueada por AuthGuard con el
 * cartel "Módulo no habilitado".
 */
const NOTIF_MODULO_SLUG = "productos-a-vencer";

const NOTIF_VISTO_KEY = "notif-lotes-visto";

/**
 * Reproduce un beep corto (200ms) usando Web Audio API. No requiere assets ni
 * data URIs gigantes. Se llama en la primera apertura del popover con count>0.
 */
function reproducirBeep() {
  try {
    type WebkitWindow = Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as unknown as WebkitWindow;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  } catch {
    /* no bloquea si el browser no lo permite */
  }
}

type LoteNotif = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  numero_lote: string;
  fecha_vencimiento: string;
  cantidad: number;
  dias_restantes: number;
  nivel: NivelVencimiento;
};

type HeaderUsuario = {
  nombre: string | null;
  rol: string | null;
  email: string | null;
  /** Sucursal en la que opera el usuario. Null si no tiene una asignada. */
  sucursal?: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function roleLabel(rol: string | null | undefined): string {
  const r = clean(rol).toLowerCase();
  const labels: Record<string, string> = {
    admin: "Admin",
    administrador: "Admin",
    super_admin: "Super admin",
    supervisor: "Supervisor",
    vendedor: "Vendedor",
    asesor: "Asesor",
    comercial: "Comercial",
    "asesor comercial": "Asesor comercial",
    usuario: "Usuario",
  };
  if (labels[r]) return labels[r];
  if (!r) return "Usuario";
  return r
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Header() {
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [usuario, setUsuario] = useState<HeaderUsuario | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { mobileSidebarOpen, setMobileSidebarOpen } = useBoot();

  // ── Notificaciones de lotes por vencer ───────────────────────────────────
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLotes, setNotifLotes] = useState<LoteNotif[]>([]);
  const [notifCargando, setNotifCargando] = useState(false);
  // Solo mostramos la campanita si la empresa tiene el módulo "Productos a
  // vencer". Para empresas sin ese módulo (ej. Roldán) la campanita se oculta.
  const [notifHabilitado, setNotifHabilitado] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { ok, data } = await getModuleAccessCached();
        if (!alive || !ok) return;
        const esSuperAdmin = data.superAdmin === true;
        const granted = new Set(data.slugs ?? []);
        const inactive = new Set(data.inactiveSlugs ?? []);
        setNotifHabilitado(
          esSuperAdmin ||
            isModuleSlugGranted(NOTIF_MODULO_SLUG, granted, inactive, {
              strict: data.strictAllowlist === true,
            })
        );
      } catch {
        /* silencioso: si falla, la campanita queda oculta */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!notifHabilitado) return;
    let alive = true;
    async function cargarCount() {
      try {
        const r = await fetchWithSupabaseSession("/api/lotes/count-notificaciones", {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.success) setNotifCount(Number(j.data?.count) || 0);
      } catch {
        /* silencioso: no bloquea el header */
      }
    }
    void cargarCount();
    const id = window.setInterval(cargarCount, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [notifHabilitado]);

  // Cerrar popover al click fuera.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function abrirNotificaciones() {
    // Sonido: solo la primera vez que este usuario ve la campanita con count>0.
    // El flag se persiste en localStorage con la fecha para debug.
    if (notifCount > 0) {
      try {
        if (!localStorage.getItem(NOTIF_VISTO_KEY)) {
          reproducirBeep();
          localStorage.setItem(NOTIF_VISTO_KEY, new Date().toISOString());
        }
      } catch {
        /* localStorage puede fallar (SSR / privacidad) */
      }
    }
    setNotifOpen((v) => !v);
    if (!notifOpen && notifLotes.length === 0) {
      setNotifCargando(true);
      try {
        const r = await fetchWithSupabaseSession(
          "/api/lotes/proximos-vencer?dias=15",
          { cache: "no-store" }
        );
        const j = await r.json();
        if (r.ok && j?.success) {
          setNotifLotes(((j.data?.lotes ?? []) as LoteNotif[]).slice(0, 10));
        }
      } catch {
        /* silencioso */
      } finally {
        setNotifCargando(false);
      }
    }
  }

  // Los helpers de niveles vienen de "@/lib/lotes/nivel"; pero para el badge
  // dentro del popover usamos labels/clases locales chicas.
  void diasRestantes;
  void nivelPorDias;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadUsuario() {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as { usuario?: HeaderUsuario };
        if (alive) setUsuario(json.usuario ?? null);
      } catch {
        if (alive) setUsuario(null);
      }
    }
    void loadUsuario();
    return () => {
      alive = false;
    };
  }, []);

  const fallbackEmail = clean(usuario?.email);
  const displayName = nombreUsuarioDisplay({ email: usuario?.email, nombre: usuario?.nombre });
  const dropdownName = displayName;
  const displayRole = roleLabel(usuario?.rol);
  const sucursal = clean(usuario?.sucursal);

  return (
    <header
      id="neura-header"
      className="z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-3 sm:px-6 shadow-[inset_0_-1px_0_0_rgba(10,37,64,0.05)] backdrop-blur-sm"
    >
      {/* Boton hamburger (solo mobile) */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#3F8E91] lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer en desktop para empujar el resto a la derecha */}
      <div className="hidden lg:block lg:flex-1" />

      <div className="flex items-center gap-2">
        {/* Switcher de sucursal. Si el usuario tiene 1 sola sucursal, se ve
            como badge estático. Si tiene N, dropdown para cambiar. Se autoresuelve
            desde /api/sucursales/mias — ya no depende del prop `sucursal` del
            payload del header. */}
        <SucursalSwitcher />

        {/* Pedidos de descuento esperando respuesta. Se muestra solo a quien
            puede autorizarlos y solo cuando hay alguno. */}
        <AutorizacionesDescuento />

        {/* Notificaciones — lotes próximos a vencer (≤15 días).
            Solo visible si la empresa tiene el módulo "Productos a vencer". */}
        {notifHabilitado && (
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={abrirNotificaciones}
            className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
            aria-label={`Notificaciones${notifCount > 0 ? ` (${notifCount})` : ""}`}
          >
            <Bell className="h-5 w-5" />
            {notifCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {notifCount > 99 ? "99+" : notifCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">Próximos a vencer</p>
                <p className="text-[11px] text-slate-500">Ventana de 15 días</p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifCargando ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-500 animate-pulse">
                    Cargando…
                  </p>
                ) : notifLotes.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-500">
                    Ningún lote por vencer en 15 días. Todo bajo control.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {notifLotes.map((l) => {
                      const cls =
                        l.nivel === "critico"
                          ? "bg-red-100 text-red-700 border-red-200"
                          : l.nivel === "proximo"
                          ? "bg-amber-100 text-amber-700 border-amber-200"
                          : "bg-yellow-50 text-yellow-700 border-yellow-200";
                      return (
                        <li key={l.id} className="px-4 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-800">
                                {l.producto_nombre}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                #{l.numero_lote} · {l.fecha_vencimiento}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
                            >
                              {l.dias_restantes < 0
                                ? `vencido ${-l.dias_restantes}d`
                                : `${l.dias_restantes}d`}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-right">
                <Link
                  href="/reportes/productos-a-vencer"
                  onClick={() => setNotifOpen(false)}
                  className="text-xs font-medium text-sky-700 hover:text-sky-900"
                >
                  Ver todos →
                </Link>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Avatar + menú usuario */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition-all hover:border-[#4FAEB2]/60"
          >
            {/* Fondo blanco y object-contain: el logo es un círculo sobre
                blanco. El negro de antes le dibujaba un aro oscuro alrededor, y
                el scale-[1.15] le comía el borde del círculo. */}
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.25)" }}
            >
              <Image
                src="/brand/roldan-logo.png"
                alt="Aceros Metal Roldán e Hijos"
                width={72}
                height={72}
                sizes="36px"
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <div className="hidden text-left sm:block">
              <p className="max-w-[180px] truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3F8E91]">{displayRole}</p>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {userMenuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-[#4FAEB2]/15">
              {/* franja superior turquesa */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40"
              />
              <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
                  style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Sesión</p>
              </div>
              <div className="border-b border-slate-100 px-4 pb-3">
                <p className="truncate text-sm font-semibold text-slate-900">{dropdownName}</p>
                {fallbackEmail ? (
                  <p className="truncate text-xs text-slate-500">{fallbackEmail}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
