/**
 * Layout aislado del kiosco público de fichaje.
 *
 * No envuelve con AppShell ni con AuthGuard: la página es pública, accesible
 * solo via /fichar/[token]. El root layout ya inyecta los providers básicos;
 * el bypass real ocurre en AppShell (STANDALONE_ROUTES) y AuthGuard
 * (PUBLIC_ROUTES) — ambos detectan el prefijo /fichar.
 */
export default function FicharLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
