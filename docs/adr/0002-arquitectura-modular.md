# ADR-002: Monolito modular con puertos y adaptadores

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #5
- **Relacionada con:** ADR-001 (stack)
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

En el prototipo v1 cada ruta de `src/app.js` mezcla HTTP, reglas de negocio, SQL y manejo de archivos (unas 2.300 líneas en una sola capa). No se puede probar ni cambiar una parte sin tocar las demás, y no hay una API que otro cliente pueda reutilizar (diagnóstico completo en `docs/PLAN_MEJORA.md`, sección 1).

El sistema que necesita la entidad exige, además:

- reglas que cambian con el tiempo, por ejemplo cómo se decide un duplicado probable o qué puede hacer cada rol;
- trazabilidad completa: cada decisión sobre un documento deja un evento de auditoría;
- poder mover el despliegue (disco, S3 compatible, nube) sin reescribir la lógica;
- un solo desarrollador y 15 días: la arquitectura no puede costar más de lo que ahorra.

## 2. Decisión

**Un monolito modular.** Una sola aplicación NestJS, una sola base de datos y un solo despliegue, dividida en módulos por tema, con capas dentro de cada módulo y puertos para lo que está fuera (archivos, reloj).

```
 Navegador ──► Interfaz web (React, hito V2-M4) ──► API REST (NestJS)
                                                       │
        ┌───────────────┬──────────────────────────────┼───────────────┐
   módulo auth      módulo ccd                  módulo documentos   módulo auditoría
   (usuarios,       (series y                   (versiones, huellas, (eventos y
    roles)           subseries)                  duplicados,          consulta)
                                                 búsqueda)
                                                       │
                       Puertos: AlmacenArchivos · Reloj · repositorios
                                                       │
              ┌────────────────────────────────────────┴───────────────┐
        PostgreSQL (Drizzle, migraciones)       Almacén de objetos (adaptadores:
                                                 disco local | S3 compatible | nube)
```

### Módulos

| Módulo | Responsabilidad | Estado |
|---|---|---|
| `config` | Variables de entorno validadas al arrancar; se inyecta como `ENTORNO` | [CONFIRMADO] |
| `base-datos` | Conexión (`POOL`, `DB`), esquema y migraciones | [CONFIRMADO] |
| `salud` | `GET /health` con el estado de la API y de la base | [CONFIRMADO] |
| `auth` | Usuarios, roles (administrador, editor, consulta) y guardas de acceso | [PROPUESTA] (#8, #17) |
| `ccd` | Cuadro de clasificación documental: series y subseries | [PROPUESTA] (#9, #19) |
| `documentos` | Documentos, versiones, huellas, verificación de duplicados y búsqueda | [PROPUESTA] (#10 a #13) |
| `auditoria` | Registro y consulta de eventos | [PROPUESTA] (#14) |

### Capas dentro de cada módulo

`controller` → `service` → `repository`.

- El **controller** recibe HTTP, valida la entrada y traduce la respuesta. No contiene reglas de negocio.
- El **service** contiene las reglas. No conoce Express ni SQL.
- El **repository** es el único lugar donde se escribe SQL o se usa Drizzle.

### Reglas de dependencia

1. Un módulo usa a otro **solo a través de los servicios que este exporta**. Nunca importa sus repositorios ni sus tablas directamente.
2. `documentos` no escribe la auditoría por su cuenta: llama al servicio de `auditoria`.
3. Las reglas de negocio dependen de **puertos** (interfaces), no de implementaciones. Los puertos previstos son `AlmacenArchivos` (adaptadores: disco local, almacén S3 compatible, nube) y `Reloj` (para fijar la fecha en las pruebas) [PROPUESTA].
4. La inyección de dependencias es **explícita** con `@Inject(<token>)`, sin depender de metadatos de decoradores. Así funciona igual compilado con `nest build` que bajo Vitest, sin depender de que la herramienta emita esos metadatos [CONFIRMADO en #6].
5. Todo lo que llega del entorno se valida al arrancar y los módulos lo reciben ya validado (`ENTORNO`); ningún módulo lee `process.env`. Solo lo leen para validarlo `main.ts` y `config`, y por separado la herramienta de migraciones (`drizzle.config.ts`), que corre fuera de la API [CONFIRMADO].

Las reglas 1 a 3 se aplican por convención y revisión del PR; hoy ninguna herramienta las verifica automáticamente.

## 3. Alternativas descartadas

| Alternativa | Motivo del descarte |
|---|---|
| **Microservicios** | Dos personas y un dominio pequeño: el costo operativo (varios despliegues, red entre servicios, observabilidad) no se justifica. Además, documento, versión y auditoría deben cambiar juntos en una transacción de base de datos, y repartirlos en servicios lo complicaría. |
| **Monolito en capas sin módulos** (el prototipo) | Es el origen del problema: sin fronteras, todo depende de todo. |
| **Arquitectura hexagonal completa con diseño guiado por el dominio** (entidades, agregados, objetos de valor) | Más ceremonia de la que un dominio de cuatro conceptos necesita en 15 días. Se toma solo la idea de puertos para lo externo. |
| **Funciones sin servidor por endpoint** | Cada función sufriría arranques en frío sobre una base (Neon) que se suspende por inactividad [POR VERIFICAR], y el estado compartido (sesiones, conexiones) se vuelve más difícil. |
| **Interfaz renderizada en el servidor** (el prototipo) | No deja un contrato de API reutilizable para la interfaz web nueva ni para integraciones futuras con SIA y SECOP. |

## 4. Consecuencias

**A favor**

- Cada módulo se puede probar por separado: los servicios se prueban con repositorios y puertos falsos, y la integración contra PostgreSQL real ya existe (`npm run test:e2e`).
- Los puertos permiten cambiar de almacén de archivos sin tocar las reglas.
- Si un módulo creciera lo suficiente, ya tiene sus fronteras para separarlo, aunque hoy no hace falta.
- La API REST es el contrato único para la interfaz web y para cualquier cliente futuro.

**En contra y riesgos**

- **Más archivos y repetición** (módulo, controller, service, repository) que en el prototipo, para funciones pequeñas.
- **La disciplina de dependencias no está automatizada.** Un atajo, como importar un repositorio ajeno, no lo detecta nadie salvo la revisión [PROPUESTA: agregar una regla de análisis de dependencias si aparece el problema].
- **Transacciones entre módulos** (por ejemplo subir una versión y registrar su evento de auditoría) necesitan una forma común de compartir la transacción [POR VERIFICAR]: se decide en #11 y #14, y si resulta costosa se documenta en un ADR nuevo.
- **El almacén de archivos y la base de datos no comparten transacción.** Subir el objeto y guardar su fila pueden quedar a medias. [PROPUESTA] Subir primero el objeto con una clave derivada de su huella y después insertar la fila en una transacción; los objetos huérfanos que queden se pueden detectar y limpiar. Se confirma al implementar #10.
- **Una sola base de datos compartida:** un cambio de esquema afecta a todos los módulos. Se controla con migraciones versionadas que no se editan una vez fusionadas.

## 5. Referencias

- `docs/PLAN_MEJORA.md`, secciones 1, 2 y 8.
- ADR-001: stack tecnológico.
- Código existente: `apps/api/src/app.module.ts`, `apps/api/src/config/`, `apps/api/src/base-datos/` y `apps/api/src/salud/`.
