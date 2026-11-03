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

/**
 * Valida un campo único que puede llevar RUC o cédula, como el del
 * presupuesto.
 *
 * ── POR QUÉ ES UN CAMPO SOLO ──────────────────────────────────────────────
 * En el presupuesto el cliente se escribe a mano, y quien atiende no sabe de
 * antemano si va a cotizarle a una empresa con RUC o a una persona con cédula.
 * Un campo solo que acepte los dos es lo que se puede llenar sin pensarlo.
 *
 * ── POR QUÉ IMPORTA EN EL PRESUPUESTO ─────────────────────────────────────
 * Si el presupuesto no trae identificador, el cliente que se da de alta solo
 * al guardarlo tampoco lo tiene: se cuela por la ventana que cerramos en el
 * alta de clientes, y el padrón se vuelve a llenar de homónimos. Además el
 * presupuesto es el papel que después se factura, y una factura sin RUC ni
 * cédula no se puede emitir.
 *
 * Acepta el RUC con su dígito verificador (80012345-1) o una cédula, que es un
 * número y puede venir con puntos o guiones. No acepta texto: "s/d" o "no
 * tiene" en ese campo son lo mismo que dejarlo vacío, pero sin que se note.
 */
export function validarRucOCedula(valor: string | null | undefined): ResultadoIdentificador {
  const v = String(valor ?? "").trim();
  if (v === "") {
    return { ok: false, error: "Cargá el RUC o la cédula del cliente." };
  }
  if (RE_RUC.test(v)) return { ok: true, error: null };
  if (/^[\d.\-\s]+$/.test(v)) return { ok: true, error: null };
  return {
    ok: false,
    error: "Poné el RUC (ej: 80012345-1) o la cédula. Solo números, puntos y guiones.",
  };
}

/**
 * Los datos que no pueden faltar al dar de alta un cliente.
 *
 * ── CUÁLES, Y POR QUÉ ESTOS ───────────────────────────────────────────────
 * Son los cinco que nombró la reunión: nombre, RUC o cédula, teléfono,
 * profesión y ciudad. Cada uno se usa para algo concreto:
 *
 *   nombre          va en la factura
 *   RUC o cédula    identifica a la persona; sin él, el padrón se llena de
 *                   homónimos y el anticipo termina en la ficha equivocada
 *   teléfono        sin teléfono no hay seguimiento, y el seguimiento es la
 *                   mitad del trabajo de un presupuesto
 *   profesión       es con lo que la casa segmenta (herrero, constructor,
 *                   gasista) para saber a quién ofrecerle qué
 *   ciudad          define el flete y la zona de reparto
 *
 * NO se exigen dirección, email, límite ni días de crédito: al cliente de
 * mostrador no siempre se le piden, y volverlos obligatorios haría que se
 * carguen inventados con tal de poder seguir, que es peor que vacíos.
 *
 * ── SOLO AL CREAR ─────────────────────────────────────────────────────────
 * Igual que el identificador: de los 21.348 clientes migrados, muchos no
 * tienen profesión ni ciudad. Exigirlos al editar dejaría esas fichas
 * congeladas.
 */
export interface DatosAltaCliente extends IdentificadorCliente {
  nombre?: string | null;
  telefono?: string | null;
  profesion?: string | null;
  ciudad?: string | null;
}

/** Qué falta, en el orden en que está el formulario. */
export function faltantesAltaCliente(datos: DatosAltaCliente): string[] {
  const vacio = (v: unknown) => String(v ?? "").trim() === "";
  const faltan: string[] = [];
  if (vacio(datos.nombre)) faltan.push("el nombre");
  if (vacio(datos.ruc) && vacio(datos.documento)) faltan.push("el RUC o la cédula");
  if (vacio(datos.telefono)) faltan.push("el teléfono");
  if (vacio(datos.profesion)) faltan.push("la profesión");
  if (vacio(datos.ciudad)) faltan.push("la ciudad");
  return faltan;
}

/**
 * Valida los datos obligatorios del alta.
 *
 * Devuelve TODO lo que falta de una, no el primero: con un mensaje por campo,
 * quien está cargando descubre el siguiente recién después de arreglar el
 * anterior, y con el cliente esperando en el mostrador eso son cinco idas y
 * vueltas.
 */
export function validarAltaCliente(
  datos: DatosAltaCliente,
  exigirFormatoRuc = false
): ResultadoIdentificador {
  const faltan = faltantesAltaCliente(datos);
  if (faltan.length > 0) {
    return {
      ok: false,
      error:
        faltan.length === 1
          ? `Falta ${faltan[0]}.`
          : `Faltan ${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}.`,
    };
  }
  // Los cinco están; queda chequear que el RUC tenga forma de RUC.
  return validarIdentificadorAlta(datos, exigirFormatoRuc);
}
