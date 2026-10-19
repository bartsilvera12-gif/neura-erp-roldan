/**
 * Nombre a mostrar para un usuario del ERP.
 *
 * En esta instancia no hay etiquetas especiales por usuario: siempre se muestra
 * el nombre real (o el email / fallback cuando no hay nombre guardado).
 * El módulo conserva su ruta para no tocar los imports existentes.
 */

export function nombreUsuarioDisplay(opts: {
  email?: string | null;
  nombre?: string | null;
  fallback?: string;
}): string {
  const nombre = (opts.nombre ?? "").trim();
  if (nombre) return nombre;
  const email = (opts.email ?? "").trim();
  if (email) return email;
  return opts.fallback ?? "Usuario";
}
