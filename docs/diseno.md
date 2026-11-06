# El diseño del ERP, en una página

Esto no es una guía de estilo aspiracional: son las decisiones que ya están
aplicadas en el código. Si algo nuevo no se parece a esto, está mal lo nuevo.

## Por qué existe

Antes de emparejarlo, la aplicación tenía, contando sobre el código:

| | |
|---|---|
| Títulos de pantalla escritos a mano | **109**, en 12 estilos distintos |
| Variantes de botón con el color de la marca | **144** |
| Variantes de tarjeta blanca | **369** |
| Variantes de encabezado de tabla | **43** |
| Radios de esquina en uso | 4 (`md`, `lg`, `xl`, `2xl`) mezclados |

No era falta de diseño: era de más, todo distinto. Dos pantallas hermanas no
se parecían, y cada una parecía hecha por otra persona.

## Las decisiones

### Esquinas

- **`rounded-lg`** para lo que se toca: inputs, selectores, botones, chips.
- **`rounded-xl`** para lo que contiene: tarjetas, tablas, paneles, modales.

No se usan `rounded-md` ni `rounded-2xl`. Dos radios alcanzan; cuatro es ruido
que nadie puede sostener.

### Superficies

```
rounded-xl border border-slate-200 bg-white
```

**Sin sombra.** La mitad de las tarjetas tenía `shadow-sm` y la otra mitad no,
y en una pantalla con varias juntas las sombras se superponen y ensucian. El
borde solo alcanza para separar, y es el mismo a cualquier tamaño.

El fondo de la aplicación es gris claro, así que el blanco ya se despega.

### Tipografía

| Para qué | Clase |
|---|---|
| Título de pantalla | `text-xl font-semibold tracking-tight text-slate-900` (lo pone `PageHeader`) |
| Título de sección | `text-sm font-semibold text-slate-900` |
| Texto normal | `text-sm text-slate-700` |
| Secundario / ayuda | `text-[11px] leading-snug text-slate-500` |
| Etiqueta de campo | `text-[11px] font-medium text-slate-500` |

**Las micro-etiquetas no van en mayúsculas.** `UPPERCASE` en 11px con
`tracking-wide` es más difícil de leer y hace que una ayuda parezca un título.
La única excepción es el *eyebrow* de arriba del título, donde las mayúsculas
espaciadas son el recurso.

**Los números grandes y sueltos no llevan `tabular-nums`.** Esa clase le da a
cada dígito el ancho de un cero: sirve en una columna que tiene que alinearse,
y en un número grande solo lo deja flojo.

### Botones

Tres, y nada más:

```tsx
<Boton>Guardar</Boton>                       // primario: uno por pantalla
<Boton variante="secundario">Cancelar</Boton>
<Boton variante="fantasma">Ver más</Boton>
```

El primario es el color de la marca lleno. Si en una pantalla hay dos, hay uno
de más: el segundo es secundario. Nada de degradés, anillos ni saltos al
apretar.

### Tablas

- Encabezado: `bg-slate-50 text-xs text-slate-500`, en minúsculas.
- Filas: `py-2`, separadas por `border-b border-slate-100`.
- Los números a la derecha y con `tabular-nums`, para que se alineen.
- Las columnas que no entran en un teléfono se esconden con `hidden md:table-cell`,
  nunca se achican hasta que no se lean.

### El color no lleva el dato

Pintar una fila de rojo o una tarjeta de verde parece que ayuda, pero quien no
distingue el rojo del verde —uno de cada doce hombres— no ve ninguna
diferencia. Medido con el validador de paletas, el par rojo/verde queda en
ΔE 6,0 en deuteranopía, abajo del piso de 8.

Entonces: **el estado se dice con la palabra** ("Vencido", "Cobrado") y el
color es refuerzo, nunca el único portador. Y no se usan más de tres o cuatro
colores de estado: una columna con catorce colores, uno por cada clase, no se
distingue ni se recuerda.

Los cuatro tonos, y nada más:

| Tono | Para qué |
|---|---|
| `neutro` | un número sin carga |
| `acento` | lo que la pantalla quiere destacar |
| `pendiente` | algo que falta hacer |
| `bien` | algo cerrado, cobrado, pagado |
| `alerta` | algo vencido o roto |

## Lo que quedó emparejado

| | antes | después |
|---|---|---|
| Estilos de título de pantalla | 12 | **1** |
| Variantes de encabezado de tabla | 43 | 22, y todas con la misma tipografía (lo que cambia es el layout) |
| Radios de esquina | 4 | **2** |
| Color de acento | dos marcas mezcladas: el turquesa de Roldán y el celeste `#0EA5E9` del sistema clonado, en 309 lugares | **uno** |
| Saltos al apretar (`active:scale-95`) | 31 | 0 |
| Sombras en tarjetas apoyadas | la mitad sí, la mitad no | ninguna: solo lo que flota |

Lo que todavía NO está: 109 pantallas siguen escribiendo su `<h1>` a mano en
vez de usar `PageHeader`. La tipografía ya es la misma, así que se ven
iguales, pero les falta el eyebrow y el lugar fijo para las acciones. Eso se
hace pantalla por pantalla, no con un reemplazo.

## Las piezas

| Componente | Para qué |
|---|---|
| `PageHeader` | el encabezado de toda pantalla: eyebrow, título, descripción, acciones, volver |
| `BarraFiltros` + `CampoFiltro` + `campoClase` | la fila de filtros, con las acciones del otro lado y "Limpiar" |
| `Metrica` + `FilaDeMetricas` | las tarjetas de números de arriba |
| `SeccionForm` | una sección numerada de un formulario largo |
| `Selector` | el desplegable de toda la aplicación, dibujado por nosotros |
| `Boton` | los tres botones |

## Al escribir una pantalla nueva

1. `PageHeader` arriba, siempre. No se escribe un `<h1>` a mano.
2. Si hay filtros, `BarraFiltros`.
3. Si hay números de resumen, `FilaDeMetricas`.
4. Si es un formulario largo, `SeccionForm` numeradas.
5. Botones con `Boton`.
6. Nada de `rounded-md`, `rounded-2xl`, `shadow`, `uppercase` en 11px, ni
   colores fuera de los cinco tonos.
