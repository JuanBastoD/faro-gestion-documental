import { Navigate, Route, Routes } from 'react-router';
import { Plantilla } from './componentes/Plantilla';
import { DocumentoDetalle } from './paginas/DocumentoDetalle';
import { Documentos } from './paginas/Documentos';
import { Ingreso } from './paginas/Ingreso';
import { Marcador } from './paginas/Marcador';
import { NoEncontrada } from './paginas/NoEncontrada';
import { RutaProtegida } from './sesion/RutaProtegida';

/**
 * Las rutas de la interfaz. Viven bajo `/app/` (el `basename` del enrutador, ADR-012), así que `/documentos/12` aquí
 * es `/app/documentos/12` en el navegador y no choca con `GET /documentos/12` de la API.
 *
 * Rutas con pantalla provisional (`Marcador`): ya existen para que los enlaces y la guarda de roles estén listos,
 * pero su pantalla es de otro issue (#24: carga, nueva versión y duplicado; #25: usuarios y auditoría).
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
            <Route
              path="/documentos/nuevo"
              element={
                <Marcador
                  titulo="Cargar un documento"
                  issue={24}
                  descripcion="Aquí se cargará un PDF con su título, expediente y serie, con el aviso de duplicados."
                />
              }
            />
            <Route
              path="/documentos/:id/version"
              element={
                <Marcador
                  titulo="Subir una versión nueva"
                  issue={24}
                  descripcion="Aquí se subirá una versión nueva de un documento, con el motivo del cambio."
                />
              }
            />
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
