"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";

/**
 * Ciudad y barrio con los datos del INE (censo 2022): se busca la ciudad, y
 * el barrio ofrece solo los de esa ciudad. Se guardan como texto: si algo no
 * está en el listado (o venía escrito de otra forma) se escribe y listo.
 */

type Ciudad = { codigo: string; nombre: string; departamento: string };

/** Sin tildes ni mayúsculas, para que "nemby" encuentre "Ñemby". */
const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

let ciudadesCache: Promise<Ciudad[]> | null = null;
function traerCiudades(): Promise<Ciudad[]> {
  ciudadesCache ??= fetch("/api/geo")
    .then((r) => r.json())
    .then((j) => (j?.data?.ciudades ?? []) as Ciudad[])
    .catch(() => { ciudadesCache = null; return []; });
  return ciudadesCache;
}

/** Cómo se guarda la ciudad: con el departamento solo si el nombre se repite (hay dos "Bella Vista"). */
function valorCiudad(c: Ciudad, todas: Ciudad[]): string {
  return todas.filter((x) => x.nombre === c.nombre).length > 1 ? `${c.nombre} (${c.departamento})` : c.nombre;
}

export default function CiudadBarrio({ ciudad, barrio, onCiudad, onBarrio, inputCls, labelCls }: {
  ciudad: string;
  barrio: string;
  onCiudad: (v: string) => void;
  onBarrio: (v: string) => void;
  inputCls: string;
  labelCls: string;
}) {
  const [ciudades, setCiudades] = useState<Ciudad[]>([]);
  // Los barrios guardados con la ciudad a la que pertenecen: si cambia la
  // ciudad, los de la anterior dejan de valer sin tener que vaciarlos.
  const [barriosDe, setBarriosDe] = useState<{ codigo: string; barrios: string[] } | null>(null);

  useEffect(() => { void traerCiudades().then(setCiudades); }, []);

  const elegida = useMemo(
    () => ciudades.find((c) => plano(valorCiudad(c, ciudades)) === plano(ciudad)) ?? null,
    [ciudades, ciudad]
  );

  const codigo = elegida?.codigo ?? null;
  useEffect(() => {
    if (!codigo) return;
    let vivo = true;
    fetch(`/api/geo?ciudad=${codigo}`)
      .then((r) => r.json())
      .then((j) => { if (vivo) setBarriosDe({ codigo, barrios: (j?.data?.barrios ?? []) as string[] }); })
      .catch(() => { if (vivo) setBarriosDe({ codigo, barrios: [] }); });
    return () => { vivo = false; };
  }, [codigo]);
  const barrios = barriosDe && barriosDe.codigo === codigo ? barriosDe.barrios : [];

  return (
    <>
      <div>
        <label className={labelCls}>Ciudad</label>
        <Combo
          value={ciudad}
          onChange={(v) => { if (plano(v) !== plano(ciudad)) onBarrio(""); onCiudad(v); }}
          opciones={ciudades.map((c) => ({ valor: valorCiudad(c, ciudades), detalle: c.departamento }))}
          placeholder="Buscá la ciudad…"
          inputCls={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Barrio</label>
        <Combo
          value={barrio}
          onChange={onBarrio}
          opciones={barrios.map((b) => ({ valor: b }))}
          placeholder={elegida ? `Barrios de ${elegida.nombre}…` : ciudad ? "Escribí el barrio" : "Primero la ciudad"}
          inputCls={inputCls}
        />
      </div>
    </>
  );
}

function Combo({ value, onChange, opciones, placeholder, inputCls }: {
  value: string;
  onChange: (v: string) => void;
  opciones: Array<{ valor: string; detalle?: string }>;
  placeholder: string;
  inputCls: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);

  const filtradas = useMemo(() => {
    const q = plano(value);
    const lista = q ? opciones.filter((o) => plano(o.valor).includes(q)) : [...opciones];
    // Los que empiezan con lo escrito, primero.
    return lista.sort((a, b) => Number(!plano(a.valor).startsWith(q)) - Number(!plano(b.valor).startsWith(q))).slice(0, 60);
  }, [opciones, value]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  const elegir = (v: string) => { onChange(v); setAbierto(false); };
  const exacto = opciones.some((o) => plano(o.valor) === plano(value));

  return (
    <div ref={caja} className="relative mt-1">
      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setAbierto(true); setActivo(0); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (!abierto || filtradas.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActivo((i) => Math.min(i + 1, filtradas.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); elegir(filtradas[activo].valor); }
          else if (e.key === "Escape") setAbierto(false);
        }}
        className={`${inputCls} mt-0 pl-9`}
        autoComplete="off"
      />
      {abierto && opciones.length > 0 && !(exacto && filtradas.length <= 1) && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">No está en el listado del INE: queda como lo escribiste.</li>
          ) : filtradas.map((o, i) => (
            <li key={`${o.valor}-${i}`}
              onMouseDown={(e) => { e.preventDefault(); elegir(o.valor); }}
              onMouseEnter={() => setActivo(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${i === activo ? "bg-[#4FAEB2]/10 text-[#3F8E91]" : "text-slate-700"}`}>
              <span className="truncate">{o.valor}</span>
              {o.detalle && <span className="shrink-0 text-xs text-slate-400">{o.detalle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
