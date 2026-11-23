ALTER TABLE "versiones" ADD COLUMN "texto_estado" text DEFAULT 'sin_texto' NOT NULL;--> statement-breakpoint
ALTER TABLE "versiones" ADD COLUMN "texto_normalizado" text;--> statement-breakpoint
ALTER TABLE "versiones" ADD COLUMN "firma" "bytea";--> statement-breakpoint
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_texto_estado_ck" CHECK ("versiones"."texto_estado" in ('ok', 'sin_texto'));--> statement-breakpoint
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_texto_coherente_ck" CHECK (("versiones"."texto_estado" = 'ok') = ("versiones"."texto_normalizado" is not null and "versiones"."firma" is not null));