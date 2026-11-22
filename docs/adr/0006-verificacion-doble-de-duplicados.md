# ADR-006: Verificación doble de duplicados con huella de similitud calculada en la aplicación

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #12
- **Relacionada con:** ADR-001 (anticipaba `pg_trgm` y dejaba abierta la librería de extracción y el umbral), ADR-004 (carga), ADR-005 (versiones y restauración), `docs/PLAN_MEJORA.md` sección 5
- **Reemplaza una decisión del plan:** el plan proponía `pg_trgm` con la regla «si el p95 no baja de 2 s, se cambia a una huella calculada en la aplicación». La medición de abajo activó esa regla.
- **Etiquetas de certeza:** [CONFIRMADO] construido y medido en el repositorio; [PROPUESTA] decidido pero aún no construido; [SUPUESTO] razonable pero sin medir; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

Un reescaneo del mismo papel genera otro archivo: otros bytes, otra fecha en los metadatos de PDF/A, a veces otras palabras mal reconocidas por el OCR. La huella SHA-256 no lo detecta. Los PDF de la entidad se escanean con OCR y en PDF/A-1a, así que traen capa de texto, y ese texto sí se parece. El problema original (los ingenieros piden re-escanear documentos ya digitalizados) exige detectarlo.

Reglas del plan que se mantienen: la similitud **nunca bloquea sola** (actas, contratos y oficios comparten plantillas), la decisión es de la persona y queda en la auditoría.

## 2. La medición que cambió el diseño [CONFIRMADO]

Prueba de rendimiento que exigía el plan, antes de construir: PostgreSQL 17.12 (el del Compose del repositorio), 100 documentos ficticios de unos 328 000 caracteres (≈ 100 páginas), índice GIN `gin_trgm_ops`, umbral 0,90 con el operador `%`. El corpus usa 6000 palabras inventadas con distribución tipo Zipf [SUPUESTO: más homogéneo que el español real; exagera el efecto de abajo, pero no lo crea].

| Resultado | Medición |
|---|---|
| Insertar un documento con el índice | 57 ms |
| Tamaño del índice | 248 kB (no es selectivo: todos los documentos comparten casi todos los trigramas) |
| Consulta de un documento **nuevo, sin relación** | **14,4 s** (p50) y **15,8 s** (p95) por consulta |
| Consulta de un reescaneo con 2 % de palabras mal reconocidas | 71 a 95 ms, pero **no lo encontró (0 de 15)** |
| Documentos nuevos y sin relación marcados como «≥ 0,90 similares» | **al menos 10 de 15** (la salida de esta corrida se recortó y no se pudo contar el resto); en una corrida previa más pequeña (10 documentos de 20 páginas) fueron **15 de 15**, y allí la similitud de trigramas de un reescaneo con 2 % de errores contra su original fue 0,899 |

Dos fallas distintas, y la segunda es la grave:

1. **Rendimiento:** p95 de 15,4 s contra el criterio de 2 s.
2. **No discrimina.** `pg_trgm` compara *conjuntos* de trigramas de letras. Dos textos largos del mismo idioma comparten casi todos los trigramas posibles, así que cualquier par de documentos de varias páginas sale muy parecido y el reescaneo (con ruido) puede salir *menos* parecido que documentos sin relación (en la corrida pequeña, 0,899 contra más de 0,90). Un aviso que salta con todos los documentos no sirve.

## 3. Decisión

### 3.1 Texto de cada versión con `unpdf` [CONFIRMADO en #12]

En la carga (y en cada versión nueva) se extrae la capa de texto con `unpdf` (no se corre OCR propio). La librería leyó bien los PDF generados con `pdf-lib`, conserva las tildes y tarda unos 0,9 s en un PDF de 100 páginas. Se normaliza (NFKD, sin tildes ni signos, minúsculas, espacios únicos: «Interventoría,» y «interventoria» son la misma palabra, y las ligaduras «ﬁ» de los PDF se desarman) y se guarda en `versiones.texto_normalizado` (también alimentará la búsqueda de #13).

`versiones.texto_estado` es `ok` o `sin_texto`. Queda `sin_texto`, y solo se verifica por huella exacta, cuando el PDF **no tiene capa de texto**, **tiene menos de 50 palabras** (una carátula, un sello, un número de página no dicen nada), o **no se puede leer**. Nunca bloquea la carga. Una restricción de la base obliga a que haya texto y firma exactamente cuando el estado es `ok`.

### 3.2 Firma MinHash sobre grupos de 3 palabras [CONFIRMADO en #12]

Cada versión con texto guarda una **firma de 256 números** (1 KB, `versiones.firma`). Se calcula con MinHash sobre los conjuntos de grupos de 3 palabras consecutivas; la fracción de posiciones iguales entre dos firmas estima la similitud de Jaccard de esos conjuntos, con un error típico de unos 0,03. Dos documentos distintos casi no comparten grupos de palabras; un reescaneo comparte casi todos. Es la «huella de similitud calculada en la aplicación» que el plan preveía (allí la llamaba SimHash; MinHash estima directamente Jaccard con un error conocido).

Calibración con 45 000 palabras (≈ 100 páginas) ficticias, [CONFIRMADO en simulación, SUPUESTO sobre PDF reales]:

| Caso | Similitud media | Rango |
|---|---|---|
| Idéntico | 1,000 | 1,00 |
| Mismo texto con otra maquetación (tildes, mayúsculas, signos) | 1,000 | 1,00 |
| Reescaneo con 0,5 % de palabras con error de OCR | 0,971 | 0,94–0,99 |
| Reescaneo con 1 % | 0,948 | 0,93–0,96 |
| Reescaneo con 2 % | 0,897 | 0,87–0,91 |
| Reescaneo con 3 % | 0,850 | 0,82–0,89 |
| Reescaneo con 5 % | 0,764 | 0,71–0,82 |
| Misma plantilla, 5 % de palabras distintas | 0,754 | 0,73–0,77 |
| Misma plantilla, 15 % de palabras distintas | 0,462 | 0,41–0,49 |
| Misma plantilla, 30 % de palabras distintas | 0,221 | 0,20–0,25 |
| Documento sin relación (mismo vocabulario) | 0,001 | 0,00 |
| 10 páginas: reescaneo 2 % / sin relación | 0,900 / 0,000 | 0,87–0,93 / 0,00 |

Calcular una firma de 100 páginas tarda 43 ms. Con el servidor real y 100 documentos en la base: cargar un PDF de 100 páginas **0,68 s** y detectar su reescaneo **0,89 s** de punta a punta, por debajo del objetivo de 2 s.

### 3.3 Umbral inicial 0,80, configurable [POR VERIFICAR]

`UMBRAL_SIMILITUD` (0,5 a 1, por defecto **0,80**, no el 0,90 del plan: aquel valor era para la escala de `pg_trgm`). Con 0,90 no se detectaría un reescaneo con 2 % de errores de OCR (0,897); con 0,80 se detecta hasta un 3 a 4 %, y una plantilla con 5 % de datos distintos (0,75) queda por debajo. **Falta calibrarlo con PDF reales de la entidad, que requieren su autorización**; hasta entonces se prueba con PDF ficticios y un reescaneo simulado. Mientras no haya datos reales, el aviso es una ayuda, no una garantía: un reescaneo muy ruidoso puede pasar sin aviso (el SHA y la similitud son una red, no un bloqueo).

### 3.4 Flujo de decisión [CONFIRMADO en #12]

`POST /documentos`, tras validar el PDF y la subserie:

| Situación | Resultado |
|---|---|
| Huella SHA-256 igual a la de cualquier versión de cualquier documento | **409 `duplicado_exacto`** con documento, versión, título, expediente y serie del existente. No se salta con una decisión |
| Huella distinta, similitud ≥ umbral con uno o más documentos | **409 `duplicado_probable`** con hasta 5 candidatos (uno por documento, el más parecido primero, con su similitud) y el umbral usado |
| Huella distinta y similitud < umbral, o `sin_texto` | Se carga como documento nuevo |

Ante `duplicado_probable` la persona **reenvía el mismo archivo** con una decisión (así el servidor no guarda estados intermedios):

- `decision=nueva_version` + `documentoId` + `motivo`: se agrega como versión del documento elegido (201, mismo flujo y misma transacción que `POST /documentos/:id/versiones`).
- `decision=documento_distinto` + `justificacion`: se carga como documento nuevo.

Cada decisión escribe el evento `decision_duplicado` **en la misma transacción** que la carga, con el documento, los candidatos con su similitud y la justificación; si el evento no se puede escribir, tampoco se crea la carga. Los campos de decisión que no corresponden (por ejemplo `documentoId` con `documento_distinto`) se rechazan con 400.

### 3.5 Carreras entre cargas idénticas [CONFIRMADO en #12]

La comprobación de huella ocurre antes de guardar el objeto, así que dos cargas idénticas simultáneas podrían pasarla las dos. Dentro de la transacción de carga se toma un bloqueo consultivo por huella (`pg_advisory_xact_lock`) y se vuelve a comprobar: la segunda ve a la primera y recibe 409. Prueba con peticiones simultáneas reales: una gana, la otra recibe 409 y queda un solo documento.

## 4. Alternativas descartadas

- **`pg_trgm` (la del plan):** medida en la sección 2. Lenta y, sobre todo, no discrimina en documentos largos. Habría servido para textos cortos o para búsqueda difusa de títulos, no para comparar documentos de 100 páginas.
- **Jaccard exacto guardando todos los grupos de palabras:** ≈ 180 KB por versión y una comparación costosa contra todas. MinHash da lo mismo con 1 KB y un error de 0,03.
- **SimHash:** estima el ángulo de vectores ponderados, no un Jaccard; el error es menos fácil de razonar para explicarlo a la entidad. MinHash fue más simple de calibrar.
- **Embeddings o un modelo de lenguaje:** costo, dependencia de un servicio externo y envío de documentos de la entidad a un tercero. Fuera de alcance.
- **Comparar imágenes de las páginas (huella perceptual):** exige renderizar PDF y no aprovecha la capa de texto que ya traen.
- **Que la similitud bloquee sola:** descartado por el plan y confirmado aquí: una plantilla con 5 % de datos distintos ya da 0,75.

## 5. Consecuencias y límites

- **La comparación se hace en memoria.** Cada carga lee la firma de todas las versiones con texto y contenido propio (1 KB cada una; las restauraciones se dejan fuera porque repiten otra firma). Con las cifras de la entidad (53 procesos en lo corrido del año) son megabytes como mucho [SUPUESTO]. Con decenas de miles de versiones habría que indexar (LSH por bandas); no es un riesgo previsible.
- **Una versión nueva (`POST /documentos/:id/versiones`) calcula y guarda su texto y su firma, pero no se compara con otros documentos:** la verificación entre documentos es la de la carga. Subir un archivo a mano como versión de otro documento es una decisión explícita de quien tiene el documento delante. [PROPUESTA] Si en las pruebas con usuarios aparece como un hueco, se agrega el mismo aviso allí.
- **Las filas anteriores a la migración 0005 quedan `sin_texto`** (no hay forma de saber su texto sin releer el archivo). En un despliegue limpio no existe ninguna.
- **Cambiar cualquier constante de `similitud/firma.ts`** (tamaño de la firma, palabras por grupo, semillas) invalida las firmas guardadas y obliga a recalcularlas desde `texto_normalizado`, que por eso se guarda.
- **Espacio:** el texto normalizado de un PDF de 100 páginas ronda 300 KB sin comprimir (PostgreSQL lo comprime). [POR VERIFICAR] contra el límite de almacenamiento del plan elegido en Neon (#20).
- **Extracción durante la petición:** unos 0,9 s por cada 100 páginas, con el límite de 20 MB. Con un PDF muy pesado la carga tarda más pero no falla.
- **Un PDF puede traer un texto distinto al que se ve** (OCR de mala calidad, texto oculto). Es la misma limitación que cualquier verificación por texto.
- **Un archivo idéntico siempre se bloquea.** [POR VERIFICAR] con la entidad si hay documentos que legítimamente van en dos expedientes; si los hay, la salida es una decisión explícita con justificación como la de la similitud, no quitar el bloqueo.
- **Migración 0005:** agrega `texto_estado`, `texto_normalizado` y `firma`, y las restricciones de coherencia. Sin `pg_trgm`, así que no depende de extensiones de PostgreSQL ni de qué ofrezca Neon.
