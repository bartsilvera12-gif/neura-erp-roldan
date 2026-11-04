/** Piezas chicas que comparten el listado y la ficha del empleado. */

const ESTADOS: Record<string, { label: string; cls: string }> = {
  activo: { label: "Activo", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  baja: { label: "Baja", cls: "bg-red-50 text-red-700 ring-red-200" },
  suspendido: { label: "Suspendido", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  pendiente: { label: "Pendiente", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export function EstadoEmpleadoBadge({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? { label: estado, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${e.cls}`}>
      {e.label}
    </span>
  );
}

const COLORES = ["bg-[#4FAEB2]", "bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-emerald-500"];

export function Iniciales({ nombre, grande = false }: { nombre: string; grande?: boolean }) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const ini = ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
  const color = COLORES[[...nombre].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORES.length];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color} ${
        grande ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs"
      }`}
      aria-hidden
    >
      {ini}
    </span>
  );
}
