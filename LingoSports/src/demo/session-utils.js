export const ACTIVE_DEMO_STATUSES = Object.freeze([
  'starting',
  'resetting',
  'seeding',
]);

export function isDemoSessionActive(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ACTIVE_DEMO_STATUSES.includes(normalized);
}

