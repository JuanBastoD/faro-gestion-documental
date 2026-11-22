CREATE TYPE "public"."rol_usuario" AS ENUM('administrador', 'editor', 'consulta');--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auditoria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" integer,
	"accion" text NOT NULL,
	"documento_id" integer,
	"detalle" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documentos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "documentos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"titulo" text NOT NULL,
	"expediente" text NOT NULL,
	"serie_id" integer NOT NULL,
	"fecha_documento" date NOT NULL,
	"creado_por" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_ccd" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "series_ccd_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"padre_id" integer,
	CONSTRAINT "series_ccd_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usuarios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario" text NOT NULL,
	"nombre" text NOT NULL,
	"rol" "rol_usuario" NOT NULL,
	"clave_hash" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_usuario_unique" UNIQUE("usuario")
);
--> statement-breakpoint
CREATE TABLE "versiones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "versiones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"documento_id" integer NOT NULL,
	"numero" integer NOT NULL,
	"archivo" text NOT NULL,
	"nombre_original" text NOT NULL,
	"sha256" text NOT NULL,
	"tamano" bigint NOT NULL,
	"motivo" text NOT NULL,
	"autor_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versiones_documento_numero_uq" UNIQUE("documento_id","numero"),
	CONSTRAINT "versiones_documento_sha256_uq" UNIQUE("documento_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_documento_id_documentos_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_serie_id_series_ccd_id_fk" FOREIGN KEY ("serie_id") REFERENCES "public"."series_ccd"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_ccd" ADD CONSTRAINT "series_ccd_padre_id_series_ccd_id_fk" FOREIGN KEY ("padre_id") REFERENCES "public"."series_ccd"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_documento_id_documentos_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_creado_en_idx" ON "auditoria" USING btree ("creado_en");--> statement-breakpoint
CREATE INDEX "documentos_serie_idx" ON "documentos" USING btree ("serie_id");--> statement-breakpoint
CREATE INDEX "documentos_expediente_idx" ON "documentos" USING btree ("expediente");--> statement-breakpoint
CREATE INDEX "versiones_sha256_idx" ON "versiones" USING btree ("sha256");