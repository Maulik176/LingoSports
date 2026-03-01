export function envBoolEnabled(value, defaultEnabled = true) {
  if (value == null) return defaultEnabled;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultEnabled;
  return normalized !== '0' && normalized !== 'false';
}
