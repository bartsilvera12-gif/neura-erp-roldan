import { andSucursal } from "@/lib/sucursales/sql";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  categoriaDeCliente,
  rangoDePeriodo,
  type CategoriaConMinimo,
} from "@/lib/clientes/categoria-automatica";

/**
 * Categorías de cliente automáticas — acceso a datos.
 *
 * La decisión vive en `categoria-automatica.ts`, sin base de datos, para poder
 * probarla con casos armados a mano. Acá se traen los montos del mes y se
 * escribe el cambio con su renglón de historial.
 *
 * ── POR QUÉ POR SQL Y NO POR POSTGREST ────────────────────────────────────
 * Son 21.344 clientes y 85.711 ventas. Sumar lo del mes cliente por cliente
 * contra PostgREST serían 21.344 consultas, y traerse todas las ventas para
 * sumarlas en memoria serían 86 páginas de 1.000 filas. Un GROUP BY lo hace la
 * base en una sola consulta, que es para lo que está.
 */

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const OFFSET_PY = "-03:00";

export interface MontoDelMes {
  cliente_id: string;
  monto: number;
  operaciones: number;
}

/**
 * Lo que compró cada cliente en el período, por venta y no por línea.
 *
 * ── QUÉ CUENTA COMO COMPRA ────────────────────────────────────────────────
 *   - Las ventas anuladas NO cuentan: esa plata no entró.
 *   - El total es el de la venta, con IVA, que es lo que el cliente pagó y con
 *     lo que va a comparar si le preguntan por qué cambió de categoría. Los
 *     montos mínimos se cargan pensando en la factura, no en el neto fiscal.
 *   - Las ventas sin cliente (consumidor final) no entran: no hay a quién
 *     categorizar.
 */
export async function montosPorCliente(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  desde: string,
  hasta: string
): Promise<Map<string, MontoDelMes>> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");

  const q = await p.query<{ cliente_id: string; monto: string; operaciones: string }>(
    `SELECT v.cliente_id::text AS cliente_id,
            COALESCE(SUM(v.total), 0) AS monto,
            COUNT(*)                  AS operaciones
       FROM ${tV} v
      WHERE v.empresa_id = $1::uuid${andSucursal(sucursalId, "v.")}
        AND COALESCE(v.estado, 'completada') <> 'anulada'
        AND v.cliente_id IS NOT NULL
        AND v.fecha >= $2::timestamptz
        AND v.fecha <= $3::timestamptz
      GROUP BY v.cliente_id`,
    [empresaId, `${desde}T00:00:00${OFFSET_PY}`, `${hasta}T23:59:59.999${OFFSET_PY}`]
  );

  const mapa = new Map<string, MontoDelMes>();
  for (const r of q.rows) {
    mapa.set(r.cliente_id, {
      cliente_id: r.cliente_id,
      monto: Number(r.monto) || 0,
      operaciones: Number(r.operaciones) || 0,
    });
  }
  return mapa;
}

export interface CambioCategoria {
  cliente_id: string;
  cliente_nombre: string;
  categoria_anterior_id: string | null;
  categoria_anterior_nombre: string | null;
  categoria_nueva_id: string;
  categoria_nueva_nombre: string;
  monto_periodo: number;
  motivo: string;
}

export interface ResultadoRecalculo {
  periodo: string;
  desde: string;
  hasta: string;
  clientes_evaluados: number;
  cambios: CambioCategoria[];
  /** Si no hay montos mínimos cargados no se evalúa nada. */
  sin_escalera: boolean;
}

/**
 * Recalcula la categoría de todos los clientes para un período, y escribe los
 * cambios.
 *
 * ── SE EVALÚAN TODOS, NO SOLO LOS QUE COMPRARON ───────────────────────────
 * El que no compró tiene monto 0, y eso tiene que poder hacerlo BAJAR. Si solo
 * se miraran los que compraron, un cliente que dejó de comprar se quedaría
 * cobrando precio de mayorista para siempre.
 *
 * ── QUÉ PASA SI SE CORRE DOS VECES ────────────────────────────────────────
 * Nada: el índice único del script 55 deja un solo renglón automático por
 * cliente y período, y los clientes que ya están en la categoría que les toca
 * no generan cambio. Correrlo de nuevo sobre un mes cerrado es inofensivo.
 *
 * `soloCliente` limita el recálculo a una persona: es lo que se usa después de
 * cada venta, para que el ascenso sea inmediato sin recorrer el padrón.
 */
export async function recalcularCategorias(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  periodo: string,
  opciones?: { soloCliente?: string; usuarioId?: string | null; usuarioNombre?: string | null }
): Promise<ResultadoRecalculo> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const rango = rangoDePeriodo(periodo);
  if (!rango) throw new Error(`Período inválido: ${periodo}. Se espera YYYY-MM.`);

  const tCli = quoteSchemaTable(schema, "clientes");
  const tCat = quoteSchemaTable(schema, "categorias_cliente");
  const tHist = quoteSchemaTable(schema, "clientes_categoria_historial");
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");

  // ── La escalera ─────────────────────────────────────────────────────────
  const catQ = await p.query<{
    id: string; nombre: string; monto_minimo_mensual: string | null; activa: boolean;
  }>(
    `SELECT id::text, nombre, monto_minimo_mensual, activa
       FROM ${tCat} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const categorias: CategoriaConMinimo[] = catQ.rows.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    monto_minimo_mensual:
      c.monto_minimo_mensual == null ? null : Number(c.monto_minimo_mensual),
    activa: c.activa,
  }));

  const hayEscalera = categorias.some((c) => c.activa !== false && c.monto_minimo_mensual != null);
  if (!hayEscalera) {
    return {
      periodo, desde: rango.desde, hasta: rango.hasta,
      clientes_evaluados: 0, cambios: [], sin_escalera: true,
    };
  }

  // ── Los clientes y lo que compraron ─────────────────────────────────────
  const montos = await montosPorCliente(schema, empresaId, sucursalId, rango.desde, rango.hasta);

  const args: unknown[] = [empresaId];
  let filtroCliente = "";
  if (opciones?.soloCliente) {
    args.push(opciones.soloCliente);
    filtroCliente = ` AND c.id = $${args.length}::uuid`;
  }
  const cliQ = await p.query<{ id: string; nombre: string; categoria_cliente_id: string | null }>(
    `SELECT c.id::text,
            COALESCE(c.nombre_facturacion, c.empresa, c.nombre_contacto, c.nombre, '') AS nombre,
            c.categoria_cliente_id::text
       FROM ${tCli} c
      WHERE c.empresa_id = $1::uuid
        AND c.deleted_at IS NULL${filtroCliente}`,
    args
  );

  const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
  const cambios: CambioCategoria[] = [];

  for (const cli of cliQ.rows) {
    const monto = montos.get(cli.id)?.monto ?? 0;
    const d = categoriaDeCliente(categorias, cli.categoria_cliente_id, monto);
    if (!d.cambia || !d.destino) continue;
    cambios.push({
      cliente_id: cli.id,
      cliente_nombre: cli.nombre,
      categoria_anterior_id: cli.categoria_cliente_id,
      categoria_anterior_nombre: cli.categoria_cliente_id
        ? nombreCat.get(cli.categoria_cliente_id) ?? null
        : null,
      categoria_nueva_id: d.destino.id,
      categoria_nueva_nombre: d.destino.nombre,
      monto_periodo: monto,
      motivo: d.motivo,
    });
  }

  // ── Escritura ───────────────────────────────────────────────────────────
  // Todo o nada: si se mueve la categoría de un cliente y falla el renglón del
  // historial, queda un cambio de precio que nadie puede explicar.
  if (cambios.length > 0) {
    const conn = await p.connect();
    try {
      await conn.query("BEGIN");
      for (const c of cambios) {
        await conn.query(
          `UPDATE ${tCli} SET categoria_cliente_id = $2::uuid, updated_at = now()
            WHERE empresa_id = $1::uuid AND id = $3::uuid`,
          [empresaId, c.categoria_nueva_id, c.cliente_id]
        );
        await conn.query(
          `INSERT INTO ${tHist}
             (empresa_id, cliente_id, categoria_anterior_id, categoria_anterior_nombre,
              categoria_nueva_id, categoria_nueva_nombre, periodo, monto_periodo,
              origen, motivo, usuario_id, usuario_nombre)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7, $8, 'automatico', $9, $10::uuid, $11)
           ON CONFLICT (empresa_id, cliente_id, periodo) WHERE origen = 'automatico'
           DO UPDATE SET categoria_anterior_id = EXCLUDED.categoria_anterior_id,
                         categoria_anterior_nombre = EXCLUDED.categoria_anterior_nombre,
                         categoria_nueva_id = EXCLUDED.categoria_nueva_id,
                         categoria_nueva_nombre = EXCLUDED.categoria_nueva_nombre,
                         monto_periodo = EXCLUDED.monto_periodo,
                         motivo = EXCLUDED.motivo,
                         created_at = now()`,
          [
            empresaId, c.cliente_id,
            c.categoria_anterior_id, c.categoria_anterior_nombre,
            c.categoria_nueva_id, c.categoria_nueva_nombre,
            periodo, Math.round(c.monto_periodo),
            c.motivo,
            opciones?.usuarioId ?? null, opciones?.usuarioNombre ?? null,
          ]
        );
      }
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  return {
    periodo, desde: rango.desde, hasta: rango.hasta,
    clientes_evaluados: cliQ.rows.length,
    cambios,
    sin_escalera: false,
  };
}

export interface FilaHistorial {
  id: string;
  fecha: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_ruc: string | null;
  categoria_anterior: string | null;
  categoria_nueva: string | null;
  periodo: string;
  monto_periodo: number;
  origen: string;
  motivo: string | null;
  usuario_nombre: string | null;
}

export interface FilaSinCompras {
  cliente_id: string;
  cliente_nombre: string;
  cliente_ruc: string | null;
  categoria: string | null;
  /** Última venta de este cliente, de cualquier fecha. null = nunca compró. */
  ultima_compra: string | null;
  dias_sin_comprar: number | null;
}

/** El historial de cambios, filtrado por fecha. */
export async function historialCategorias(
  schemaRaw: string,
  empresaId: string,
  desde: string,
  hasta: string,
  opciones?: { clienteId?: string | null; categoriaId?: string | null; limite?: number }
): Promise<FilaHistorial[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tHist = quoteSchemaTable(schema, "clientes_categoria_historial");
  const tCli = quoteSchemaTable(schema, "clientes");
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");

  const args: unknown[] = [
    empresaId,
    `${desde}T00:00:00${OFFSET_PY}`,
    `${hasta}T23:59:59.999${OFFSET_PY}`,
  ];
  const cond: string[] = [
    `h.empresa_id = $1::uuid`,
    `h.created_at >= $2::timestamptz`,
    `h.created_at <= $3::timestamptz`,
  ];
  if (opciones?.clienteId) {
    args.push(opciones.clienteId);
    cond.push(`h.cliente_id = $${args.length}::uuid`);
  }
  // Por categoría se filtra por la de DESTINO: la pregunta que se hace desde la
  // pantalla es "quién quedó en mayorista", no "quién venía de mayorista".
  if (opciones?.categoriaId) {
    args.push(opciones.categoriaId);
    cond.push(`h.categoria_nueva_id = $${args.length}::uuid`);
  }
  args.push(Math.min(Math.max(1, opciones?.limite ?? 500), 2000));

  const q = await p.query<Record<string, unknown>>(
    `SELECT h.id::text,
            h.created_at                AS fecha,
            h.cliente_id::text,
            COALESCE(c.nombre_facturacion, c.empresa, c.nombre_contacto, c.nombre, '') AS cliente_nombre,
            c.ruc                       AS cliente_ruc,
            h.categoria_anterior_nombre AS categoria_anterior,
            h.categoria_nueva_nombre    AS categoria_nueva,
            h.periodo,
            h.monto_periodo,
            h.origen,
            h.motivo,
            h.usuario_nombre
       FROM ${tHist} h
       LEFT JOIN ${tCli} c ON c.id = h.cliente_id AND c.empresa_id = $1::uuid
      WHERE ${cond.join(" AND ")}
      ORDER BY h.created_at DESC
      LIMIT $${args.length}`,
    args
  );

  return q.rows.map((r) => ({
    id: String(r.id),
    fecha: String(r.fecha),
    cliente_id: String(r.cliente_id),
    cliente_nombre: String(r.cliente_nombre ?? ""),
    cliente_ruc: r.cliente_ruc == null ? null : String(r.cliente_ruc),
    categoria_anterior: r.categoria_anterior == null ? null : String(r.categoria_anterior),
    categoria_nueva: r.categoria_nueva == null ? null : String(r.categoria_nueva),
    periodo: String(r.periodo ?? ""),
    monto_periodo: Number(r.monto_periodo) || 0,
    origen: String(r.origen ?? ""),
    motivo: r.motivo == null ? null : String(r.motivo),
    usuario_nombre: r.usuario_nombre == null ? null : String(r.usuario_nombre),
  }));
}

/**
 * Los clientes que NO compraron en el período.
 *
 * ── POR QUÉ ES UNA CONSULTA APARTE Y NO UN FILTRO DEL HISTORIAL ───────────
 * El que no compró normalmente no genera renglón de historial: si ya estaba en
 * la categoría más baja, no cambió nada y no hay nada que registrar. Buscarlo
 * en el historial no lo encontraría nunca. Son dos preguntas distintas y por
 * eso son dos consultas.
 *
 * Se incluye la última compra de cualquier fecha, porque "no compró en octubre"
 * y "no compra desde hace dos años" piden llamadas muy distintas.
 */
export async function clientesSinCompras(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  desde: string,
  hasta: string,
  opciones?: { categoriaId?: string | null; limite?: number }
): Promise<FilaSinCompras[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCli = quoteSchemaTable(schema, "clientes");
  const tCat = quoteSchemaTable(schema, "categorias_cliente");
  const tV = quoteSchemaTable(schema, "ventas");
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");

  const args: unknown[] = [
    empresaId,
    `${desde}T00:00:00${OFFSET_PY}`,
    `${hasta}T23:59:59.999${OFFSET_PY}`,
  ];
  let filtroCat = "";
  if (opciones?.categoriaId) {
    args.push(opciones.categoriaId);
    filtroCat = ` AND c.categoria_cliente_id = $${args.length}::uuid`;
  }
  args.push(Math.min(Math.max(1, opciones?.limite ?? 500), 2000));

  const q = await p.query<Record<string, unknown>>(
    `SELECT c.id::text AS cliente_id,
            COALESCE(c.nombre_facturacion, c.empresa, c.nombre_contacto, c.nombre, '') AS cliente_nombre,
            c.ruc AS cliente_ruc,
            cat.nombre AS categoria,
            u.ultima AS ultima_compra
       FROM ${tCli} c
       LEFT JOIN ${tCat} cat ON cat.id = c.categoria_cliente_id
       LEFT JOIN LATERAL (
         SELECT MAX(v.fecha) AS ultima
           FROM ${tV} v
          WHERE v.cliente_id = c.id
            AND v.empresa_id = $1::uuid${andSucursal(sucursalId, "v.")}
            AND COALESCE(v.estado, 'completada') <> 'anulada'
       ) u ON true
      WHERE c.empresa_id = $1::uuid
        AND c.deleted_at IS NULL${filtroCat}
        -- Sin ninguna venta viva dentro del período.
        AND NOT EXISTS (
          SELECT 1 FROM ${tV} v2
           WHERE v2.cliente_id = c.id
             AND v2.empresa_id = $1::uuid${andSucursal(sucursalId, "v2.")}
             AND COALESCE(v2.estado, 'completada') <> 'anulada'
             AND v2.fecha >= $2::timestamptz
             AND v2.fecha <= $3::timestamptz
        )
      -- Primero los que alguna vez compraron y dejaron de hacerlo: son los que
      -- hay que llamar. El que nunca compró va al final.
      ORDER BY u.ultima DESC NULLS LAST
      LIMIT $${args.length}`,
    args
  );

  const ahora = Date.now();
  return q.rows.map((r) => {
    const ultima = r.ultima_compra == null ? null : String(r.ultima_compra);
    const dias = ultima
      ? Math.max(0, Math.floor((ahora - new Date(ultima).getTime()) / 86_400_000))
      : null;
    return {
      cliente_id: String(r.cliente_id),
      cliente_nombre: String(r.cliente_nombre ?? ""),
      cliente_ruc: r.cliente_ruc == null ? null : String(r.cliente_ruc),
      categoria: r.categoria == null ? null : String(r.categoria),
      ultima_compra: ultima,
      dias_sin_comprar: dias,
    };
  });
}
