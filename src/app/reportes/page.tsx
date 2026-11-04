"use client";

import PageHeader from "@/components/ui/PageHeader";
import { ReportCard } from "@/components/reportes/ReportCard";
import { ArrowLeftRight, Banknote, FileArchive, FileWarning, HandCoins, History, Landmark, Package, ShieldAlert, ShoppingCart, Target, TrendingUp, Truck, Users, Wallet } from "lucide-react";

/** Hub de reportería operativa (Fase 1: Estado de cuenta + Proveedores). */
export default function ReportesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Análisis"
        title="Reportes"
        description="Panel de análisis y reportería operativa"
      />

      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <ReportCard
            title="Paquete mensual"
            subtitle="Todos los informes del mes en un ZIP"
            icon={FileArchive}
            description="Lo que se le manda al contador: se elige el mes una vez y salen los libros, las ventas, las compras, las cobranzas y el stock, cada uno en su planilla con encabezado y totales."
            href="/reportes/paquete-mensual"
          />
        </li>
        <li>
          <ReportCard
            title="Historial de ventas"
            subtitle="Todas las ventas de un período"
            icon={History}
            description="Para buscar una venta vieja y para mandar el listado: rango de fechas, filtros por cliente, vendedor, medio y estado, con Excel e imprimir."
            href="/reportes/historial-ventas"
          />
        </li>
        <li>
          <ReportCard
            title="Modificaciones administrativas"
            subtitle="Qué tocó el administrador"
            icon={ShieldAlert}
            description="Anulaciones, ediciones de ventas y turnos de caja reabiertos: quién lo hizo, cuándo y con qué motivo. Solo lo ve un administrador."
            href="/reportes/modificaciones"
          />
        </li>
        <li>
          <ReportCard
            title="Ganancias"
            subtitle="Rentabilidad semanal y mensual"
            icon={TrendingUp}
            description="Ventas, costo real de lo vendido, ganancia bruta, gastos, ganancia neta y márgenes — comparado contra el período anterior."
            href="/reportes/ganancias"
          />
        </li>
        <li>
          <ReportCard
            title="Rentabilidad"
            subtitle="Ganancia y margen por producto/rubro"
            icon={Target}
            description="Qué producto y qué línea dejan más ganancia (no solo cuál factura más): unidades, costo, margen y participación en la utilidad."
            href="/reportes/rentabilidad"
          />
        </li>
        <li>
          <ReportCard
            title="Ventas por vendedor"
            subtitle="Qué vende cada uno"
            icon={Users}
            description="Una tarjeta por vendedor con lo que más vende, cuánto factura y cuánta utilidad deja; y el detalle completo de cada uno, producto por producto, con Excel e imprimir."
            href="/reportes/vendedores"
          />
        </li>
        <li>
          <ReportCard
            title="Cobranzas"
            subtitle="Qué se cobró y con qué comprobante"
            icon={HandCoins}
            description="Cliente, factura cobrada, fecha, importe, medio de pago y comprobante, con filtros por cliente, fecha y medio. Los anulados se muestran y no suman."
            href="/reportes/cobranzas"
          />
        </li>
        <li>
          <ReportCard
            title="Flujo de caja"
            subtitle="Dinero cobrado y pagado"
            icon={Banknote}
            description="Saldo inicial + entradas efectivamente cobradas − salidas efectivamente pagadas = saldo final. Por día, semana, mes o rango."
            href="/reportes/flujo-caja"
          />
        </li>
        <li>
          <ReportCard
            title="Estado de cuenta"
            subtitle="Saldos, movimientos y situación financiera"
            icon={Wallet}
            description="Resumen de ventas, compras, gastos y resultado del período, con sus movimientos."
            href="/reportes/estado-cuenta"
          />
        </li>
        <li>
          <ReportCard
            title="Ventas"
            subtitle="Facturación y operaciones"
            icon={ShoppingCart}
            description="Ventas del mes, desglose por tipo de precio (minorista/mayorista/al costo) y por producto."
            href="/reportes/ventas"
          />
        </li>
        <li>
          <ReportCard
            title="Compras"
            subtitle="Adquisiciones y costos"
            icon={Package}
            description="Compras del mes (agrupadas por N° de control), por proveedor y por producto."
            href="/reportes/compras"
          />
        </li>
        <li>
          <ReportCard
            title="Proveedores"
            subtitle="Abastecimiento y relación comercial"
            icon={Truck}
            description="Resumen de proveedores, compras por proveedor y actividad del mes."
            href="/reportes/proveedores"
          />
        </li>
        <li>
          <ReportCard
            title="Tesorería por cuenta"
            subtitle="Movimiento por banco / cuenta / POS"
            icon={Landmark}
            description="Cuánto entró por cada banco, cuenta, POS y efectivo, con lo pendiente de conciliar por cuenta."
            href="/reportes/tesoreria"
          />
        </li>
        <li>
          <ReportCard
            title="Conciliación bancaria"
            subtitle="Cobros por método y entidad"
            icon={ArrowLeftRight}
            description="Detalle de cobro por venta (efectivo/transferencia/tarjeta), por método y por entidad."
            href="/reportes/conciliacion"
          />
        </li>
        <li>
          <ReportCard
            title="Ingresos y egresos"
            subtitle="Movimientos de caja y gastos"
            icon={ArrowLeftRight}
            description="Toda la plata que entró y salió sin ser una venta, con rango de fechas y filtros. Desde acá también se cargan."
            href="/reportes/ingresos-egresos"
          />
        </li>
        <li>
          <ReportCard
            title="Gastos sin factura"
            subtitle="Lo que no es deducible"
            icon={FileWarning}
            description="Los gastos que no se pueden usar en la declaración, separando los que no tienen factura de los que la tienen incompleta y todavía se pueden reclamar al proveedor."
            href="/reportes/gastos-no-deducibles"
          />
        </li>
        <li>
          <ReportCard
            title="Cierres de caja"
            subtitle="Turno por turno"
            icon={Wallet}
            description="Qué se vendió en cada turno, cuánto se contó al cerrar y si hubo faltante o sobrante."
            href="/reportes/cajas"
          />
        </li>
      </ul>
    </div>
  );
}
