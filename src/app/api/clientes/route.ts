import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { emitEvent, EVENT_TYPES } from "@/lib/integrations/events";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getClientesSupabaseFromAuthWithRol } from "@/lib/clientes/clientes-service-client";
import { fetchPerfilTributarioActivosMap } from "@/lib/clientes/tributario-server";
import { ensureSemillasCatalogoTipos, tipoServicioSlugValido } from "@/lib/clientes/tipo-servicio-catalogo";

/** Une `plan_activo` (nombre) a cada fila de cliente según suscripción activa más reciente. */
function attachPlanesActivos(
  rows: Record<string, unknown>[],
  map: Map<string, string>
): void {
  for (const r of rows) {
    const id = typeof r.id === "string" ? r.id : null;
    if (!id) continue;
    const nombre = map.get(id);
    if (nombre) r.plan_activo = nombre;
  }
}

async function buildPlanActivoMap(
  supabase: AppSupabaseClient,
  empresaId: string,
  clienteIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (clienteIds.length === 0) return map;

  // Con el listado completo, `.in(...)` con miles de uuids pasa el largo de URL del gateway
  // (414/520): en ese caso se leen las suscripciones activas de la empresa por páginas.
  // El shim Postgres directo (schemas no expuestos) no tiene ese límite ni implementa .range().
  const wanted = new Set(clienteIds);
  const data: Record<string, unknown>[] = [];
  const base = () =>
    supabase
      .from("suscripciones")
      .select("cliente_id, planes(nombre)")
      .eq("empresa_id", empresaId)
      .eq("estado", "activa");
  const soportaRange = typeof (base() as { range?: unknown }).range === "function";
  if (!soportaRange || clienteIds.length <= 100) {
    const { data: rows, error } = await base()
      .in("cliente_id", clienteIds)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[api/clientes] buildPlanActivoMap:", error.message);
      return map;
    }
    data.push(...((rows ?? []) as Record<string, unknown>[]));
  } else {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: batch, error } = await base()
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("[api/clientes] buildPlanActivoMap:", error.message);
        return map;
      }
      data.push(...((batch ?? []) as Record<string, unknown>[]));
      if ((batch ?? []).length < PAGE) break;
    }
  }

  for (const row of data) {
    const cid = (row as { cliente_id: string }).cliente_id;
    if (!wanted.has(cid)) continue;
    if (!map.has(cid)) {
      const planes = (row as { planes: { nombre: string } | { nombre: string }[] | null }).planes;
      const plan = Array.isArray(planes) ? planes[0] : planes;
      const nombre = plan?.nombre?.trim();
      map.set(cid, nombre || "Suscripción");
    }
  }
  return map;
}

type VendedorUsuarioRow = {
  id: string;
  nombre: string | null;
  email: string | null;
};

function vendedorUsuarioIds(rows: Record<string, unknown>[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((r) => (typeof r.vendedor_usuario_id === "string" ? r.vendedor_usuario_id.trim() : ""))
        .filter(Boolean)
    )
  );
}

async function buildVendedoresResponsablesMap(
  empresaId: string,
  usuarioIds: string[]
): Promise<Map<string, { nombre: string | null; email: string | null }>> {
  const map = new Map<string, { nombre: string | null; email: string | null }>();
  if (usuarioIds.length === 0) return map;

  const catalog = createServiceRoleClient();
  const { data, error } = await catalog
    .from("usuarios")
    .select("id, nombre, email")
    .eq("empresa_id", empresaId)
    .in("id", usuarioIds);

  if (error) {
    console.error("[api/clientes] vendedores responsables:", error.message);
    return map;
  }

  for (const u of (data ?? []) as VendedorUsuarioRow[]) {
    map.set(u.id, { nombre: u.nombre, email: u.email });
  }
  return map;
}

function attachVendedoresResponsables(
  rows: Record<string, unknown>[],
  map: Map<string, { nombre: string | null; email: string | null }>
): void {
  for (const r of rows) {
    const uid = typeof r.vendedor_usuario_id === "string" ? r.vendedor_usuario_id.trim() : "";
    if (!uid) continue;
    const vendedor = map.get(uid);
    if (!vendedor) continue;
    r.vendedor_usuario_nombre = vendedor.nombre;
    r.vendedor_usuario_email = vendedor.email;
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const sp = request.nextUrl.searchParams;
    const incluirEliminados = sp.get("incluir_eliminados") === "1";
    const planActivo = sp.get("plan_activo") === "1";

    let q = supabase
      .from("clientes")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false });
    if (!incluirEliminados) {
      q = q.is("deleted_at", null);
    }

    const { data, error } = await q;

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    /** Los enriquecimientos secundarios NO deben derribar el listado: si una tabla auxiliar no
     *  está mapeada en el shim o un RPC dependiente falla en un tenant `erp_*`, el listado igual
     *  debe responder con los clientes. */
    if (planActivo && rows.length > 0) {
      const ids = rows.map((r) => r.id).filter((id): id is string => typeof id === "string");
      try {
        const planMap = await buildPlanActivoMap(supabase, auth.empresa_id, ids);
        attachPlanesActivos(rows, planMap);
      } catch (e) {
        console.error("[api/clientes] enrich plan activo:", e instanceof Error ? e.message : e);
      }
    }

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id).filter((id): id is string => typeof id === "string");
      try {
        const perfilMap = await fetchPerfilTributarioActivosMap(supabase, auth.empresa_id, ids);
        for (const r of rows) {
          const id = typeof r.id === "string" ? r.id : "";
          r.perfil_tributario_activo = id ? perfilMap.get(id) === true : false;
        }
      } catch (e) {
        console.error("[api/clientes] enrich perfil tributario:", e instanceof Error ? e.message : e);
        for (const r of rows) r.perfil_tributario_activo = false;
      }
    }

    if (rows.length > 0) {
      try {
        const vendedorIds = vendedorUsuarioIds(rows);
        const vendedoresMap = await buildVendedoresResponsablesMap(auth.empresa_id, vendedorIds);
        attachVendedoresResponsables(rows, vendedoresMap);
      } catch (e) {
        console.error("[api/clientes] enrich vendedores:", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json(successResponse(rows));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const body = await request.json();
    const {
      tipo_cliente,
      empresa,
      nombre_contacto,
      nombre_facturacion,
      nombre_comercial,
      nivel_precio,
      ruc,
      documento,
      es_contribuyente,
      telefono,
      telefono_secundario,
      email,
      email_secundario,
      direccion,
      ciudad,
      pais,
      sitio_web,
      instagram,
      linkedin,
      valor_cliente,
      sifen_receptor_extranjero,
      sifen_codigo_pais,
      sifen_tipo_doc_receptor,
      sifen_receptor_manual,
      sifen_receptor_naturaleza,
      sifen_ti_ope,
      sifen_num_id_de,
      sifen_direccion_de,
      sifen_num_casa_de,
      sifen_descripcion_tipo_doc,
      condicion_pago,
      metodo_pago_preferido,
      moneda_preferida,
      estado,
      origen,
      tipo_servicio_cliente,
      plan_comercial_id,
      vendedor_asignado,
      vendedor_usuario_id,
      usa_nota_remision,
      categoria_cliente_id,
      profesion,
      limite_credito,
      dias_credito,
    } = body;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const planComercial =
      typeof plan_comercial_id === "string" && uuidRe.test(plan_comercial_id.trim()) ? plan_comercial_id.trim() : null;

    const vendedorUsuarioId =
      typeof vendedor_usuario_id === "string" && uuidRe.test(vendedor_usuario_id.trim())
        ? vendedor_usuario_id.trim()
        : null;

    // Persona de contacto: opcional para empresas (la razón social identifica al
    // cliente), obligatorio para personas (es su nombre). Se exige al menos un
    // identificador: razón social (empresa) o nombre de contacto.
    const esEmpresa = (tipo_cliente ?? "empresa") !== "persona";
    if (!esEmpresa && !nombre_contacto?.trim()) {
      return NextResponse.json(errorResponse("El nombre completo es obligatorio para personas."), { status: 400 });
    }
    if (esEmpresa && !empresa?.trim() && !nombre_contacto?.trim()) {
      return NextResponse.json(errorResponse("Cargá la razón social o la persona de contacto."), { status: 400 });
    }

    // Validación de formato de RUC paraguayo (dígitos-dígito verificador).
    // Empresas siempre validan; personas sólo si es_contribuyente=true.
    const rucRaw = typeof ruc === "string" ? ruc.trim() : "";
    const debeValidarRuc =
      rucRaw.length > 0 &&
      (tipo_cliente === "empresa" || es_contribuyente === true);
    if (debeValidarRuc && !/^\d{1,10}-\d$/.test(rucRaw)) {
      return NextResponse.json(
        errorResponse(
          'Los datos no fueron cargados correctamente, seguir la estructura del RUC (números-dígito verificador, ej: 12345678-9).'
        ),
        { status: 400 }
      );
    }

    const tipoServicio = tipo_servicio_cliente?.trim();
    if (tipoServicio) {
      await ensureSemillasCatalogoTipos(supabase, auth.empresa_id);
      const valido = await tipoServicioSlugValido(supabase, auth.empresa_id, tipoServicio);
      if (!valido) {
        return NextResponse.json(
          errorResponse("tipo_servicio_cliente no existe en el catálogo de la empresa. Actualizá la lista en Configuración → CRM."),
          { status: 400 }
        );
      }
    }

    const nombreCreador =
      (typeof auth.nombre === "string" ? auth.nombre.trim() : "") ||
      (typeof auth.user?.email === "string" ? auth.user.email.trim() : "") ||
      null;

    const insertBase = {
      empresa_id:           auth.empresa_id,
      created_by_user_id:    auth.user.id,
      created_by_nombre:     nombreCreador,
      tipo_cliente:         tipo_cliente ?? "empresa",
      tipo_servicio_cliente: tipoServicio || null,
      empresa:              empresa?.trim() || null,
      // `nombre` es NOT NULL: si no hay persona de contacto, se usa la razón
      // social como respaldo (y "Cliente" como última red).
      nombre:               nombre_contacto?.trim() || empresa?.trim() || "Cliente",
      nombre_contacto:      nombre_contacto?.trim() || null,
      nombre_facturacion:   typeof nombre_facturacion === "string" && nombre_facturacion.trim().length > 0
        ? nombre_facturacion.trim()
        : null,
      nombre_comercial:     typeof nombre_comercial === "string" && nombre_comercial.trim().length > 0
        ? nombre_comercial.trim()
        : null,
      nivel_precio:         nivel_precio === "mayorista" || nivel_precio === "distribuidor"
        ? nivel_precio
        : "minorista",
      categoria_cliente_id: typeof categoria_cliente_id === "string" && uuidRe.test(categoria_cliente_id.trim())
        ? categoria_cliente_id.trim()
        : null,
      // Punto 3.2. El límite queda en NULL si no se definió: cero significa
      // "no se le vende a crédito", que es una decisión tomada, y mezclarlos
      // haría que un cliente sin configurar parezca bloqueado.
      profesion: typeof profesion === "string" && profesion.trim().length > 0
        ? profesion.trim().toUpperCase()
        : null,
      limite_credito: limite_credito === null || limite_credito === undefined || limite_credito === ""
        ? null
        : Number.isFinite(Number(limite_credito)) && Number(limite_credito) >= 0
          ? Number(limite_credito)
          : null,
      // Plazo acordado, en días. Vacío = sin plazo acordado, que no es cero.
      dias_credito: dias_credito === null || dias_credito === undefined || dias_credito === ""
        ? null
        : Number.isFinite(Number(dias_credito)) && Number(dias_credito) >= 0 && Number(dias_credito) <= 365
          ? Math.round(Number(dias_credito))
          : null,
      // Defensa en profundidad: para personas, si es_contribuyente no está
      // marcado, el RUC se descarta del lado servidor. Evita que un RUC
      // "fantasma" (mandado por un cliente desactualizado o vía API directa)
      // quede persistido con el flag apagado — rde-xml.ts decide B2B mirando
      // el RUC directamente, no el flag, así que un RUC guardado igual
      // facturaría como B2B. Empresas siempre pueden tener RUC (no aplica el gate).
      ruc:
        tipo_cliente === "persona" && es_contribuyente !== true
          ? null
          : ruc?.trim() || null,
      documento:            documento?.trim() || null,
      es_contribuyente:     es_contribuyente === true,
      telefono:             telefono?.trim() || null,
      telefono_secundario:  typeof telefono_secundario === "string" && telefono_secundario.trim() ? telefono_secundario.trim() : null,
      email:                email?.trim() || null,
      email_secundario:     typeof email_secundario === "string" && email_secundario.trim() ? email_secundario.trim() : null,
      direccion:            direccion?.trim() || null,
      ciudad:               ciudad?.trim() || null,
      pais:                 pais?.trim() || null,
      sitio_web:            typeof sitio_web === "string" && sitio_web.trim() ? sitio_web.trim() : null,
      instagram:            typeof instagram === "string" && instagram.trim() ? instagram.trim() : null,
      linkedin:             typeof linkedin === "string" && linkedin.trim() ? linkedin.trim() : null,
      valor_cliente:        (() => { const n = Number(valor_cliente); return Number.isFinite(n) && n > 0 ? n : null; })(),
      condicion_pago:       condicion_pago?.trim() || null,
      metodo_pago_preferido:
        metodo_pago_preferido === "efectivo" ||
        metodo_pago_preferido === "transferencia" ||
        metodo_pago_preferido === "tarjeta" ||
        metodo_pago_preferido === "cheque"
          ? metodo_pago_preferido
          : null,
      moneda_preferida:     moneda_preferida === "USD" ? "USD" : "GS",
      estado:               estado === "inactivo" ? "inactivo" : "activo",
      // Origen del alta: CRM (transformado desde un prospecto), VENTA o MANUAL.
      // Alimenta la etiqueta "Creado desde CRM" en la lista y ficha del cliente.
      origen:               origen === "CRM" || origen === "VENTA" ? origen : "MANUAL",
      vendedor_asignado:    typeof vendedor_asignado === "string" && vendedor_asignado.trim() ? vendedor_asignado.trim() : null,
      vendedor_usuario_id:  vendedorUsuarioId,
      usa_nota_remision:    usa_nota_remision === true,
    };

    if (typeof sifen_receptor_extranjero === "boolean") {
      (insertBase as Record<string, unknown>).sifen_receptor_extranjero = sifen_receptor_extranjero;
    }
    if (sifen_codigo_pais != null && String(sifen_codigo_pais).trim() !== "") {
      (insertBase as Record<string, unknown>).sifen_codigo_pais = String(sifen_codigo_pais).trim().toUpperCase();
    }
    if (sifen_tipo_doc_receptor != null && sifen_tipo_doc_receptor !== "") {
      const n = Number(sifen_tipo_doc_receptor);
      if (Number.isFinite(n)) (insertBase as Record<string, unknown>).sifen_tipo_doc_receptor = n;
    }
    if (sifen_receptor_manual === true) {
      (insertBase as Record<string, unknown>).sifen_receptor_manual = true;
      if (typeof sifen_receptor_naturaleza === "string" && sifen_receptor_naturaleza.trim()) {
        (insertBase as Record<string, unknown>).sifen_receptor_naturaleza = sifen_receptor_naturaleza.trim();
      }
      if (sifen_ti_ope != null && sifen_ti_ope !== "") {
        const t = Number(sifen_ti_ope);
        if (Number.isFinite(t)) (insertBase as Record<string, unknown>).sifen_ti_ope = Math.floor(t);
      }
      if (sifen_num_id_de != null && String(sifen_num_id_de).trim() !== "") {
        (insertBase as Record<string, unknown>).sifen_num_id_de = String(sifen_num_id_de).trim().slice(0, 20);
      }
      if (sifen_direccion_de != null && String(sifen_direccion_de).trim() !== "") {
        (insertBase as Record<string, unknown>).sifen_direccion_de = String(sifen_direccion_de).trim();
      }
      if (sifen_num_casa_de != null && Number.isFinite(Number(sifen_num_casa_de))) {
        (insertBase as Record<string, unknown>).sifen_num_casa_de = Math.max(0, Math.floor(Number(sifen_num_casa_de)));
      }
      if (sifen_descripcion_tipo_doc != null && String(sifen_descripcion_tipo_doc).trim() !== "") {
        (insertBase as Record<string, unknown>).sifen_descripcion_tipo_doc = String(sifen_descripcion_tipo_doc)
          .trim()
          .slice(0, 41);
      }
    }

    const rowWithPlan =
      planComercial ? { ...insertBase, plan_comercial_id: planComercial } : insertBase;

    let { data, error } = await supabase.from("clientes").insert([rowWithPlan]).select().single();

    // Si falla con plan (columna sin migrar, caché PostgREST, FK, etc.), reintentar sin plan_comercial_id.
    if (error && planComercial) {
      const second = await supabase.from("clientes").insert([insertBase]).select().single();
      if (!second.error) {
        data = second.data;
        error = null;
      } else {
        error = second.error;
      }
    }

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    await emitEvent(EVENT_TYPES.cliente_creado, { cliente_id: data.id, empresa: data.empresa });

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
