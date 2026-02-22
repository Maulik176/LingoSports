import { z } from 'zod';

const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:?\d{2})?)?$/i;

const isValidISODateString = (str) => {
  if (typeof str !== 'string') return false;
  if (!ISO8601_REGEX.test(str)) return false;
  const date = new Date(str);
  return !Number.isNaN(date.getTime());
};

export const listMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const MATCH_STATUS = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  FINISHED: 'finished',
};

export const matchIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createMatchSchema = z
  .object({
    sport: z.string().min(1, 'sport must be a non-empty string'),
    homeTeam: z.string().min(1, 'homeTeam must be a non-empty string'),
    awayTeam: z.string().min(1, 'awayTeam must be a non-empty string'),
    startTime: z.string().refine(isValidISODateString, {
      message: 'startTime must be a valid ISO date string',
    }),
    endTime: z.string().refine(isValidISODateString, {
      message: 'endTime must be a valid ISO date string',
    }),
    homeScore: z.coerce.number().int().min(0).optional(),
    awayScore: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startTime).getTime();
    const end = new Date(data.endTime).getTime();
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endTime must be chronologically after startTime',
        path: ['endTime'],
      });
    }
  });

export const updateScoreSchema = z.object({
  homeScore: z.coerce.number().int().min(0),
  awayScore: z.coerce.number().int().min(0),
});
