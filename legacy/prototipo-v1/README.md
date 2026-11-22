# Prototipo SGD Faro

Primer incremento de un prototipo académico de gestión documental (Proyecto Integrador AR, Universidad de Pamplona, 2026-2P). Funciona en un solo equipo y usa únicamente **datos ficticios**. No es un SGDEA en producción.

## 1. Requisitos y ejecución

Se necesita Node.js 22.13 o superior.

```
npm install
npm start
```

La aplicación queda en <http://localhost:3000>. Después de instalar no necesita internet.

| Usuario | Rol | Puede |
|---|---|---|
| `admin.demo` | administrador | Consultar, cargar, versionar y ver auditoría |
| `editor.demo` | editor | Consultar, cargar y versionar |
| `consulta.demo` | consulta | Consultar y descargar |

La contraseña de los tres usuarios de demostración es `Demo2026!`.

## 2. Comandos

- `npm test` ejecuta la prueba automatizada del flujo.
- `npm run reiniciar` borra la carpeta `data/` y restaura los datos iniciales. Conviene usarlo antes de cada ensayo.

## 3. Guion de la demo

Los PDF están en `demo-pdfs/` y se crean en el primer arranque.

1. Ingresar como `editor.demo` y buscar `interventoria`. La búsqueda ignora las tildes.
2. Cargar `2-documento-nuevo.pdf` en la serie 300.1.
3. Cargar `1-ya-digitalizado.pdf`. El sistema avisa que ya existe e indica dónde está.
4. Abrir "Acta de inicio" y registrar `3-nueva-version-acta.pdf` con su motivo. El historial conserva v1 y v2.
5. Ingresar como `consulta.demo`. Puede descargar, pero no cargar ni versionar.
6. Ingresar como `admin.demo` y abrir Auditoría para ver la trazabilidad.

## 4. Límites conocidos

- El aviso de duplicado solo detecta archivos idénticos byte a byte. Un nuevo escaneo del mismo papel genera otro archivo y no se detecta.
- Un archivo ya cargado no se puede registrar de nuevo, ni siquiera para restaurar una versión anterior.
- La búsqueda usa metadatos, no el contenido del PDF.
- Las sesiones se guardan en memoria y se cierran al reiniciar. Los datos sí persisten.
- [SUPUESTO] El cuadro de clasificación es un ejemplo. No es un instrumento aprobado por la entidad.
- No incluye administración de usuarios desde la interfaz.
