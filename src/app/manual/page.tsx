"use client";

/**
 * /manual — El manual del sistema.
 *
 * ── CÓMO SE LEE ────────────────────────────────────────────────────────────
 *   Portada con los temas, lista de tareas del tema, y cada tarea de a UN
 *   paso por pantalla: una frase, la captura agrandada donde hay que tocar y
 *   «Siguiente».
 *
 *   De a un paso y no todo junto porque el que abre el manual está trabado en
 *   algo, no está estudiando. Una pantalla con doce pasos obliga a buscar en
 *   cuál va; una con uno, no.
 *
 * ── LA LUPA ────────────────────────────────────────────────────────────────
 *   Cuando el paso tiene marca, la captura se muestra agrandada ALREDEDOR del
 *   botón, con el resto oscurecido y una flecha encima. La posición sale de
 *   `marcas.json`, medida sobre la pantalla real.
 *
 *   Sin marca medida se muestra la pantalla entera. Es preferible a una
 *   flecha apuntando a cualquier lado.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Expand, Lightbulb,
  Package, Rocket, Search, ShoppingCart, Truck, FileText, X, AlertTriangle,
  Users, Wallet, BarChart3, UserCog, Settings,
} from "lucide-react";
import { GRUPOS, GUIAS, LLEGAR, type Guia } from "@/lib/manual/contenido";
import marcasJson from "@/lib/manual/marcas.json";

/**
 * Dónde cae el objetivo y CUÁNTO MIDE, en porcentajes de la captura.
 *
 * `w`/`h` pueden faltar en marcas viejas; sin ellas se asume un objetivo
 * chico y la flecha se planta igual, solo que más pegada.
 */
type Punto = { x: number; y: number; w?: number; h?: number };
const MARCAS = marcasJson as unknown as Record<string, Record<string, Punto | null>>;

const TEMAS: { grupo: string; titulo: string; detalle: string; Icono: React.ComponentType<{ className?: string }> }[] = [
  { grupo: "Primeros pasos", titulo: "Lo básico", detalle: "Cómo moverte por el sistema", Icono: Rocket },
  { grupo: "Caja y ventas", titulo: "Vender y cobrar", detalle: "Abrir la caja, vender, devolver y cerrar", Icono: ShoppingCart },
  { grupo: "Inventario", titulo: "Mis productos", detalle: "Cargar productos y controlar el stock", Icono: Package },
  { grupo: "Compras y pagos", titulo: "Comprar y pagar", detalle: "Facturas, proveedores y cobranzas", Icono: Truck },
  { grupo: "Presupuestos", titulo: "Presupuestos", detalle: "Cotizar y mandar a cobrar", Icono: FileText },
  { grupo: "Clientes", titulo: "Mis clientes", detalle: "Altas, cuenta corriente y WhatsApp", Icono: Users },
  { grupo: "Gastos y bancos", titulo: "Gastos y bancos", detalle: "Lo que se paga y de dónde sale", Icono: Wallet },
  { grupo: "Informes", titulo: "Informes", detalle: "Ganancias, comisiones y lo del contador", Icono: BarChart3 },
  { grupo: "Personal", titulo: "El personal", detalle: "Horarios, vacaciones, sueldos y aguinaldo", Icono: UserCog },
  { grupo: "Administración", titulo: "Administración", detalle: "Usuarios, sucursales y facturación", Icono: Settings },
];

type Nota = { tipo: "consejo" | "ojo"; texto: string };
type Diapositiva = { frase: string; aclara?: string; img?: string; alt?: string; marca?: string; intro?: string; notas: Nota[] };

/** Una guía se recorre de a una frase por pantalla. */
function diapositivas(g: Guia): Diapositiva[] {
  const out: Diapositiva[] = [];
  const llegar = LLEGAR[g.id];
  if (llegar) {
    const [seccion, item] = llegar;
    /*
      Este paso lleva la captura `menu`, que es la pantalla con la ventana
      alta para que entre el menú entero, y la flecha sobre el ítem de ESTA
      guía.

      Antes usaba `inicio` sin marca, y como el paso es el mismo en las 21
      guías, las 21 empezaban mostrando el Dashboard igualito. Daba la
      sensación de que el manual estaba roto, y encima el paso decía "abrí el
      menú" mientras mostraba una pantalla donde el menú es una franja
      chiquita del costado que no se lee.

      La marca es el ítem de primer nivel: de "Inventario → Productos" se
      señala "Inventario", que es lo que hay que tocar primero.
    */
    const item1 = (item ?? seccion).split("→")[0].trim();
    out.push({
      frase: `En el menú de la izquierda, abrí ${seccion}${item ? ` y entrá a ${item}` : ""}.`,
      aclara: "En el celular, el menú se abre con el botón de las tres rayitas.",
      img: "menu",
      alt: "El menú del sistema",
      marca: item1,
      notas: [],
    });
  }
  for (const b of g.bloques) {
    const pasos = b.pasos ?? [];
    if (b.texto && pasos.length === 0) out.push({ frase: b.texto, img: b.img, alt: b.alt, notas: [] });
    // `p.img` gana sobre `b.img`. Casi siempre un bloque son varios pasos
    // SOBRE LA MISMA PANTALLA, y ahí repetir la captura es lo correcto. Pero
    // en las guías que resumen un recorrido —"Un día de trabajo"— cada paso
    // ocurre en otra pantalla, y mostrar seis veces el Dashboard enseña mal:
    // el que lee cree que ahí se cobra.
    pasos.forEach((p, i) =>
      out.push({
        frase: p.t, aclara: p.d, img: p.img ?? b.img, alt: p.alt ?? b.alt,
        marca: p.marca, intro: i === 0 ? b.texto : undefined, notas: [],
      })
    );
    const nota: Nota | null = b.consejo
      ? { tipo: "consejo", texto: b.consejo }
      : b.ojo
      ? { tipo: "ojo", texto: b.ojo }
      : null;
    if (nota) {
      if (out.length > 0) out[out.length - 1].notas.push(nota);
      else out.push({ frase: nota.texto, notas: [] });
    }
  }
  return out;
}

const ZOOM = 2.1;
const PROP_VISOR = 10 / 16;

/** La captura agrandada alrededor del lugar a tocar, con el resto oscurecido. */
function Visor({ d, onAmpliar }: { d: Diapositiva; onAmpliar: () => void }) {
  const [proporcion, setProporcion] = useState<number | null>(null);
  if (!d.img) return null;
  const src = `/manual/${d.img}.webp`;
  const p = d.marca ? MARCAS[d.img]?.[d.marca] ?? null : null;

  if (!p) {
    return (
      <button
        type="button"
        onClick={onAmpliar}
        aria-label="Ver la pantalla completa"
        className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={d.alt ?? ""} className="block w-full object-contain" />
      </button>
    );
  }

  const r = proporcion ?? 0.625;
  const altoImg = (ZOOM * r) / PROP_VISOR;
  // El punto queda a la izquierda del centro: lo que se señala sigue a la derecha.
  const aLaDerecha = p.x >= 50;
  const izq = Math.min(0, Math.max(100 - 100 * ZOOM, (aLaDerecha ? 22 : 38) - p.x * ZOOM));
  const arriba = Math.min(0, Math.max(100 - 100 * altoImg, 50 - p.y * altoImg));
  const px = p.x * ZOOM + izq;
  const py = p.y * altoImg + arriba;

  return (
    <button
      type="button"
      onClick={onAmpliar}
      aria-label="Ver la pantalla completa"
      className="relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={d.alt ?? ""}
        onLoad={(e) => setProporcion(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
        className={`absolute max-w-none ${proporcion ? "" : "opacity-0"}`}
        style={{ width: `${ZOOM * 100}%`, left: `${izq}%`, top: `${arriba}%` }}
      />
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse ${aLaDerecha ? 62 : 42}% 38% at ${
            aLaDerecha ? px + 26 : px + 13
          }% ${py}%, transparent 72%, rgba(15,23,42,.5) 100%)`,
        }}
      />
      {/*
        LA FLECHA SE PLANTA AL BORDE DEL OBJETIVO, NO ENCIMA NI A OJO.

        Hubo dos intentos antes, y cada uno arreglaba un caso rompiendo el
        otro:
          · entrando de costado a una distancia fija, el círculo rojo se comía
            la primera letra de los botones anchos ("Nuevo producto" se leía
            "uevo producto");
          · bajando desde arriba a una distancia fija, en el menú caía sobre la
            opción de más arriba, así que el manual señalaba otra cosa.

        Como ahora cada marca guarda su ancho y su alto, se calculan los bordes
        reales y la flecha se pone pegada al borde, con un respiro:
          · si el objetivo tiene lugar a su izquierda, la flecha viene de la
            izquierda apuntando a la derecha (el caso normal: botones y campos);
          · si está pegado al borde izquierdo —las filas del menú—, viene de la
            derecha apuntando a la izquierda;
          · y si es tan ancho que no entra de ningún costado, baja desde arriba,
            pegada al borde de arriba y no a media altura.
      */}
      {(() => {
        const RESPIRO = 1.5;          // separación entre la punta y el borde
        const RADIO = 3.2;            // lo que ocupa el círculo, en % del visor
        const medioAncho = ((p.w ?? 0) / 2) * ZOOM;
        const medioAlto = ((p.h ?? 0) / 2) * altoImg;
        const bordeIzq = px - medioAncho;
        const bordeDer = px + medioAncho;
        const bordeArriba = py - medioAlto;

        const cabeIzquierda = bordeIzq - RESPIRO - RADIO * 2 > 1;
        const cabeDerecha = bordeDer + RESPIRO + RADIO * 2 < 99;

        let left: number, top: number, direccion: "derecha" | "izquierda" | "abajo";
        if (cabeIzquierda) {
          direccion = "derecha";
          left = bordeIzq - RESPIRO - RADIO;
          top = py;
        } else if (cabeDerecha) {
          direccion = "izquierda";
          left = bordeDer + RESPIRO + RADIO;
          top = py;
        } else {
          direccion = "abajo";
          left = px;
          top = Math.max(bordeArriba - RESPIRO - RADIO, RADIO + 1);
        }
        const Icono = direccion === "derecha" ? ArrowRight : direccion === "izquierda" ? ArrowLeft : ArrowDown;

        return (
          <span
            className="pointer-events-none absolute"
            style={{ left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" }}
          >
            <span className="relative grid h-9 w-9 place-items-center sm:h-11 sm:w-11">
              <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/50" />
              <span className="relative grid h-full w-full place-items-center rounded-full bg-rose-600 text-white ring-2 ring-white">
                <Icono className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
              </span>
            </span>
          </span>
        );
      })()}
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2.5 py-1 text-xs font-medium text-white">
        <Expand className="h-3.5 w-3.5" aria-hidden /> Ver toda la pantalla
      </span>
    </button>
  );
}

/** Una guía, de a un paso por pantalla. */
function Recorrido({ guia, alSalir }: { guia: Guia; alSalir: () => void }) {
  const pasos = useMemo(() => diapositivas(guia), [guia]);
  const [i, setI] = useState(0);
  const [ampliada, setAmpliada] = useState(false);
  const d = pasos[i];
  const ultimo = i === pasos.length - 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={alSalir}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <span className="text-xs font-medium text-slate-400">
          Paso {i + 1} de {pasos.length}
        </span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-[#4FAEB2] transition-[width] duration-300"
          style={{ width: `${((i + 1) / pasos.length) * 100}%` }}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        {d.intro && <p className="mb-3 text-sm text-slate-500">{d.intro}</p>}
        <p className="text-xl font-semibold leading-snug text-slate-900 sm:text-2xl">{d.frase}</p>
        {d.aclara && <p className="mt-2 text-sm text-slate-500">{d.aclara}</p>}

        {d.img && (
          <div className="mt-5">
            <Visor d={d} onAmpliar={() => setAmpliada(true)} />
          </div>
        )}

        {d.notas.map((n, k) => (
          <p
            key={k}
            className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
              n.tipo === "ojo"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-[#4FAEB2]/30 bg-[#4FAEB2]/5 text-[#2F6E71]"
            }`}
          >
            {n.tipo === "ojo" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <span>{n.texto}</span>
          </p>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setI((v) => Math.max(0, v - 1))}
          disabled={i === 0}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" /> Anterior
        </button>
        {ultimo ? (
          <button
            type="button"
            onClick={alSalir}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            <Check className="h-4 w-4" /> Listo
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setI((v) => Math.min(pasos.length - 1, v + 1))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            Siguiente <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {ampliada && d.img && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4"
          onClick={() => setAmpliada(false)}
        >
          <button
            type="button"
            onClick={() => setAmpliada(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/manual/${d.img}.webp`}
            alt={d.alt ?? ""}
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function ManualPage() {
  const [tema, setTema] = useState<string | null>(null);
  const [guia, setGuia] = useState<Guia | null>(null);
  const [q, setQ] = useState("");

  const encontradas = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return null;
    return GUIAS.filter((g) =>
      norm(
        [g.titulo, g.resumen, ...g.bloques.flatMap((b) => [b.texto, b.consejo, b.ojo, ...(b.pasos ?? []).flatMap((p) => [p.t, p.d])])]
          .filter(Boolean)
          .join(" ")
      ).includes(t)
    );
  }, [q]);

  if (guia) {
    return (
      <div className="mx-auto max-w-3xl">
        <Recorrido guia={guia} alSalir={() => setGuia(null)} />
      </div>
    );
  }

  const lista = encontradas ?? (tema ? GUIAS.filter((g) => g.grupo === tema) : null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#4FAEB2]/10 text-[#3F8E91]">
          <BookOpen className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Manual</h1>
          <p className="text-sm text-slate-500">
            Cómo se hace cada cosa, paso a paso y con las pantallas del sistema.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar: cerrar caja, cargar producto, pagar proveedor…"
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
      </div>

      {lista ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {encontradas ? `${lista.length} ${lista.length === 1 ? "guía" : "guías"}` : tema}
            </h2>
            {!encontradas && (
              <button type="button" onClick={() => setTema(null)} className="text-xs text-slate-500 hover:text-slate-800">
                Ver todos los temas
              </button>
            )}
          </div>
          {lista.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              No hay ninguna guía sobre eso todavía.
            </p>
          )}
          <ul className="space-y-2">
            {lista.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setGuia(g)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left transition-colors hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{g.titulo}</p>
                    <p className="truncate text-sm text-slate-500">{g.resumen}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMAS.filter((t) => GUIAS.some((g) => g.grupo === t.grupo)).map(({ grupo, titulo, detalle, Icono }) => (
            <button
              key={grupo}
              type="button"
              onClick={() => setTema(grupo)}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/[0.03]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#4FAEB2]/10 text-[#3F8E91]">
                <Icono className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{titulo}</span>
                <span className="block text-sm text-slate-500">{detalle}</span>
                <span className="mt-1 block text-xs text-slate-400">
                  {GUIAS.filter((g) => g.grupo === grupo).length} guías
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        ¿Falta algo acá? Escribinos y lo agregamos.{" "}
        <Link href="/" className="text-[#3F8E91] hover:underline">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}

/** Los grupos que todavía no tienen guías no se muestran. */
void GRUPOS;
