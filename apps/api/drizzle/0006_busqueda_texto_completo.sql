ALTER TABLE "documentos" ADD COLUMN "busqueda" "tsvector";--> statement-breakpoint
CREATE INDEX "documentos_busqueda_idx" ON "documentos" USING gin ("busqueda");--> statement-breakpoint
-- Los documentos que ya existen quedan buscables: mismo cálculo que `actualizarBusqueda` del servicio
-- (título A, expediente B, texto de la versión vigente C, primeros 300 000 caracteres). Sin la extensión
-- `unaccent`: las tildes de título y expediente se quitan con `translate`, y el texto ya está normalizado.
UPDATE "documentos" d SET "busqueda" =
  setweight(to_tsvector('spanish', translate(lower(d."titulo"), 'áéíóúüñ', 'aeiouun')), 'A') ||
  setweight(to_tsvector('spanish', translate(lower(d."expediente"), 'áéíóúüñ', 'aeiouun')), 'B') ||
  setweight(to_tsvector('spanish', coalesce((
    SELECT left(v."texto_normalizado", 300000) FROM "versiones" v
     WHERE v."documento_id" = d."id" ORDER BY v."numero" DESC LIMIT 1
  ), '')), 'C');
