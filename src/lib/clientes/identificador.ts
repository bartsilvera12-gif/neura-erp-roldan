/**
 * El identificador obligatorio del cliente: RUC o cédula.
 *
 * ── POR QUÉ ES OBLIGATORIO ────────────────────────────────────────────────
 * Se pidió en la reunión: "RUC o cédula obligatorio para registrar clientes".
 * La razón de fondo es que sin identificador el padrón se llena de homónimos
 * —hay nueve "GONZALEZ"— y después nadie sabe a cuál de todos le corresponde
 * el anticipo, la cuenta por cobrar o la categoría. El nombre no identifica a
 * nadie; el RUC sí.
 *
 * ── SOLO AL CREAR, NUNCA AL EDITAR ────────────────────────────────────────
 * De los 21.344 clientes que vinieron del sistema anterior, una parte no tiene
 * RUC cargado. Exigirlo al editar dejaría esas fichas congeladas: no se podría
 * ni corregir un teléfono sin inventar un RUC. Por eso la exigencia corre solo
 * en el alta, y las fichas viejas se completan cuando el cliente vuelve.
 *
 * ── UNO DE LOS DOS, NO LOS DOS ────────────────────────────────────────────
 * Una empresa tiene RUC; una persona que no es contribuyente tiene cédula y
 * no tiene RUC. Pedir los dos sería pedir algo que no existe.
 */

export interface IdentificadorCliente {
  ruc?: string | null;
  documento?: string | null;
}

/** El formato del RUC paraguayo: dígitos, guion y dígito verificador. */
export const RE_RUC = /^\d{1,10}-\d$/;

export interface ResultadoIdentificador {
  ok: boolean;
  /** Qué decirle a quien está cargando. null cuando está bien. */
  error: string | null;
}

/**
 * Valida el identificador de un cliente NUEVO.
 *
 * `exigirFormatoRuc` controla si el RUC además tiene que cumplir el formato de
 * la SET. Se exige a empresas y contribuyentes, que son los que facturan; a una
 * persona que carga su RUC sin ser contribuyente no se le discute el formato,
 * porque ese dato no va a ningún documento electrónico.
 */
export function validarIdentificadorAlta(
  datos: IdentificadorCliente,
  exigirFormatoRuc = false
): ResultadoIdentificador {
  const ruc = String(datos.ruc ?? "").trim();
  const doc = String(datos.documento ?? "").trim();

  if (ruc === "" && doc === "") {
    return {
      ok: false,
      error: "Cargá el RUC o la cédula. Sin uno de los dos no se puede registrar el cliente.",
    };
  }

  if (ruc !== "" && exigirFormatoRuc && !RE_RUC.test(ruc)) {
    return {
      ok: false,
      error:
        "Los datos no fueron cargados correctamente, seguir la estructura del RUC " +
        "(números-dígito verificador, ej: 12345678-9).",
    };
  }

  // Una cédula es un número; dejarla con letras convierte la búsqueda por
  // documento en una lotería.
  if (ruc === "" && doc !== "" && !/^[\d.\-\s]+$/.test(doc)) {
    return {
      ok: false,
      error: "La cédula tiene que ser un número (se admiten puntos y guiones).",
    };
  }

  return { ok: true, error: null };
}
