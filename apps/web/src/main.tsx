import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ProveedorSesion } from './sesion/ProveedorSesion';
import './estilos.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el elemento #raiz en index.html');

// `import.meta.env.BASE_URL` es «/app/» (la `base` de Vite, ADR-012): el enrutador cuenta las rutas desde ahí,
// sin la barra final.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter basename={BASE}>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </BrowserRouter>
  </StrictMode>,
);
