import type { ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * Una sección de un formulario largo.
 *
 * ── POR QUÉ NUMERADAS ──────────────────────────────────────────────────────
 *   Nuevo presupuesto es una pantalla de scroll largo: cliente, productos,
 *   condiciones y notas, una tarjeta abajo de la otra, todas iguales y con un
 *   título chiquito en gris. No se veía dónde terminaba una y empezaba la
 *   otra, ni cuánto faltaba. Con el paso numerado, el que la está llenando
 *   sabe en qué parte está sin tener que leer.
 *
 *   El número además deja marcar lo que ya está completo, que es lo que
 *   contesta la pregunta de por qué el botón de guardar sigue apagado.
 */
export default function SeccionForm({
  paso, titulo, descripcion, completa = false, acciones, children,
}: {
  /** El número que se muestra en el círculo. */
  paso: number;
  titulo: string;
  descripcion?: ReactNode;
  /** true pinta el número como hecho: lo mínimo de esta sección ya está. */
  completa?: boolean;
  /** Controles de la sección, arriba a la derecha. */
  acciones?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              completa ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            {completa ? <Check className="h-3.5 w-3.5" /> : paso}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
            {descripcion && (
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{descripcion}</p>
            )}
          </div>
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
