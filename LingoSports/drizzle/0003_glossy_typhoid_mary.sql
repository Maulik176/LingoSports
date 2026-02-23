CREATE TABLE "commentary_translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"commentary_id" integer NOT NULL,
	"target_locale" text NOT NULL,
	"quality" text DEFAULT 'standard' NOT NULL,
	"translated_message" text NOT NULL,
	"provider" text DEFAULT 'lingo' NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lingo_translation_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"commentary_id" integer,
	"source_locale" text NOT NULL,
	"target_locale" text NOT NULL,
	"quality" text DEFAULT 'standard' NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"fallback_reason" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commentary" ADD COLUMN "source_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "commentary_translations" ADD CONSTRAINT "commentary_translations_commentary_id_commentary_id_fk" FOREIGN KEY ("commentary_id") REFERENCES "public"."commentary"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lingo_translation_events" ADD CONSTRAINT "lingo_translation_events_commentary_id_commentary_id_fk" FOREIGN KEY ("commentary_id") REFERENCES "public"."commentary"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commentary_translations_unique_idx" ON "commentary_translations" USING btree ("commentary_id","target_locale","quality");--> statement-breakpoint
CREATE INDEX "commentary_translations_lookup_idx" ON "commentary_translations" USING btree ("target_locale","quality","created_at");--> statement-breakpoint
CREATE INDEX "lingo_translation_events_created_idx" ON "lingo_translation_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lingo_translation_events_status_idx" ON "lingo_translation_events" USING btree ("status");