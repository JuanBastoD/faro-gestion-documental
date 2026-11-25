import { TAMANO_MAXIMO_BYTES } from '../api/documentos';
import { formatearTamano } from '../utilidades/formato';
import { Campo } from './Campo';

interface Propiedades {
  /** El archivo elegido (el navegador no deja controlar el valor de un campo de archivo: lo guarda quien lo usa). */
  archivo: File | null;
  error?: string;
  alCambiar: (archivo: File | null) => void;
}

/** Campo de archivo PDF de los formularios de carga y de versión nueva: etiqueta, ayuda con el límite y el archivo elegido. */
export function CampoArchivo({ archivo, error, alCambiar }: Propiedades) {
  return (
    <div className="campo-archivo">
      <Campo
        etiqueta="Archivo PDF"
        obligatorio
        ayuda={`Solo PDF, hasta ${TAMANO_MAXIMO_BYTES / (1024 * 1024)} MB. El servidor revisa que el contenido sea de verdad un PDF.`}
        error={error}
      >
        {(propiedades) => (
          <input
            {...propiedades}
            name="archivo"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(evento) => alCambiar(evento.target.files?.[0] ?? null)}
          />
        )}
      </Campo>
      {archivo && (
        <output className="campo-archivo__elegido">
          Elegido: <strong>{archivo.name}</strong> · {formatearTamano(archivo.size)}
        </output>
      )}
    </div>
  );
}
