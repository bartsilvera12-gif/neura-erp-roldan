/**
 * Sistema y navegador, en palabras, a partir del user-agent. Alcanza para
 * distinguir «Windows · Chrome» de «Android · Chrome»: no es un detector
 * exhaustivo y no hace falta que lo sea.
 */
export function describirAgente(ua: string): { sistema: string | null; navegador: string | null } {
  const u = ua || "";
  const sistema =
    /Windows NT 10/.test(u) ? "Windows 10/11"
    : /Windows/.test(u) ? "Windows"
    : /Android/.test(u) ? "Android"
    : /iPhone|iPad|iOS/.test(u) ? "iPhone / iPad"
    : /Mac OS X|Macintosh/.test(u) ? "Mac"
    : /Linux/.test(u) ? "Linux"
    : null;
  const navegador =
    /Edg\//.test(u) ? "Edge"
    : /OPR\//.test(u) ? "Opera"
    : /Chrome\//.test(u) ? "Chrome"
    : /Firefox\//.test(u) ? "Firefox"
    : /Safari\//.test(u) ? "Safari"
    : null;
  return { sistema, navegador };
}
