import { Navigate, Route, Routes } from 'react-router';
import { Plantilla } from './componentes/Plantilla';
import { CargarDocumento } from './paginas/CargarDocumento';
import { DocumentoDetalle } from './paginas/DocumentoDetalle';
import { Documentos } from './paginas/Documentos';
import { Ingreso } from './paginas/Ingreso';
import { Marcador } from './paginas/Marcador';
import { NoEncontrada } from './paginas/NoEncontrada';
import { NuevaVersion } from './paginas/NuevaVersion';
import { RutaProtegida } from './sesion/RutaProtegida';

/**
 * Las rutas de la interfaz. Viven bajo `/app/` (el `basename` del enrutador, ADR-012), así que `/documentos/12` aquí
 * es `/app/documentos/12` en el navegador y no choca con `GET /documentos/12` de la API.
 *
 * Rutas con pantalla provisional (`Marcador`): ya existen para que los enlaces y la guarda de roles estén listos,
 * pero su pantalla es de otro issue (#25: usuarios y auditoría). Carga y versión nueva son las del #24.
 */
export function App() {
  return (
    <Routes>
      <Route path="/ingreso" element={<Ingreso />} />

      <Route element={<RutaProtegida />}>
        <Route element={<Plantilla />}>
          <Route index element={<Navigate to="/documentos" replace />} />
          <Route path="/documentos" element={<Documentos />} />
          <Route path="/documentos/:id" element={<DocumentoDetalle />} />

          <Route element={<RutaProtegida roles={['administrador', 'editor']} />}>
            <Route path="/documentos/nuevo" element={<CargarDocumento />} />
            <Route path="/documentos/:id/version" element={<NuevaVersion />} />
          </Route>

          <Route element={<RutaProtegida roles={['administrador']} />}>
            <Route
              path="/usuarios"
              element={
                <Marcador
                  titulo="Usuarios"
                  issue={25}
                  descripcion="Aquí el administrador creará usuarios y cambiará su rol o los desactivará."
                />
              }
            />
            <Route
              path="/auditoria"
              element={
                <Marcador
                  titulo="Auditoría"
                  issue={25}
                  descripcion="Aquí el administrador consultará los eventos registrados, con filtros."
                />
              }
            />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
