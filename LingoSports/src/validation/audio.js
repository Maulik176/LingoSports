import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../lingo/locale-utils.js';

const localeSchema = z.enum(SUPPORTED_LOCALES);

export const createSpeechRequestSchema = z.object({
  input: z.string().trim().min(1).max(1200),
  locale: localeSchema.optional(),
  rate: z.coerce.number().min(0.75).max(1.5).optional(),
  style: z.string().trim().min(1).max(80).optional(),
}).strict();

export const createVoiceAgentSessionSchema = z.object({
  offerSdp: z.string().trim().min(32).max(120000),
  locale: localeSchema.optional(),
  style: z.string().trim().min(1).max(80).optional(),
}).strict();
