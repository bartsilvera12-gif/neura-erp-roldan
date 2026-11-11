"use client";

import {
  Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect,
  useMemo, useRef, useState, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * El selector de toda la aplicación.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *   "haceme todos los selectores integrados."
 *
 *   El `<select>` del navegador abre una lista que dibuja el sistema
 *   operativo: fondo blanco, resalte azul de Windows, tipografía que no es la
 *   de la pantalla y esquinas rectas en una pantalla de esquinas redondeadas.
 *   En el medio de un formulario celeste y gris, salta. Y no hay CSS que lo
 *   arregle: esa lista no se puede estilar, por eso todos los sistemas
 *   terminan reemplazándola.
 *
 * ── ES UN REEMPLAZO DIRECTO ────────────────────────────────────────────────
 *   Se usa igual que un `<select>`, con los mismos `<option>` adentro:
 *
 *       <Selector value={banco} onChange={(e) => setBanco(e.target.value)}>
 *         <option value="">Elegí el banco…</option>
 *         {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
 *       </Selector>
 *
 *   El `onChange` recibe algo con la forma `{ target: { value, name } }`, que
 *   es lo único que usaban los handlers. Así las 325 pantallas que ya estaban
 *   escritas cambian de etiqueta y nada más: cada una conserva su `className`,
 *   su ancho y su validación.
 *
 * ── EL BUSCADOR APARECE SOLO CUANDO SIRVE ──────────────────────────────────
 *   Con pocas opciones un buscador es un estorbo: son dos renglones y se
 *   eligen con el dedo. Desde ocho aparece, porque ahí ya se scrollea. El
 *   mismo componente hace las dos cosas para no tener que acordarse de cuál
 *   poner en cada pantalla.
 */

export interface OpcionSelector {
  value: string;
  label: string;
  disabled: boolean;
}

/** Desde cuántas opciones se muestra el buscador. */
const DESDE_BUSCADOR = 8;

/** El texto de un `<option>`, sea texto suelto, número o varios pedazos. */
function textoDe(nodo: ReactNode): string {
  if (nodo == null || nodo === false || nodo === true) return "";
  if (typeof nodo === "string") return nodo;
  if (typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join("");
  if (isValidElement(nodo)) {
    return textoDe((nodo.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * Las opciones escritas como `<option>` adentro.
 *
 * Aguanta lo que aparece en el código real: un `.map()` que devuelve un array,
 * un `{cond && <option/>}` que devuelve false, y fragments. `Children.toArray`
 * aplana los arrays y descarta null/false; los fragments se abren a mano.
 */
export function leerOpciones(children: ReactNode): OpcionSelector[] {
  const salida: OpcionSelector[] = [];
  for (const hijo of Children.toArray(children)) {
    if (!isValidElement(hijo)) continue;
    const props = hijo.props as {
      value?: unknown; children?: ReactNode; disabled?: boolean;
    };
    // Un fragment envuelve opciones: se abre y se sigue adentro.
    if ((hijo.type as unknown) === Fragment) {
      salida.push(...leerOpciones(props.children));
      continue;
    }
    if (hijo.type !== "option") continue;
    const label = textoDe(props.children);
    salida.push({
      // Igual que el navegador: sin `value`, el texto ES el valor.
      value: props.value == null ? label : String(props.value),
      label,
      disabled: props.disabled === true,
    });
  }
  return salida;
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Lo que se le pasa al `onChange`.
 *
 * Se declara como el evento de un `<select>` de verdad —y se arma un objeto
 * con la forma que los handlers usan— para que las pantallas no tengan que
 * cambiar ni una línea del manejador. Varias comparten un `handleChange(e)`
 * que lee `e.target.name` y `e.target.value` para inputs y selects a la vez;
 * con un tipo propio habría que tocar cada una de esas funciones.
 *
 * Lo que NO hay detrás es un elemento del DOM: `target` es un objeto con
 * `name` y `value`, no el `<select>`. Ningún handler de la aplicación usa
 * otra cosa —se revisó: no hay `selectedIndex` ni `currentTarget`— y
 * `preventDefault` y `stopPropagation` existen y no hacen nada, para que una
 * llamada no reviente.
 */
function eventoFalso(value: string, name: string): React.ChangeEvent<HTMLSelectElement> {
  const target = { value, name } as unknown as EventTarget & HTMLSelectElement;
  return {
    target,
    currentTarget: target,
    type: "change",
    preventDefault() {},
    stopPropagation() {},
  } as unknown as React.ChangeEvent<HTMLSelectElement>;
}

export interface SelectorProps {
  value?: string | number | null;
  /** Para los que no se controlan por estado: arrancan en este valor. */
  defaultValue?: string | number | null;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  name?: string;
  id?: string;
  /** Se acepta porque las pantallas lo pasan; la validación la hace el form. */
  required?: boolean;
  title?: string;
  "aria-label"?: string;
  /** Para las tarjetas que arrastran: el clic no tiene que llegar al padre. */
  onClick?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  style?: React.CSSProperties;
  /** Texto cuando no hay nada elegido y ninguna opción coincide con el valor. */
  placeholder?: string;
}

export default function Selector({
  value, defaultValue, onChange, children, disabled = false, className = "",
  name = "", id, title, placeholder = "Elegí…",
  onClick, onPointerDown, onFocus, style, "aria-label": ariaLabel,
}: SelectorProps) {
  const opciones = useMemo(() => leerOpciones(children), [children]);

  /**
   * Hay dos formas de usarlo, igual que un `<select>`: con `value` y estado
   * afuera, o con `defaultValue` y que se acuerde solo. La segunda es la de
   * los formularios que se leen al enviar, no a cada tecla.
   */
  const esControlado = value !== undefined;
  const [interno, setInterno] = useState(defaultValue == null ? "" : String(defaultValue));
  const valor = esControlado ? (value == null ? "" : String(value)) : interno;
  const elegida = opciones.find((o) => o.value === valor) ?? null;

  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [marcado, setMarcado] = useState(0);
  /** Dónde dibujar la lista, en coordenadas de pantalla. */
  const [caja2, setCaja2] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const autoId = useId();

  const conBuscador = opciones.length >= DESDE_BUSCADOR;

  const filtradas = useMemo(() => {
    const t = normalizar(q);
    if (!t) return opciones;
    const palabras = t.split(/\s+/).filter(Boolean);
    return opciones.filter((o) => {
      const heno = normalizar(o.label);
      return palabras.every((p) => heno.includes(p));
    });
  }, [opciones, q]);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setQ("");
  }, []);

  const elegir = useCallback((o: OpcionSelector) => {
    if (o.disabled) return;
    if (!esControlado) setInterno(o.value);
    onChange?.(eventoFalso(o.value, name));
    cerrar();
    boton.current?.focus();
  }, [onChange, name, cerrar, esControlado]);

  /**
   * La lista se dibuja en el `body`, no acá adentro.
   *
   * Un `<select>` del navegador se sale de cualquier contenedor con scroll;
   * una lista normal, no: adentro de una tabla con `overflow-x-auto` quedaría
   * cortada por el borde, y en la última fila se vería un pedacito. Por eso va
   * en un portal con posición de pantalla, que se recalcula al scrollear.
   */
  const ubicar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    // Si abajo no entra y arriba sí, se abre para arriba. Pasa siempre en la
    // última fila de una tabla, que es donde más se usa.
    const abajo = window.innerHeight - r.bottom;
    const arriba = abajo < 260 && r.top > 260;
    setCaja2({
      left: r.left,
      width: r.width,
      ...(arriba ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, []);

  function abrir() {
    if (disabled) return;
    ubicar();
    const i = opciones.findIndex((o) => o.value === valor);
    setMarcado(i >= 0 ? i : 0);
    setAbierto(true);
  }

  // Antes de pintar, para que no se vea saltar de una posición a la otra.
  useLayoutEffect(() => { if (abierto) ubicar(); }, [abierto, ubicar]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current?.contains(e.target as Node)) return;
      if (lista.current?.closest("[data-selector-lista]")?.contains(e.target as Node)) return;
      cerrar();
    };
    // Scrollear con la lista abierta no la tiene que dejar colgada arriba.
    const seMovio = () => ubicar();
    window.addEventListener("scroll", seMovio, true);
    window.addEventListener("resize", seMovio);
    document.addEventListener("mousedown", fuera);
    const t = setTimeout(() => {
      if (conBuscador) buscador.current?.focus();
      else lista.current?.focus();
    }, 20);
    return () => {
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("scroll", seMovio, true);
      window.removeEventListener("resize", seMovio);
      clearTimeout(t);
    };
  }, [abierto, cerrar, conBuscador, ubicar]);

  // La opción marcada siempre a la vista, si no las flechas la pierden.
  useEffect(() => {
    if (!abierto) return;
    lista.current?.querySelector<HTMLElement>(`[data-i="${marcado}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [marcado, abierto]);

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); cerrar(); boton.current?.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!abierto) { abrir(); return; }
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setMarcado((m) => {
        // Se saltean las deshabilitadas, que si no la marca se traba ahí.
        for (let k = 1; k <= filtradas.length; k++) {
          const i = (m + paso * k + filtradas.length * k) % filtradas.length;
          if (filtradas[i] && !filtradas[i].disabled) return i;
        }
        return m;
      });
      return;
    }
    if (e.key === "Enter" || (e.key === " " && !conBuscador)) {
      e.preventDefault();
      if (!abierto) { abrir(); return; }
      const o = filtradas[marcado];
      if (o) elegir(o);
      return;
    }
    if (e.key === "Tab" && abierto) cerrar();
  }

  const idBoton = id ?? `sel-${autoId}`;

  return (
    <div ref={caja} className={`relative ${abierto ? "z-50" : ""}`}>
      {/* Un <select> con `name` adentro de un <form> viaja solo al enviarlo.
          Acá lo que se dibuja es un botón, que no viaja: sin este campo
          escondido, ese dato se perdería al guardar y nadie vería por qué. */}
      {name !== "" && <input type="hidden" name={name} value={valor} />}
      <button
        ref={boton}
        id={idBoton}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={(e) => { onClick?.(e); if (abierto) cerrar(); else abrir(); }}
        onPointerDown={onPointerDown}
        onFocus={onFocus}
        style={style}
        onKeyDown={teclas}
        /* Se conserva el className de cada pantalla —ancho, borde, tamaño de
           letra— y solo se agrega lo que hace falta para que el texto y la
           flecha queden alineados. Si no, habría que repasar 325 llamadas. */
        className={`${className} inline-flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`truncate ${elegida && elegida.value !== "" ? "" : "text-slate-400"}`}>
          {elegida ? elegida.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto && caja2 && createPortal(
        <div
          data-selector-lista
          style={{
            position: "fixed",
            left: caja2.left,
            minWidth: caja2.width,
            ...(caja2.top != null ? { top: caja2.top } : { bottom: caja2.bottom }),
          }}
          /*
            Z-INDEX 2000: la lista va ARRIBA DE TODO lo que la pueda abrir.

            Cuelga de `body`, así que compite en el stacking context raíz con
            las demás capas flotantes, que también cuelgan de ahí. Con z-[100]
            quedaba por debajo de dos de ellas, y en las dos el combo se abría
            PERO NO SE VEÍA:
              · el panel del calendario (zIndex 1000), que es el que tiene
                adentro los combos de mes y año: tocar "Noviembre" no mostraba
                nada, la lista salía atrás de la grilla de días;
              · los modales (hasta z-[120]).

            Una lista desplegada es siempre la capa más nueva y la más
            transitoria: no hay nada que deba taparla mientras está abierta,
            salvo la pantalla de carga (z-[9999]), que corta todo a propósito.
          */
          className="z-[2000] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {conBuscador && (
            <div className="relative border-b border-slate-100 p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={buscador}
                value={q}
                /* Al filtrar, la marca vuelve arriba: si no, queda apuntando a
                   una opción que ya no está y Enter elige cualquier cosa. */
                onChange={(e) => { setQ(e.target.value); setMarcado(0); }}
                onKeyDown={teclas}
                placeholder="Buscar…"
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
            </div>
          )}

          <ul
            ref={lista}
            tabIndex={-1}
            role="listbox"
            onKeyDown={teclas}
            className="m-0 max-h-60 list-none overflow-y-auto p-1 outline-none"
          >
            {filtradas.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">Sin coincidencias</li>
            ) : (
              filtradas.map((o, i) => {
                const esta = o.value === valor;
                return (
                  <li key={`${o.value}-${i}`} data-i={i}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={esta}
                      disabled={o.disabled}
                      onClick={() => elegir(o)}
                      onMouseEnter={() => setMarcado(i)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
                        i === marcado && !o.disabled ? "bg-[#4FAEB2]/10" : ""
                      } ${esta ? "font-semibold text-[#3F8E91]" : "text-slate-700"}`}
                    >
                      <span className="truncate">{o.label || <span className="text-slate-400">—</span>}</span>
                      {esta && <Check className="h-3.5 w-3.5 shrink-0 text-[#4FAEB2]" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
