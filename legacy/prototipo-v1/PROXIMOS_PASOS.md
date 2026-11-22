# Próximos pasos del desarrollo

Estado al 8 de noviembre de 2026. Primer incremento: 5 módulos del anteproyecto, con 4 operativos y 7 pruebas automatizadas en verde (`npm test`). Este archivo guía la siguiente sesión de desarrollo. Las tarjetas correspondientes están en el tablero del proyecto (github.com/users/JuanBastoD/projects/2) y los paquetes están en el plan de trabajo (EDT, sección 2).

[PROPUESTA] El orden sigue la ruta crítica del plan: administración de usuarios, cuadro validado y pruebas.

## 0. Antes de tocar código

- Confirmar con el usuario si el commit de `iniciar-demo.bat` entra al repositorio. Hoy solo existe en la carpeta local.
- Confirmar qué pasa con las tarjetas: ¿se quedan como borradores del proyecto o se convierten en issues? Los issues son públicos.
- Verificar que `npm test` pasa antes de empezar (7 de 7).

## 1. Administración de usuarios desde la interfaz (paquete 1.4.1, HU-06, ruta crítica)

Criterio de aceptación del plan: el administrador crea, desactiva y cambia el rol de un usuario sin tocar la base de datos.

- Ruta nueva `GET /usuarios` y formulario para crear usuarios (solo rol `administrador`, con `exigirPermiso`).
- Desactivar en lugar de borrar: agregar una columna `activo` a `usuarios` en `db/schema.sql`. Un usuario inactivo no puede ingresar.
- Cambiar rol y restablecer la clave. La clave se guarda con bcrypt, como ya está en `POST /login`.
- Cada acción queda en `auditoria` (`usuario_creado`, `usuario_desactivado`, `rol_cambiado`).
- Pruebas nuevas en `test/flujo.test.js`: un editor recibe 403, un usuario desactivado no ingresa, el cambio de rol queda registrado.
- Documentar en la matriz de roles y permisos (paquete 1.3.2), que hoy solo está en el código.

Decisión a registrar: desactivar, no borrar, para conservar la trazabilidad de los documentos que cargó ese usuario.

## 2. Cuadro de clasificación validado (paquetes 1.2.3, 1.4.2, HU-07, ruta crítica)

El cuadro actual es un ejemplo marcado [SUPUESTO]. Antes de cambiarlo hay que validarlo con la encargada del archivo; eso es una tarea de la entidad, no del código.

- Cuando exista el cuadro validado: cargarlo desde un archivo CSV (`seed/` o un script) y, si da tiempo, desde la pantalla.
- Las series validadas reemplazan las de ejemplo solo si no hay documentos asociados. Si los hay, requiere migración explícita. No borrar series con documentos.
- Pruebas: todo documento nuevo se clasifica en una subserie válida (ya lo exige `serieValida`) y las series ya cargadas no cambian de código.

## 3. Pruebas (paquete 1.5.1)

- Ampliar las 7 pruebas a los módulos nuevos (usuarios y cuadro).
- Prueba de regresión del flujo de demostración completo, tal como está en `README.md`, sección 3.
- Opcional: una prueba que recorra `npm run reiniciar` y verifique que los datos de demostración quedan como al inicio.

## 4. Deudas conocidas del primer incremento

Están declaradas en `README.md`, sección 4. Revisar antes de cambiar nada:

- El aviso de duplicado solo detecta archivos idénticos byte a byte. Un nuevo escaneo del mismo papel no se detecta. No cambiar sin decidirlo: sería OCR o comparación por contenido, que está fuera del alcance del primer incremento.
- Un archivo ya cargado no se puede registrar de nuevo, ni siquiera para restaurar una versión anterior. Revisar si hace falta un caso de restauración.
- Las sesiones se guardan en memoria: al reiniciar el servidor hay que volver a ingresar.
- La búsqueda usa solo metadatos.

## 5. Lo que no es código y sigue en el plan

- Línea base de solicitudes de copias y reescaneo (paquete 1.2.1). Sin registros reales, las cifras siguen como [SIMULADO].
- Requisitos RF y RNF numerados (1.2.2) y diagrama entidad-relación (1.3.1).
- Pruebas con usuarios de la entidad (1.5.2) y comparación con la línea base (1.5.3).
- Manual de usuario, video, póster e informe final (1.6.x).

## Reglas para la siguiente sesión

- Cada cambio relevante se registra en la bitácora del día, con su certeza ([CONFIRMADO], [POR VERIFICAR], [SUPUESTO], [PROPUESTA]) y sus decisiones.
- No usar documentos reales de la entidad. Los datos de demostración son ficticios.
- No crear recursos públicos ni borrar nada sin confirmar con el usuario.
- Los commits llevan fecha real; no se retrodatan.
- El repositorio es público: no subir PDF reales, cédulas, teléfonos ni la carpeta `data/`.
