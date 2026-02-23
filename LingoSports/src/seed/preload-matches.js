import fs from 'node:fs/promises';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';
import { getMatchStatus } from '../utils/match-status.js';
import { and, eq, inArray } from 'drizzle-orm';

const DEFAULT_MATCH_DURATION_MINUTES = Number.parseInt(
  process.env.SEED_MATCH_DURATION_MINUTES || '120',
  10
);
const FORCE_LIVE =
  process.env.SEED_FORCE_LIVE !== '0' &&
  process.env.SEED_FORCE_LIVE !== 'false';
const DEFAULT_DATA_FILE = new URL('../data/data.json', import.meta.url);

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildMatchTimes(seedMatch) {
  const now = new Date();
  const durationMs = DEFAULT_MATCH_DURATION_MINUTES * 60 * 1000;

  let start = parseDate(seedMatch.startTime);
  let end = parseDate(seedMatch.endTime);

  if (!start && !end) {
    start = new Date(now.getTime() - 5 * 60 * 1000);
    end = new Date(start.getTime() + durationMs);
  } else {
    if (start && !end) {
      end = new Date(start.getTime() + durationMs);
    }
    if (!start && end) {
      start = new Date(end.getTime() - durationMs);
    }
  }

  if (FORCE_LIVE && start && end) {
    if (!(now >= start && now < end)) {
      start = new Date(now.getTime() - 5 * 60 * 1000);
      end = new Date(start.getTime() + durationMs);
    }
  }

  if (!start || !end) {
    throw new Error('Seed match must include valid startTime and endTime.');
  }

  return { startTime: start, endTime: end };
}

function matchKey(entry) {
  return `${entry.sport}|${entry.homeTeam}|${entry.awayTeam}`;
}

async function loadSeedMatches() {
  const raw = await fs.readFile(DEFAULT_DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.matches)) {
    return [];
  }
  return parsed.matches;
}

export async function preloadMatchesFromSeedData() {
  const seedMatches = await loadSeedMatches();
  if (seedMatches.length === 0) {
    return {
      inserted: 0,
      existing: 0,
      totalSeedMatches: 0,
    };
  }

  const seedMatchKeySet = new Set(seedMatches.map((seedMatch) => matchKey(seedMatch)));
  const existingMatches = await db.select().from(matches);
  const existingByKey = new Map();
  const staleIds = [];
  for (const existing of existingMatches) {
    const key = matchKey(existing);
    if (!seedMatchKeySet.has(key)) {
      staleIds.push(existing.id);
      continue;
    }
    if (existingByKey.has(key)) {
      staleIds.push(existing.id);
      continue;
    }
    existingByKey.set(key, existing);
  }

  if (staleIds.length > 0) {
    await db.delete(matches).where(inArray(matches.id, staleIds));
  }

  const rowsToInsert = [];
  for (const seedMatch of seedMatches) {
    const key = matchKey(seedMatch);
    if (existingByKey.has(key)) {
      continue;
    }

    const { startTime, endTime } = buildMatchTimes(seedMatch);
    const status = getMatchStatus(startTime, endTime) || 'live';

    rowsToInsert.push({
      sport: seedMatch.sport,
      homeTeam: seedMatch.homeTeam,
      awayTeam: seedMatch.awayTeam,
      startTime,
      endTime,
      homeScore: 0,
      awayScore: 0,
      status,
    });
  }

  if (rowsToInsert.length > 0) {
    await db.insert(matches).values(rowsToInsert);
  }

  let resetCount = 0;
  for (const seedMatch of seedMatches) {
    const { startTime, endTime } = buildMatchTimes(seedMatch);
    const status = getMatchStatus(startTime, endTime) || 'live';
    const updatedRows = await db
      .update(matches)
      .set({
        startTime,
        endTime,
        status,
        homeScore: 0,
        awayScore: 0,
      })
      .where(
        and(
          eq(matches.sport, seedMatch.sport),
          eq(matches.homeTeam, seedMatch.homeTeam),
          eq(matches.awayTeam, seedMatch.awayTeam)
        )
      )
      .returning({ id: matches.id });
    resetCount += updatedRows.length;
  }

  return {
    inserted: rowsToInsert.length,
    existing: seedMatches.length - rowsToInsert.length,
    pruned: staleIds.length,
    resetToZero: resetCount,
    totalSeedMatches: seedMatches.length,
  };
}
