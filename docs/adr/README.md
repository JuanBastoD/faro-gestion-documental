# Decisiones de arquitectura (ADR)

Cada decisión importante de diseño queda registrada aquí con su fecha, su motivo y las alternativas descartadas. Las reglas de uso están en [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

| N.º | Título | Estado | Fecha |
|---|---|---|---|
| [0001](0001-stack.md) | Stack tecnológico de la versión 2 | Aceptada | 22 de noviembre de 2026 |
| [0002](0002-arquitectura-modular.md) | Monolito modular con puertos y adaptadores | Aceptada | 22 de noviembre de 2026 |
| [0003](0003-autenticacion-y-sesiones.md) | Autenticación con sesiones en el servidor y base de datos de pruebas aparte | Aceptada | 22 de noviembre de 2026 |

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
