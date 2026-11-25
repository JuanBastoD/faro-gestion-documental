import { useEffect, useId, useRef, useState } from 'react';
import type { UsuarioAdministrado } from '../api/usuarios';

interface Propiedades {
  usuario: UsuarioAdministrado;
  clave: string;
  alCerrar: () => void;
}

/**
 * La clave temporal que acaba de fijar el administrador, a la vista UNA sola vez (#51 [PROPUESTA]): la API no la guarda en claro y
 * no hay forma de volver a verla, así que si se cierra sin copiarla hay que restablecerla otra vez. Está en un campo de solo
 * lectura (se puede seleccionar y copiar a mano con el teclado) y con un botón que la copia al portapapeles. Vive solo en el estado
 * de esta pantalla: no va a la URL, al historial ni al almacenamiento del navegador, y se borra al cerrar el aviso o salir.
 */
export function ClaveTemporal({ usuario, clave, alCerrar }: Propiedades) {
  const [copia, setCopia] = useState<'copiada' | 'fallida' | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const idTitulo = useId();
  const idClave = useId();

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  async function copiar() {
    try {
      if (!navigator.clipboard) throw new Error('Sin portapapeles');
      await navigator.clipboard.writeText(clave);
      setCopia('copiada');
    } catch {
      setCopia('fallida');
    }
  }

  return (
    <section className="clave-temporal" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} ref={titulo} tabIndex={-1}>
        Clave temporal de {usuario.nombre}
      </h2>
      <p>
        Se restableció la clave de {usuario.nombre} ({usuario.usuario}). Sus sesiones se cerraron y, al ingresar con esta clave, el
        sistema le pedirá elegir una propia.
      </p>
      <label htmlFor={idClave} className="clave-temporal__etiqueta">
        Clave temporal
      </label>
      <input
        id={idClave}
        className="clave-temporal__valor"
        type="text"
        readOnly
        value={clave}
        spellCheck={false}
        autoComplete="off"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="acciones">
        <button type="button" className="boton boton--primario" onClick={() => void copiar()}>
          Copiar la clave
        </button>
      </div>
      <output className="clave-temporal__estado">
        {copia === 'copiada' && 'Clave copiada. Pégala solo donde vayas a entregarla.'}
        {copia === 'fallida' && 'No se pudo copiar. Selecciona la clave del campo y cópiala a mano.'}
      </output>
      <p className="aviso aviso--info aviso--bloque">
        <strong>Esta es la única vez que se muestra.</strong> El sistema no la guarda y no puede volver a mostrarla: si la pierdes,
        restablece la clave otra vez. Entrégasela a {usuario.nombre} por otro medio, no en el mismo mensaje donde le dices su usuario.
      </p>
      <div className="acciones">
        <button type="button" className="boton boton--secundario" onClick={alCerrar}>
          Ya la copié, cerrar
        </button>
      </div>
    </section>
  );
}
