import { z } from 'zod';

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
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
});
