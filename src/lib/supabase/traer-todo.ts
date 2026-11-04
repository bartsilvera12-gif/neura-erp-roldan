/**
 * Traer TODAS las filas de una consulta, no las primeras mil.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 * PostgREST corta toda respuesta en 1000 filas y NO avisa: devuelve `data` con
 * mil elementos y `error` en null, igual que si eso fuera todo. Una consulta
 * sin `limit` parece traer la tabla entera y trae mil filas.
 *
 * Esto ya nos mordió tres veces con datos reales:
 *   · Depósitos listaba 1000 de 1002 productos.
 *   · Cartera listaba 1000 de los clientes.
 *   · Flujo de caja armaba la grilla con 1000 de 16.373 compras.
 *
 * Los tres se veían perfectos en la pantalla: mil filas son muchas, nadie las
 * cuenta. Por eso el paginado va en un solo lugar y no copiado en cada ruta.
 *
 * ── CÓMO SE USA ────────────────────────────────────────────────────────────
 *   const compras = await traerTodas<Fila>((desde, hasta) =>
 *     supabase.from("compras").select(COLS).eq("empresa_id", id)
 *       .order("id").range(desde, hasta)
 *   );
 *
 * El `order` NO es decorativo: sin un orden estable, dos páginas consecutivas
 * pueden repetir y saltear filas. Poné siempre uno, aunque no te importe cuál.
 */

/** Lo que devuelve una consulta de supabase-js, reducido a lo que se usa acá. */
type Pagina<T> = { data: T[] | null; error: { message: string } | null };

export interface OpcionesTraerTodas {
  /**
   * Filas por pedido. 1000 es el máximo que PostgREST devuelve: pedir más no
   * trae más, solo hace creer que la última página estaba completa.
   */
  tam?: number;
  /**
   * Freno de mano. Si la consulta devuelve más que esto, se corta y se avisa
   * por `onTope` en vez de seguir pidiendo páginas para siempre.
   */
  tope?: number;
  /** Se llama si se alcanzó el tope, con cuántas filas se alcanzó. */
  onTope?: (filas: number) => void;
}

export async function traerTodas<T>(
  pedirPagina: (desde: number, hasta: number) => PromiseLike<Pagina<T>>,
  opts: OpcionesTraerTodas = {}
): Promise<T[]> {
  const tam = Math.min(1000, Math.max(1, opts.tam ?? 1000));
  const tope = opts.tope ?? 200_000;
  const filas: T[] = [];

  for (let desde = 0; ; desde += tam) {
    const { data, error } = await pedirPagina(desde, desde + tam - 1);
    if (error) throw new Error(error.message);
    const tanda = data ?? [];
    filas.push(...tanda);
    // Página incompleta = era la última. Es la única señal que da PostgREST.
    if (tanda.length < tam) break;
    if (filas.length >= tope) {
      opts.onTope?.(filas.length);
      break;
    }
  }

  return filas;
}
