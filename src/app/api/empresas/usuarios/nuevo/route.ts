import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { esRolAdminEmpresa } from "@/lib/modulos/resolve-effective-modules";
import { numeroDecimal } from "@/lib/numeros/decimal";

function emailExistsInAuthError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("user already registered") ||
    m.includes("duplicate")
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findAuthUserIdByEmail(supabase: any, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  let page = 1;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
    const users = data?.users ?? [];
    const found = users.find((u: { id: string; email?: string }) => (u.email ?? "").toLowerCase() === target);
    if (found) return found.id;
    if (users.length < 500) break;
    page++;
  }
  return null;
}

/**
 * Crea usuario en Auth + `zentra_erp.usuarios`, o si el correo ya existe en Auth,
 * vincula ese usuario a la empresa del administrador (útil tras pruebas u otra empresa).
 */
export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const authR = await getServiceAuthUsuario(req);
    if (!authR.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: authR.status });
    }
    if (!authR.catalogUsuario) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const supabase = createClient(url, serviceKey, { ...supabaseServiceRoleClientOptions });

    const admin = {
      empresa_id: authR.catalogUsuario.empresa_id ?? undefined,
      rol: authR.catalogUsuario.rol ?? undefined,
    };

    if (!admin.empresa_id && admin.rol !== "super_admin") {
      return NextResponse.json({ error: "Tu usuario no tiene empresa asignada." }, { status: 403 });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const nombre = String(body.nombre ?? "").trim();
    const telefono = body.telefono ? String(body.telefono).trim() : null;
    const fecha_nacimiento = body.fecha_nacimiento ? String(body.fecha_nacimiento) : null;
    const fecha_ingreso = body.fecha_ingreso ? String(body.fecha_ingreso) : null;
    const tipoRaw = body.tipo_contrato ? String(body.tipo_contrato).trim().toLowerCase() : null;
    const tipoOk = ["salario", "comision", "mixto", "prestador_servicio"];
    const tipo_contrato = tipoRaw && tipoOk.includes(tipoRaw) ? tipoRaw : null;
    const parseGs = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(/\s/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const parsePct = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      // La pantalla ya manda el número, pero acá también se acepta "2,5": si
      // mañana otro cliente de esta ruta manda el texto como lo escribió la
      // persona, no se pierde la comisión en silencio.
      return typeof v === "number" ? (Number.isFinite(v) ? v : null) : numeroDecimal(v);
    };
    const salario_base = parseGs(body.salario_base);
    const porcentaje_comision = parsePct(body.porcentaje_comision);
    const ips = Boolean(body.ips);
    const areaRaw = body.area ? String(body.area).trim().toLowerCase() : null;
    const areasOk = ["ventas", "cajero", "soporte", "finanzas", "operaciones", "administracion"];
    const area = areaRaw && areasOk.includes(areaRaw) ? areaRaw : null;
    const rol = String(body.rol ?? "usuario");

    if (!email || !password || password.length < 6) {
      return NextResponse.json({ error: "Email y contraseña (mín. 6 caracteres) son obligatorios." }, { status: 400 });
    }
    if (!nombre) {
      return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
    }

    if (porcentaje_comision != null && (porcentaje_comision < 0 || porcentaje_comision > 100)) {
      return NextResponse.json({ error: "La comisión debe estar entre 0 y 100." }, { status: 400 });
    }

    let vinculado = false;

    const empresaId = admin.empresa_id;
    if (!empresaId) {
      return NextResponse.json({ error: "Solo un administrador de empresa puede crear usuarios." }, { status: 403 });
    }

    // Sucursal: obligatoria y explícita. NO se hereda del admin que crea — el
    // admin de Reserva Market se da de alta desde Casa Matriz, así que heredar
    // lo dejaría en la sucursal equivocada viendo datos que no le corresponden.
    // Sin sucursal el usuario queda inutilizable (los endpoints devuelven 409),
    // por eso se valida acá y no después.
    const sucursalId = body.sucursal_id ? String(body.sucursal_id) : "";
    if (!sucursalId) {
      return NextResponse.json({ error: "Seleccioná la sucursal del usuario." }, { status: 400 });
    }
    const { data: sucOk } = await supabase
      .from("sucursales")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", sucursalId)
      .maybeSingle();
    if (!sucOk) {
      return NextResponse.json({ error: "La sucursal seleccionada no existe." }, { status: 400 });
    }

    /**
     * ── ESTA PANTALLA CREA. NO PISA A NADIE. ──────────────────────────────
     *
     * Antes, si el correo ya existía, esta ruta "vinculaba": le cambiaba la
     * contraseña a ese usuario y le escribía encima el nombre, el rol y el
     * área del formulario.
     *
     * El 11/11/2026 eso dejó a Roldán sin administrador. El navegador
     * autocompletó `admin@roldanehijos.com` en el campo de correo del alta
     * —es el que la persona tiene guardado para entrar—, nadie lo miró, y al
     * guardar el administrador pasó a llamarse DEYSI ALMADA, con rol
     * "usuario" y con la contraseña que se había tipeado para la nueva
     * empleada. Nadie pudo entrar más.
     *
     * Un alta no puede terminar en "le cambié la clave a otro". Si el correo
     * ya está tomado, se corta acá y se dice de quién es.
     */
    const { data: existente } = await supabase
      .from("usuarios")
      .select("id, nombre, estado")
      .eq("empresa_id", empresaId)
      .eq("email", email)
      .maybeSingle();

    if (existente?.id) {
      const quien = (existente as { nombre?: string | null }).nombre?.trim();
      return NextResponse.json(
        {
          error:
            `Ese correo ya es de ${quien || "otro usuario"}. ` +
            "Para cambiarle los datos o la contraseña, entrá a su ficha desde la lista de usuarios.",
        },
        { status: 409 }
      );
    }

    let authUserId: string | null = null;

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      if (emailExistsInAuthError(createErr.message)) {
        // El correo existe en Auth pero no es de esta empresa: puede ser de
        // otra, o haber quedado de una prueba. Se lo vincula SIN tocarle la
        // contraseña: cambiársela sería dejar afuera a quien lo esté usando.
        authUserId = await findAuthUserIdByEmail(supabase, email);
        if (!authUserId) {
          return NextResponse.json(
            {
              error:
                "El correo figura como ocupado pero no se pudo localizar la cuenta. Probá con otro correo o avisá a soporte.",
            },
            { status: 400 }
          );
        }
        vinculado = true;
      } else {
        return NextResponse.json({ error: createErr.message }, { status: 400 });
      }
    } else {
      authUserId = created.user?.id ?? null;
    }

    const payload = {
      empresa_id: empresaId,
      sucursal_predeterminada_id: sucursalId,
      email,
      nombre,
      telefono,
      fecha_nacimiento,
      fecha_ingreso,
      tipo_contrato,
      salario_base,
      porcentaje_comision,
      ips,
      area,
      rol,
      auth_user_id: authUserId,
      estado: "activo" as const,
    };

    // Siempre INSERT: llegar hasta acá significa que el correo no es de
    // ningún usuario de esta empresa.
    const { data: inserted, error: insErr } = await supabase
      .from("usuarios")
      .insert([payload])
      .select("id")
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    if (!inserted?.id) {
      return NextResponse.json({ error: "No se pudo obtener el id del usuario creado." }, { status: 500 });
    }
    const targetId = inserted.id as string;

    await supabase.from("usuario_modulos").delete().eq("usuario_id", targetId);
    if (!esRolAdminEmpresa(rol)) {
      const { data: emActivos } = await supabase
        .from("empresa_modulos")
        .select("modulo_id")
        .eq("empresa_id", empresaId)
        .eq("activo", true);
      if (emActivos && emActivos.length > 0) {
        const umRows = emActivos.map((r) => ({
          usuario_id: targetId,
          modulo_id: r.modulo_id as string,
        }));
        const { error: errUm } = await supabase.from("usuario_modulos").insert(umRows);
        if (errUm) {
          return NextResponse.json(
            { error: `Usuario guardado pero error al asignar módulos: ${errUm.message}` },
            { status: 400 }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      vinculado,
      message: vinculado
        ? "Usuario creado. El correo ya tenía una cuenta en el sistema, así que entra con la contraseña que ya usaba, no con la que acabás de poner."
        : "Usuario creado correctamente.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
