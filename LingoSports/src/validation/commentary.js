import { z } from 'zod';
import { QUALITY_VALUES, SUPPORTED_LOCALES } from '../lingo/locale-utils.js';

const localeSchema = z.enum(SUPPORTED_LOCALES);
const qualitySchema = z.enum(QUALITY_VALUES);

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  locale: localeSchema.optional(),
  quality: qualitySchema.optional(),
  beforeCreatedAt: z.string().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  includeSource: z
    .union([z.literal('0'), z.literal('1'), z.literal(0), z.literal(1)])
    .optional(),
}).superRefine((value, ctx) => {
  const hasBeforeCreatedAt = typeof value.beforeCreatedAt === 'string' && value.beforeCreatedAt.trim() !== '';
  const hasBeforeId = Number.isInteger(value.beforeId);
  if (hasBeforeCreatedAt !== hasBeforeId) {
    ctx.addIssue({
      code: 'custom',
      path: ['beforeCreatedAt'],
      message: 'beforeCreatedAt and beforeId must be provided together',
    });
  }
});

export const createCommentarySchema = z.object({
  minute: z.coerce.number().int().min(0),
  sequence: z.coerce.number().int().min(0),
  period: z.string(),
  eventType: z.string(),
  actor: z.string().optional().nullable(),
  team: z.string().optional().nullable(),
  message: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).optional(),
  sourceLocale: localeSchema.optional(),
  quality: qualitySchema.optional(),
  precompute: z.coerce.boolean().optional(),
  includeGlobalFanView: z.coerce.boolean().optional(),
});
