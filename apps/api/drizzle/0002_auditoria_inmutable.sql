-- La auditoría no se edita ni se borra: ni por la API ni por una consulta suelta.
-- TRUNCATE no se bloquea a propósito (las pruebas vacían las tablas). En el despliegue,
-- la cuenta de base de datos que usa la API no debe tener permiso para vaciarla.
CREATE FUNCTION "auditoria_inmutable"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'La tabla auditoria no admite % (los eventos no se editan ni se borran)', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "auditoria_sin_cambios"
	BEFORE UPDATE OR DELETE ON "auditoria"
	FOR EACH ROW EXECUTE FUNCTION "auditoria_inmutable"();
