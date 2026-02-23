import {
  index,
  uniqueIndex,
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

export const matchStatusEnum = pgEnum('match_status', [
  'scheduled',
  'live',
  'finished',
]);

export const matches = pgTable(
  'matches',
  {
    id: serial('id').primaryKey(),
    sport: text('sport').notNull(),
    homeTeam: text('home_team').notNull(),
    awayTeam: text('away_team').notNull(),
    status: matchStatusEnum('status').notNull().default('scheduled'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }),
    homeScore: integer('home_score').notNull().default(0),
    awayScore: integer('away_score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('matches_status_idx').on(table.status),
    index('matches_start_time_idx').on(table.startTime),
    index('matches_created_at_idx').on(table.createdAt),
  ]
);

export const commentary = pgTable(
  'commentary',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    minute: integer('minute').notNull(),
    sequence: integer('sequence').notNull(),
    period: text('period').notNull(),
    eventType: text('event_type').notNull(),
    actor: text('actor'),
    team: text('team'),
    message: text('message').notNull(),
    sourceLocale: text('source_locale').notNull().default('en'),
    metadata: jsonb('metadata'),
    tags: jsonb('tags'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('commentary_match_id_idx').on(table.matchId)]
);

export const commentaryTranslations = pgTable(
  'commentary_translations',
  {
    id: serial('id').primaryKey(),
    commentaryId: integer('commentary_id')
      .notNull()
      .references(() => commentary.id, { onDelete: 'cascade' }),
    targetLocale: text('target_locale').notNull(),
    quality: text('quality').notNull().default('standard'),
    translatedMessage: text('translated_message').notNull(),
    provider: text('provider').notNull().default('lingo'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('commentary_translations_unique_idx').on(
      table.commentaryId,
      table.targetLocale,
      table.quality
    ),
    index('commentary_translations_lookup_idx').on(
      table.targetLocale,
      table.quality,
      table.createdAt
    ),
  ]
);

export const lingoTranslationEvents = pgTable(
  'lingo_translation_events',
  {
    id: serial('id').primaryKey(),
    commentaryId: integer('commentary_id').references(() => commentary.id, {
      onDelete: 'set null',
    }),
    sourceLocale: text('source_locale').notNull(),
    targetLocale: text('target_locale').notNull(),
    quality: text('quality').notNull().default('standard'),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms'),
    fallbackReason: text('fallback_reason'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('lingo_translation_events_created_idx').on(table.createdAt),
    index('lingo_translation_events_status_idx').on(table.status),
  ]
);
