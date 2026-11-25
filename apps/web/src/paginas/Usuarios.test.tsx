import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Rol } from '../api/auth';
import type { CambioDeUsuario, NuevoUsuario, UsuarioAdministrado } from '../api/usuarios';
import {
  CLAVE_DEL_MINIMO,
  CLAVE_DEMASIADO_CORTA,
  CLAVE_INICIAL_DE_PRUEBA,
  listaDeUsuarios,
  usuarioAdministrado,
} from '../pruebas/administracion';
import { manejadoresDeSesion, renderizarApp, respuestaJson, simularApi, type Llamada } from '../pruebas/ayudas';

type Manejadores = Parameters<typeof simularApi>[0];

/** La API de usuarios de mentira: una lista que cambia con los POST y los PATCH, como la real. */
function montar(opciones: { rol?: Rol; extra?: Manejadores; usuarios?: UsuarioAdministrado[] } = {}) {
  let usuarios = opciones.usuarios ?? listaDeUsuarios();
  const parchar = (id: number) => (llamada: Llamada) => {
    const actual = usuarios.find((u) => u.id === id);
    if (!actual) return respuestaJson({ statusCode: 404, message: `No existe el usuario ${id}` }, 404);
    const nuevo = { ...actual, ...(llamada.cuerpo as CambioDeUsuario) };
    usuarios = usuarios.map((u) => (u.id === id ? nuevo : u));
    return respuestaJson(nuevo);
  };
  const api = simularApi({
    ...manejadoresDeSesion(opciones.rol ?? 'administrador'),
    'GET /usuarios': () => respuestaJson(usuarios),
    'POST /usuarios': (llamada) => {
      const datos = llamada.cuerpo as NuevoUsuario;
      const nuevo = usuarioAdministrado(5, { usuario: datos.usuario, nombre: datos.nombre, rol: datos.rol });
      usuarios = [...usuarios, nuevo];
      return respuestaJson(nuevo, 201);
    },
    ...Object.fromEntries([1, 2, 3, 4, 5].map((id) => [`PATCH /usuarios/${id}`, parchar(id)])),
    ...opciones.extra,
  });
  renderizarApp('/usuarios');
  return api;
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

/** La tarjeta de un usuario, por su nombre. */
function tarjeta(nombre: string): HTMLElement {
  const encabezado = screen.getByRole('heading', { level: 2, name: new RegExp(`^${nombre}`) });
  const elemento = encabezado.closest('li');
  if (!elemento) throw new Error(`No hay tarjeta de ${nombre}`);
  return elemento;
}

async function esperarLista() {
  await screen.findByRole('heading', { level: 2, name: /^Admin Demo/ });
}

describe('lista de usuarios', () => {
  it('muestra a cada usuario con su rol, su estado y cuándo se creó, y marca la cuenta propia', async () => {
    montar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
    await esperarLista();
    expect(screen.getByText('4 usuarios · 3 activos')).toBeInTheDocument();

    const admin = tarjeta('Admin Demo');
    expect(within(admin).getByText('Tú')).toBeInTheDocument();
    expect(within(admin).getByText('administrador.demo')).toBeInTheDocument();
    expect(within(admin).getByText('Administrador', { selector: 'dd' })).toBeInTheDocument();
    expect(within(admin).getByText('Activo')).toBeInTheDocument();
    expect(within(admin).getByText(/2026.*10:30/)).toBeInTheDocument();
    expect(within(tarjeta('Editor Demo')).queryByText('Tú')).not.toBeInTheDocument();
  });

  it('un usuario inactivo lo dice con texto (no solo con estilo) y ofrece reactivarlo, no desactivarlo', async () => {
    montar();
    await esperarLista();
    const inactiva = tarjeta('Persona Inactiva Demo');
    expect(within(inactiva).getByText('Inactivo')).toBeInTheDocument();
    expect(within(inactiva).getByText('Inactivo: no puede ingresar')).toBeInTheDocument();
    expect(within(inactiva).getByRole('button', { name: 'Reactivar a Persona Inactiva Demo' })).toBeInTheDocument();
    expect(within(inactiva).queryByRole('button', { name: /^Desactivar a/ })).not.toBeInTheDocument();
    expect(within(tarjeta('Editor Demo')).getByRole('button', { name: 'Desactivar a Editor Demo' })).toBeInTheDocument();
  });

  it('el nombre accesible de cada botón de la tarjeta contiene su texto visible (WCAG 2.5.3, lo marcó axe en el navegador)', async () => {
    montar();
    await esperarLista();
    const lista = document.querySelector<HTMLElement>('.lista-usuarios');
    if (!lista) throw new Error('No hay lista de usuarios');
    const botones = within(lista).getAllByRole('button');
    expect(botones.length).toBeGreaterThanOrEqual(7);
    for (const b of botones) {
      const visible = (b.textContent ?? '').trim().toLowerCase();
      expect(b.getAttribute('aria-label')?.toLowerCase() ?? visible, `botón «${visible}»`).toContain(visible);
    }
  });

  it('con un error del servidor muestra el aviso y deja reintentar', async () => {
    const usuario = userEvent.setup();
    let falla = true;
    montar({ extra: { 'GET /usuarios': () => (falla ? respuestaJson({ message: 'boom' }, 500) : respuestaJson(listaDeUsuarios())) } });
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    falla = false;
    await usuario.click(boton('Reintentar'));
    await esperarLista();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('«Actualizar la lista» vuelve a pedirla y muestra lo que cambió en otro lado', async () => {
    const usuario = userEvent.setup();
    let usuarios = listaDeUsuarios();
    const api = montar({ extra: { 'GET /usuarios': () => respuestaJson(usuarios) } });
    await esperarLista();
    usuarios = [...usuarios, usuarioAdministrado(9, { nombre: 'Persona Nueva Demo' })];
    await usuario.click(boton('Actualizar la lista'));
    await screen.findByRole('heading', { level: 2, name: /^Persona Nueva Demo/ });
    expect(api.a('GET', '/usuarios')).toHaveLength(2);
  });

  it.each(['editor', 'consulta'] as const)('el rol %s no ve la pantalla y ni siquiera se le pide la lista', async (rol) => {
    const api = montar({ rol });
    expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    expect(api.a('GET', '/usuarios')).toHaveLength(0);
  });

  it('un 403 al pedir la lista explica qué pasó y vuelve a leer la sesión: si el rol ya no sirve, muestra «sin permiso»', async () => {
    let consultas = 0;
    montar({
      extra: {
        'GET /auth/yo': () => {
          consultas += 1;
          return respuestaJson({ usuario: { id: 1, usuario: 'administrador.demo', nombre: 'Admin Demo', rol: consultas === 1 ? 'administrador' : 'editor' } });
        },
        'GET /usuarios': () => respuestaJson({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403),
      },
    });
    expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    expect(consultas).toBe(2);
  });
});

describe('crear un usuario', () => {
  /** Monta la pantalla, espera la lista y abre el formulario. `extra` reemplaza manejadores de la API de mentira. */
  async function abrirFormulario(extra: Manejadores = {}) {
    const usuario = userEvent.setup();
    const api = montar({ extra });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    return { usuario, api };
  }

  const campo = (etiqueta: RegExp) => screen.getByLabelText(etiqueta);

  async function llenar(usuario: ReturnType<typeof userEvent.setup>, datos: { nombre?: string; usuario?: string; clave?: string } = {}) {
    await usuario.type(campo(/^Nombre completo/), datos.nombre ?? 'Ana Demo');
    await usuario.type(campo(/^Nombre de usuario/), datos.usuario ?? 'ana.demo');
    await usuario.type(campo(/^Clave inicial/), datos.clave ?? CLAVE_INICIAL_DE_PRUEBA);
  }

  it('el formulario explica cada campo y trae marcado el rol de menos permisos', async () => {
    await abrirFormulario();
    expect(screen.getByRole('heading', { level: 2, name: 'Crear un usuario' })).toHaveFocus();
    expect(campo(/^Nombre de usuario/)).toHaveAccessibleDescription(/minúsculas sin tilde.*No se puede cambiar después/);
    expect(campo(/^Clave inicial/)).toHaveAccessibleDescription(/De 12 a 256 caracteres.*por otro medio/);
    expect(screen.getByRole('radio', { name: /^Consulta/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Administrador/ })).not.toBeChecked();
    expect(screen.getByText(/Todo: carga, versiona y restaura documentos/)).toBeInTheDocument();
  });

  it('la clave se escribe oculta y se puede mostrar para no equivocarse', async () => {
    const { usuario } = await abrirFormulario();
    expect(campo(/^Clave inicial/)).toHaveAttribute('type', 'password');
    expect(campo(/^Clave inicial/)).toHaveAttribute('autocomplete', 'new-password');
    await usuario.click(screen.getByLabelText('Mostrar la clave mientras la escribo'));
    expect(campo(/^Clave inicial/)).toHaveAttribute('type', 'text');
    await usuario.click(screen.getByLabelText('Mostrar la clave mientras la escribo'));
    expect(campo(/^Clave inicial/)).toHaveAttribute('type', 'password');
  });

  it('con todo vacío señala los tres campos, pone el foco en el primero y no envía nada', async () => {
    const { usuario, api } = await abrirFormulario();
    await usuario.click(boton('Crear usuario'));
    expect(api.a('POST', '/usuarios')).toHaveLength(0);
    expect(campo(/^Nombre completo/)).toHaveAccessibleDescription(/Escribe el nombre completo de la persona/);
    expect(campo(/^Nombre de usuario/)).toHaveAccessibleDescription(/Escribe el nombre de usuario/);
    expect(campo(/^Clave inicial/)).toHaveAccessibleDescription(/Escribe la clave inicial/);
    expect(campo(/^Nombre completo/)).toHaveFocus();
    expect(campo(/^Nombre completo/)).toBeInvalid();
  });

  it('no envía si el nombre de usuario tiene mayúsculas: dice cómo escribirlo', async () => {
    const { usuario, api } = await abrirFormulario();
    await llenar(usuario, { usuario: 'Ana.Demo' });
    await usuario.click(boton('Crear usuario'));
    expect(api.a('POST', '/usuarios')).toHaveLength(0);
    expect(campo(/^Nombre de usuario/)).toHaveAccessibleDescription(/Escríbelo todo en minúsculas, por ejemplo «ana\.demo»/);
    expect(campo(/^Nombre de usuario/)).toHaveFocus();
  });

  it('una clave de 11 caracteres no pasa y una de 12 sí', async () => {
    const { usuario, api } = await abrirFormulario();
    await llenar(usuario, { clave: CLAVE_DEMASIADO_CORTA });
    await usuario.click(boton('Crear usuario'));
    expect(campo(/^Clave inicial/)).toHaveAccessibleDescription(/Mínimo 12 caracteres: esta tiene 11/);
    expect(campo(/^Clave inicial/)).toHaveFocus();
    expect(api.a('POST', '/usuarios')).toHaveLength(0);
    await usuario.clear(campo(/^Clave inicial/));
    await usuario.type(campo(/^Clave inicial/), CLAVE_DEL_MINIMO);
    await usuario.click(boton('Crear usuario'));
    await screen.findByText(/Se creó el usuario «ana\.demo»/);
    expect(api.a('POST', '/usuarios')).toHaveLength(1);
  });

  it('una clave de solo espacios no pasa', async () => {
    const { usuario } = await abrirFormulario();
    await llenar(usuario, { clave: ' '.repeat(14) });
    await usuario.click(boton('Crear usuario'));
    expect(campo(/^Clave inicial/)).toHaveAccessibleDescription(/no puede ser solo espacios/);
  });

  it('crea el usuario: lo agrega a la lista y avisa, con el foco en el aviso y sin repetir la clave', async () => {
    const { usuario } = await abrirFormulario();
    await llenar(usuario);
    await usuario.click(screen.getByRole('radio', { name: /^Editor/ }));
    await usuario.click(boton('Crear usuario'));

    const aviso = await screen.findByText(/Se creó el usuario «ana\.demo» \(Ana Demo\) con el rol Editor/);
    expect(aviso).toHaveFocus();
    expect(aviso).toHaveTextContent('Entrégale su clave inicial por otro medio');
    expect(screen.queryByRole('heading', { name: 'Crear un usuario' })).not.toBeInTheDocument();
    expect(within(tarjeta('Ana Demo')).getByText('Editor', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('5 usuarios · 4 activos')).toBeInTheDocument();
    // La clave no queda en ninguna parte de la pantalla.
    expect(document.body).not.toHaveTextContent(CLAVE_INICIAL_DE_PRUEBA);
  });

  it('el cuerpo de la petición lleva solo los cuatro campos, con el nombre y el usuario sin espacios sobrantes', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario, { nombre: '  Ana Demo  ', usuario: ' ana.demo ' });
    await usuario.click(screen.getByRole('radio', { name: /^Administrador/ }));
    await usuario.click(boton('Crear usuario'));
    await screen.findByText(/Se creó el usuario/);
    expect(api.a('POST', '/usuarios')).toHaveLength(1);
    expect(api.a('POST', '/usuarios')[0].cuerpo).toEqual({
      usuario: 'ana.demo',
      nombre: 'Ana Demo',
      rol: 'administrador',
      clave: CLAVE_INICIAL_DE_PRUEBA,
    });
  });

  it('un nombre de usuario repetido (409) se señala en su campo, con el nombre, y no cierra el formulario', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: {
        'POST /usuarios': () =>
          respuestaJson({ statusCode: 409, error: 'Conflict', codigo: 'usuario_existente', message: 'Ya existe un usuario con el nombre ana.demo' }, 409),
      },
    });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario);
    await usuario.click(boton('Crear usuario'));
    await waitFor(() => expect(campo(/^Nombre de usuario/)).toHaveFocus());
    expect(campo(/^Nombre de usuario/)).toHaveAccessibleDescription(/Ya existe un usuario llamado «ana\.demo»\. Elige otro nombre de usuario/);
    expect(screen.getByRole('alert')).toHaveTextContent('Ya existe un usuario llamado «ana.demo»');
    // Lo escrito se conserva para corregir solo lo que falta.
    expect(campo(/^Nombre completo/)).toHaveValue('Ana Demo');
    expect(screen.queryByText(/Se creó el usuario/)).not.toBeInTheDocument();
  });

  it('un 400 de la API se reparte por campo, en español y sin repetir lo escrito', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: {
        'POST /usuarios': () =>
          respuestaJson(
            {
              statusCode: 400,
              message: 'Datos inválidos',
              problemas: ['usuario: de 3 a 64 caracteres: minúsculas, números, punto, guion y guion bajo, empezando con letra o número', 'clave: debe tener al menos 12 caracteres'],
            },
            400,
          ),
      },
    });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario);
    await usuario.click(boton('Crear usuario'));
    await waitFor(() => expect(campo(/^Nombre de usuario/)).toHaveFocus());
    expect(campo(/^Nombre de usuario/)).toHaveAccessibleDescription(/El nombre de usuario debe tener de 3 a 64 caracteres/);
    expect(campo(/^Clave inicial/)).toHaveAccessibleDescription(/La clave debe tener al menos 12 caracteres/);
  });

  it('un fallo del servidor muestra la alerta y deja intentar de nuevo con lo escrito', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios': () => respuestaJson({ message: 'boom' }, 500) } });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario);
    await usuario.click(boton('Crear usuario'));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('El servidor tuvo un problema');
    expect(alerta).toHaveFocus();
    expect(boton('Crear usuario')).toBeEnabled();
    expect(campo(/^Clave inicial/)).toHaveValue(CLAVE_INICIAL_DE_PRUEBA);
  });

  it('sin conexión avisa que conviene mirar la lista antes de repetir', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: {
        'POST /usuarios': () => {
          throw new TypeError('Failed to fetch');
        },
      },
    });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario);
    await usuario.click(boton('Crear usuario'));
    expect(await screen.findByRole('alert')).toHaveTextContent('puede que el usuario sí se haya creado');
  });

  it('un 403 de rol lo explica y vuelve a leer la sesión', async () => {
    const usuario = userEvent.setup();
    const api = montar({
      extra: { 'POST /usuarios': () => respuestaJson({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403) },
    });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario);
    await usuario.click(boton('Crear usuario'));
    expect(await screen.findByRole('alert')).toHaveTextContent('solo los administradores pueden');
    await waitFor(() => expect(api.a('GET', '/auth/yo')).toHaveLength(2));
  });

  it('un segundo clic mientras se envía no manda otra petición', async () => {
    const usuario = userEvent.setup();
    let liberar: (r: Response) => void = () => undefined;
    const api = montar({
      extra: { 'POST /usuarios': () => new Promise<Response>((resolver) => (liberar = resolver)) },
    });
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await llenar(usuario);
    await usuario.click(boton('Crear usuario'));
    expect(await screen.findByRole('button', { name: 'Creando el usuario…' })).toBeDisabled();
    await usuario.keyboard('{Enter}');
    expect(api.a('POST', '/usuarios')).toHaveLength(1);
    liberar(respuestaJson(usuarioAdministrado(5, { usuario: 'ana.demo', nombre: 'Ana Demo' }), 201));
    await screen.findByText(/Se creó el usuario/);
    expect(api.a('POST', '/usuarios')).toHaveLength(1);
  });

  it('cancelar cierra el formulario, devuelve el foco al botón y no envía nada', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Crear usuario'));
    await usuario.click(boton('Cancelar'));
    expect(screen.queryByRole('heading', { name: 'Crear un usuario' })).not.toBeInTheDocument();
    await waitFor(() => expect(boton('Crear usuario')).toHaveFocus());
    expect(api.a('POST', '/usuarios')).toHaveLength(0);
  });
});

describe('cambiar el rol', () => {
  it('pide confirmar, explica que rige al instante y no envía nada si se elige el mismo rol', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Cambiar rol de Editor Demo'));
    const panel = screen.getByRole('form', { name: 'Cambiar el rol de Editor Demo' });
    expect(within(panel).getByRole('heading', { name: 'Cambiar el rol de Editor Demo' })).toHaveFocus();
    expect(within(panel).getByText(/rige/)).toHaveTextContent('al instante');
    expect(within(panel).getByRole('radio', { name: /^Editor \(rol actual\)/ })).toBeChecked();

    await usuario.click(within(panel).getByRole('button', { name: 'Sí, cambiar el rol' }));
    expect(within(panel).getByRole('radio', { name: /^Editor/ })).toHaveFocus();
    expect(within(panel).getByText(/ya tiene el rol Editor/)).toBeInTheDocument();
    expect(api.a('PATCH', '/usuarios/2')).toHaveLength(0);
  });

  it('cambia el rol: envía solo el rol, actualiza la tarjeta, avisa y cierra el panel', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Cambiar rol de Editor Demo'));
    const panel = screen.getByRole('form', { name: 'Cambiar el rol de Editor Demo' });
    await usuario.click(within(panel).getByRole('radio', { name: /^Consulta/ }));
    await usuario.click(within(panel).getByRole('button', { name: 'Sí, cambiar el rol' }));

    const aviso = await screen.findByText('Se cambió el rol de Editor Demo: ahora es Consulta. Rige desde ya.');
    expect(aviso).toHaveFocus();
    expect(api.a('PATCH', '/usuarios/2')[0].cuerpo).toEqual({ rol: 'consulta' });
    expect(within(tarjeta('Editor Demo')).getByText('Consulta', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /Cambiar el rol/ })).not.toBeInTheDocument();
  });

  it('degradar al último administrador (409) se explica y deja el panel abierto y el rol como estaba', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: {
        'PATCH /usuarios/1': () =>
          respuestaJson({ statusCode: 409, error: 'Conflict', codigo: 'ultimo_administrador', message: 'No se puede desactivar ni cambiar el rol del último administrador activo.' }, 409),
      },
    });
    await esperarLista();
    await usuario.click(boton('Cambiar rol de Admin Demo'));
    const panel = screen.getByRole('form', { name: 'Cambiar el rol de Admin Demo' });
    expect(within(panel).getByText(/Es tu propia cuenta/)).toBeInTheDocument();
    await usuario.click(within(panel).getByRole('radio', { name: /^Editor/ }));
    await usuario.click(within(panel).getByRole('button', { name: 'Sí, cambiar el rol' }));

    const alerta = await within(panel).findByRole('alert');
    expect(alerta).toHaveTextContent('último administrador activo');
    expect(alerta).toHaveTextContent('Antes crea o reactiva a otro administrador');
    expect(alerta).toHaveFocus();
    expect(within(tarjeta('Admin Demo')).getByText('Administrador', { selector: 'dd' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Sí, cambiar el rol' })).toBeEnabled();
  });

  it('cancelar cierra el panel y devuelve el foco al botón que lo abrió', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Cambiar rol de Editor Demo'));
    await usuario.click(within(screen.getByRole('form', { name: /Cambiar el rol/ })).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: /Cambiar el rol/ })).not.toBeInTheDocument();
    await waitFor(() => expect(boton('Cambiar rol de Editor Demo')).toHaveFocus());
    expect(api.a('PATCH', '/usuarios/2')).toHaveLength(0);
  });

  it('cambiar el propio rol a uno sin permisos vuelve a leer la sesión y la guarda de rutas saca de la pantalla', async () => {
    const usuario = userEvent.setup();
    let cambiado = false;
    const api = montar({
      extra: {
        'GET /auth/yo': () =>
          respuestaJson({ usuario: { id: 1, usuario: 'administrador.demo', nombre: 'Admin Demo', rol: cambiado ? 'editor' : 'administrador' } }),
        'PATCH /usuarios/1': () => {
          cambiado = true;
          return respuestaJson(usuarioAdministrado(1, { usuario: 'administrador.demo', nombre: 'Admin Demo', rol: 'editor' }));
        },
      },
    });
    await esperarLista();
    await usuario.click(boton('Cambiar rol de Admin Demo'));
    const panel = screen.getByRole('form', { name: 'Cambiar el rol de Admin Demo' });
    await usuario.click(within(panel).getByRole('radio', { name: /^Editor/ }));
    await usuario.click(within(panel).getByRole('button', { name: 'Sí, cambiar el rol' }));
    expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    expect(api.a('GET', '/auth/yo')).toHaveLength(2);
  });
});

describe('desactivar y reactivar', () => {
  it('desactivar pide confirmar y explica que cierra las sesiones y que no borra nada', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Desactivar a Editor Demo'));
    const panel = screen.getByRole('form', { name: '¿Desactivar a Editor Demo?' });
    expect(within(panel).getByText(/no podrá ingresar/)).toBeInTheDocument();
    expect(within(panel).getByText(/sesiones abiertas se cierran/)).toBeInTheDocument();
    expect(within(panel).getByText(/No se borra nada/)).toBeInTheDocument();
    expect(within(panel).queryByText(/Es tu propia cuenta/)).not.toBeInTheDocument();
    expect(api.a('PATCH', '/usuarios/2')).toHaveLength(0);
  });

  it('dos envíos seguidos del panel de confirmación mandan una sola petición (la guarda no depende de que el botón ya esté deshabilitado)', async () => {
    const usuario = userEvent.setup();
    let liberar: (r: Response) => void = () => undefined;
    const api = montar({ extra: { 'PATCH /usuarios/2': () => new Promise<Response>((resolver) => (liberar = resolver)) } });
    await esperarLista();
    await usuario.click(boton('Desactivar a Editor Demo'));
    const panel = screen.getByRole('form', { name: '¿Desactivar a Editor Demo?' });
    // Dos «submit» del mismo formulario sin pintar entre uno y otro: el botón aún no se ha deshabilitado en el segundo.
    fireEvent.submit(panel);
    fireEvent.submit(panel);
    await waitFor(() => expect(api.a('PATCH', '/usuarios/2')).toHaveLength(1));
    liberar(respuestaJson(usuarioAdministrado(2, { usuario: 'editor.demo', nombre: 'Editor Demo', rol: 'editor', activo: false })));
    await screen.findByText(/Se desactivó a Editor Demo/);
    expect(api.a('PATCH', '/usuarios/2')).toHaveLength(1);
  });

  it('confirmar desactiva: envía solo activo=false, marca la tarjeta como inactiva y cambia el botón por «Reactivar»', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Desactivar a Editor Demo'));
    await usuario.click(within(screen.getByRole('form', { name: /Desactivar/ })).getByRole('button', { name: 'Sí, desactivar' }));

    const aviso = await screen.findByText('Se desactivó a Editor Demo. Sus sesiones se cerraron y ya no puede ingresar.');
    expect(aviso).toHaveFocus();
    expect(api.a('PATCH', '/usuarios/2')[0].cuerpo).toEqual({ activo: false });
    const editor = tarjeta('Editor Demo');
    expect(within(editor).getByText('Inactivo')).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Reactivar a Editor Demo' })).toBeInTheDocument();
    expect(screen.getByText('4 usuarios · 2 activos')).toBeInTheDocument();
  });

  it('desactivar al último administrador (409) se explica y no cambia la tarjeta', async () => {
    const usuario = userEvent.setup();
    const api = montar({
      extra: {
        'PATCH /usuarios/1': () =>
          respuestaJson({ statusCode: 409, error: 'Conflict', codigo: 'ultimo_administrador', message: 'No se puede desactivar ni cambiar el rol del último administrador activo.' }, 409),
      },
    });
    await esperarLista();
    await usuario.click(boton('Desactivar a Admin Demo'));
    const panel = screen.getByRole('form', { name: '¿Desactivar a Admin Demo?' });
    await usuario.click(within(panel).getByRole('button', { name: 'Sí, desactivar' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('último administrador activo');
    expect(within(tarjeta('Admin Demo')).queryByText('Inactivo')).not.toBeInTheDocument();
    expect(api.a('PATCH', '/usuarios/1')).toHaveLength(1);
  });

  it('cancelar no envía nada y devuelve el foco al botón', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Desactivar a Editor Demo'));
    await usuario.click(within(screen.getByRole('form', { name: /Desactivar/ })).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(boton('Desactivar a Editor Demo')).toHaveFocus());
    expect(api.a('PATCH', '/usuarios/2')).toHaveLength(0);
  });

  it('reactivar es inmediato: envía activo=true y la tarjeta vuelve a estar activa', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    await usuario.click(boton('Reactivar a Persona Inactiva Demo'));
    const aviso = await screen.findByText('Se reactivó a Persona Inactiva Demo. Ya puede ingresar de nuevo.');
    expect(aviso).toHaveFocus();
    expect(api.a('PATCH', '/usuarios/4')[0].cuerpo).toEqual({ activo: true });
    expect(within(tarjeta('Persona Inactiva Demo')).queryByText('Inactivo')).not.toBeInTheDocument();
    expect(screen.getByText('4 usuarios · 4 activos')).toBeInTheDocument();
  });

  it('si reactivar falla, lo dice con una alerta y la tarjeta sigue inactiva', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'PATCH /usuarios/4': () => respuestaJson({ message: 'boom' }, 500) } });
    await esperarLista();
    await usuario.click(boton('Reactivar a Persona Inactiva Demo'));
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    expect(within(tarjeta('Persona Inactiva Demo')).getByText('Inactivo')).toBeInTheDocument();
    expect(boton('Reactivar a Persona Inactiva Demo')).toBeEnabled();
  });

  it('desactivarse a uno mismo advierte con más fuerza y, al confirmar, la sesión termina y se vuelve al ingreso', async () => {
    const usuario = userEvent.setup();
    let desactivado = false;
    const api = montar({
      extra: {
        'GET /auth/yo': () =>
          desactivado
            ? respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión', error: 'Unauthorized' }, 401)
            : respuestaJson({ usuario: { id: 1, usuario: 'administrador.demo', nombre: 'Admin Demo', rol: 'administrador' } }),
        'PATCH /usuarios/1': () => {
          desactivado = true;
          return respuestaJson(usuarioAdministrado(1, { usuario: 'administrador.demo', nombre: 'Admin Demo', rol: 'administrador', activo: false }));
        },
      },
    });
    await esperarLista();
    await usuario.click(boton('Desactivar a Admin Demo'));
    const panel = screen.getByRole('form', { name: '¿Desactivar a Admin Demo?' });
    expect(within(panel).getByText(/Es tu propia cuenta/).closest('p')).toHaveTextContent('Tu sesión se cerrará ahora mismo');
    await usuario.click(within(panel).getByRole('button', { name: 'Sí, desactivar' }));
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/ingreso');
    expect(api.a('POST', '/auth/logout')).toHaveLength(1);
  });
});

describe('sesión que termina o rol que cambia', () => {
  it('un 401 al hacer un cambio devuelve al ingreso con el aviso de sesión terminada', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'PATCH /usuarios/2': () => respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión', error: 'Unauthorized' }, 401) } });
    await esperarLista();
    await usuario.click(boton('Desactivar a Editor Demo'));
    await usuario.click(within(screen.getByRole('form', { name: /Desactivar/ })).getByRole('button', { name: 'Sí, desactivar' }));
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(screen.getByText('Tu sesión terminó. Ingresa de nuevo para continuar.')).toBeInTheDocument();
    expect(ubicacion()).toBe('/ingreso');
  });

  it('si al volver a leer la sesión la API ya no la reconoce (401), se vuelve al ingreso con el aviso', async () => {
    let consultas = 0;
    montar({
      extra: {
        'GET /auth/yo': () => {
          consultas += 1;
          return consultas === 1
            ? respuestaJson({ usuario: { id: 1, usuario: 'administrador.demo', nombre: 'Admin Demo', rol: 'administrador' } })
            : respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión', error: 'Unauthorized' }, 401);
        },
        'GET /usuarios': () => respuestaJson({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403),
      },
    });
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(screen.getByText('Tu sesión terminó. Ingresa de nuevo para continuar.')).toBeInTheDocument();
  });

  it('si al volver a leer la sesión no hay red, se conserva lo que había y el aviso del 403 sigue a la vista', async () => {
    let consultas = 0;
    montar({
      extra: {
        'GET /auth/yo': () => {
          consultas += 1;
          if (consultas === 1) return respuestaJson({ usuario: { id: 1, usuario: 'administrador.demo', nombre: 'Admin Demo', rol: 'administrador' } });
          throw new TypeError('Failed to fetch');
        },
        'GET /usuarios': () => respuestaJson({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403),
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('solo los administradores pueden');
    await waitFor(() => expect(consultas).toBe(2));
    expect(screen.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
  });

  it('un 403 de origen no se confunde con uno de rol: se explica y no se vuelve a leer la sesión', async () => {
    const usuario = userEvent.setup();
    const api = montar({
      extra: {
        'PATCH /usuarios/2': () => respuestaJson({ statusCode: 403, error: 'Forbidden', codigo: 'origen_no_permitido', message: 'Origen no permitido' }, 403),
      },
    });
    await esperarLista();
    await usuario.click(boton('Desactivar a Editor Demo'));
    await usuario.click(within(screen.getByRole('form', { name: /Desactivar/ })).getByRole('button', { name: 'Sí, desactivar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('desde un sitio que el servidor no reconoce');
    expect(api.a('GET', '/auth/yo')).toHaveLength(1);
  });
});

describe('restablecer la clave de otra persona (#51)', () => {
  const FORMA_GENERADA = /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/;
  const sinContenido = () => new Response(null, { status: 204 });
  type Usuario = ReturnType<typeof userEvent.setup>;

  function panelDeClave(nombre = 'Editor Demo') {
    return screen.getByRole('form', { name: `Restablecer la clave de ${nombre}` });
  }

  async function abrirPanel(usuario: Usuario, nombre = 'Editor Demo') {
    await usuario.click(boton(`Restablecer clave de ${nombre}`));
    return panelDeClave(nombre);
  }

  /** Escribe en el campo de la clave temporal pegando el texto (con `type` cada carácter es una pulsación). */
  async function escribirClave(usuario: Usuario, panel: HTMLElement, clave: string) {
    await usuario.click(within(panel).getByLabelText(/^Clave temporal/));
    await usuario.paste(clave);
  }

  async function confirmar(usuario: Usuario, panel: HTMLElement) {
    await usuario.click(within(panel).getByRole('button', { name: 'Sí, restablecer la clave' }));
  }

  it('cada persona tiene «Restablecer clave»; en la propia hay un enlace a «Cambiar mi clave» y no ese botón', async () => {
    montar();
    await esperarLista();
    for (const nombre of ['Editor Demo', 'Consulta Demo', 'Persona Inactiva Demo']) {
      expect(within(tarjeta(nombre)).getByRole('button', { name: `Restablecer clave de ${nombre}` })).toBeInTheDocument();
    }
    const propia = tarjeta('Admin Demo');
    expect(within(propia).queryByRole('button', { name: /Restablecer clave/ })).not.toBeInTheDocument();
    expect(within(propia).getByRole('link', { name: 'Cambiar mi clave' })).toHaveAttribute('href', '/clave');
  });

  it('el enlace propio lleva a la pantalla de cambio de clave', async () => {
    const usuario = userEvent.setup();
    montar();
    await esperarLista();
    await usuario.click(within(tarjeta('Admin Demo')).getByRole('link', { name: 'Cambiar mi clave' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Cambiar mi clave' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/clave');
  });

  it('abrir el panel explica las consecuencias, oculta la clave y no envía nada', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    const panel = await abrirPanel(usuario);
    expect(within(panel).getByText(/no podrá ingresar con su clave actual/)).toBeInTheDocument();
    expect(within(panel).getByText(/sesiones abiertas se cierran/)).toBeInTheDocument();
    expect(within(panel).getByText(/no vuelve a mostrar/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Clave temporal/)).toHaveAttribute('type', 'password');
    expect(within(panel).getByLabelText(/^Clave temporal/)).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('heading', { level: 3, name: 'Restablecer la clave de Editor Demo' })).toHaveFocus();
    expect(boton('Restablecer clave de Editor Demo')).toHaveAttribute('aria-expanded', 'true');
    expect(api.a('POST', '/usuarios/2/clave')).toHaveLength(0);
  });

  it('sin clave, o con 11 caracteres, no se envía y el error lleva el foco al campo', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await confirmar(usuario, panel);
    expect(within(panel).getByText('Escribe la clave temporal o genera una.')).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Clave temporal/)).toHaveFocus();
    expect(within(panel).getByLabelText(/^Clave temporal/)).toHaveAttribute('aria-invalid', 'true');

    await escribirClave(usuario, panel, CLAVE_DEMASIADO_CORTA);
    await confirmar(usuario, panel);
    expect(within(panel).getByText(/Mínimo 12 caracteres: esta tiene 11/)).toBeInTheDocument();
    expect(api.a('POST', '/usuarios/2/clave')).toHaveLength(0);
  });

  it('con una clave escrita: envía solo {clave}, cierra el panel y muestra la clave una vez, con el foco en su título', async () => {
    const usuario = userEvent.setup();
    const api = montar({ extra: { 'POST /usuarios/2/clave': sinContenido } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);

    const titulo = await screen.findByRole('heading', { level: 2, name: 'Clave temporal de Editor Demo' });
    expect(titulo).toHaveFocus();
    expect(api.a('POST', '/usuarios/2/clave')).toHaveLength(1);
    expect(api.a('POST', '/usuarios/2/clave')[0].cuerpo).toEqual({ clave: CLAVE_DEL_MINIMO });
    expect(screen.queryByRole('form', { name: /Restablecer la clave/ })).not.toBeInTheDocument();
    const caja = titulo.closest('section') as HTMLElement;
    expect(within(caja).getByLabelText('Clave temporal')).toHaveValue(CLAVE_DEL_MINIMO);
    expect(within(caja).getByLabelText('Clave temporal')).toHaveAttribute('readonly');
    expect(within(caja).getByText(/única vez que se muestra/)).toBeInTheDocument();
    expect(within(caja).getAllByText(/por otro medio/).length).toBeGreaterThan(0);
    // La lista no cambia: restablecer la clave no toca el rol ni el estado.
    expect(screen.getByText('4 usuarios · 3 activos')).toBeInTheDocument();
    // Ninguna otra petición lleva la clave.
    expect(api.llamadas.filter((l) => JSON.stringify(l.cuerpo ?? '').includes(CLAVE_DEL_MINIMO))).toHaveLength(1);
  });

  it('«Generar una clave» pone una clave de 16 símbolos a la vista y esa misma es la que se envía y la que se muestra', async () => {
    const usuario = userEvent.setup();
    const api = montar({ extra: { 'POST /usuarios/2/clave': sinContenido } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await usuario.click(within(panel).getByRole('button', { name: 'Generar una clave' }));
    const campo = within(panel).getByLabelText(/^Clave temporal/) as HTMLInputElement;
    expect(campo).toHaveAttribute('type', 'text');
    const generada = campo.value;
    expect(generada).toMatch(FORMA_GENERADA);
    expect(within(panel).getByLabelText('Mostrar la clave mientras la escribo')).toBeChecked();

    // Otra vez da una distinta.
    await usuario.click(within(panel).getByRole('button', { name: 'Generar una clave' }));
    expect(campo.value).not.toBe(generada);
    const segunda = campo.value;

    await confirmar(usuario, panel);
    const caja = (await screen.findByRole('heading', { level: 2, name: 'Clave temporal de Editor Demo' })).closest('section') as HTMLElement;
    expect(api.a('POST', '/usuarios/2/clave')[0].cuerpo).toEqual({ clave: segunda });
    expect(within(caja).getByLabelText('Clave temporal')).toHaveValue(segunda);
  });

  it('generar quita el error de validación que hubiera', async () => {
    const usuario = userEvent.setup();
    montar();
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await confirmar(usuario, panel);
    expect(within(panel).getByText('Escribe la clave temporal o genera una.')).toBeInTheDocument();
    await usuario.click(within(panel).getByRole('button', { name: 'Generar una clave' }));
    expect(within(panel).queryByText('Escribe la clave temporal o genera una.')).not.toBeInTheDocument();
  });

  it('«Copiar la clave» la manda al portapapeles y lo dice; si no se puede, lo dice y deja copiarla a mano', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios/2/clave': sinContenido } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    await screen.findByRole('heading', { level: 2, name: 'Clave temporal de Editor Demo' });

    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true });
    await usuario.click(boton('Copiar la clave'));
    expect(escribir).toHaveBeenCalledExactlyOnceWith(CLAVE_DEL_MINIMO);
    expect(await screen.findByText(/Clave copiada/)).toBeInTheDocument();

    escribir.mockRejectedValueOnce(new Error('denegado'));
    await usuario.click(boton('Copiar la clave'));
    expect(await screen.findByText(/No se pudo copiar\. Selecciona la clave del campo y cópiala a mano/)).toBeInTheDocument();
    expect(screen.queryByText(/Clave copiada/)).not.toBeInTheDocument();
  });

  it('sin portapapeles en el navegador también avisa', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios/2/clave': sinContenido } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    await screen.findByRole('heading', { level: 2, name: 'Clave temporal de Editor Demo' });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await usuario.click(boton('Copiar la clave'));
    expect(await screen.findByText(/No se pudo copiar/)).toBeInTheDocument();
  });

  it('cerrar la caja borra la clave de la pantalla, devuelve el foco al botón y deja restablecer otra vez', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios/2/clave': sinContenido } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    await screen.findByRole('heading', { level: 2, name: 'Clave temporal de Editor Demo' });
    // Mientras la caja está abierta no se abre otro restablecimiento: la caja es lo único que tiene la clave.
    expect(boton('Restablecer clave de Consulta Demo')).toBeDisabled();

    await usuario.click(boton('Ya la copié, cerrar'));
    expect(screen.queryByRole('heading', { name: 'Clave temporal de Editor Demo' })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CLAVE_DEL_MINIMO);
    await waitFor(() => expect(boton('Restablecer clave de Editor Demo')).toHaveFocus());
    expect(boton('Restablecer clave de Consulta Demo')).toBeEnabled();
  });

  it('cancelar el panel no envía nada y devuelve el foco al botón', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await usuario.click(within(panel).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(boton('Restablecer clave de Editor Demo')).toHaveFocus());
    expect(screen.queryByRole('form', { name: /Restablecer la clave/ })).not.toBeInTheDocument();
    expect(api.a('POST', '/usuarios/2/clave')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(CLAVE_DEL_MINIMO);
  });

  it('dos envíos seguidos mandan una sola petición', async () => {
    const usuario = userEvent.setup();
    let liberar: (r: Response) => void = () => undefined;
    const api = montar({ extra: { 'POST /usuarios/2/clave': () => new Promise<Response>((resolver) => (liberar = resolver)) } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    fireEvent.submit(panel);
    fireEvent.submit(panel);
    await waitFor(() => expect(api.a('POST', '/usuarios/2/clave')).toHaveLength(1));
    liberar(sinContenido());
    await screen.findByRole('heading', { level: 2, name: 'Clave temporal de Editor Demo' });
    expect(api.a('POST', '/usuarios/2/clave')).toHaveLength(1);
  });

  it('una persona que ya no existe (404) se explica dentro del panel, que conserva lo escrito', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios/2/clave': () => respuestaJson({ statusCode: 404, message: 'No existe el usuario 2' }, 404) } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Editor Demo ya no existe');
    expect(within(panel).getByLabelText(/^Clave temporal/)).toHaveValue(CLAVE_DEL_MINIMO);
    expect(screen.queryByRole('heading', { name: 'Clave temporal de Editor Demo' })).not.toBeInTheDocument();
  });

  it('un 429 dice cuánto esperar y no muestra ninguna clave', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios/2/clave': () => respuestaJson({ message: 'x' }, 429, { 'Retry-After': '30' }) } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Intenta de nuevo en 30 segundos');
    expect(screen.queryByRole('heading', { name: 'Clave temporal de Editor Demo' })).not.toBeInTheDocument();
  });

  it('un 400 con problemas de la clave se muestra en español', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: {
        'POST /usuarios/2/clave': () => respuestaJson({ message: 'Datos no válidos', problemas: ['clave: debe tener al menos 12 caracteres'] }, 400),
      },
    });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    expect(await within(panel).findByRole('alert')).toHaveTextContent('La clave temporal debe tener al menos 12 caracteres.');
  });

  it('un 403 de rol vuelve a leer la sesión', async () => {
    const usuario = userEvent.setup();
    const api = montar({
      extra: { 'POST /usuarios/2/clave': () => respuestaJson({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403) },
    });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    expect(await within(panel).findByRole('alert')).toHaveTextContent('solo los administradores pueden');
    await waitFor(() => expect(api.a('GET', '/auth/yo').length).toBeGreaterThan(1));
  });

  it('el servidor caído da un mensaje claro y deja volver a intentar', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /usuarios/2/clave': () => respuestaJson({ message: 'boom' }, 500) } });
    await esperarLista();
    const panel = await abrirPanel(usuario);
    await escribirClave(usuario, panel, CLAVE_DEL_MINIMO);
    await confirmar(usuario, panel);
    expect(await within(panel).findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    expect(within(panel).getByRole('button', { name: 'Sí, restablecer la clave' })).toBeEnabled();
  });
});
