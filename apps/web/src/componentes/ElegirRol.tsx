import { useId } from 'react';
import type { Rol } from '../api/auth';
import { DESCRIPCION_DE_ROL, ETIQUETA_DE_ROL, ROLES } from '../utilidades/roles';

interface Propiedades {
  valor: Rol;
  alCambiar: (rol: Rol) => void;
  error?: string;
  /** El rol que la persona tiene hoy, si ya existe: se marca como «actual». */
  actual?: Rol;
  /** El nombre accesible del grupo. */
  leyenda?: string;
}

/**
 * Los tres roles como opciones con lo que puede hacer cada uno (`docs/matriz-de-roles.md`): quien elige ve qué otorga, no solo
 * un nombre. El rol que se marca por omisión lo decide quien usa el componente (en el alta, el de menos permisos).
 */
export function ElegirRol({ valor, alCambiar, error, actual, leyenda = 'Rol' }: Propiedades) {
  const base = useId();
  return (
    <fieldset className="grupo" aria-describedby={error ? `${base}-error` : undefined}>
      <legend>{leyenda}</legend>
      {ROLES.map((rol) => (
        <div key={rol} className={rol === valor ? 'opcion opcion--activa' : 'opcion'}>
          <label>
            <input
              type="radio"
              name={`${base}-rol`}
              value={rol}
              checked={rol === valor}
              onChange={() => alCambiar(rol)}
              data-error={error && rol === valor ? 'true' : undefined}
              aria-describedby={`${base}-${rol}`}
            />
            <span className="opcion__titulo">
              {ETIQUETA_DE_ROL[rol]}
              {rol === actual && (
                <>
                  {/* El espacio va fuera del <span>: los lectores de pantalla (y el nombre accesible) lo pierden dentro. */}{' '}
                  <span className="campo__marca">(rol actual)</span>
                </>
              )}
            </span>
          </label>
          <p id={`${base}-${rol}`} className="opcion__efecto">
            {DESCRIPCION_DE_ROL[rol]}
          </p>
        </div>
      ))}
      {error && (
        <p id={`${base}-error`} className="campo__error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
