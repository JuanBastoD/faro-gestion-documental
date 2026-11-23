ALTER TABLE "versiones" DROP CONSTRAINT "versiones_documento_sha256_uq";--> statement-breakpoint
ALTER TABLE "versiones" ADD COLUMN "restaurada_de" integer;--> statement-breakpoint
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_restaurada_de_fk" FOREIGN KEY ("documento_id","restaurada_de") REFERENCES "public"."versiones"("documento_id","numero") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "versiones_documento_sha256_uq" ON "versiones" USING btree ("documento_id","sha256") WHERE "versiones"."restaurada_de" is null;--> statement-breakpoint
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_restaurada_anterior_ck" CHECK ("versiones"."restaurada_de" is null or "versiones"."restaurada_de" < "versiones"."numero");