# Cómo probar el módulo 1 (Inventario) — paso a paso

Los 7 puntos del PDF de requerimientos del 26-10-2026, con qué hacer y qué tiene
que pasar. Los números esperados salen de los datos que hay hoy en la base, así
que si alguien carga o vende algo antes de probar, van a cambiar — lo que no
cambia es el criterio de cada paso.

**Antes de empezar:** los scripts `17` a `20` ya están corridos. No hace falta
tocar la base.

Hay que entrar **como administrador**: los puntos 1.2, 1.3 y 1.7 esconden
información de costos a los demás usuarios, a propósito.

---

## Datos que hay hoy

| Producto | SKU | Stock | Costo | Precio |
|---|---|---|---|---|
| CINTA AISLANTE | QA-002 | 120 | 5.000 | 12.000 |
| GUANTES DE TRABAJO | QA-001 | 40 | 15.000 | 30.000 |
| LINTERNA LED | QA-004 | 9 | 20.000 | 45.000 |
| PRUEBA | PRU-0001 | 190 | 8.970 | 20.000 |
| TALADRO PERCUTOR 650W | QA-003 | 5 | 300.000 | 520.000 |

Rubros: EJEMPLO, ELECTRICIDAD, HERRAMIENTAS, SEGURIDAD.

---

## 1.1 — Planilla de inventario

**Dónde:** Inventario → botón **"Planilla de conteo"** (arriba a la derecha, al
lado de Exportar/Importar).

1. Tocá el botón. Se abre un modal con la lista de rubros y tres opciones.
2. **Sin tildar ningún rubro**, tocá *Imprimir*.
   - Se abre una pestaña nueva con el diálogo de impresión ya abierto.
   - Tiene que decir **ACEROS METAL ROLDÁN E HIJOS** arriba, "Planilla de
     Inventario", la fecha y hora a la derecha, y renglones vacíos al lado de
     "Rubro:" y "Marca:" para completar a mano.
   - Columnas: **Cód · Cód Ref. · Artículo · 1er conteo · 2do conteo**.
   - **No** tiene que aparecer la columna "Stock Act" (el conteo ciego viene
     tildado).
   - **No** tiene que aparecer la fecha ni el link de la página en los bordes de
     la hoja. Si aparecen, destildá *"Encabezados y pies de página"* en el
     diálogo de impresión.
3. Volvé a abrir el modal y **destildá "Conteo ciego"**. Imprimí de nuevo:
   ahora sí tiene que aparecer la columna **Stock Act** con los números del
   sistema.
4. Volvé a abrir y **tildá dos rubros** (por ejemplo HERRAMIENTAS y SEGURIDAD).
   - Abajo tiene que avisar *"2 rubros: sale una hoja por rubro"*.
   - Al imprimir salen **dos hojas**, cada una con su rubro en el encabezado, su
     propio total de artículos abajo y sus tres firmas (Contó / Controló /
     Fecha).

**Falla si:** sale una sola planilla con todo mezclado, falta alguna de las dos
columnas de conteo, o el encabezado se corta en la segunda hoja.

---

## 1.2 — Stock mínimo automático

**Dónde:** Inventario → **Reposición**.

1. Arriba, debajo de los dos parámetros, hay un panel **"Mínimo automático"**.
   Tiene que explicar que usa la **mediana** de los últimos 6 meses y decir
   cuántos productos tienen hoy el mínimo distinto del sugerido.
2. En la tabla, la columna **"Sugerido"** va al lado de **"Mínimo"**. Pasá el
   mouse por un número: tiene que mostrar el mejor mes y en cuántos de los 6
   meses hubo ventas.
3. Tocá **"Solo los vacíos"**. Confirmá.
   - Carga el mínimo **únicamente** donde hoy no hay ninguno. Los que ya tenían
     un mínimo puesto a mano **no se tocan**.
   - Abajo del panel aparece en verde cuántos se actualizaron.
4. Tocá **"Actualizar todos"**.
   - Antes de hacer nada tiene que **decir cuántos productos va a cambiar** y
     pedir confirmación.
   - Después, la columna "Mínimo" y "Sugerido" quedan iguales en esos productos.

**Lo que hay que entender para no reportarlo como error:** un producto que vendió
fuerte dos meses y nada los otros cuatro da **mínimo sugerido 0**. No está roto:
la mediana ignora los picos a propósito, porque un mínimo alto para algo que casi
no rota deja plata parada. El "mejor mes" del tooltip muestra el pico.

**Falla si:** "Actualizar todos" no avisa cuántos va a cambiar, o "Solo los
vacíos" pisa un mínimo que ya estaba cargado.

---

## 1.3 — Stock crítico por rubro

**Dónde:** Inventario → **Rubros**, columna **"Crítico bajo"**.

1. Todos los rubros tienen que decir **"general"** (todavía ninguno fue
   configurado).
2. Hacé clic en el "general" de **HERRAMIENTAS**. Se abre un cuadro pidiendo los
   días. Poné **15** y aceptá.
   - La celda pasa a decir **"15 d"** en negrita.
3. Probá que valida: hacé clic de nuevo y poné **0**, después **400**. Las dos
   veces tiene que rechazarlo con un mensaje, sin guardar nada.
4. Dejá el campo **vacío** y aceptá: vuelve a decir "general".
5. Poné 15 en HERRAMIENTAS y andá a **Inventario → Reposición**.
   - Abajo de los filtros tiene que decir **"1 rubro tiene su propio umbral
     crítico"**, con un link a configurar.
   - En la columna **"Alcanza"** de un producto de HERRAMIENTAS aparece un
     numerito gris con el umbral del rubro. Pasando el mouse dice de dónde salió.

**Qué significa el número:** los días de stock por debajo de los cuales ese rubro
se marca crítico. En la práctica, **lo que tarda reponerlo**: si la chapa tarda
15 días, poné 15.

**Falla si:** acepta 0 o 400, o si el rubro configurado sigue usando el umbral
general en Reposición.

---

## 1.4 — Historial de ajustes

**Dónde:** menú Inventario → **Ajustes**.

1. Poné el filtro **Desde** en `2026-10-01` para que entren los ajustes viejos.
   Tienen que aparecer **5 ajustes**, así:

   | Código | Producto | Cantidad | Stock | Motivo |
   |---|---|---|---|---|
   | AJ-000001 | CINTA AISLANTE | **−5** (rojo) | 95 → 90 | Ajuste manual desde la ficha… |
   | AJ-000002 | CINTA AISLANTE | **+7** (verde) | 90 → 97 | QA Claude: revertir pruebas… |
   | AJ-000003 | LINTERNA LED | **+10** | 0 → 10 | Ajuste manual desde la ficha… |
   | AJ-000004 | CINTA AISLANTE | **? 3** (gris) | — | CONTEO FISICO |
   | AJ-000005 | PRUEBA | **+200** | 0 → 200 | Ajuste manual desde la ficha… |

2. El **AJ-000004 tiene que salir con "?"**. No es un error: ese ajuste se hizo
   antes de que el sistema guardara el signo, y el motivo está escrito a mano, así
   que no hay forma de saber si sumó o restó 3. Pasá el mouse: lo explica.
   La tarjeta **"Sin signo"** de arriba tiene que decir **1**.
3. **No tienen que aparecer** ventas, compras ni la carga inicial. Solo ajustes.
4. Probá el buscador con `CINTA`, con `AJ-000002` y con `CONTEO`. Los tres tienen
   que filtrar.
5. Achicá el rango a un solo día sin ajustes: tiene que decir *"No hay ajustes en
   ese período"*.

### Comprobar que un ajuste nuevo queda bien registrado

6. Andá a Inventario, abrí **GUANTES DE TRABAJO** y editá el stock de **40 a 37**.
   Poné como motivo `ROTURA`.
7. Volvé a **Ajustes**. Tiene que aparecer arriba de todo un **AJ-000006** con
   **−3 en rojo**, **40 → 37**, tu nombre de usuario y la hora.

**Falla si:** el ajuste nuevo sale sin código, sin signo, o sin el "40 → 37".

---

## 1.5 — Compras en dólares

**Dónde:** Compras → **Nueva compra**.

1. Elegí un proveedor y un producto cualquiera.
2. En **Moneda**, pasá de Guaraníes a **Dólares (USD)**.
   - El campo **Tipo de cambio** tiene que **llenarse solo** con `6.400`.
   - Abajo tiene que decir de cuándo es esa cotización y que queda guardada con
     la compra.
3. Cambiá el tipo de cambio a mano (poné `7.300`).
   - Aparece un link **"Volver a la vigente"**. Tocalo: vuelve a 6.400.
4. Cargá un costo unitario en dólares (por ejemplo `2`) con tipo de cambio
   `6.400` y guardá la compra.
5. Abrí el producto en Inventario: el costo tiene que haberse actualizado
   usando **2 × 6.400 = 12.800** como costo de esa entrada.

**Lo que no se ve pero es lo importante:** la conversión ahora la rehace el
servidor. Aunque el navegador mande un número equivocado, lo que se guarda es
`costo en dólares × tipo de cambio`.

**Falla si:** al elegir USD el tipo de cambio queda vacío, o si el costo guardado
no es el costo en dólares multiplicado por la cotización.

> **Nota:** todavía no hay pantalla para cargar cotizaciones nuevas — eso es el
> punto 7.1. Por ahora el sistema usa la que quedó sembrada de la última compra.

---

## 1.6 — Valoración de existencias

**Dónde:** menú Inventario → **Valoración**.

1. Con la fecha en **hoy**, tiene que mostrar:

   | Producto | Cantidad | Costo unit. | Valor |
   |---|---|---|---|
   | CINTA AISLANTE *(aprox.)* | 117 | 5.000 | 585.000 |
   | GUANTES DE TRABAJO | 40 | 15.000 | 600.000 |
   | LINTERNA LED | 9 | 20.000 | 180.000 |
   | PRUEBA | 190 | 6.584 | 1.250.933 |
   | TALADRO PERCUTOR 650W | 5 | 300.000 | 1.500.000 |

   **Valor total: Gs. 4.115.933**

2. **CINTA AISLANTE sale con la etiqueta "aprox." y 117 en vez de 120.** Es
   correcto: esas 3 unidades son el ajuste AJ-000004, el que no tiene signo. Arriba
   tiene que haber un aviso amarillo explicándolo.
3. Tocá el atajo **"Cierre 2025"**. Como no hay movimientos de 2025, tiene que
   decir *"No había stock a esa fecha"* — no dar error ni mostrar el stock de hoy.
4. Poné una fecha intermedia, por ejemplo `2026-10-21`.
   - Los números cambian, y aparece una columna extra **"Stock hoy"** para
     comparar.
5. Tildá **"Ver totales por rubro"**: una fila por rubro con su valor y el
   porcentaje del total.
6. Filtrá por un rubro y tocá **Imprimir**.

**Por qué el costo de PRUEBA (6.584) no es el que figura en su ficha (8.970):** la
valoración reconstruye el costo siguiendo los movimientos; la ficha arrastra un
costo que se calculó cuando el stock del producto estaba descuadrado. La
reconstrucción es la que cuadra con las compras.

**Falla si:** una fecha pasada devuelve exactamente lo mismo que hoy, o si el
total no coincide con la suma de la columna Valor.

---

## 1.7 — Margen y remarcación

**Dónde:** Inventario (lista) y Caja → Nueva venta.

1. En **Inventario**, la tabla tiene ahora **dos** columnas nuevas:
   **Remarcación** y **Margen**. Verificá contra estos:

   | Producto | Remarcación | Margen |
   |---|---|---|
   | CINTA AISLANTE | 140,0% | 58,3% |
   | GUANTES DE TRABAJO | 100,0% | 50,0% |
   | LINTERNA LED | 125,0% | 55,6% |
   | TALADRO PERCUTOR 650W | 73,3% | 42,3% |

   Pasá el mouse por cada encabezado: tiene que explicar la diferencia con un
   ejemplo.

2. Andá a **Caja → Nueva venta** y agregá **GUANTES DE TRABAJO**.
   - Debajo del nombre, en chiquito: **Rem. 100,0% · Marg. 50,0%**.
   - En el panel de totales, abajo del TOTAL, un recuadro con **Costo**,
     **Ganancia**, **Remarcación** y **Margen** de toda la venta.
3. **Bajá el precio** de la línea a `20.000`.
   - Los dos porcentajes bajan al instante: Rem. 33,3% y Marg. 25,0%.
   - El recuadro de totales se recalcula.
4. Agregá un segundo producto. El recuadro tiene que sumar los dos.
5. **Entrá con un usuario que no sea administrador.** Ni la fila del carrito ni
   el recuadro de totales tienen que mostrar nada de costos.

**La diferencia entre las dos, que es lo que el punto quiere dejar claro:**
costo 100.000 y precio 150.000 son **50% de remarcación** (lo que se le puso
encima al costo) y **33,3% de margen** (lo que queda de la venta). Es la misma
plata mirada desde dos lados.

**Falla si:** aparece una sola de las dos, si un usuario común ve los costos, o si
los porcentajes no se actualizan al cambiar el precio en Caja.

---

## Resumen para marcar

| # | Punto | OK |
|---|---|---|
| 1.1 | Planilla: dos conteos, varios rubros, una hoja por rubro | ☐ |
| 1.2 | Mínimo por mediana, "solo vacíos" no pisa, "todos" avisa | ☐ |
| 1.3 | Días críticos por rubro, valida 1-365, se ve en Reposición | ☐ |
| 1.4 | 5 ajustes con código y signo, el AJ-000004 con "?" | ☐ |
| 1.5 | Tipo de cambio se precarga, costo = USD × cotización | ☐ |
| 1.6 | Valoración de hoy da 4.115.933, fecha pasada da distinto | ☐ |
| 1.7 | Las dos columnas en Inventario y en Caja, ocultas al no-admin | ☐ |
