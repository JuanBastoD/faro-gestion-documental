CREATE TABLE "intentos_ingreso" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intentos_ingreso_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario" text NOT NULL,
	"ip" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "intentos_ingreso_usuario_idx" ON "intentos_ingreso" USING btree ("usuario","creado_en");--> statement-breakpoint
CREATE INDEX "intentos_ingreso_ip_idx" ON "intentos_ingreso" USING btree ("ip","creado_en");