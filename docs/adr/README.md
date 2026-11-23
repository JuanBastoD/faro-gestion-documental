# Decisiones de arquitectura (ADR)

Cada decisión importante de diseño queda registrada aquí con su fecha, su motivo y las alternativas descartadas. Las reglas de uso están en [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

| N.º | Título | Estado | Fecha |
|---|---|---|---|
| [0001](0001-stack.md) | Stack tecnológico de la versión 2 | Aceptada | 22 de noviembre de 2026 |
| [0002](0002-arquitectura-modular.md) | Monolito modular con puertos y adaptadores | Aceptada | 22 de noviembre de 2026 |
| [0003](0003-autenticacion-y-sesiones.md) | Autenticación con sesiones en el servidor y base de datos de pruebas aparte | Aceptada | 22 de noviembre de 2026 |
| [0004](0004-almacen-de-archivos-y-carga.md) | Almacén de archivos y carga sin estados a medias | Aceptada | 22 de noviembre de 2026 |
| [0005](0005-versionado-y-restauracion.md) | Versionado de documentos y restauración que solo agrega | Aceptada | 22 de noviembre de 2026 |
| [0006](0006-verificacion-doble-de-duplicados.md) | Verificación doble de duplicados con huella de similitud calculada en la aplicación | Aceptada | 22 de noviembre de 2026 |
| [0007](0007-busqueda-por-texto-completo.md) | Búsqueda por texto completo sobre texto normalizado en la aplicación | Aceptada | 22 de noviembre de 2026 |
| [0008](0008-administracion-de-usuarios.md) | Administración de usuarios: desactivar en vez de borrar y protección del último administrador | Aceptada | 22 de noviembre de 2026 |
| [0009](0009-seguridad-minima-para-exponer-la-api.md) | Seguridad mínima para exponer la API: CSRF por origen, límite de intentos de ingreso, cabeceras y secretos | Aceptada | 22 de noviembre de 2026 |
| [0010](0010-importacion-del-cuadro-por-comando.md) | Importación del cuadro de clasificación por línea de comandos: simulación por defecto, todo o nada y sin tocar lo que tiene documentos | Aceptada | 22 de noviembre de 2026 |

## Formato

Un archivo por decisión, `NNNN-titulo-corto.md`, con estas secciones:

1. **Encabezado:** fecha, estado, issue y a qué ADR reemplaza o con cuál se relaciona.
2. **Contexto:** qué problema hay y qué restricciones lo condicionan.
3. **Decisión:** qué se eligió.
4. **Alternativas descartadas:** qué más se consideró y por qué no.
5. **Consecuencias:** qué mejora, qué empeora y qué riesgos quedan.
6. **Referencias:** documentos, issues y PR.

Estados: *Propuesta*, *Aceptada*, *Reemplazada por ADR-NNNN*. Un ADR aceptado no se reescribe: si la decisión cambia, se escribe uno nuevo que declara que reemplaza al anterior.

Las afirmaciones se marcan según su certeza: [CONFIRMADO], [PROPUESTA], [POR VERIFICAR], [SUPUESTO] o [DESCARTADO].
