# ADR-007: Búsqueda por texto completo sobre texto normalizado en la aplicación

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #13
- **Relacionada con:** ADR-006 (guarda `texto_normalizado` por versión), ADR-005 (versión vigente y restauración), `docs/PLAN_EJECUCION.md` sección 5 (#13)
- **Cambia una decisión del plan:** el plan proponía la extensión `unaccent` y una configuración de búsqueda propia `es_sin_tildes`. Se reemplaza por normalizar en la aplicación (sección 2.1).
- **Etiquetas de certeza:** [CONFIRMADO] construido y medido en el repositorio; [PROPUESTA] decidido pero aún no construido; [SUPUESTO] razonable pero sin medir; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

Quien busca escribe «interventoria» y espera encontrar «Interventoría», en el título, el expediente o el texto del PDF. La búsqueda debe ser paginada, ordenada por relevancia y no repetir ni perder resultados entre páginas. El texto de cada versión ya se extrae y se guarda normalizado (ADR-006).

## 2. Decisión

### 2.1 Se normaliza en la aplicación y se indexa con `spanish` [CONFIRMADO en #13]

Una sola función (`normalizarTexto`: NFKD, sin tildes ni signos, minúsculas) se aplica a **todo**: título, expediente, texto del PDF y la consulta de quien busca. Con las dos puntas normalizadas igual, `to_tsvector('spanish', …)` y `plainto_tsquery('spanish', …)` encuentran «interventoria» al buscar «Interventoría», «INTERVENTORÍA» o «interventoria», y viceversa; el stemmer del español además junta singular y plural y las conjugaciones («interventorías», «pagos parciales» con «pago parcial»).

Por qué no `unaccent` + `es_sin_tildes` como decía el plan:

- El texto ya llega normalizado por ADR-006; con `unaccent` se haría dos veces.
- `unaccent` es una extensión: [POR VERIFICAR] su disponibilidad en Neon (#20). Sin ella la migración y la búsqueda no dependen de nada fuera de PostgreSQL estándar.
- `unaccent` no es inmutable, así que no se podría usar en una columna generada; habría que mantener el índice desde la aplicación de todos modos.
- Una función única en el código garantiza que documento y consulta se normalizan igual. Con dos mecanismos (la aplicación y una configuración de PostgreSQL) podrían divergir sin que nada falle.

### 2.2 Columna `documentos.busqueda` (`tsvector`) con índice GIN [CONFIRMADO en #13]

Título (peso A), expediente (B) y texto de la **versión vigente** (C). La mantiene el servicio (`actualizarBusqueda`) **dentro de la misma transacción** que crea o cambia el documento: carga, versión nueva y restauración. Así el índice nunca queda detrás de los datos, y una restauración devuelve al índice el texto de la versión restaurada (probado). Si la versión vigente no tiene texto (`sin_texto`), el documento se sigue encontrando por título y expediente.

Para los documentos que ya existían, la migración 0006 rellena la columna con el mismo cálculo (con `translate` en lugar de la normalización de la aplicación en título y expediente; el texto ya estaba normalizado). En un despliegue limpio no hay filas.

**Límite del índice:** un `tsvector` no puede pasar de 1 MB. Solo se indexan los **primeros 300 000 caracteres** del texto (unas 100 páginas). Una prueba con 1,5 millones de caracteres en los que casi toda palabra es distinta (el peor caso de un OCR con ruido) comprueba que la carga no falla, que lo del principio se encuentra y que lo del final no. El texto completo sigue guardado. [POR VERIFICAR] con PDF reales de la entidad si hay documentos que pasen de ese tamaño; si los hay, la salida es indexar el resto en trozos, no subir el límite.

### 2.3 Consulta y orden [CONFIRMADO en #13]

`GET /documentos?q=&serieId=&pagina=&tamano=`:

- `q` (máx. 200 caracteres) se normaliza y se pasa a `plainto_tsquery`: **todas las palabras deben estar (Y)** y lo escrito es solo texto, sin operadores, comillas ni sintaxis (probado con comillas, `&`, `|`, `:*`, `\` y SQL). Un `q` vacío, de espacios o de solo signos equivale a no buscar. Un `q` de solo palabras vacías («de la») no encuentra nada y no falla.
- Con `q`, orden por `ts_rank` (un acierto en el título pesa más que uno en el texto) y, a igualdad, el más reciente; **el desempate final por `id` hace el orden total**, y por eso la paginación no repite ni pierde elementos (probado con 23 documentos y páginas de 10, con y sin texto). Sin `q`, el más reciente primero.
- `serieId` filtra por esa serie o subserie e **incluye los documentos de sus subseries**.
- Páginas por posición (`OFFSET`), tamaño máximo 50; `total` es el de toda la búsqueda.

## 3. Medición [CONFIRMADO]

1000 documentos ficticios de 3000 palabras cada uno, PostgreSQL 17.12 del Compose: cargar e indexar los 1000 llevó 16 s (≈ 16 ms por documento); tabla de 33 MB con un índice GIN de 6,7 MB. Consultas (20 resultados, con el orden por relevancia): palabra poco frecuente, palabra frecuente, dos palabras y una palabra del título presente en **todos** los documentos (el peor caso, hay que ordenar los 1000): mediana 68 ms y p95 entre 77 y 87 ms en todos los casos. [SUPUESTO] El costo crece con el número de documentos que coinciden, no con el tamaño total; con 10 000 documentos que coinciden todos serían unas décimas de segundo.

## 4. Alternativas descartadas

- **`unaccent` + `es_sin_tildes`:** ver 2.1.
- **Columna generada o disparador que mantenga `busqueda`:** una columna generada no puede usar `unaccent` ni leer otra tabla (el texto vive en `versiones`). Un disparador garantizaría la consistencia pero esconde lógica y es más difícil de probar. Se eligió el servicio dentro de la transacción, con pruebas. **Consecuencia: quien edite título o expediente (aún no hay forma de hacerlo) debe llamar a `actualizarBusqueda` en la misma transacción.**
- **`pg_trgm` para tolerar errores de escritura:** descartado en ADR-006 para comparar documentos largos; para títulos cortos sí serviría, pero no está en el alcance del issue.
- **Paginación por cursor (keyset):** más estable con inserciones durante la navegación, pero la interfaz del plan es de páginas numeradas y con estas cifras `OFFSET` sobra. Se puede cambiar sin tocar el esquema.
- **Un motor de búsqueda aparte (Elasticsearch, Meilisearch):** un servicio más que operar y pagar para unos miles de documentos.

## 5. Consecuencias y límites

- **No hay búsqueda por frase exacta, por prefijo ni con tolerancia a errores de escritura**, ni fragmentos resaltados. «Contrato obra» exige las dos palabras, en cualquier orden y lugar.
- **El stemmer puede juntar palabras distintas** («plano» y «plan» tienen la misma raíz): es el comportamiento esperado de la búsqueda en español y rara vez estorba.
- **Sin palabras vacías en la consulta:** buscar solo «de» o «la» no devuelve nada.
- **El texto de PDF sin capa de texto no se busca**, claro: esos documentos se encuentran por título y expediente (el aviso de `sin_texto` ya viaja en la versión).
- **Migración 0006:** columna, índice GIN y relleno de lo existente.
