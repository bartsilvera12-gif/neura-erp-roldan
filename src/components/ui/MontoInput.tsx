"use client";

/** Formatea número con separador de miles (Paraguay: 1.200.000) */
export function formatMontoDisplay(value: number | string, decimals = true): string {
  const n = typeof value === "string" ? parseMontoInput(value) : value;
  if (isNaN(n) || (typeof value === "number" && isNaN(value))) return "";
  return n.toLocaleString("es-PY", {
    minimumFractionDigits: decimals ? 0 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

/** Parsea string con formato a número (acepta "1.200.000", "1.234,50", "1234.56") */
export function parseMontoInput(value: string): number {
  if (!value || !value.trim()) return 0;
  const v = value.replace(/\s/g, "");
  if (v.includes(",")) {
    const [intPart, decPart] = v.split(",");
    const n = parseFloat((intPart || "").replace(/\./g, "") + "." + (decPart || "0"));
    return isNaN(n) ? 0 : n;
  }
  const parts = v.split(".");
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  const last = parts[parts.length - 1] || "";
  if (last.length <= 2 && /^\d+$/.test(last)) {
    return parseFloat(parts.slice(0, -1).join("") + "." + last) || 0;
  }
  return parseFloat(parts.join("")) || 0;
}

type MontoInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number | string;
  onChange: (value: number) => void;
  /** Si true, permite decimales. Default: true */
  decimals?: boolean;
};

/**
 * Input de monto con separador de miles.
 * Muestra el valor formateado (ej: 1.200.000) y emite el número al cambiar.
 */
export default function MontoInput({
  value,
  onChange,
  decimals = true,
  className = "",
  ...rest
}: MontoInputProps) {
  // El VALOR que llega por prop puede ser un número de JS pasado a texto
  // ("8970.526315789473", un costo promedio): eso no es formato de miles, son
  // decimales, y leerlo como miles daba 8.970.526.315.789.473 (BUG-12).
  // Ojo: esta lectura va SOLO acá y no en parseMontoInput. Lo que se TIPEA
  // pasa por "1.234" + "5" = "1.2345", que sí es el quinto dígito; tratarlo
  // como decimal no dejaba escribir más de 4 cifras en ningún monto.
  const numValue = typeof value === "string"
    ? (value === "" ? 0 : /^-?\d+\.\d+$/.test(value.trim()) && !/^-?\d{1,3}(\.\d{3})+$/.test(value.trim())
        ? Number(value.trim()) || 0
        : parseMontoInput(value))
    : Number(value) || 0;
  const display = (typeof value === "string" && value === "") ? "" : formatMontoDisplay(numValue, decimals);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseMontoInput(e.target.value);
    onChange(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      className={className}
      {...rest}
    />
  );
}
