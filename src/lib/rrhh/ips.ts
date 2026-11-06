/**
 * De qué salario sale el aporte al IPS.
 *
 * ── EL PROBLEMA ────────────────────────────────────────────────────────────
 *   "salario real y salario puesto en ips y que de ahí descuente el 9%."
 *
 *   Hasta ahora había un solo salario y el 9% salía de ahí. En la práctica no
 *   siempre es el mismo número: al empleado se le paga lo acordado y al IPS se
 *   le declara otra cifra, muy seguido el salario mínimo.
 *
 *   Con un campo solo, las dos opciones estaban mal: declarando el real, el
 *   9% descontado no coincide con la planilla del IPS; declarando el otro, el
 *   recibo le paga al empleado menos de lo prometido.
 *
 * ── LAS TRES FORMAS, Y CUÁL GANA ───────────────────────────────────────────
 *   1. `ips_sobre_minimo` prendido → el salario mínimo de la empresa.
 *   2. apagado y con `salario_ips` cargado → ese monto.
 *   3. ninguna de las dos → el salario real, que es como funcionaba antes.
 *
 *   El interruptor gana sobre el monto escrito a mano: si está prendido es
 *   porque se decidió declarar el mínimo, y dejar que un número viejo guardado
 *   en la ficha lo pise sería declarar cualquier cosa sin que nadie lo vea.
 *
 * ── POR QUÉ NO ALCANZA CON QUE SEA MENOR ───────────────────────────────────
 *   Declarar MÁS que el salario real no es un error del sistema: existe quien
 *   aporta sobre una cifra mayor para mejorar su jubilación. Pero declarar
 *   menos que el mínimo legal sí es un problema, y acá se avisa en vez de
 *   impedirlo: la ficha puede estar a medio cargar y el sistema no es quien
 *   para trabar la liquidación del mes.
 */

export interface EmpleadoIps {
  /** Lo que se le paga. */
  salario_base: number | null | undefined;
  /** Lo que se le declara al IPS. null = se declara el real. */
  salario_ips?: number | null;
  /** Si se le declara el salario mínimo de la empresa. */
  ips_sobre_minimo?: boolean | null;
}

export type OrigenBaseIps = "minimo" | "declarado" | "real" | "sin_minimo_cargado";

export interface BaseIps {
  /** El monto mensual sobre el que se calcula el aporte. */
  base: number;
  origen: OrigenBaseIps;
  /** Cuánto menos se declara que lo que se paga. 0 si se declara igual o más. */
  diferencia: number;
  /** Lo que hay que decirle a quien mira la ficha, o null si no hay nada que decir. */
  aviso: string | null;
}

const gs = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export const IPS_TRABAJADOR_PCT = 9;
export const IPS_PATRONAL_PCT = 16.5;

/**
 * El salario sobre el que se aporta.
 *
 * `salarioMinimo` es el parámetro de la empresa; viene en null mientras nadie
 * lo haya cargado, y entonces el interruptor del mínimo no puede resolverse:
 * se cae al salario real y se avisa, que es mejor que aportar sobre cero.
 */
export function baseIps(
  emp: EmpleadoIps,
  salarioMinimo: number | null | undefined
): BaseIps {
  const real = gs(emp.salario_base);
  const minimo = gs(salarioMinimo);

  if (emp.ips_sobre_minimo) {
    if (minimo <= 0) {
      return {
        base: real,
        origen: "sin_minimo_cargado",
        diferencia: 0,
        aviso:
          "Está marcado para aportar sobre el salario mínimo, pero el mínimo " +
          "todavía no se cargó en Configuración → RRHH. Mientras tanto se " +
          "aporta sobre el salario real.",
      };
    }
    return {
      base: minimo,
      origen: "minimo",
      diferencia: Math.max(0, real - minimo),
      aviso: null,
    };
  }

  const declarado = emp.salario_ips == null ? 0 : gs(emp.salario_ips);
  if (declarado > 0) {
    return {
      base: declarado,
      origen: "declarado",
      diferencia: Math.max(0, real - declarado),
      aviso:
        minimo > 0 && declarado < minimo
          ? `Se está declarando al IPS menos que el salario mínimo (Gs. ${minimo.toLocaleString("es-PY")}).`
          : null,
    };
  }

  return {
    base: real,
    origen: "real",
    diferencia: 0,
    aviso:
      minimo > 0 && real > 0 && real < minimo
        ? `El salario es menor que el mínimo (Gs. ${minimo.toLocaleString("es-PY")}).`
        : null,
  };
}

/** El 9% del trabajador sobre una base mensual. */
export function aporteTrabajador(base: number): number {
  return Math.round((gs(base) * IPS_TRABAJADOR_PCT) / 100);
}

/** El 16,5% del empleador sobre la misma base. */
export function aportePatronal(base: number): number {
  return Math.round((gs(base) * IPS_PATRONAL_PCT) / 100);
}

/**
 * La base del mes cuando no se trabajó el mes entero.
 *
 * Se prorratea igual que el salario —sobre 30 días— porque el IPS se declara
 * por lo devengado en el período: a quien entró el día 16 se le declara medio
 * mes, no el mes completo.
 */
export function baseDelPeriodo(base: number, diasTrabajados: number, diasDelMes = 30): number {
  const dias = Math.max(0, Math.min(diasDelMes, Math.trunc(diasTrabajados)));
  if (dias >= diasDelMes) return gs(base);
  return Math.round((gs(base) / diasDelMes) * dias);
}

/** "Se declara el mínimo", para mostrar de dónde salió el número. */
export function textoOrigen(origen: OrigenBaseIps): string {
  switch (origen) {
    case "minimo": return "declarado sobre el salario mínimo";
    case "declarado": return "declarado con un monto propio";
    case "sin_minimo_cargado": return "sobre el salario real (falta cargar el mínimo)";
    case "real": return "declarado sobre el salario real";
  }
}
