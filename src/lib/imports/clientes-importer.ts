/**
 * Importador masivo de clientes desde Excel.
 *
 * Match: por RUC (case-insensitive) si viene, si no por NOMBRE_CONTACTO
 * (case-insensitive). Match → UPDATE; sin match → INSERT.
 * Categorías (CATEGORIA_CLIENTE) se resuelven contra `categorias_cliente`;
 * si `crear_faltantes=1` las crea sobre la marcha.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";
import type { PreviewRow, PreviewResponse } from "@/lib/excel/import-types";
import { pick, pickBool, chunked } from "./import-helpers";

export interface ClienteParsed {
  row_number: number;
  tipo_cliente: "empresa" | "persona";
  /** Persona de contacto (empresa) o Nombre completo (persona). Va al col DB `nombre_contacto`. */
  nombre_contacto: string;
  /** Razón social. Solo aplica a empresas. Va al col DB `empresa`. */
  razon_social: string | null;
  nombre_facturacion: string | null;
  nivel_precio: "minorista" | "mayorista" | "distribuidor";
  categoria_cliente_nombre: string | null;
  ruc: string | null;
  documento: string | null;
  es_contribuyente: boolean;
  telefono: string | null;
  telefono_secundario: string | null;
  email: string | null;
  email_secundario: string | null;
  direccion: string | null;
  usa_nota_remision: boolean;
  ciudad: string | null;
  pais: string | null;
  condicion_pago: string | null;
  moneda_preferida: "GS" | "USD";
  estado: "activo" | "inactivo";
  errors: string[];
  warnings: string[];
  match_id?: string | null;
}

const NIVELES_PRECIO = new Set(["minorista", "mayorista", "distribuidor"]);

export function parseClientesRows(rows: Record<string, string>[]): ClienteParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const tipoRaw = pick(r, "TIPO_CLIENTE").toLowerCase();
    const tipoNorm: "empresa" | "persona" = tipoRaw === "persona" ? "persona" : "empresa";

    // Persona de contacto (empresa) o Nombre completo (persona). El form los
    // llama distinto en pantalla pero ambos van a la misma columna DB.
    const nombreContacto = pick(r, "PERSONA_CONTACTO", "NOMBRE_COMPLETO", "NOMBRE_CONTACTO", "NOMBRE").trim();
    // Razón social — solo aplica a empresas. Si viene y el tipo es persona, se ignora.
    const razonSocial = normalizeUpperNullable(pick(r, "RAZON_SOCIAL", "EMPRESA"));

    if (tipoNorm === "empresa") {
      if (!razonSocial) errors.push("RAZON_SOCIAL obligatoria para empresas.");
      if (!nombreContacto) errors.push("PERSONA_CONTACTO obligatoria para empresas.");
    } else {
      if (!nombreContacto) errors.push("NOMBRE_COMPLETO obligatorio para personas.");
    }

    const nivelRaw = pick(r, "NIVEL_PRECIO").toLowerCase();
    const nivelPrecio: "minorista" | "mayorista" | "distribuidor" =
      NIVELES_PRECIO.has(nivelRaw) ? (nivelRaw as "minorista" | "mayorista" | "distribuidor") : "minorista";

    const emailRaw = pick(r, "EMAIL").trim();
    const email2Raw = pick(r, "EMAIL_SECUNDARIO").trim();
    const moneda = pick(r, "MONEDA_PREFERIDA").toUpperCase();
    const estadoRaw = pick(r, "ESTADO").toLowerCase();

    return {
      row_number: idx + 2,
      tipo_cliente: tipoNorm,
      nombre_contacto: nombreContacto,
      razon_social: razonSocial,
      nombre_facturacion: normalizeUpperNullable(pick(r, "NOMBRE_FACTURACION")),
      nivel_precio: nivelPrecio,
      categoria_cliente_nombre: normalizeUpperNullable(pick(r, "CATEGORIA_CLIENTE", "CATEGORIA")),
      ruc: (() => {
        const raw = normalizeUpperNullable(pick(r, "RUC"));
        if (raw && !/^\d{1,10}-\d$/.test(raw)) {
          errors.push(`RUC "${raw}" no cumple el formato NÚMERO-DÍGITO_VERIFICADOR (ej: 12345678-9).`);
        }
        return raw;
      })(),
      documento: pick(r, "DOCUMENTO", "CI").trim() || null,
      es_contribuyente: pickBool(r, "ES_CONTRIBUYENTE") || !!pick(r, "RUC").trim(),
      telefono: pick(r, "TELEFONO").trim() || null,
      telefono_secundario: pick(r, "TELEFONO_SECUNDARIO").trim() || null,
      email: emailRaw ? emailRaw.toLowerCase() : null,
      email_secundario: email2Raw ? email2Raw.toLowerCase() : null,
      direccion: normalizeUpperNullable(pick(r, "DIRECCION")),
      usa_nota_remision: pickBool(r, "USA_NOTA_REMISION"),
      ciudad: normalizeUpperNullable(pick(r, "CIUDAD")),
      pais: normalizeUpperNullable(pick(r, "PAIS")) || "PARAGUAY",
      condicion_pago: normalizeUpperNullable(pick(r, "CONDICION_PAGO")),
      moneda_preferida: moneda === "USD" ? "USD" : "GS",
      estado: estadoRaw === "inactivo" ? "inactivo" : "activo",
      errors,
      warnings: [],
    };
  });
}

interface ClienteEx { id: string; nombre: string; ruc: string | null }

export interface ClienteResolverMaps {
  byRuc: Map<string, ClienteEx>;
  byNombre: Map<string, ClienteEx>;
  categoriasByName: Map<string, string>;
}

export async function buildClientesResolverMaps(schemaRaw: string, empresaId: string): Promise<ClienteResolverMaps> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tC = quoteSchemaTable(schema, "clientes");
  const tK = quoteSchemaTable(schema, "categorias_cliente");
  const [cli, cats] = await Promise.all([
    pool.query<ClienteEx>(`SELECT id, nombre, ruc FROM ${tC} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tK} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
  ]);
  const byRuc = new Map<string, ClienteEx>();
  const byNombre = new Map<string, ClienteEx>();
  for (const c of cli.rows) {
    if (c.ruc) byRuc.set(c.ruc.toUpperCase().trim(), c);
    byNombre.set(c.nombre.trim().toUpperCase(), c);
  }
  const categoriasByName = new Map<string, string>();
  for (const k of cats.rows) categoriasByName.set(k.nombre.trim().toUpperCase(), k.id);
  return { byRuc, byNombre, categoriasByName };
}

export function buildClientesPreview(parsed: ClienteParsed[], maps: ClienteResolverMaps): PreviewResponse {
  const catsFaltantes = new Set<string>();
  let insertar = 0, actualizar = 0, errores = 0, warnings = 0;
  const rucsVistos = new Set<string>();
  const nombresVistos = new Set<string>();

  const rows: PreviewRow[] = parsed.map((p) => {
    if (p.ruc && rucsVistos.has(p.ruc)) p.errors.push(`RUC duplicado en el archivo: ${p.ruc}`);
    if (p.ruc) rucsVistos.add(p.ruc);
    else {
      const nk = p.nombre_contacto.toUpperCase();
      if (nombresVistos.has(nk)) p.errors.push(`Nombre duplicado en el archivo: ${p.nombre_contacto}`);
      nombresVistos.add(nk);
    }

    let matchId: string | null = null;
    if (p.ruc && maps.byRuc.has(p.ruc)) matchId = maps.byRuc.get(p.ruc)!.id;
    else if (!p.ruc && maps.byNombre.has(p.nombre_contacto.toUpperCase())) {
      matchId = maps.byNombre.get(p.nombre_contacto.toUpperCase())!.id;
    }
    p.match_id = matchId;

    if (p.categoria_cliente_nombre && !maps.categoriasByName.has(p.categoria_cliente_nombre)) {
      p.warnings.push(`Categoría "${p.categoria_cliente_nombre}" no existe. Se creará si tildaste "Crear faltantes", si no se ignora.`);
      catsFaltantes.add(p.categoria_cliente_nombre);
    }

    const hasErr = p.errors.length > 0;
    const action = hasErr ? "ERROR" : matchId ? "UPDATE" : "INSERT";
    if (action === "INSERT") insertar++;
    else if (action === "UPDATE") actualizar++;
    else errores++;
    if (p.warnings.length > 0) warnings++;

    return {
      row_number: p.row_number,
      action,
      errors: p.errors,
      warnings: p.warnings,
      data: {
        TIPO_CLIENTE: p.tipo_cliente,
        RAZON_SOCIAL: p.razon_social ?? "",
        NOMBRE_CONTACTO: p.nombre_contacto,
        RUC: p.ruc ?? "",
        EMAIL: p.email ?? "",
        CIUDAD: p.ciudad ?? "",
        CATEGORIA_CLIENTE: p.categoria_cliente_nombre ?? "",
      },
    };
  });

  return {
    summary: {
      total: parsed.length, insertar, actualizar, omitir: 0, errores, warnings,
      faltantes: { categorias: [...catsFaltantes], proveedores: [], ubicaciones: [] },
    },
    rows,
    headers: [
      "TIPO_CLIENTE", "RAZON_SOCIAL", "PERSONA_CONTACTO", "NOMBRE_COMPLETO",
      "NOMBRE_FACTURACION", "NIVEL_PRECIO", "CATEGORIA_CLIENTE",
      "RUC", "DOCUMENTO", "ES_CONTRIBUYENTE",
      "TELEFONO", "TELEFONO_SECUNDARIO", "EMAIL", "EMAIL_SECUNDARIO",
      "DIRECCION", "USA_NOTA_REMISION", "CIUDAD", "PAIS",
      "CONDICION_PAGO", "MONEDA_PREFERIDA", "ESTADO",
    ],
  };
}

export interface ClientesCommit {
  inserted: number; updated: number; skipped: number; errors: number; warnings: number;
  errorMessages: string[]; warningMessages: string[];
}

export async function commitClientes(
  schemaRaw: string, empresaId: string, parsed: ClienteParsed[], maps: ClienteResolverMaps, crearFaltantes: boolean,
  usuarioIdCatalog: string | null, usuarioNombre: string | null,
): Promise<ClientesCommit> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tC = quoteSchemaTable(schema, "clientes");
  const tK = quoteSchemaTable(schema, "categorias_cliente");
  const out: ClientesCommit = { inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0, errorMessages: [], warningMessages: [] };

  if (crearFaltantes) {
    const faltantes = new Set<string>();
    for (const p of parsed) {
      if (p.categoria_cliente_nombre && !maps.categoriasByName.has(p.categoria_cliente_nombre)) {
        faltantes.add(p.categoria_cliente_nombre);
      }
    }
    for (const nombre of faltantes) {
      try {
        const r = await pool.query<{ id: string }>(
          `INSERT INTO ${tK} (empresa_id, nombre, activo) VALUES ($1::uuid, $2, true) RETURNING id`,
          [empresaId, nombre]
        );
        maps.categoriasByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Categoría creada: ${nombre}`);
      } catch (e) {
        out.errorMessages.push(`No se pudo crear categoría ${nombre}: ${(e as Error).message}`);
      }
    }
  }

  for (const chunk of chunked(parsed, 200)) {
    for (const p of chunk) {
      if (p.errors.length > 0) {
        out.errors++;
        out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join("; ")}`);
        continue;
      }
      const categoriaId = p.categoria_cliente_nombre ? (maps.categoriasByName.get(p.categoria_cliente_nombre) ?? null) : null;
      // Regla defensa en profundidad: personas sin es_contribuyente no guardan RUC.
      const rucFinal = p.tipo_cliente === "persona" && !p.es_contribuyente ? null : p.ruc;
      // Razón social solo aplica a empresas.
      const empresaFinal = p.tipo_cliente === "empresa" ? p.razon_social : null;

      try {
        if (p.match_id) {
          await pool.query(
            `UPDATE ${tC} SET
               nombre=$1, nombre_contacto=$1,
               empresa=$2, tipo_cliente=$3,
               nombre_facturacion=$4, nivel_precio=$5,
               categoria_cliente_id=$6::uuid,
               ruc=$7, documento=$8, es_contribuyente=$9,
               telefono=$10, telefono_secundario=$11,
               email=$12, email_secundario=$13,
               direccion=$14, ciudad=$15, pais=$16,
               condicion_pago=$17, moneda_preferida=$18,
               estado=$19, usa_nota_remision=$20,
               updated_at=now()
             WHERE id=$21::uuid AND empresa_id=$22::uuid`,
            [
              p.nombre_contacto, empresaFinal, p.tipo_cliente,
              p.nombre_facturacion, p.nivel_precio, categoriaId,
              rucFinal, p.documento, p.es_contribuyente,
              p.telefono, p.telefono_secundario,
              p.email, p.email_secundario,
              p.direccion, p.ciudad, p.pais,
              p.condicion_pago, p.moneda_preferida,
              p.estado, p.usa_nota_remision,
              p.match_id, empresaId,
            ]
          );
          out.updated++;
        } else {
          await pool.query(
            `INSERT INTO ${tC} (
               empresa_id, created_by_user_id, created_by_nombre,
               tipo_cliente, empresa, nombre, nombre_contacto,
               nombre_facturacion, nivel_precio,
               categoria_cliente_id, ruc, documento, es_contribuyente,
               telefono, telefono_secundario, email, email_secundario,
               direccion, ciudad, pais,
               condicion_pago, moneda_preferida, estado, usa_nota_remision
             ) VALUES (
               $1::uuid, $2, $3,
               $4, $5, $6, $6,
               $7, $8,
               $9::uuid, $10, $11, $12,
               $13, $14, $15, $16,
               $17, $18, $19,
               $20, $21, $22, $23
             )`,
            [
              empresaId, usuarioIdCatalog, usuarioNombre,
              p.tipo_cliente, empresaFinal, p.nombre_contacto,
              p.nombre_facturacion, p.nivel_precio,
              categoriaId, rucFinal, p.documento, p.es_contribuyente,
              p.telefono, p.telefono_secundario, p.email, p.email_secundario,
              p.direccion, p.ciudad, p.pais,
              p.condicion_pago, p.moneda_preferida, p.estado, p.usa_nota_remision,
            ]
          );
          out.inserted++;
        }
        if (p.warnings.length > 0) out.warnings++;
      } catch (e) {
        out.errors++;
        out.errorMessages.push(`Fila ${p.row_number}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  return out;
}

export const CLIENTES_TEMPLATE_ROW = {
  TIPO_CLIENTE: "empresa",
  RAZON_SOCIAL: "BIGGIE SAECA",
  PERSONA_CONTACTO: "BIGGIE - SUCURSAL CENTRO",
  NOMBRE_COMPLETO: "",
  NOMBRE_FACTURACION: "",
  NIVEL_PRECIO: "minorista",
  CATEGORIA_CLIENTE: "MAYORISTA CENTRO",
  RUC: "80006886-8",
  DOCUMENTO: "",
  ES_CONTRIBUYENTE: "SI",
  TELEFONO: "021-000000",
  TELEFONO_SECUNDARIO: "",
  EMAIL: "compras@biggie.com.py",
  EMAIL_SECUNDARIO: "",
  DIRECCION: "AV. MARISCAL LÓPEZ 1234",
  USA_NOTA_REMISION: "NO",
  CIUDAD: "ASUNCIÓN",
  PAIS: "PARAGUAY",
  CONDICION_PAGO: "Contado",
  MONEDA_PREFERIDA: "GS",
  ESTADO: "activo",
};
