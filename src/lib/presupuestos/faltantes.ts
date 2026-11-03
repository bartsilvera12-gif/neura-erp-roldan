import { faltantesAltaCliente, validarRucOCedula } from "@/lib/clientes/identificador";

/**
 * Qué le falta a un presupuesto para ser firme.
 *
 * ── POR QUÉ ESTÁ APARTE DEL RESTO ─────────────────────────────────────────
 *   Esta cuenta la necesitan tres lados: el formulario mientras se escribe
 *   —para decir antes de guardar que va a quedar borrador—, el POST que lo
 *   crea y el PATCH que lo completa. Si se escribiera en cada uno, el día que
 *   alguien agregue un dato obligatorio lo va a agregar en uno solo, y un
 *   borrador se podría "completar" desde la edición con menos datos de los
 *   que pide el alta.
 *
 *   Y va en un archivo sin nada de servidor adentro porque el formulario es
 *   un componente de cliente: con el alta de cliente en el mismo módulo, esa
 *   función terminaría viajando al navegador sin ninguna razón.
 */

export interface DatosClientePresupuesto {
  cliente_id?: string | null;
  nombre: string;
  ruc?: string | null;
  telefono?: string | null;
  profesion?: string | null;
  ciudad?: string | null;
  direccion?: string | null;
}

/**
 * Lo que falta para que el presupuesto sea firme.
 *
 * Son los mismos datos que pide el alta de cliente, porque crear el
 * presupuesto le abre la ficha. Vacío = está completo.
 *
 * Al cliente elegido del catálogo no se le vuelve a pedir nada: su ficha ya
 * pasó por el alta.
 */
export function faltantesDelPresupuesto(d: DatosClientePresupuesto): string[] {
  if (d.cliente_id) return [];
  const ident = validarRucOCedula(d.ruc);
  return [
    ...faltantesAltaCliente({
      nombre: d.nombre,
      ruc: d.ruc,
      telefono: d.telefono,
      profesion: d.profesion,
      ciudad: d.ciudad,
    }),
    // Un RUC mal escrito no es un dato que falta, es uno que no sirve. Se
    // suma a la lista para que el borrador pueda decir por qué no avanza.
    ...(ident.ok ? [] : [ident.error ?? "el RUC o la cédula"]),
  ];
}

/** Lo dicho en una sola frase, para mostrarlo. */
export function textoFaltantes(faltan: string[]): string {
  if (faltan.length === 0) return "";
  if (faltan.length === 1) return faltan[0]!;
  return `${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}`;
}

