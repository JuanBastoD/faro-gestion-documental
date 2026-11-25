import { useId, type ReactNode } from 'react';

/** Lo que el control (input, textarea, select) debe recibir para quedar enlazado con su etiqueta, ayuda y error. */
export interface PropiedadesDeControl {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
}

interface PropiedadesDeCampo {
  etiqueta: string;
  /** Texto de apoyo bajo la etiqueta: qué se espera en el campo. */
  ayuda?: string;
  /** Mensaje de error del campo. Con error, el control queda marcado como no válido. */
  error?: string;
  obligatorio?: boolean;
  /** Sin «(obligatorio)» ni «(opcional)» junto a la etiqueta: para los filtros, donde todo es opcional y la marca sobra. */
  sinMarca?: boolean;
  /** Contador de caracteres («120 / 300»). */
  contador?: { actual: number; maximo: number };
  /** Recibe lo que hay que poner en el control; así la etiqueta, la ayuda y el error siempre apuntan al control correcto. */
  children: (propiedades: PropiedadesDeControl) => ReactNode;
}

/**
 * Un campo de formulario: etiqueta visible, ayuda, control, contador y error, todo enlazado para lectores de pantalla
 * (`for`/`id` y `aria-describedby`). El error aparece como texto (no solo con color) y marca el control con `aria-invalid`.
 */
export function Campo({ etiqueta, ayuda, error, obligatorio = false, sinMarca = false, contador, children }: PropiedadesDeCampo) {
  const base = useId();
  const idAyuda = `${base}-ayuda`;
  const idContador = `${base}-contador`;
  const idError = `${base}-error`;
  const descripcion = [ayuda && idAyuda, contador && idContador, error && idError].filter(Boolean).join(' ');

  return (
    <div className={error ? 'campo campo--con-error' : 'campo'}>
      <label htmlFor={base}>
        {etiqueta}
        {sinMarca ? null : obligatorio ? (
          <span className="campo__marca"> (obligatorio)</span>
        ) : (
          <span className="campo__marca"> (opcional)</span>
        )}
      </label>
      {ayuda && (
        <p id={idAyuda} className="campo__ayuda">
          {ayuda}
        </p>
      )}
      {children({
        id: base,
        'aria-describedby': descripcion === '' ? undefined : descripcion,
        'aria-invalid': error ? true : undefined,
        required: obligatorio ? true : undefined,
      })}
      {contador && (
        <p id={idContador} className={contador.actual > contador.maximo ? 'campo__contador campo__contador--excedido' : 'campo__contador'}>
          {contador.actual} / {contador.maximo} caracteres
        </p>
      )}
      {error && (
        <p id={idError} className="campo__error">
          {error}
        </p>
      )}
    </div>
  );
}
