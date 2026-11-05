/**
 * Hoja A4 sobria para los documentos de RRHH que se firman: recibo de salario,
 * comunicación de vacaciones. Escala de grises, tipografía Inter con números
 * de ancho fijo, y dos copias por hoja (empresa y trabajador) para cortar por
 * la línea punteada.
 *
 * Cada documento pone su cuerpo y su CSS propio; acá queda lo común, para que
 * los dos se vean iguales.
 */

const CSS_BASE = `
  @page { size: A4; margin: 12mm 14mm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", "Segoe UI", Arial, sans-serif;
    font-size: 10.5px; line-height: 1.45; color: #18181B;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    padding: 20px;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .copia { padding-bottom: 10px; }
  .copia + .copia { border-top: 1px dashed #A1A1AA; padding-top: 14px; }

  .titulo { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; }
  h1 { font-size: 15px; font-weight: 700; letter-spacing: .01em; margin: 0; }
  .periodo { margin: 2px 0 0; color: #52525B; font-size: 10.5px; }
  .copia-tag { font-size: 8.5px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #52525B; border: 1px solid #D4D4D8; border-radius: 3px; padding: 3px 7px; }

  .datos { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 5px 20px; padding: 8px 12px; border: 1px solid #E4E4E7; border-radius: 4px; margin-bottom: 10px; }
  .datos div { display: flex; flex-direction: column; }
  .lbl { font-size: 8px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #71717A; }
  .val { font-size: 10.5px; color: #18181B; }
  .fuerte { font-weight: 600; }
  .obs { margin: 10px 0 0; font-size: 10px; color: #3F3F46; }

  .firmas { display: flex; justify-content: space-between; gap: 60px; margin-top: 30px; }
  .firma { flex: 1; border-top: 1px solid #52525B; padding-top: 5px; text-align: center; font-size: 9.5px; color: #3F3F46; }
  .firma span { display: block; font-size: 8.5px; color: #A1A1AA; }

  @media print {
    body { padding: 0; }
    .noprint { display: none; }
    .copia { break-inside: avoid; }
    /* Las dos copias en una sola hoja A4. Si no entran, la segunda pasa
       entera a otra hoja. */
    .wrap { zoom: .9; }
  }
`;

export function hojaSobria({ titulo, css = "", cuerpo }: { titulo: string; css?: string; cuerpo: string }): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>${titulo}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>${CSS_BASE}${css}</style></head>
<body><div class="wrap">
  ${cuerpo}
  <div class="noprint" style="margin-top:20px;text-align:center;">
    <button onclick="window.print()" style="font-family:inherit;background:#18181B;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Imprimir / Guardar PDF</button>
  </div>
</div>
<script>
  // Se imprime cuando la tipografía terminó de cargar: si no, la primera
  // impresión sale con la fuente del sistema.
  window.addEventListener("load", () => {
    const listo = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    listo.then(() => { try { window.print(); } catch (e) {} });
  });
</script>
</body></html>`;
}
