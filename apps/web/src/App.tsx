import { Navigate, Route, Routes } from 'react-router';
import { Plantilla } from './componentes/Plantilla';
import { Auditoria } from './paginas/Auditoria';
import { CargarDocumento } from './paginas/CargarDocumento';
import { DocumentoDetalle } from './paginas/DocumentoDetalle';
import { Documentos } from './paginas/Documentos';
import { Ingreso } from './paginas/Ingreso';
import { NoEncontrada } from './paginas/NoEncontrada';
import { NuevaVersion } from './paginas/NuevaVersion';
import { Usuarios } from './paginas/Usuarios';
import { RutaProtegida } from './sesion/RutaProtegida';

/**
 * Las rutas de la interfaz. Viven bajo `/app/` (el `basename` del enrutador, ADR-012), así que `/documentos/12` aquí
 * es `/app/documentos/12` en el navegador y no choca con `GET /documentos/12` de la API.
 *
 * Carga y versión nueva son solo de administrador y editor (#24); usuarios y auditoría, solo de administrador (#25). Quien
 * entra a una por la dirección sin tener el rol ve la pantalla de «sin permiso»; la API responde 403 igual.
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
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/auditoria" element={<Auditoria />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
