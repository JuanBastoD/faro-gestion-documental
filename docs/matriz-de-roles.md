# Matriz de roles y permisos

- **Fecha:** 22 de noviembre de 2026
- **Issue:** #22 (1.3.2 del plan de mejora)
- **Alcance:** qué puede hacer cada rol en la API del prototipo v2, endpoint por endpoint. Hoy la regla vive en el código (`@Publico()`, `@Roles(...)` y las guardas globales `AuthGuard` y `RolesGuard`); este documento la hace legible para quien no lee código.
- **Etiquetas de certeza:** [CONFIRMADO] comprobado por la prueba de la sección 1; [PROPUESTA] decidido pero no construido.

## 1. Cómo se mantiene al día [CONFIRMADO]

La matriz no es solo documentación: `apps/api/test/matriz-de-roles.e2e-spec.ts` **lee la tabla de la sección 2 y la prueba contra la API real**, con un usuario de cada rol y sin sesión, por cada endpoint:

- donde dice **Sí**, la petición **pasa las guardas** (la respuesta no es 401 ni 403; puede ser 400 o 404 porque se prueba con datos vacíos, y eso demuestra que la guarda la dejó pasar);
- donde dice **No**, la respuesta es **403** (con sesión pero sin el rol) o **401** (sin sesión).

Y recorre las rutas que el servidor realmente tiene registradas: **si alguien agrega un endpoint y no lo pone aquí, o lo borra del código y lo deja aquí, el CI falla.** Esto atrapa el error más peligroso de una API: un endpoint nuevo que nadie decidió quién puede usar.

## 2. Matriz

**Sí** = permitido. **No** = prohibido (403 con sesión; 401 sin ella). Los endpoints de «Sin sesión: Sí» son públicos por diseño.

| Método | Ruta | Qué hace | Administrador | Editor | Consulta | Sin sesión |
|---|---|---|---|---|---|---|
| GET | `/health` | Estado de la API y de la base | Sí | Sí | Sí | Sí |
| POST | `/auth/login` | Ingresar | Sí | Sí | Sí | Sí |
| POST | `/auth/logout` | Cerrar la sesión propia | Sí | Sí | Sí | No |
| GET | `/auth/yo` | Quién soy | Sí | Sí | Sí | No |
| GET | `/series` | Cuadro de clasificación (árbol de series y subseries) | Sí | Sí | Sí | No |
| GET | `/documentos` | Listar y buscar documentos | Sí | Sí | Sí | No |
| POST | `/documentos` | Cargar un documento nuevo | Sí | Sí | No | No |
| GET | `/documentos/:id` | Ver un documento con su historial | Sí | Sí | Sí | No |
| GET | `/documentos/:id/versiones` | Historial de versiones | Sí | Sí | Sí | No |
| POST | `/documentos/:id/versiones` | Subir una versión nueva | Sí | Sí | No | No |
| POST | `/documentos/:id/versiones/:numero/restaurar` | Restaurar una versión anterior (crea una nueva) | Sí | Sí | No | No |
| GET | `/documentos/:id/versiones/:numero/archivo` | Descargar el PDF de una versión (queda en la auditoría) | Sí | Sí | Sí | No |
| GET | `/auditoria` | Consultar los eventos de auditoría | Sí | No | No | No |
| GET | `/usuarios` | Listar los usuarios | Sí | No | No | No |
| POST | `/usuarios` | Crear un usuario | Sí | No | No | No |
| PATCH | `/usuarios/:id` | Cambiar el rol o desactivar a un usuario | Sí | No | No | No |

## 3. Lo que la matriz resume, en palabras

| Rol | Puede | No puede |
|---|---|---|
| **Administrador** | Todo: cargar, versionar y restaurar documentos, ver la auditoría y administrar usuarios | — (con la salvedad de que **no puede dejar al sistema sin administradores activos**, ADR-008) |
| **Editor** | Cargar documentos, subir versiones y restaurar; leer y descargar todo | Ver la auditoría, administrar usuarios |
| **Consulta** | Leer, buscar y descargar | Cargar, versionar, restaurar, ver la auditoría, administrar usuarios |

## 4. Lo que la matriz NO dice [PROPUESTA]

- **Todos los roles con sesión ven todos los documentos.** No hay permisos por expediente, por serie ni por área: cualquier usuario autenticado puede listar, buscar y descargar cualquier documento. Para una entidad donde ingenieros, abogados, contabilidad y gerencia usan los mismos expedientes es lo que pide el proyecto hoy, pero **si algún documento debe ser reservado, hace falta un modelo de permisos por documento o por serie que este prototipo no tiene.**
- **Cada acción denegada queda en la auditoría** como `acceso_denegado` (con quién y qué intentó), y también cada descarga; la matriz dice quién puede, la auditoría dice quién lo hizo.
- **El rol rige al instante:** un cambio de rol (o desactivar al usuario) se aplica en la siguiente petición, aun con la sesión abierta (ADR-003 y ADR-008).
- **Antes de cualquier regla de la matriz**, toda petición que modifica datos pasa por la guarda de origen (403 `origen_no_permitido` si viene de otro sitio) y el ingreso tiene límite de intentos (429); ver [ADR-009](adr/0009-seguridad-minima-para-exponer-la-api.md). La prueba de la matriz las envía sin `Origin`, como un cliente que no es un navegador, por eso la guarda no interviene.
- **Nadie puede modificar el cuadro de clasificación por la API:** `GET /series` solo lee. El cuadro se carga con el comando `npm run ccd:importar` (CSV; [ADR-010](adr/0010-importacion-del-cuadro-por-comando.md)), que no es un endpoint y por eso no está en la matriz: lo puede ejecutar quien tenga acceso a la base de datos, no un rol de la aplicación. Queda en la auditoría como `ccd_importado`, sin usuario.
- **Nadie puede cambiar su propia clave todavía** (ADR-008, sección 4); eso no es un permiso de la matriz sino una función que falta.
