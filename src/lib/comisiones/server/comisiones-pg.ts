import { andSucursal } from "@/lib/sucursales/sql";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  comisionDeLinea,
  type BaseCalculo,
  type ReglaComision,
} from "@/lib/comisiones/calculo";

/**
 * Informe de comisiones (punto 4.6) — acceso a datos.
 *
 * La cuenta vive en `calculo.ts`, sin base de datos, para poder probarla con
 * casos armados a mano. Acá se traen las líneas y se arma el informe.
 *
 * ── DE DÓNDE SALE EL COSTO ─────────────────────────────────────────────────
 *   Del movimiento de inventario que generó la venta, no del costo de hoy. El
 *   costo promedio del producto cambia con cada compra: usar el actual para
 *   liquidar comisiones de hace dos meses daría un número distinto cada vez
 *   que se abre el informe, y nadie podría cerrar una liquidación.
 *
 *   Si la venta no dejó movimiento (producto que no controla stock), se cae al
 *   costo promedio actual, que es lo único que hay.
 */

export interface FiltroComisiones {
  desde: string | null;
  hasta: string | null;
  vendedorId?: string | null;
  categoriaId?: string | null;
}

export interface VentaComisionada {
  venta_id: string;
  numero_control: string;
  fecha: string;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_nombre: string;
  facturado: number;
  descuento: number;
  costo: number;
  ganancia: number;
  comision: number;
}

export interface VendedorComisionado {
  vendedor_id: string | null;
  vendedor_nombre: string;
  tipo_vendedor: string | null;
  operaciones: number;
  facturado: number;
  descuento: number;
  costo: number;
  ganancia: number;
  comision: number;
  margen_pct: number;
}

export interface InformeComisiones {
  ventas: VentaComisionada[];
  vendedores: VendedorComisionado[];
  totales: {
    operaciones: number;
    facturado: number;
    descuento: number;
    costo: number;
    ganancia: number;
    comision: number;
  };
  base_calculo: BaseCalculo;
  /** Si el descuento recortó comisiones en este período. */
  penaliza_descuento?: boolean;
  penalizacion_maxima_pct?: number | null;
}

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const OFFSET_PY = "-03:00";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

interface FilaCruda {
  venta_id: string;
  numero_control: string;
  fecha: string;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_nombre: string | null;
  tipo_vendedor_id: string | null;
  tipo_vendedor_nombre: string | null;
  porcentaje_base: string | null;
  porcentaje_propio: string | null;
  categoria_id: string | null;
  cantidad: string;
  precio_venta: string;
  precio_venta_original: string | null;
  tipo_iva: string | null;
  costo_unitario: string | null;
}

export async function informeComisiones(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  filtro: FiltroComisiones
): Promise<InformeComisiones> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tCli = quoteSchemaTable(schema, "clientes");
  const tU = quoteSchemaTable(schema, "usuarios");
  const tTV = quoteSchemaTable(schema, "tipos_vendedor");
  const tR = quoteSchemaTable(schema, "comisiones_reglas");
  const tC = quoteSchemaTable(schema, "comisiones_config");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const SUC_V = andSucursal(sucursalId, "v.");
  const p = pool();

  // ── Configuración ──────────────────────────────────────────────────────
  // Las columnas del script 43 pueden no estar: se pide aparte y si falla se
  // sigue con el comportamiento anterior, que es no recortar nada.
  const cfgQ = await p.query<{ base_calculo: string }>(
    `SELECT base_calculo FROM ${tC} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const base: BaseCalculo = cfgQ.rows[0]?.base_calculo === "facturacion" ? "facturacion" : "margen";

  let penalizaDescuento = false;
  let penalizacionMaximaPct: number | null = null;
  try {
    const penQ = await p.query<{ penaliza_descuento: boolean; penalizacion_maxima_pct: string | null }>(
      `SELECT penaliza_descuento, penalizacion_maxima_pct FROM ${tC} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    const row = penQ.rows[0];
    if (row) {
      penalizaDescuento = row.penaliza_descuento === true;
      penalizacionMaximaPct =
        row.penalizacion_maxima_pct == null ? null : Number(row.penalizacion_maxima_pct);
    }
  } catch {
    // Script 43 sin correr: el descuento no recorta comisión, como antes.
  }
  const opcionesComision = { penalizaDescuento, penalizacionMaximaPct };

  // ── Reglas ─────────────────────────────────────────────────────────────
  const rQ = await p.query<{
    tipo_vendedor_id: string | null; categoria_id: string | null;
    porcentaje: string; activo: boolean;
  }>(
    `SELECT tipo_vendedor_id::text, categoria_id::text, porcentaje, activo
       FROM ${tR} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const reglas: ReglaComision[] = rQ.rows.map((r) => ({
    tipo_vendedor_id: r.tipo_vendedor_id,
    categoria_id: r.categoria_id,
    porcentaje: Number(r.porcentaje) || 0,
    activo: r.activo,
  }));

  // ── Líneas del período ─────────────────────────────────────────────────
  const args: unknown[] = [empresaId];
  const cond: string[] = [`v.empresa_id = $1::uuid${SUC_V}`,
    `COALESCE(v.estado, 'completada') <> 'anulada'`];

  if (filtro.desde) { args.push(`${filtro.desde}T00:00:00${OFFSET_PY}`); cond.push(`v.fecha >= $${args.length}::timestamptz`); }
  if (filtro.hasta) { args.push(`${filtro.hasta}T23:59:59.999${OFFSET_PY}`); cond.push(`v.fecha <= $${args.length}::timestamptz`); }
  if (filtro.vendedorId) { args.push(filtro.vendedorId); cond.push(`v.vendedor_usuario_id = $${args.length}::uuid`); }
  if (filtro.categoriaId) { args.push(filtro.categoriaId); cond.push(`pr.categoria_principal_id = $${args.length}::uuid`); }

  const q = await p.query<FilaCruda>(
    `SELECT v.id::text            AS venta_id,
            v.numero_control,
            v.fecha,
            COALESCE(cl.nombre_facturacion, cl.empresa, cl.nombre_contacto, cl.nombre) AS cliente_nombre,
            v.vendedor_usuario_id::text AS vendedor_id,
            COALESCE(u.nombre, v.vendedor_nombre, v.usuario_nombre) AS vendedor_nombre,
            u.tipo_vendedor_id::text    AS tipo_vendedor_id,
            tv.nombre                   AS tipo_vendedor_nombre,
            tv.porcentaje_base,
            u.porcentaje_comision AS porcentaje_propio,
            pr.categoria_principal_id::text AS categoria_id,
            vi.cantidad,
            vi.precio_venta,
            vi.precio_venta_original,
            vi.tipo_iva,
            -- El costo del momento de la venta; si no hay movimiento, el actual.
            COALESCE(m.costo_unitario, pr.costo_promedio) AS costo_unitario
       FROM ${tVI} vi
       JOIN ${tV}  v  ON v.id = vi.venta_id AND v.empresa_id = $1::uuid
       LEFT JOIN ${tP}   pr ON pr.id = vi.producto_id AND pr.empresa_id = $1::uuid
       LEFT JOIN ${tCli} cl ON cl.id = v.cliente_id  AND cl.empresa_id = $1::uuid
       LEFT JOIN ${tU}   u  ON u.id = v.vendedor_usuario_id AND u.empresa_id = $1::uuid
       LEFT JOIN ${tTV}  tv ON tv.id = u.tipo_vendedor_id
       LEFT JOIN LATERAL (
         SELECT mm.costo_unitario
           FROM ${tM} mm
          WHERE mm.venta_id = v.id
            AND mm.producto_id = vi.producto_id
            AND mm.tipo = 'SALIDA'
          ORDER BY mm.fecha
          LIMIT 1
       ) m ON true
      WHERE ${cond.join(" AND ")}
      ORDER BY v.fecha DESC, v.numero_control`,
    args
  );

  // ── Cuenta ─────────────────────────────────────────────────────────────
  const porVenta = new Map<string, VentaComisionada>();
  const porVendedor = new Map<string, VendedorComisionado>();

  for (const f of q.rows) {
    const r = comisionDeLinea(
      {
        categoria_id: f.categoria_id,
        cantidad: Number(f.cantidad) || 0,
        precio_venta: Number(f.precio_venta) || 0,
        precio_venta_original: Number(f.precio_venta_original ?? f.precio_venta) || 0,
        costo_unitario: Number(f.costo_unitario) || 0,
        tipo_iva: f.tipo_iva ?? "10%",
      },
      reglas,
      f.tipo_vendedor_id,
      Number(f.porcentaje_base) || 0,
      base,
      f.porcentaje_propio == null ? null : Number(f.porcentaje_propio),
      opcionesComision
    );

    const vendedorNombre = f.vendedor_nombre || "Sin vendedor";

    const v = porVenta.get(f.venta_id) ?? {
      venta_id: f.venta_id,
      numero_control: f.numero_control,
      fecha: String(f.fecha),
      cliente_nombre: f.cliente_nombre,
      vendedor_id: f.vendedor_id,
      vendedor_nombre: vendedorNombre,
      facturado: 0, descuento: 0, costo: 0, ganancia: 0, comision: 0,
    };
    v.facturado += r.facturado; v.descuento += r.descuento;
    v.costo += r.costo; v.ganancia += r.ganancia; v.comision += r.comision;
    porVenta.set(f.venta_id, v);

    // Las ventas sin vendedor se agrupan juntas en vez de descartarse: que no
    // tengan a quién comisionar no las hace desaparecer de la facturación.
    const clave = f.vendedor_id ?? "__sin__";
    const vd = porVendedor.get(clave) ?? {
      vendedor_id: f.vendedor_id,
      vendedor_nombre: vendedorNombre,
      tipo_vendedor: f.tipo_vendedor_nombre,
      operaciones: 0, facturado: 0, descuento: 0, costo: 0,
      ganancia: 0, comision: 0, margen_pct: 0,
    };
    vd.facturado += r.facturado; vd.descuento += r.descuento;
    vd.costo += r.costo; vd.ganancia += r.ganancia; vd.comision += r.comision;
    porVendedor.set(clave, vd);
  }

  // Las operaciones se cuentan por venta, no por línea.
  for (const v of porVenta.values()) {
    const clave = v.vendedor_id ?? "__sin__";
    const vd = porVendedor.get(clave);
    if (vd) vd.operaciones += 1;
  }
  for (const vd of porVendedor.values()) {
    vd.margen_pct = vd.facturado > 0 ? (vd.ganancia / vd.facturado) * 100 : 0;
  }

  const ventas = [...porVenta.values()];
  const vendedores = [...porVendedor.values()].sort((a, b) => b.comision - a.comision);

  return {
    ventas,
    vendedores,
    totales: {
      operaciones: ventas.length,
      facturado: ventas.reduce((s, v) => s + v.facturado, 0),
      descuento: ventas.reduce((s, v) => s + v.descuento, 0),
      costo: ventas.reduce((s, v) => s + v.costo, 0),
      ganancia: ventas.reduce((s, v) => s + v.ganancia, 0),
      comision: ventas.reduce((s, v) => s + v.comision, 0),
    },
    base_calculo: base,
    penaliza_descuento: penalizaDescuento,
    penalizacion_maxima_pct: penalizacionMaximaPct,
  };
}
