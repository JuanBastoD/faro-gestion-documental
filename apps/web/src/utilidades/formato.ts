const ZONA_HORARIA = 'America/Bogota';

const formatoFechaHora = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: ZONA_HORARIA,
});

const formatoFecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'UTC' });

const formatoDecimal = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Instante con hora (`creadoEn`), en la hora de Colombia: es la de quien usa el sistema. */
export function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : formatoFechaHora.format(fecha);
}

/** Fecha de calendario `AAAA-MM-DD` (`fechaDocumento`). Se lee como UTC para que la zona horaria no corra el día. */
export function formatearFecha(aaaammdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(aaaammdd)) return aaaammdd;
  const fecha = new Date(`${aaaammdd}T00:00:00Z`);
  // «2026-02-31» no es un error de Date (se corre al 3 de marzo): se compara para no mostrar una fecha distinta.
  return Number.isNaN(fecha.getTime()) || !fecha.toISOString().startsWith(aaaammdd)
    ? aaaammdd
    : formatoFecha.format(fecha);
}

/** Bytes en una unidad legible: `850 B`, `12,3 KB`, `4,0 MB`. */
export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatoDecimal.format(bytes / 1024)} KB`;
  return `${formatoDecimal.format(bytes / (1024 * 1024))} MB`;
}

/** Una espera en segundos como la diría una persona: `30 segundos`, `1 minuto`, `10 minutos`. */
export function formatearEspera(segundos: number): string {
  if (segundos < 60) {
    const s = Math.max(1, Math.ceil(segundos));
    return `${s} ${s === 1 ? 'segundo' : 'segundos'}`;
  }
  const minutos = Math.ceil(segundos / 60);
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
}
