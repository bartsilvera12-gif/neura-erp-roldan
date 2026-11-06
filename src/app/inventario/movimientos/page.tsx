"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AccionesTabla from "@/components/ui/AccionesTabla";
import { getMovimientos } from "@/lib/inventario/storage";
import type { MovimientoInventario, TipoMovimiento, OrigenMovimiento } from "@/lib/inventario/types";
import Selector from "@/components/ui/Selector";
import PageHeader from "@/components/ui/PageHeader";
import BarraFiltros, { CampoFiltro, campoClase } from "@/components/ui/BarraFiltros";
import { Plus, Undo2 } from "lucide-react";

const tipoBadge: Record<TipoMovimiento, string> = {
  ENTRADA: "bg-green-100 text-green-700",
  SALIDA: "bg-red-100 text-red-700",
  AJUSTE: "bg-yellow-100 text-yellow-700",
};

const origenLabel: Record<OrigenMovimiento, string> = {
  compra: "Compra",
  venta: "Venta",
  ajuste_manual: "Ajuste manual",
  inventario_inicial: "Inventario inicial",
  anulacion_venta: "Anulación de venta",
  anulacion_compra: "Anulación de compra",
  produccion: "Producción",
  devolucion_venta: "Devolución de venta",
  devolucion_proveedor: "Devolución a proveedor",
  transferencia: "Transferencia entre depósitos",
  transferencia_salida: "Transferencia enviada",
  transferencia_entrada: "Transferencia recibida",
  edicion_venta: "Edición de venta",
  edicion_venta_reversa: "Edición de venta (reversa)",
};

/**
 * Los tres tipos, en tono suave.
 *
 * El ORIGEN, en cambio, ya no lleva color: eran catorce —azul, violeta,
 * naranja, rosa, índigo…— uno por cada clase, y con 479 filas la pantalla
 * quedaba un arcoíris en el que ningún color significaba nada. Catorce
 * colores no se distinguen ni se recuerdan: el origen ahora es texto, que se
 * lee, y el color queda para el tipo, que son tres.
 */

function formatGs(valor: number) {
  // El guaraní no tiene decimales: el costo promedio sí los arrastra
  // (38.848,82) y en pantalla parecía un precio en otra moneda.
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    // Año de dos dígitos y sin coma: con el formato largo la celda se
    // partía en dos renglones y cada fila crecía por una fecha.
    return `${dd}/${mm}/${String(yyyy).slice(2)} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

export default function MovimientosPage() {
  const [todos, setTodos] = useState<MovimientoInventario[]>([]);

  // Filtros (punto 8.2: se saca el de tipo, se agrega el de usuario y se
  // conserva el de fecha).
  //
  // POR QUÉ SE FUE EL FILTRO DE TIPO
  //   ENTRADA / SALIDA / AJUSTE ya se lee de un vistazo en la columna Tipo y en
  //   el signo de la cantidad, y además se deduce del origen: una compra es
  //   siempre entrada, una venta siempre salida. El filtro que faltaba era el
  //   otro: "¿qué tocó tal persona?", que es la pregunta de cuando aparece un
  //   ajuste que nadie recuerda haber hecho.
  const [busqueda, setBusqueda] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState<OrigenMovimiento | "">("");
  const [filtroUsuario, setFiltroUsuario] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");  // "YYYY-MM-DD"
  const [fechaHasta, setFechaHasta] = useState(""); // "YYYY-MM-DD"

  useEffect(() => {
    let cancelled = false;
    getMovimientos().then((data) => {
      if (!cancelled) setTodos(data);
    });
    return () => { cancelled = true; };
  }, []);

  const filtrados = todos.filter((m) => {
    const texto = busqueda.toLowerCase();
    const coincideTexto =
      texto === "" ||
      m.producto_nombre.toLowerCase().includes(texto) ||
      m.producto_sku.toLowerCase().includes(texto) ||
      (m.referencia ?? "").toLowerCase().includes(texto);
    const coincideOrigen = filtroOrigen === "" || m.origen === filtroOrigen;
    const coincideUsuario =
      filtroUsuario === "" || (m.usuario_nombre ?? "") === filtroUsuario;

    // Compara solo la parte de fecha (YYYY-MM-DD) del ISO string del movimiento
    const fechaMov = m.fecha.slice(0, 10); // "YYYY-MM-DD"
    const coincideDesde = fechaDesde === "" || fechaMov >= fechaDesde;
    const coincideHasta = fechaHasta === "" || fechaMov <= fechaHasta;

    return coincideTexto && coincideOrigen && coincideUsuario && coincideDesde && coincideHasta;
  });

  // El desplegable se arma con los usuarios que realmente aparecen en los
  // movimientos cargados: una lista de todos los usuarios de la empresa tendría
  // nombres que nunca tocaron el stock.
  const usuariosEnLista = Array.from(
    new Set(todos.map((m) => (m.usuario_nombre ?? "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"));

  return (
    <div className="space-y-4">

      {/* Había dos títulos, uno adentro del otro: "Movimientos de inventario"
          afuera y "Historial" adentro de la tarjeta, diciendo lo mismo. */}
      <PageHeader
        eyebrow="Inventario"
        title="Movimientos de inventario"
        description="Las entradas, las salidas y los ajustes de stock, con quién los hizo y de dónde salieron."
        actions={
          <>
            {/* Requisito 11.1: la planilla es exactamente lo que se ve, con
                los filtros aplicados. */}
            <AccionesTabla
              titulo="Movimientos de inventario"
              archivo={`movimientos-${fechaDesde || "inicio"}_${fechaHasta || "hoy"}`}
              subtitulo={fechaDesde || fechaHasta ? `Del ${fechaDesde || "inicio"} al ${fechaHasta || "hoy"}` : undefined}
              columnas={["Fecha", "Producto", "SKU", "Tipo", "Cantidad", "Costo unit.", "Origen", "Referencia", "Usuario"]}
              filas={filtrados.map((m) => [
                formatFecha(m.fecha),
                m.producto_nombre,
                m.producto_sku,
                m.tipo,
                m.tipo === "SALIDA" ? -Math.abs(m.cantidad) : m.cantidad,
                m.costo_unitario,
                origenLabel[m.origen] ?? m.origen,
                m.referencia ?? "",
                m.usuario_nombre ?? "",
              ])}
            />
            <Link
              href="/inventario/devoluciones-proveedor"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Undo2 className="h-4 w-4" /> Devolución a proveedor
            </Link>
            {/* Era un botón con degradé, anillo y un salto al apretarlo: el
                único así en toda la aplicación. */}
            <Link
              href="/inventario/movimientos/nuevo"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]"
            >
              <Plus className="h-4 w-4" /> Nuevo movimiento
            </Link>
          </>
        }
      />

      <BarraFiltros
        hayFiltro={!!(busqueda || filtroUsuario || filtroOrigen || fechaDesde || fechaHasta)}
        onLimpiar={() => {
          setBusqueda("");
          setFiltroUsuario("");
          setFiltroOrigen("");
          setFechaDesde("");
          setFechaHasta("");
        }}
      >
        <CampoFiltro etiqueta="Buscar">
          <input
            type="text"
            placeholder="Producto, SKU o comprobante"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${campoClase} w-64`}
          />
        </CampoFiltro>
        <CampoFiltro etiqueta="Usuario">
          <Selector
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
            className={`${campoClase} w-48`}
          >
            <option value="">Todos</option>
            {usuariosEnLista.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </Selector>
        </CampoFiltro>
        <CampoFiltro etiqueta="Origen">
          {/* El desplegable se arma de origenLabel para que no vuelva a quedar
              corto: las transferencias y las ediciones de venta ya escribían
              movimientos y no estaban en esta lista, así que no había forma de
              filtrarlas. */}
          <Selector
            value={filtroOrigen}
            onChange={(e) => setFiltroOrigen(e.target.value as OrigenMovimiento | "")}
            className={`${campoClase} w-56`}
          >
            <option value="">Todos</option>
            {(Object.keys(origenLabel) as OrigenMovimiento[]).map((o) => (
              <option key={o} value={o}>{origenLabel[o]}</option>
            ))}
          </Selector>
        </CampoFiltro>
        <CampoFiltro etiqueta="Desde">
          <input
            type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
            max={fechaHasta || undefined} className={campoClase}
          />
        </CampoFiltro>
        <CampoFiltro etiqueta="Hasta">
          <input
            type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
            min={fechaDesde || undefined} className={campoClase}
          />
        </CampoFiltro>
      </BarraFiltros>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
          {filtrados.length === todos.length
            ? `${todos.length} movimientos`
            : `${filtrados.length} de ${todos.length} movimientos`}
        </p>

        {/* Tabla — min-w activa el scroll horizontal en mobile;
            SKU, Origen, Usuario se ocultan en pantallas chicas. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] sm:min-w-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pl-4 pr-4 font-medium">Producto</th>
                <th className="py-2 pr-4 font-medium hidden md:table-cell">SKU</th>
                <th className="py-2 pr-4 font-medium">Tipo</th>
                <th className="py-2 pr-4 font-medium text-right">Cantidad</th>
                <th className="py-2 pr-4 font-medium text-right hidden lg:table-cell">Costo unit.</th>
                <th className="py-2 pr-4 font-medium hidden md:table-cell">Origen</th>
                <th className="py-2 pr-4 font-medium hidden lg:table-cell">Referencia</th>
                <th className="py-2 pr-4 font-medium hidden lg:table-cell">Usuario</th>
                <th className="py-2 pr-4 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-400">
                    {todos.length === 0
                      ? "No hay movimientos registrados"
                      : "Ningún movimiento coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtrados.map((m) => {
                  const signo =
                    m.tipo === "ENTRADA" ? "+" : m.tipo === "SALIDA" ? "−" : m.cantidad >= 0 ? "+" : "";
                  const cantidadColor =
                    m.tipo === "ENTRADA"
                      ? "text-green-600"
                      : m.tipo === "SALIDA"
                      ? "text-red-600"
                      : "text-yellow-600";

                  return (
                    /* Las filas eran de py-4: con 479 movimientos, entraban
                       siete en la pantalla y para leer el historial había que
                       scrollear a lo largo de tres pantallas por cada diez. */
                    <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="py-2 pl-4 pr-4 font-medium text-slate-800">{m.producto_nombre}</td>
                      <td className="hidden py-2 pr-4 font-mono text-xs text-slate-400 md:table-cell">{m.producto_sku}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tipoBadge[m.tipo]}`}>
                          {m.tipo}
                        </span>
                      </td>
                      <td className={`py-2 pr-4 text-right font-semibold tabular-nums ${cantidadColor}`}>
                        {signo}{Math.abs(m.cantidad)}
                      </td>
                      <td className="hidden py-2 pr-4 text-right tabular-nums text-slate-600 lg:table-cell">
                        {formatGs(m.costo_unitario)}
                      </td>
                      {/* El origen va en texto: con catorce colores distintos,
                          repetidos en cada fila, la columna pesaba más que el
                          dato. */}
                      <td className="hidden py-2 pr-4 text-xs text-slate-500 md:table-cell">
                        {origenLabel[m.origen]}
                      </td>
                      {/* El número del comprobante que originó el movimiento:
                          COMP-… para compras, TRF-… para transferencias. Sin
                          esta columna, una transferencia aparecía en la lista
                          sin forma de saber cuál era. Se recorta porque hay
                          referencias largas que empujaban la tabla entera. */}
                      <td
                        className="hidden max-w-[180px] truncate py-2 pr-4 font-mono text-[11px] text-slate-400 lg:table-cell"
                        title={m.referencia ?? undefined}
                      >
                        {m.referencia || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="hidden py-2 pr-4 text-xs text-slate-500 lg:table-cell">
                        {m.usuario_nombre ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-xs tabular-nums text-slate-500">
                        {formatFecha(m.fecha)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
}
