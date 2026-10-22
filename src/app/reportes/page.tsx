"use client";

import PageHeader from "@/components/ui/PageHeader";
import { ReportCard } from "@/components/reportes/ReportCard";
import { Wallet, Truck, Package, ShoppingCart, ArrowLeftRight, TrendingUp, Target, Banknote, Landmark } from "lucide-react";

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
            subtitle="Ganancia y margen por producto/categoría"
            icon={Target}
            description="Qué producto y qué línea dejan más ganancia (no solo cuál factura más): unidades, costo, margen y participación en la utilidad."
            href="/reportes/rentabilidad"
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
