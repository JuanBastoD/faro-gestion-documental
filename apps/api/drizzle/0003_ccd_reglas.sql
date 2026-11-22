-- Reglas del cuadro de clasificación que la base hace cumplir aunque el servicio falle:
--  1. El cuadro tiene dos niveles: una subserie cuelga de una serie, nunca de otra subserie,
--     y una serie con subseries no puede pasar a colgar de otra.
--  2. Solo las subseries admiten documentos, y una subserie con documentos no puede volver a ser serie.
CREATE FUNCTION "series_ccd_reglas"() RETURNS trigger AS $$
BEGIN
	IF NEW.padre_id IS NOT NULL THEN
		IF EXISTS (SELECT 1 FROM "series_ccd" WHERE id = NEW.padre_id AND padre_id IS NOT NULL) THEN
			RAISE EXCEPTION 'La serie % no puede colgar de una subserie (el cuadro tiene dos niveles)', NEW.codigo
				USING ERRCODE = 'check_violation';
		END IF;
		IF EXISTS (SELECT 1 FROM "series_ccd" WHERE padre_id = NEW.id) THEN
			RAISE EXCEPTION 'La serie % tiene subseries y no puede colgar de otra (el cuadro tiene dos niveles)', NEW.codigo
				USING ERRCODE = 'check_violation';
		END IF;
	ELSIF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "documentos" WHERE serie_id = NEW.id) THEN
		RAISE EXCEPTION 'La subserie % tiene documentos y no puede dejar de ser subserie', NEW.codigo
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "series_ccd_reglas"
	BEFORE INSERT OR UPDATE OF padre_id ON "series_ccd"
	FOR EACH ROW EXECUTE FUNCTION "series_ccd_reglas"();
--> statement-breakpoint
CREATE FUNCTION "documentos_solo_en_subseries"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "series_ccd" WHERE id = NEW.serie_id AND padre_id IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Los documentos solo se asocian a subseries (serie_id %)', NEW.serie_id
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "documentos_solo_en_subseries"
	BEFORE INSERT OR UPDATE OF serie_id ON "documentos"
	FOR EACH ROW EXECUTE FUNCTION "documentos_solo_en_subseries"();
