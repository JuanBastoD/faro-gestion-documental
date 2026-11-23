import { origenPermitido, type DatosDeOrigen } from './origen.js';

const HOST = 'faro.ejemplo.app';

function peticion(parcial: Partial<DatosDeOrigen> = {}): DatosDeOrigen {
  return { metodo: 'POST', origin: undefined, host: HOST, secFetchSite: undefined, ...parcial };
}

describe('origenPermitido', () => {
  describe('métodos que no modifican datos', () => {
    it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s pasa aunque venga de otro sitio', (metodo) => {
      expect(origenPermitido(peticion({ metodo, origin: 'https://malo.example', secFetchSite: 'cross-site' }), [])).toBe(true);
    });
  });

  describe('con encabezado Origin', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s con el mismo Host pasa', (metodo) => {
      expect(origenPermitido(peticion({ metodo, origin: `https://${HOST}` }), [])).toBe(true);
    });

    it('con otro sitio se rechaza', () => {
      expect(origenPermitido(peticion({ origin: 'https://malo.example' }), [])).toBe(false);
    });

    it('un subdominio o un puerto distinto no es el mismo origen', () => {
      expect(origenPermitido(peticion({ origin: `https://x.${HOST}` }), [])).toBe(false);
      expect(origenPermitido(peticion({ origin: `https://${HOST}:8443` }), [])).toBe(false);
    });

    it('un dominio que solo CONTIENE el Host no engaña', () => {
      expect(origenPermitido(peticion({ origin: `https://${HOST}.malo.example` }), [])).toBe(false);
      expect(origenPermitido(peticion({ origin: `https://malo.example/${HOST}` }), [])).toBe(false);
    });

    it('compara el Host sin distinguir mayúsculas', () => {
      expect(origenPermitido(peticion({ origin: `https://${HOST}`, host: HOST.toUpperCase() }), [])).toBe(true);
    });

    it.each(['null', '', 'no es una url', 'file:///etc/passwd', 'chrome-extension://abc'])(
      'Origin «%s» no es un origen web y se rechaza',
      (origin) => {
        expect(origenPermitido(peticion({ origin }), [])).toBe(false);
      },
    );

    it('un origen de la lista de permitidos pasa aunque el Host sea otro', () => {
      expect(origenPermitido(peticion({ origin: 'https://app.ejemplo.com' }), ['https://app.ejemplo.com'])).toBe(true);
      expect(origenPermitido(peticion({ origin: 'https://otra.ejemplo.com' }), ['https://app.ejemplo.com'])).toBe(false);
    });

    it('sin Host solo pasa lo que esté en la lista', () => {
      expect(origenPermitido(peticion({ origin: `https://${HOST}`, host: undefined }), [])).toBe(false);
    });

    it('un Origin sospechoso se rechaza aunque Sec-Fetch-Site diga same-origin', () => {
      expect(origenPermitido(peticion({ origin: 'https://malo.example', secFetchSite: 'same-origin' }), [])).toBe(false);
    });
  });

  describe('sin Origin, con Sec-Fetch-Site', () => {
    it.each(['same-origin', 'none'])('%s pasa', (valor) => {
      expect(origenPermitido(peticion({ secFetchSite: valor }), [])).toBe(true);
    });

    it.each(['cross-site', 'same-site', ''])('«%s» se rechaza', (valor) => {
      expect(origenPermitido(peticion({ secFetchSite: valor }), [])).toBe(false);
    });
  });

  it('sin ninguno de los dos (no es un navegador) pasa', () => {
    expect(origenPermitido(peticion(), [])).toBe(true);
  });
});
