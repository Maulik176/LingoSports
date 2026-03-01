const MATCH_STATUS_PRIORITY = {
  live: 0,
  scheduled: 1,
  finished: 2,
};

const EVENT_STYLES = {
  goal: 'good',
  wicket: 'good',
  six: 'good',
  four: 'good',
  ace: 'good',
  spike: 'good',
  block: 'good',
  yellow_card: 'warn',
  foul: 'warn',
  substitution: 'warn',
  set_point: 'warn',
  set_end: 'warn',
  red_card: 'danger',
};

const DEFAULT_MESSAGES = {
  'hero.eyebrow': 'Realtime Sports Engine',
  'hero.subtitle': 'Multilingual commentary and scores',
  'controls.language': 'Language',
  'controls.theme': 'Theme',
  'controls.speed': 'Speed',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'demo.start': 'Start Live Demo',
  'demo.starting': 'Demo starting...',
  'demo.ready': 'Demo ready',
  'demo.failed': 'Demo failed',
  'demo.idle': 'Demo idle',
  'demo.lingoProof': 'Lingo Proof',
  'connection.connected': 'LIVE CONNECTED',
  'connection.reconnecting': 'RECONNECTING',
  'connection.connecting': 'CONNECTING',
  'matches.title': 'Current Matches',
  'matches.allSports': 'All Sports',
  'matches.apiCount': 'API',
  'matches.watch': 'Watch Live',
  'matches.watching': 'Watching Live',
  'matches.close': 'Close',
  'matches.noAvailable': 'No matches available right now.',
  'matches.loadingError': 'Could not load matches. Check if backend is running.',
  'matches.timeTbd': 'TBD',
  'status.live': 'Live',
  'status.finished': 'Finished',
  'status.scheduled': 'Scheduled',
  'commentary.title': 'Live Commentary',
  'commentary.realtime': 'Real-time',
  'commentary.selectPrompt': 'Select a match to start streaming commentary.',
  'commentary.loading': 'Loading commentary...',
  'commentary.empty': 'No commentary yet.',
  'commentary.emptyFor': 'No commentary yet for {team}.',
  'commentary.update': 'Update',
  'commentary.translating': 'Translating...',
  'commentary.translatingAll': 'Translating commentary for this language...',
  'commentary.translationUnavailable': 'Translation unavailable right now.',
  'commentary.loadOlder': 'Load older commentary',
  'commentary.loadingOlder': 'Loading older commentary...',
  'audio.listen': 'Listen',
  'audio.stop': 'Stop',
  'audio.ready': 'Audio ready',
  'audio.disabled': 'Audio disabled',
  'audio.featureOff': 'Audio mode disabled by configuration.',
  'audio.speaking': 'Speaking live commentary',
  'audio.waitingTranslation': 'Waiting for translated commentary...',
  'audio.hypeReady': 'Hype commentator ready',
  'audio.hypeSpeaking': 'Hype commentator live',
  'audio.hypeConnecting': 'Connecting hype commentator...',
  'audio.hypeFallback': 'Realtime voice unavailable, using generated audio.',
  'audio.browserFallback': 'Using browser voice fallback.',
  'audio.unavailable': 'Audio unavailable in this browser.',
  'translation.cached': 'Cached',
  'translation.live': 'Live translated',
  'translation.fallback': 'Fallback source',
  'translation.pending': 'Translating',
  'translation.source': 'Source locale',
  'common.thisMatch': 'this match',
  'sport.football': 'Football',
  'sport.cricket': 'Cricket',
  'sport.basketball': 'Basketball',
  'sport.volleyball': 'Volleyball',
};

const LANGUAGE_LABELS = {
  en: 'English',
  es: 'Espanol',
  fr: 'Francais',
  de: 'Deutsch',
  hi: 'Hindi',
  ar: 'Arabic',
  ja: 'Japanese',
  pt: 'Portugues',
};

const RUNTIME_CONFIG = globalThis.__LINGOSPORTS_CONFIG || {};
const API_BASE_URL = String(RUNTIME_CONFIG.apiBaseUrl || '').replace(/\/$/, '');
const WS_BASE_URL = String(RUNTIME_CONFIG.wsBaseUrl || '').trim();

const SUPPORTED_LOCALES = Array.isArray(RUNTIME_CONFIG.supportedLocales)
  ? RUNTIME_CONFIG.supportedLocales
      .map((locale) => String(locale || '').trim().toLowerCase().split(/[-_]/)[0])
      .filter(Boolean)
  : ['en', 'es', 'fr', 'de', 'hi', 'ar', 'ja', 'pt'];
const DEFAULT_LOCALE = SUPPORTED_LOCALES.includes('en')
  ? 'en'
  : (SUPPORTED_LOCALES[0] || 'en');
const INITIAL_LOCALE = normalizeLocale(RUNTIME_CONFIG.locale, DEFAULT_LOCALE);
const RAW_MESSAGES_BY_LOCALE =
  RUNTIME_CONFIG.messagesByLocale && typeof RUNTIME_CONFIG.messagesByLocale === 'object'
    ? RUNTIME_CONFIG.messagesByLocale
    : {};
const DEFAULT_QUALITY = ['fast', 'standard'].includes(
  String(RUNTIME_CONFIG.quality || 'standard').trim().toLowerCase()
)
  ? String(RUNTIME_CONFIG.quality || 'standard').trim().toLowerCase()
  : 'standard';
const V2_AUDIO_ENABLED = String(RUNTIME_CONFIG.v2AudioEnabled ?? 'true').trim().toLowerCase() !== '0'
  && String(RUNTIME_CONFIG.v2AudioEnabled ?? 'true').trim().toLowerCase() !== 'false';
const OPENAI_VOICE_AGENT_ENABLED = String(
  RUNTIME_CONFIG.openAiVoiceAgentEnabled ?? 'false'
).trim().toLowerCase() !== '0'
  && String(RUNTIME_CONFIG.openAiVoiceAgentEnabled ?? 'false').trim().toLowerCase() !== 'false';
const OPENAI_TTS_ENABLED = String(RUNTIME_CONFIG.openAiTtsEnabled ?? 'false').trim().toLowerCase() !== '0'
  && String(RUNTIME_CONFIG.openAiTtsEnabled ?? 'false').trim().toLowerCase() !== 'false';
const OPENAI_TTS_STYLE = 'hype commentator';
const OPENAI_VOICE_AGENT_STYLE = 'hype commentator';
const OPENAI_VOICE_AGENT_CONNECT_TIMEOUT_MS = 12000;
const OPENAI_VOICE_AGENT_RESPONSE_TIMEOUT_MS = 18000;
const OPENAI_AGENT_SESSION_TIMEOUT_MS = 10000;
const OPENAI_TTS_REQUEST_TIMEOUT_MS = 10000;
const THEME_STORAGE_KEY = 'lingosports.theme';
const LOCALE_STORAGE_KEY = 'lingosports.locale';
const SUPPORTED_AUDIO_RATES = new Set([1, 1.25]);
const INITIAL_COMMENTARY_LIMIT = 25;
const COMMENTARY_PAGE_LIMIT = 25;

const state = {
  locale: INITIAL_LOCALE,
  quality: DEFAULT_QUALITY,
  theme: resolveInitialTheme(),
  matches: [],
  selectedMatchId: null,
  sportFilter: 'all',
  commentaryByMatchId: new Map(),
  commentaryCursorByMatchId: new Map(),
  commentaryHasMoreByMatchId: new Map(),
  loadingCommentary: false,
  loadingOlderCommentary: false,
  socket: null,
  socketConnected: false,
  reconnectAttempts: 0,
  subscribedMatchId: null,
  commentaryRequestToken: 0,
  pendingTranslationIds: new Set(),
  localeSwitchPending: false,
  demoSessionId: null,
  demoStatus: 'idle',
  demoPollTimer: null,
  audio: {
    supported: false,
    browserSupported: false,
    voiceAgentSupported: false,
    enabled: false,
    rate: 1,
    status: 'ready',
    provider: OPENAI_VOICE_AGENT_ENABLED ? 'openai-agent' : (OPENAI_TTS_ENABLED ? 'openai' : 'browser'),
    voiceAgentEnabled: OPENAI_VOICE_AGENT_ENABLED,
    openAiEnabled: OPENAI_TTS_ENABLED,
    usedGeneratedFallback: false,
    usedFallbackVoice: false,
    queue: [],
    speaking: false,
    currentAudio: null,
    currentAudioUrl: null,
    agentPeerConnection: null,
    agentDataChannel: null,
    agentAudioElement: null,
    agentConnecting: false,
    agentConnected: false,
    agentConnectPromise: null,
    agentPendingResolve: null,
    agentPendingReject: null,
    agentPendingTimeoutId: null,
    seenCommentaryIds: new Set(),
  },
};
let activeMessages = resolveMessagesForLocale(state.locale);
let demoStartInFlight = null;

const elements = {
  heroEyebrow: document.querySelector('#hero-eyebrow'),
  heroSubtitle: document.querySelector('#hero-subtitle'),
  languageLabel: document.querySelector('#language-label'),
  languageSelect: document.querySelector('#language-select'),
  themeToggle: document.querySelector('#theme-toggle'),
  themeToggleLabel: document.querySelector('#theme-toggle-label'),
  themeToggleValue: document.querySelector('#theme-toggle-value'),
  demoStartButton: document.querySelector('#demo-start-button'),
  demoStartText: document.querySelector('#demo-start-text'),
  demoStatusPill: document.querySelector('#demo-status-pill'),
  matchesGrid: document.querySelector('#matches-grid'),
  commentaryList: document.querySelector('#commentary-list'),
  matchesTitle: document.querySelector('#matches-title'),
  sportFilterLabel: document.querySelector('#sport-filter-label'),
  commentaryTitle: document.querySelector('#commentary-title'),
  realtimePill: document.querySelector('#realtime-pill'),
  apiCount: document.querySelector('#api-count'),
  sportFilter: document.querySelector('#sport-filter'),
  connectionPill: document.querySelector('#connection-pill'),
  connectionText: document.querySelector('#connection-text'),
  listenToggle: document.querySelector('#listen-toggle'),
  listenSpeed: document.querySelector('#listen-speed'),
  audioStatus: document.querySelector('#audio-status'),
};

function normalizeLocale(locale, fallback = DEFAULT_LOCALE) {
  if (typeof locale !== 'string') return fallback;
  const normalized = locale.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : fallback;
}

function normalizeTheme(theme, fallback = 'light') {
  const normalized = String(theme || '')
    .trim()
    .toLowerCase();
  if (normalized === 'light' || normalized === 'dark') return normalized;
  return fallback;
}

function resolveInitialTheme() {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme) return normalizeTheme(storedTheme, 'light');
  } catch {
    // Ignore localStorage restrictions.
  }

  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore matchMedia failures.
  }

  return 'light';
}

function resolveStoredLocale() {
  try {
    const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (storedLocale) {
      return normalizeLocale(storedLocale, INITIAL_LOCALE);
    }
  } catch {
    // Ignore localStorage restrictions.
  }
  return INITIAL_LOCALE;
}

function detectBrowserSpeechSupport() {
  try {
    return typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance !== 'undefined';
  } catch {
    return false;
  }
}

function detectOpenAiVoiceAgentSupport() {
  try {
    return typeof window !== 'undefined'
      && typeof window.RTCPeerConnection !== 'undefined'
      && typeof window.Audio !== 'undefined';
  } catch {
    return false;
  }
}

function detectOpenAiAudioSupport() {
  try {
    return typeof window !== 'undefined'
      && typeof window.Audio !== 'undefined'
      && typeof window.URL !== 'undefined'
      && typeof window.URL.createObjectURL === 'function';
  } catch {
    return false;
  }
}

function syncThemeToggle() {
  if (!elements.themeToggle) return;

  const isDark = state.theme === 'dark';
  const label = t('controls.theme', 'Theme');
  const modeLabel = isDark ? t('theme.dark', 'Dark') : t('theme.light', 'Light');
  const nextModeLabel = isDark ? t('theme.light', 'Light') : t('theme.dark', 'Dark');

  if (elements.themeToggleLabel) {
    elements.themeToggleLabel.textContent = label;
  }
  if (elements.themeToggleValue) {
    elements.themeToggleValue.textContent = modeLabel;
  }

  elements.themeToggle.setAttribute('aria-pressed', String(isDark));
  elements.themeToggle.setAttribute('aria-label', `${label}: ${modeLabel}. Toggle to ${nextModeLabel}.`);
}

function applyTheme(nextTheme, { persist = true } = {}) {
  const normalized = normalizeTheme(nextTheme, 'light');
  state.theme = normalized;
  document.documentElement.dataset.theme = normalized;
  syncThemeToggle();

  if (!persist) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // Ignore localStorage restrictions.
  }
}

function resolveMessagesForLocale(locale) {
  const normalized = normalizeLocale(locale, DEFAULT_LOCALE);
  const fallbackMessages =
    RAW_MESSAGES_BY_LOCALE[DEFAULT_LOCALE] && typeof RAW_MESSAGES_BY_LOCALE[DEFAULT_LOCALE] === 'object'
      ? RAW_MESSAGES_BY_LOCALE[DEFAULT_LOCALE]
      : {};
  const localeMessages =
    RAW_MESSAGES_BY_LOCALE[normalized] && typeof RAW_MESSAGES_BY_LOCALE[normalized] === 'object'
      ? RAW_MESSAGES_BY_LOCALE[normalized]
      : {};

  return {
    ...DEFAULT_MESSAGES,
    ...fallbackMessages,
    ...localeMessages,
  };
}

function getMessage(key) {
  const value = activeMessages?.[key];
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;
  return value;
}

function t(key, fallback) {
  return getMessage(key) ?? fallback;
}

function formatTemplate(template, values = {}) {
  let output = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{${key}}`, String(value ?? ''));
  }
  return output;
}

function resolveApiUrl(pathname) {
  if (!pathname) return API_BASE_URL;
  if (/^https?:\/\//i.test(pathname)) return pathname;
  if (API_BASE_URL) {
    return `${API_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }
  return pathname;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, Math.max(1000, Number(timeoutMs) || 10000));

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.max(1000, Number(timeoutMs) || 10000)}ms`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function resolveWsUrl() {
  if (WS_BASE_URL) {
    return WS_BASE_URL;
  }

  if (API_BASE_URL) {
    const httpUrl = new URL(API_BASE_URL);
    const protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${httpUrl.host}/ws`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function normalizeWsScheme(urlString) {
  if (!urlString) return urlString;
  if (window.location.protocol === 'https:' && urlString.startsWith('ws://')) {
    return `wss://${urlString.slice('ws://'.length)}`;
  }
  return urlString;
}

function swapLocalhostAlias(urlString) {
  try {
    const url = new URL(urlString);
    if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost';
      return url.toString();
    }
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function buildWsCandidates() {
  const candidates = [];
  const pushCandidate = (value) => {
    if (!value) return;
    const normalized = normalizeWsScheme(value);
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  const primary = resolveWsUrl();
  pushCandidate(primary);

  const alias = swapLocalhostAlias(primary);
  pushCandidate(alias);

  if (API_BASE_URL) {
    try {
      const apiUrl = new URL(API_BASE_URL);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      pushCandidate(`${protocol}//${apiUrl.host}/ws`);
    } catch {
      // Ignore invalid API URL formatting.
    }
  }

  const pageProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  pushCandidate(`${pageProtocol}//${window.location.host}/ws`);

  return candidates.length ? candidates : [resolveWsUrl()];
}

function setDocumentLocale(locale) {
  const normalized = normalizeLocale(locale, DEFAULT_LOCALE);
  document.documentElement.lang = normalized;
  document.documentElement.dir = normalized === 'ar' ? 'rtl' : 'ltr';
}

function isTranslationPendingEntry(entry) {
  if (!entry || !entry.translation) return false;
  if (entry.translation.status !== 'fallback-source') return false;
  const { entryLocale, sourceLocale } = localePairForEntry(entry);
  if (entryLocale === sourceLocale) return false;
  return entry.translation.fallbackReason === 'not_precomputed';
}

function localePairForEntry(entry) {
  const entryLocale = normalizeLocale(entry?.locale || state.locale, state.locale);
  const sourceLocale = normalizeLocale(
    entry?.sourceLocale || entry?.source_locale || entryLocale,
    entryLocale
  );

  return { entryLocale, sourceLocale };
}

function isNonSourceFallbackEntry(entry) {
  const translationStatus = String(entry?.translation?.status || '').trim().toLowerCase();
  if (translationStatus !== 'fallback-source') return false;

  const { entryLocale, sourceLocale } = localePairForEntry(entry);
  return entryLocale !== sourceLocale;
}

function shouldRenderAsTranslating(entry) {
  if (!isNonSourceFallbackEntry(entry)) return false;
  const entryId = Number(entry?.id);
  if (Number.isInteger(entryId) && state.pendingTranslationIds.has(entryId)) {
    return true;
  }
  if (isTranslationPendingEntry(entry)) return true;

  const fallbackReason = String(entry?.translation?.fallbackReason || '').trim().toLowerCase();
  if (!fallbackReason) return false;
  return fallbackReason.startsWith('temporary_outage_cooldown_');
}

function resolveCommentaryMessage(entry) {
  if (shouldRenderAsTranslating(entry)) {
    return t('commentary.translating', 'Translating...');
  }
  if (isNonSourceFallbackEntry(entry)) {
    return t('commentary.translationUnavailable', 'Translation unavailable right now.');
  }
  return String(entry?.message || t('commentary.update', 'Update'));
}

function markTranslationPending(entry) {
  const entryId = Number(entry?.id);
  if (!Number.isInteger(entryId)) return;
  if (!isTranslationPendingEntry(entry)) return;
  state.pendingTranslationIds.add(entryId);
  syncTranslationLoadingState();
}

function clearTranslationPending(entryId) {
  const normalizedId = Number(entryId);
  if (!Number.isInteger(normalizedId)) return;
  state.pendingTranslationIds.delete(normalizedId);
  syncTranslationLoadingState();
}

function getSelectedCommentaryEntries() {
  if (!Number.isInteger(state.selectedMatchId)) return [];
  const entries = state.commentaryByMatchId.get(state.selectedMatchId);
  return Array.isArray(entries) ? entries : [];
}

function isEntryPendingForLocale(entry) {
  const entryId = Number(entry?.id);
  if (Number.isInteger(entryId) && state.pendingTranslationIds.has(entryId)) {
    return true;
  }
  return isTranslationPendingEntry(entry);
}

function hasPendingTranslationsForSelectedMatch() {
  const entries = getSelectedCommentaryEntries();
  if (entries.length === 0) return false;
  return entries.some((entry) => isEntryPendingForLocale(entry));
}

function shouldShowLocaleTranslationOverlay() {
  if (!state.localeSwitchPending) return false;
  if (state.loadingCommentary) return true;
  const entries = getSelectedCommentaryEntries();
  if (entries.length === 0) return false;
  return entries.some((entry) => isEntryPendingForLocale(entry));
}

function syncTranslationLoadingState() {
  if (!Number.isInteger(state.selectedMatchId)) {
    state.localeSwitchPending = false;
  } else if (
    state.localeSwitchPending
    && !state.loadingCommentary
    && !hasPendingTranslationsForSelectedMatch()
  ) {
    state.localeSwitchPending = false;
  }

  const shouldOverlay = shouldShowLocaleTranslationOverlay();
  if (elements.commentaryList) {
    elements.commentaryList.classList.toggle('locale-translating', shouldOverlay);
    elements.commentaryList.dataset.overlayText = t(
      'commentary.translatingAll',
      'Translating commentary for this language...'
    );
    elements.commentaryList.setAttribute('aria-busy', String(shouldOverlay));
  }

  updateAudioStatus();
}

function replaceLocaleInPath(locale) {
  try {
    const normalized = normalizeLocale(locale, DEFAULT_LOCALE);
    const current = new URL(window.location.href);
    const segments = current.pathname.split('/').filter(Boolean);

    if (segments.length > 0 && SUPPORTED_LOCALES.includes(segments[0])) {
      segments[0] = normalized;
    } else {
      segments.unshift(normalized);
    }

    const nextPath = `/${segments.join('/')}`;
    const nextUrl = `${nextPath}${current.search}${current.hash}`;
    if (`${current.pathname}${current.search}${current.hash}` !== nextUrl) {
      window.history.replaceState({}, '', nextUrl);
    }
  } catch {
    // Ignore URL parsing failures.
  }
}

function languageLabel(locale) {
  const normalized = normalizeLocale(locale, DEFAULT_LOCALE);
  return LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
}

function translateSportLabel(value) {
  const normalized = normalizeSport(value);
  return t(`sport.${normalized}`, String(value ?? '').trim());
}

function applyStaticTranslations() {
  if (elements.heroEyebrow) {
    elements.heroEyebrow.textContent = t('hero.eyebrow', 'Realtime Sports Engine');
  }
  if (elements.heroSubtitle) {
    elements.heroSubtitle.textContent = t('hero.subtitle', 'Multilingual commentary and scores');
  }
  if (elements.languageLabel) {
    elements.languageLabel.textContent = t('controls.language', 'Language');
  }
  if (elements.matchesTitle) {
    elements.matchesTitle.textContent = t('matches.title', 'Current Matches');
  }
  if (elements.sportFilterLabel) {
    elements.sportFilterLabel.textContent = t('controls.sport', 'Sport');
  }
  if (elements.commentaryTitle) {
    elements.commentaryTitle.textContent = t('commentary.title', 'Live Commentary');
  }
  if (elements.realtimePill) {
    elements.realtimePill.textContent = t('commentary.realtime', 'Real-time');
  }
  if (elements.demoStartText) {
    elements.demoStartText.textContent = state.demoStatus === 'starting'
      ? t('demo.starting', 'Demo starting...')
      : t('demo.start', 'Start Live Demo');
  }
  if (elements.listenToggle) {
    elements.listenToggle.textContent = state.audio.enabled
      ? t('audio.stop', 'Stop')
      : t('audio.listen', 'Listen');
  }
  syncThemeToggle();
  updateDemoStatusPill(state.demoStatus);
  updateAudioStatus();
}

function syncLanguageSelect() {
  if (!elements.languageSelect) return;

  const optionHtml = SUPPORTED_LOCALES.map((locale) =>
    `<option value="${escapeHtml(locale)}">${escapeHtml(languageLabel(locale))}</option>`
  ).join('');
  elements.languageSelect.innerHTML = optionHtml;
  elements.languageSelect.value = state.locale;
}

function updateDemoStatusPill(status = 'idle') {
  if (!elements.demoStatusPill) return;
  const normalized = String(status || 'idle').trim().toLowerCase();
  state.demoStatus = normalized;

  let text = t('demo.idle', 'Demo idle');
  elements.demoStatusPill.classList.remove('ready', 'error');

  if (normalized === 'starting' || normalized === 'resetting' || normalized === 'seeding') {
    text = t('demo.starting', 'Demo starting...');
  } else if (normalized === 'ready') {
    text = t('demo.ready', 'Demo ready');
    elements.demoStatusPill.classList.add('ready');
  } else if (normalized === 'failed') {
    text = t('demo.failed', 'Demo failed');
    elements.demoStatusPill.classList.add('error');
  }

  elements.demoStatusPill.textContent = text;
  if (elements.demoStartText) {
    elements.demoStartText.textContent = normalized === 'starting' || normalized === 'resetting' || normalized === 'seeding'
      ? t('demo.starting', 'Demo starting...')
      : t('demo.start', 'Start Live Demo');
  }
}

function updateAudioStatus() {
  if (!elements.audioStatus) return;
  elements.audioStatus.classList.remove('warn', 'error');

  let message = t('audio.ready', 'Audio ready');
  const waitingForTranslation = state.audio.enabled
    && state.audio.supported
    && (state.localeSwitchPending || hasPendingTranslationsForSelectedMatch());
  if (!V2_AUDIO_ENABLED) {
    message = t('audio.featureOff', 'Audio mode disabled by configuration.');
    elements.audioStatus.classList.add('warn');
  } else if (!state.audio.supported) {
    message = t('audio.unavailable', 'Audio unavailable in this browser.');
    elements.audioStatus.classList.add('warn');
  } else if (!state.audio.enabled) {
    message = t('audio.disabled', 'Audio disabled');
  } else if (state.audio.status === 'error') {
    message = t('audio.unavailable', 'Audio unavailable in this browser.');
    elements.audioStatus.classList.add('error');
  } else if (state.audio.agentConnecting) {
    message = t('audio.hypeConnecting', 'Connecting hype commentator...');
    elements.audioStatus.classList.add('warn');
  } else if (state.audio.speaking) {
    message = state.audio.provider === 'openai' || state.audio.provider === 'openai-agent'
      ? t('audio.hypeSpeaking', 'Hype commentator live')
      : t('audio.speaking', 'Speaking live commentary');
  } else if (waitingForTranslation) {
    message = t('audio.waitingTranslation', 'Waiting for translated commentary...');
    elements.audioStatus.classList.add('warn');
  } else if (state.audio.usedGeneratedFallback) {
    message = t('audio.hypeFallback', 'Realtime voice unavailable, using generated audio.');
    elements.audioStatus.classList.add('warn');
  } else if (
    (state.audio.voiceAgentEnabled && state.audio.agentConnected)
    || (state.audio.openAiEnabled && !state.audio.usedFallbackVoice)
  ) {
    message = t('audio.hypeReady', 'Hype commentator ready');
  } else if (state.audio.usedFallbackVoice) {
    message = t('audio.browserFallback', 'Using browser voice fallback.');
    elements.audioStatus.classList.add('warn');
  }

  elements.audioStatus.textContent = message;

  if (elements.listenToggle) {
    elements.listenToggle.textContent = state.audio.enabled
      ? t('audio.stop', 'Stop')
      : t('audio.listen', 'Listen');
    elements.listenToggle.classList.toggle('active', state.audio.enabled);
    elements.listenToggle.setAttribute('aria-pressed', String(state.audio.enabled));
  }
}

function normalizeAudioRate(value) {
  const parsed = Number.parseFloat(String(value ?? '1'));
  if (!Number.isFinite(parsed)) return 1;
  return SUPPORTED_AUDIO_RATES.has(parsed) ? parsed : 1;
}

function resolveSpeechLocale(locale) {
  const normalized = normalizeLocale(locale, DEFAULT_LOCALE);
  const map = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    hi: 'hi-IN',
    ar: 'ar-SA',
    ja: 'ja-JP',
    pt: 'pt-BR',
  };
  return map[normalized] || 'en-US';
}

function clearCurrentAudioElement() {
  if (state.audio.currentAudio) {
    try {
      state.audio.currentAudio.pause();
      state.audio.currentAudio.src = '';
    } catch {
      // Ignore browser audio element errors.
    }
    state.audio.currentAudio = null;
  }
  if (state.audio.currentAudioUrl) {
    try {
      URL.revokeObjectURL(state.audio.currentAudioUrl);
    } catch {
      // Ignore URL revoke failures.
    }
    state.audio.currentAudioUrl = null;
  }
}

function createAudioRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clearVoiceAgentPendingTimeout() {
  if (state.audio.agentPendingTimeoutId == null) return;
  window.clearTimeout(state.audio.agentPendingTimeoutId);
  state.audio.agentPendingTimeoutId = null;
}

function resolvePendingVoiceAgentRequest(payload = null) {
  const resolve = state.audio.agentPendingResolve;
  state.audio.agentPendingResolve = null;
  state.audio.agentPendingReject = null;
  clearVoiceAgentPendingTimeout();
  if (typeof resolve === 'function') {
    resolve(payload);
  }
}

function rejectPendingVoiceAgentRequest(message = 'Voice agent request failed') {
  const reject = state.audio.agentPendingReject;
  state.audio.agentPendingResolve = null;
  state.audio.agentPendingReject = null;
  clearVoiceAgentPendingTimeout();
  if (typeof reject === 'function') {
    reject(new Error(message));
  }
}

function clearVoiceAgentConnection() {
  rejectPendingVoiceAgentRequest('Voice agent session reset');

  if (state.audio.agentDataChannel) {
    try {
      if (state.audio.agentDataChannel.readyState !== 'closed') {
        state.audio.agentDataChannel.close();
      }
    } catch {
      // Ignore data channel close failures.
    }
    state.audio.agentDataChannel = null;
  }

  if (state.audio.agentPeerConnection) {
    try {
      state.audio.agentPeerConnection.close();
    } catch {
      // Ignore peer connection close failures.
    }
    state.audio.agentPeerConnection = null;
  }

  if (state.audio.agentAudioElement) {
    try {
      state.audio.agentAudioElement.pause();
      state.audio.agentAudioElement.srcObject = null;
      state.audio.agentAudioElement.removeAttribute('src');
    } catch {
      // Ignore audio element cleanup failures.
    }
    state.audio.agentAudioElement = null;
  }

  state.audio.agentConnected = false;
  state.audio.agentConnecting = false;
  state.audio.agentConnectPromise = null;
}

function markVoiceAgentOffline(message = 'Voice agent disconnected') {
  state.audio.agentConnected = false;
  state.audio.agentConnecting = false;
  if (state.audio.provider === 'openai-agent') {
    state.audio.provider = state.audio.openAiEnabled ? 'openai' : 'browser';
  }
  rejectPendingVoiceAgentRequest(message);
  updateAudioStatus();
}

function handleVoiceAgentMessage(rawPayload) {
  let payload;
  try {
    payload = JSON.parse(String(rawPayload || ''));
  } catch {
    return;
  }

  const eventType = String(payload?.type || '').trim().toLowerCase();
  if (!eventType) return;

  if (eventType === 'response.done' || eventType === 'response.completed') {
    resolvePendingVoiceAgentRequest(payload);
    return;
  }

  if (eventType === 'response.failed' || eventType === 'error' || eventType === 'response.cancelled') {
    const details =
      payload?.error?.message
      || payload?.response?.status_details?.error?.message
      || payload?.response?.status
      || 'Voice agent response failed';
    rejectPendingVoiceAgentRequest(String(details));
  }
}

function waitForIceGatheringComplete(peerConnection, timeoutMs = 1200) {
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const onStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete' && !settled) {
        settled = true;
        window.clearTimeout(timeoutId);
        peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
      resolve();
    }, timeoutMs);

    peerConnection.addEventListener('icegatheringstatechange', onStateChange);
  });
}

function waitForDataChannelOpen(dataChannel, timeoutMs = OPENAI_VOICE_AGENT_CONNECT_TIMEOUT_MS) {
  if (dataChannel.readyState === 'open') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      dataChannel.removeEventListener('open', onOpen);
      dataChannel.removeEventListener('error', onError);
      dataChannel.removeEventListener('close', onClose);
      window.clearTimeout(timeoutId);
    };
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const settleReject = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const onOpen = () => settleResolve();
    const onError = () => settleReject('Voice agent data channel failed');
    const onClose = () => settleReject('Voice agent data channel closed');
    const timeoutId = window.setTimeout(() => {
      settleReject('Voice agent data channel timed out');
    }, timeoutMs);

    dataChannel.addEventListener('open', onOpen, { once: true });
    dataChannel.addEventListener('error', onError, { once: true });
    dataChannel.addEventListener('close', onClose, { once: true });
  });
}

async function ensureVoiceAgentConnection(locale) {
  if (!state.audio.voiceAgentEnabled || !state.audio.voiceAgentSupported) {
    throw new Error('OpenAI voice agent is unavailable');
  }
  if (state.audio.agentConnected && state.audio.agentDataChannel?.readyState === 'open') {
    return;
  }
  if (state.audio.agentConnectPromise) {
    await state.audio.agentConnectPromise;
    return;
  }

  state.audio.agentConnecting = true;
  updateAudioStatus();

  const connectPromise = (async () => {
    clearVoiceAgentConnection();

    const peerConnection = new RTCPeerConnection();
    const audioElement = new Audio();
    audioElement.autoplay = true;
    audioElement.preload = 'none';
    peerConnection.addTransceiver('audio', { direction: 'recvonly' });

    const dataChannel = peerConnection.createDataChannel('oai-events');
    dataChannel.addEventListener('message', (event) => {
      handleVoiceAgentMessage(event.data);
    });
    dataChannel.addEventListener('close', () => {
      markVoiceAgentOffline('Voice agent data channel closed');
    });
    dataChannel.addEventListener('error', () => {
      markVoiceAgentOffline('Voice agent data channel error');
    });

    peerConnection.addEventListener('connectionstatechange', () => {
      const connectionState = peerConnection.connectionState;
      if (connectionState === 'failed' || connectionState === 'closed' || connectionState === 'disconnected') {
        markVoiceAgentOffline(`Voice agent connection ${connectionState}`);
      }
    });
    peerConnection.addEventListener('track', (event) => {
      const stream = Array.isArray(event.streams) ? event.streams[0] : null;
      if (!stream) return;
      audioElement.srcObject = stream;
      void audioElement.play().catch(() => {
        // Autoplay can be blocked; the next queue step will retry.
      });
    });

    state.audio.agentPeerConnection = peerConnection;
    state.audio.agentDataChannel = dataChannel;
    state.audio.agentAudioElement = audioElement;

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(peerConnection);
    const offerSdp = String(peerConnection.localDescription?.sdp || offer.sdp || '').trim();
    if (!offerSdp) {
      throw new Error('Voice agent offer SDP is empty');
    }

    const sessionResponse = await fetchWithTimeout(resolveApiUrl('/audio/agent/session'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        offerSdp,
        locale: normalizeLocale(locale || state.locale, state.locale),
        style: OPENAI_VOICE_AGENT_STYLE,
      }),
    }, OPENAI_AGENT_SESSION_TIMEOUT_MS);
    if (!sessionResponse.ok) {
      const details = await sessionResponse.text().catch(() => '');
      throw new Error(
        details ? `Voice agent session failed: ${details.slice(0, 200)}` : `Voice agent session failed (${sessionResponse.status})`
      );
    }

    const payload = await sessionResponse.json().catch(() => null);
    const answerSdp = String(payload?.data?.answerSdp || '').trim();
    if (!answerSdp) {
      throw new Error('Voice agent session missing SDP answer');
    }

    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    await waitForDataChannelOpen(dataChannel);

    state.audio.agentConnected = true;
    state.audio.provider = 'openai-agent';
    state.audio.usedGeneratedFallback = false;
    state.audio.usedFallbackVoice = false;
  })();

  state.audio.agentConnectPromise = connectPromise;

  try {
    await connectPromise;
  } catch (error) {
    clearVoiceAgentConnection();
    throw error;
  } finally {
    state.audio.agentConnecting = false;
    if (state.audio.agentConnectPromise === connectPromise) {
      state.audio.agentConnectPromise = null;
    }
    updateAudioStatus();
  }
}

function stopAudioQueue() {
  state.audio.queue = [];
  state.audio.speaking = false;
  state.audio.seenCommentaryIds = new Set();
  clearCurrentAudioElement();
  clearVoiceAgentConnection();
  try {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // Ignore browser speech API errors.
  }
  updateAudioStatus();
}

function finishAudioQueueStep() {
  state.audio.speaking = false;
  updateAudioStatus();
  processAudioQueue();
}

function playBrowserTtsEntry(next) {
  if (!state.audio.browserSupported) {
    state.audio.enabled = false;
    state.audio.status = 'error';
    stopAudioQueue();
    return;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(String(next.message || '').trim());
    utterance.lang = resolveSpeechLocale(next.locale || state.locale);
    utterance.rate = state.audio.rate;
    state.audio.provider = 'browser';
    state.audio.usedGeneratedFallback = false;
    state.audio.usedFallbackVoice = true;
    updateAudioStatus();

    utterance.addEventListener('end', () => {
      finishAudioQueueStep();
    });
    utterance.addEventListener('error', () => {
      state.audio.enabled = false;
      state.audio.status = 'error';
      stopAudioQueue();
    });

    window.speechSynthesis.speak(utterance);
  } catch {
    state.audio.enabled = false;
    state.audio.status = 'error';
    stopAudioQueue();
  }
}

async function playOpenAiTtsEntry(next, { fromVoiceAgentFallback = false } = {}) {
  const response = await fetchWithTimeout(resolveApiUrl('/audio/speech'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      input: String(next.message || ''),
      locale: normalizeLocale(next.locale || state.locale, state.locale),
      rate: state.audio.rate,
      style: OPENAI_TTS_STYLE,
    }),
  }, OPENAI_TTS_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`OpenAI speech request failed (${response.status})`);
  }

  const audioBlob = await response.blob();
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('OpenAI speech response is empty');
  }
  if (!state.audio.enabled) {
    return;
  }

  clearCurrentAudioElement();

  const objectUrl = URL.createObjectURL(audioBlob);
  const audioElement = new Audio(objectUrl);
  state.audio.currentAudio = audioElement;
  state.audio.currentAudioUrl = objectUrl;
  state.audio.provider = 'openai';
  state.audio.usedGeneratedFallback = fromVoiceAgentFallback;
  state.audio.usedFallbackVoice = false;
  audioElement.playbackRate = state.audio.rate;
  updateAudioStatus();

  const onEnded = () => {
    if (state.audio.currentAudio === audioElement) {
      state.audio.currentAudio = null;
    }
    if (state.audio.currentAudioUrl === objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore URL revoke failures.
      }
      state.audio.currentAudioUrl = null;
    }
    finishAudioQueueStep();
  };

  audioElement.addEventListener('ended', onEnded, { once: true });
  audioElement.addEventListener('error', () => {
    if (state.audio.currentAudio === audioElement) {
      state.audio.currentAudio = null;
    }
    if (state.audio.currentAudioUrl === objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore URL revoke failures.
      }
      state.audio.currentAudioUrl = null;
    }

    if (state.audio.browserSupported) {
      playBrowserTtsEntry(next);
      return;
    }

    state.audio.enabled = false;
    state.audio.status = 'error';
    stopAudioQueue();
  }, { once: true });

  await audioElement.play();
}

async function playOpenAiVoiceAgentEntry(next) {
  if (!state.audio.enabled) {
    return;
  }
  await ensureVoiceAgentConnection(next.locale || state.locale);
  const dataChannel = state.audio.agentDataChannel;
  if (!dataChannel || dataChannel.readyState !== 'open') {
    throw new Error('Voice agent channel is not open');
  }

  const message = String(next.message || '').trim();
  if (!message) {
    return;
  }

  const normalizedLocale = normalizeLocale(next.locale || state.locale, state.locale);
  const requestId = createAudioRequestId();
  state.audio.provider = 'openai-agent';
  state.audio.usedGeneratedFallback = false;
  state.audio.usedFallbackVoice = false;
  updateAudioStatus();

  await new Promise((resolve, reject) => {
    state.audio.agentPendingResolve = resolve;
    state.audio.agentPendingReject = reject;
    clearVoiceAgentPendingTimeout();
    state.audio.agentPendingTimeoutId = window.setTimeout(() => {
      rejectPendingVoiceAgentRequest('Voice agent response timed out');
    }, OPENAI_VOICE_AGENT_RESPONSE_TIMEOUT_MS);

    try {
      dataChannel.send(
        JSON.stringify({
          type: 'conversation.item.create',
          event_id: `item_${requestId}`,
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: message }],
          },
        })
      );

      dataChannel.send(
        JSON.stringify({
          type: 'response.create',
          event_id: `response_${requestId}`,
          response: {
            modalities: ['audio'],
            instructions: [
              `Read the latest commentary message in locale ${normalizedLocale}.`,
              'Use energetic play-by-play sports tone.',
              'Speak only the provided commentary text, no extra additions.',
            ].join(' '),
          },
        })
      );
    } catch (error) {
      rejectPendingVoiceAgentRequest(error?.message || 'Voice agent send failed');
    }
  });
}

function processAudioQueue() {
  if (!state.audio.enabled || !state.audio.supported) return;
  if (state.audio.speaking) return;
  const next = state.audio.queue.shift();
  if (!next) {
    updateAudioStatus();
    return;
  }

  state.audio.speaking = true;
  updateAudioStatus();

  if (state.audio.voiceAgentEnabled && state.audio.voiceAgentSupported) {
    void playOpenAiVoiceAgentEntry(next).then(() => {
      if (!state.audio.enabled) return;
      finishAudioQueueStep();
    }).catch(() => {
      if (!state.audio.enabled) return;
      clearVoiceAgentConnection();
      state.audio.voiceAgentEnabled = false;
      if (state.audio.openAiEnabled) {
        void playOpenAiTtsEntry(next, { fromVoiceAgentFallback: true }).catch(() => {
          if (!state.audio.enabled) return;
          clearCurrentAudioElement();
          if (state.audio.browserSupported) {
            playBrowserTtsEntry(next);
            return;
          }
          state.audio.enabled = false;
          state.audio.status = 'error';
          stopAudioQueue();
        });
        return;
      }
      if (state.audio.browserSupported) {
        playBrowserTtsEntry(next);
        return;
      }
      state.audio.enabled = false;
      state.audio.status = 'error';
      stopAudioQueue();
    });
    return;
  }

  if (state.audio.openAiEnabled) {
    void playOpenAiTtsEntry(next).catch(() => {
      if (!state.audio.enabled) return;
      clearCurrentAudioElement();
      if (state.audio.browserSupported) {
        playBrowserTtsEntry(next);
        return;
      }
      state.audio.enabled = false;
      state.audio.status = 'error';
      stopAudioQueue();
    });
    return;
  }

  playBrowserTtsEntry(next);
}

function shouldSpeakEntry(entry) {
  if (state.localeSwitchPending) return false;
  const { entryLocale, sourceLocale } = localePairForEntry(entry);
  if (entryLocale === sourceLocale) return true;

  const translationStatus = String(entry?.translation?.status || '')
    .trim()
    .toLowerCase();
  if (!translationStatus) return false;
  return (
    translationStatus === 'precomputed'
    || translationStatus === 'cache-hit'
    || translationStatus === 'on-demand'
    || translationStatus === 'translated'
  );
}

function enqueueAudioEntry(entry) {
  if (!state.audio.enabled || !state.audio.supported) return;
  const entryId = Number(entry?.id);
  if (!Number.isInteger(entryId)) return;
  if (state.audio.seenCommentaryIds.has(entryId)) return;

  const text = String(entry?.message || '').trim();
  if (!text) return;
  if (!shouldSpeakEntry(entry)) {
    updateAudioStatus();
    return;
  }

  state.audio.seenCommentaryIds.add(entryId);
  state.audio.queue.push({
    id: entryId,
    message: text,
    locale: entry.locale || state.locale,
  });
  processAudioQueue();
}

function toggleAudio(forceEnabled = null) {
  if (!V2_AUDIO_ENABLED) {
    state.audio.enabled = false;
    state.audio.status = 'error';
    updateAudioStatus();
    return;
  }
  if (!state.audio.supported) {
    state.audio.enabled = false;
    state.audio.status = 'error';
    updateAudioStatus();
    return;
  }

  const target = forceEnabled == null ? !state.audio.enabled : Boolean(forceEnabled);
  state.audio.enabled = target;
  state.audio.status = 'ready';
  if (!state.audio.enabled) {
    stopAudioQueue();
    return;
  }
  state.audio.voiceAgentEnabled = OPENAI_VOICE_AGENT_ENABLED && state.audio.voiceAgentSupported;
  state.audio.provider = state.audio.voiceAgentEnabled
    ? 'openai-agent'
    : (state.audio.openAiEnabled ? 'openai' : 'browser');
  state.audio.usedGeneratedFallback = false;
  state.audio.usedFallbackVoice = false;

  updateAudioStatus();
  const currentEntries = state.commentaryByMatchId.get(state.selectedMatchId) || [];
  if (currentEntries.length > 0) {
    enqueueAudioEntry(currentEntries[0]);
  }
}

async function setLocale(nextLocale, { refreshCommentary = true, updatePath = true } = {}) {
  const normalized = normalizeLocale(nextLocale, state.locale);
  const previousLocale = state.locale;
  const selectedMatchId = state.selectedMatchId;

  state.locale = normalized;
  activeMessages = resolveMessagesForLocale(state.locale);
  setDocumentLocale(state.locale);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);
  } catch {
    // Ignore localStorage restrictions.
  }
  syncLanguageSelect();
  if (previousLocale !== state.locale) {
    const shouldRefreshForLocale = refreshCommentary && Number.isInteger(selectedMatchId);
    state.localeSwitchPending = shouldRefreshForLocale;
    state.commentaryByMatchId.clear();
    state.commentaryCursorByMatchId.clear();
    state.commentaryHasMoreByMatchId.clear();
    if (shouldRefreshForLocale) {
      state.pendingTranslationIds.clear();
      state.loadingCommentary = true;
    }
    if (state.audio.enabled) {
      stopAudioQueue();
    }
    state.subscribedMatchId = null;
    syncSocketSubscription();
  }

  applyStaticTranslations();
  syncSportFilterOptions();
  renderMatches();
  renderCommentary();

  if (updatePath) {
    replaceLocaleInPath(state.locale);
  }

  if (refreshCommentary && Number.isInteger(selectedMatchId)) {
    await ensureCommentaryLoaded(selectedMatchId, {
      force: true,
      showLoading: false,
      limit: INITIAL_COMMENTARY_LIMIT,
    });
    renderCommentary();
  } else if (previousLocale !== state.locale) {
    state.localeSwitchPending = false;
    syncTranslationLoadingState();
  }

  setConnectionState(state.socketConnected);
}

void bootstrap();

async function bootstrap() {
  state.locale = resolveStoredLocale();
  activeMessages = resolveMessagesForLocale(state.locale);
  state.audio.browserSupported = detectBrowserSpeechSupport();
  state.audio.voiceAgentSupported = detectOpenAiVoiceAgentSupport();
  state.audio.voiceAgentEnabled = OPENAI_VOICE_AGENT_ENABLED && state.audio.voiceAgentSupported;
  state.audio.openAiEnabled = OPENAI_TTS_ENABLED && detectOpenAiAudioSupport();
  state.audio.provider = state.audio.voiceAgentEnabled
    ? 'openai-agent'
    : (state.audio.openAiEnabled ? 'openai' : 'browser');
  state.audio.supported = V2_AUDIO_ENABLED
    && (state.audio.voiceAgentEnabled || state.audio.openAiEnabled || state.audio.browserSupported);
  state.audio.usedGeneratedFallback = false;
  state.audio.usedFallbackVoice = false;
  state.audio.rate = normalizeAudioRate(elements.listenSpeed?.value || '1');
  setDocumentLocale(state.locale);
  applyTheme(state.theme, { persist: false });
  bindEvents();
  syncLanguageSelect();
  applyStaticTranslations();
  await refreshDemoStatus();
  await loadMatches();
  connectWebSocket();
}

function bindEvents() {
  if (elements.languageSelect) {
    elements.languageSelect.addEventListener('change', async (event) => {
      const selected = String(event.target.value || DEFAULT_LOCALE);
      await setLocale(selected, { refreshCommentary: true, updatePath: true });
    });
  }

  if (elements.sportFilter) {
    elements.sportFilter.addEventListener('change', async (event) => {
      const nextFilter = String(event.target.value || 'all').toLowerCase();
      await applySportFilter(nextFilter);
    });
  }

  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
    });
  }

  if (elements.demoStartButton) {
    elements.demoStartButton.addEventListener('click', async () => {
      await startDemoSession();
    });
  }

  if (elements.listenToggle) {
    elements.listenToggle.addEventListener('click', () => {
      toggleAudio();
    });
  }

  if (elements.listenSpeed) {
    elements.listenSpeed.addEventListener('change', (event) => {
      state.audio.rate = normalizeAudioRate(event.target.value);
      updateAudioStatus();
    });
  }

  if (elements.commentaryList) {
    elements.commentaryList.addEventListener('click', async (event) => {
      const loadOlderButton = event.target.closest('[data-load-older-commentary]');
      if (!loadOlderButton) return;
      if (state.loadingOlderCommentary) return;
      if (!Number.isInteger(state.selectedMatchId)) return;

      const cursor = state.commentaryCursorByMatchId.get(state.selectedMatchId);
      if (!cursor) return;

      state.loadingOlderCommentary = true;
      renderCommentary();
      try {
        await ensureCommentaryLoaded(state.selectedMatchId, {
          force: true,
          mode: 'append',
          showLoading: false,
          limit: COMMENTARY_PAGE_LIMIT,
          beforeCursor: cursor,
        });
      } finally {
        state.loadingOlderCommentary = false;
        renderCommentary();
      }
    });
  }

  if (!elements.matchesGrid) return;
  elements.matchesGrid.addEventListener('click', async (event) => {
    const watchButton = event.target.closest('[data-watch-match]');
    if (watchButton) {
      const matchId = Number.parseInt(watchButton.dataset.watchMatch ?? '', 10);
      if (!Number.isInteger(matchId)) return;
      await setSelectedMatch(matchId);
      return;
    }

    const closeButton = event.target.closest('[data-close-match]');
    if (closeButton) {
      state.selectedMatchId = null;
      state.loadingOlderCommentary = false;
      renderMatches();
      renderCommentary();
      syncSocketSubscription();
    }
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(resolveApiUrl(url), init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.details) {
        message = payload.details;
      } else if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Ignore JSON parse failures and keep the status message.
    }
    throw new Error(message);
  }
  return response.json();
}

function clearDemoPollTimer() {
  if (state.demoPollTimer == null) return;
  window.clearTimeout(state.demoPollTimer);
  state.demoPollTimer = null;
}

async function refreshDemoStatus(sessionId = state.demoSessionId) {
  try {
    const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const payload = await fetchJson(`/demo/status${suffix}`);
    const data = payload?.data || {};
    if (data.sessionId) {
      state.demoSessionId = data.sessionId;
    }
    updateDemoStatusPill(data.status || 'idle');
    return data;
  } catch {
    updateDemoStatusPill('idle');
    return null;
  }
}

function scheduleDemoPoll(sessionId) {
  clearDemoPollTimer();
  state.demoPollTimer = window.setTimeout(async () => {
    const data = await refreshDemoStatus(sessionId);
    if (!data) return;
    const status = String(data.status || '').toLowerCase();
    if (status === 'starting' || status === 'resetting' || status === 'seeding') {
      scheduleDemoPoll(sessionId);
      return;
    }
    if (status === 'ready') {
      await loadMatches();
      if (Number.isInteger(state.selectedMatchId)) {
        await ensureCommentaryLoaded(state.selectedMatchId, {
          force: true,
          limit: INITIAL_COMMENTARY_LIMIT,
        });
        renderCommentary();
      }
    }
  }, 1200);
}

async function startDemoSession() {
  if (demoStartInFlight) {
    return demoStartInFlight;
  }

  updateDemoStatusPill('starting');
  demoStartInFlight = (async () => {
    try {
      const payload = await fetchJson('/demo/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'judge',
          quality: state.quality,
          locale: state.locale,
        }),
      });

      const data = payload?.data || {};
      if (data.sessionId) {
        state.demoSessionId = data.sessionId;
        scheduleDemoPoll(data.sessionId);
      }
      updateDemoStatusPill(data.status || 'starting');
    } catch (error) {
      console.error('Failed to start demo session:', error?.message || error);
      updateDemoStatusPill('failed');
    } finally {
      demoStartInFlight = null;
    }
  })();

  return demoStartInFlight;
}

async function loadMatches() {
  try {
    const payload = await fetchJson('/matches?limit=100');
    const matches = Array.isArray(payload.data) ? payload.data : [];
    state.matches = sortMatches(matches);
    syncSportFilterOptions();
    const visibleMatches = getVisibleMatches();
    updateApiCount(visibleMatches);

    if (
      !state.selectedMatchId ||
      !visibleMatches.some((match) => match.id === state.selectedMatchId)
    ) {
      state.selectedMatchId = pickDefaultMatchId(visibleMatches);
    }

    renderMatches();
    await ensureCommentaryLoaded(state.selectedMatchId, {
      limit: INITIAL_COMMENTARY_LIMIT,
    });
    renderCommentary();
  } catch (error) {
    elements.matchesGrid.innerHTML = `
      <div class="panel-placeholder error-placeholder">
        ${escapeHtml(t('matches.loadingError', 'Could not load matches. Check if backend is running.'))}
      </div>
    `;
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder error-placeholder">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

function pickDefaultMatchId(matches) {
  if (!matches.length) return null;
  const firstLive = matches.find((match) => match.status === 'live');
  return firstLive?.id ?? matches[0].id;
}

function normalizeSport(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getVisibleMatches() {
  if (state.sportFilter === 'all') return state.matches;
  return state.matches.filter((match) => normalizeSport(match.sport) === state.sportFilter);
}

function updateApiCount(matches) {
  elements.apiCount.textContent = `${t('matches.apiCount', 'API')}: ${matches.length}`;
}

function sportOptions(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const label = String(match.sport ?? '').trim();
    if (!label) continue;
    const key = normalizeSport(label);
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return Array.from(byKey.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

function syncSportFilterOptions() {
  if (!elements.sportFilter) return;

  const options = sportOptions(state.matches);
  const optionValues = new Set(options.map(([value]) => value));
  if (state.sportFilter !== 'all' && !optionValues.has(state.sportFilter)) {
    state.sportFilter = 'all';
  }

  const optionsHtml = [
    `<option value="all">${escapeHtml(t('matches.allSports', 'All Sports'))}</option>`,
    ...options.map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(translateSportLabel(label))}</option>`
    ),
  ].join('');

  elements.sportFilter.innerHTML = optionsHtml;
  elements.sportFilter.value = state.sportFilter;
}

async function applySportFilter(nextFilter) {
  state.sportFilter = nextFilter || 'all';
  const visibleMatches = getVisibleMatches();
  updateApiCount(visibleMatches);

  if (
    !state.selectedMatchId ||
    !visibleMatches.some((match) => match.id === state.selectedMatchId)
  ) {
    state.selectedMatchId = pickDefaultMatchId(visibleMatches);
    await ensureCommentaryLoaded(state.selectedMatchId, {
      limit: INITIAL_COMMENTARY_LIMIT,
    });
  }

  renderMatches();
  renderCommentary();
  syncSocketSubscription();
}

function sortMatches(matches) {
  return [...matches].sort((left, right) => {
    const leftPriority = MATCH_STATUS_PRIORITY[left.status] ?? 99;
    const rightPriority = MATCH_STATUS_PRIORITY[right.status] ?? 99;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    const leftCreated = Date.parse(left.createdAt || '') || 0;
    const rightCreated = Date.parse(right.createdAt || '') || 0;
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;

    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function renderMatches() {
  const visibleMatches = getVisibleMatches();
  updateApiCount(visibleMatches);

  if (!visibleMatches.length) {
    elements.matchesGrid.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(t('matches.noAvailable', 'No matches available right now.'))}</div>
    `;
    return;
  }

  const html = visibleMatches
    .map((match) => {
      const isSelected = match.id === state.selectedMatchId;
      const status = match.status || 'scheduled';
      const watchLabel = isSelected && status === 'live'
        ? t('matches.watching', 'Watching Live')
        : t('matches.watch', 'Watch Live');

      return `
        <article class="match-card ${isSelected ? 'selected' : ''}">
          <div class="match-top">
            <span class="sport-pill">${escapeHtml(translateSportLabel(match.sport))}</span>
            <span class="status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
          </div>

          <div class="scoreboard-row">
            <p class="team-name">${escapeHtml(match.homeTeam)}</p>
            <span class="score-box">${safeScore(match.homeScore)}</span>
          </div>

          <div class="scoreboard-row">
            <p class="team-name">${escapeHtml(match.awayTeam)}</p>
            <span class="score-box">${safeScore(match.awayScore)}</span>
          </div>

          <div class="card-divider"></div>

          <div class="match-bottom">
            <p class="match-time">${escapeHtml(formatLocalTime(match.startTime))}</p>
            <div class="watch-controls">
              <button
                class="watch-btn ${isSelected ? 'active' : ''}"
                data-watch-match="${match.id}"
              >
                ${watchLabel}
              </button>
              ${
                isSelected
                  ? `<button class="close-btn" data-close-match="1">${escapeHtml(t('matches.close', 'Close'))}</button>`
                  : ''
              }
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  elements.matchesGrid.innerHTML = html;
}

function safeScore(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function statusLabel(status) {
  if (status === 'live') return t('status.live', 'Live');
  if (status === 'finished') return t('status.finished', 'Finished');
  return t('status.scheduled', 'Scheduled');
}

function formatLocalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('matches.timeTbd', 'TBD');
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTimelineTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

async function setSelectedMatch(matchId) {
  if (state.selectedMatchId === matchId) return;
  state.selectedMatchId = matchId;
  state.loadingOlderCommentary = false;
  renderMatches();
  await ensureCommentaryLoaded(matchId, {
    limit: INITIAL_COMMENTARY_LIMIT,
  });
  renderCommentary();
  const entries = state.commentaryByMatchId.get(matchId) || [];
  if (entries.length > 0) {
    enqueueAudioEntry(entries[0]);
  }
  syncSocketSubscription();
}

async function ensureCommentaryLoaded(matchId, options = {}) {
  const force = options.force === true;
  const mode = options.mode === 'append' ? 'append' : 'replace';
  const showLoading = options.showLoading !== false;
  const requestedLimit = Number.isInteger(options.limit)
    ? options.limit
    : INITIAL_COMMENTARY_LIMIT;
  const safeLimit = Math.max(1, Math.min(100, requestedLimit));
  const cursor = options.beforeCursor && Number.isInteger(options.beforeCursor.beforeId)
    && typeof options.beforeCursor.beforeCreatedAt === 'string'
    ? options.beforeCursor
    : null;

  if (!Number.isInteger(matchId)) return;
  if (mode === 'replace' && !force && state.commentaryByMatchId.has(matchId)) return;
  if (mode === 'append' && !cursor) return;

  const requestToken = state.commentaryRequestToken + 1;
  state.commentaryRequestToken = requestToken;

  if (showLoading && mode === 'replace') {
    state.loadingCommentary = true;
    renderCommentary();
  }

  try {
    const searchParams = new URLSearchParams({
      limit: String(safeLimit),
      locale: state.locale,
      quality: state.quality,
      includeSource: '1',
    });
    if (mode === 'append' && cursor) {
      searchParams.set('beforeCreatedAt', cursor.beforeCreatedAt);
      searchParams.set('beforeId', String(cursor.beforeId));
    }

    const payload = await fetchJson(
      `/matches/${matchId}/commentary?${searchParams.toString()}`
    );
    if (requestToken !== state.commentaryRequestToken) return;

    const entries = Array.isArray(payload.data) ? payload.data : [];
    const hasMore = payload?.meta?.hasMore === true;
    const nextCursor = payload?.meta?.nextCursor;
    const normalizedNextCursor = nextCursor
      && Number.isInteger(nextCursor.beforeId)
      && typeof nextCursor.beforeCreatedAt === 'string'
      ? {
          beforeCreatedAt: nextCursor.beforeCreatedAt,
          beforeId: nextCursor.beforeId,
        }
      : null;

    for (const entry of entries) {
      clearTranslationPending(entry?.id);
      if (isTranslationPendingEntry(entry)) {
        markTranslationPending(entry);
      }
    }
    if (mode === 'append') {
      const existing = state.commentaryByMatchId.get(matchId) || [];
      state.commentaryByMatchId.set(
        matchId,
        sortCommentary(dedupeCommentaryEntries([...existing, ...entries]))
      );
    } else {
      state.commentaryByMatchId.set(matchId, sortCommentary(entries));
    }
    state.commentaryHasMoreByMatchId.set(matchId, hasMore);
    if (normalizedNextCursor) {
      state.commentaryCursorByMatchId.set(matchId, normalizedNextCursor);
    } else {
      state.commentaryCursorByMatchId.delete(matchId);
    }
  } catch {
    if (requestToken !== state.commentaryRequestToken) return;
    if ((force || !state.commentaryByMatchId.has(matchId)) && mode === 'replace') {
      state.commentaryByMatchId.set(matchId, []);
    }
    if (mode === 'replace') {
      state.commentaryHasMoreByMatchId.set(matchId, false);
      state.commentaryCursorByMatchId.delete(matchId);
    }
  } finally {
    if (requestToken === state.commentaryRequestToken) {
      if (mode === 'replace') {
        state.loadingCommentary = false;
      }
      syncTranslationLoadingState();
    }
  }
}

function dedupeCommentaryEntries(entries) {
  const deduped = new Map();
  for (const entry of entries) {
    const entryId = Number(entry?.id);
    const fallbackKey = `${entry?.createdAt || ''}:${entry?.sequence || ''}:${entry?.message || ''}`;
    const key = Number.isInteger(entryId) ? `id:${entryId}` : `fallback:${fallbackKey}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }
  return Array.from(deduped.values());
}

function sortCommentary(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || '') || 0;
    const rightTime = Date.parse(right.createdAt || '') || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;

    const leftSeq = Number(left.sequence || 0);
    const rightSeq = Number(right.sequence || 0);
    return rightSeq - leftSeq;
  });
}

function translationStatusMeta(entry) {
  const status = String(entry?.translation?.status || '').trim().toLowerCase();
  if (status === 'fallback-source' && shouldRenderAsTranslating(entry)) {
    return {
      className: 'pending',
      label: t('translation.pending', 'Translating'),
    };
  }
  if (status === 'precomputed' || status === 'cache-hit') {
    return {
      className: 'cached',
      label: t('translation.cached', 'Cached'),
    };
  }
  if (status === 'on-demand' || status === 'translated') {
    return {
      className: 'translated',
      label: t('translation.live', 'Live translated'),
    };
  }
  if (status === 'fallback-source') {
    return {
      className: 'fallback',
      label: t('translation.fallback', 'Fallback source'),
    };
  }
  return {
    className: 'source',
    label: t('translation.source', 'Source locale'),
  };
}

function renderCommentary() {
  if (!Number.isInteger(state.selectedMatchId)) {
    state.localeSwitchPending = false;
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(t('commentary.selectPrompt', 'Select a match to start streaming commentary.'))}</div>
    `;
    syncTranslationLoadingState();
    return;
  }

  const selectedMatch = findMatchById(state.selectedMatchId);
  const commentary = state.commentaryByMatchId.get(state.selectedMatchId) ?? [];
  const hasMoreCommentary = state.commentaryHasMoreByMatchId.get(state.selectedMatchId) === true;
  const shouldShowOverlay = shouldShowLocaleTranslationOverlay();

  if (state.loadingCommentary && commentary.length === 0) {
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(
        shouldShowOverlay
          ? t('commentary.translatingAll', 'Translating commentary for this language...')
          : t('commentary.loading', 'Loading commentary...')
      )}</div>
    `;
    syncTranslationLoadingState();
    return;
  }

  if (!commentary.length) {
    const teamName = selectedMatch?.homeTeam || t('common.thisMatch', 'this match');
    const template = t('commentary.emptyFor', 'No commentary yet for {team}.');
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(formatTemplate(template, { team: teamName }))}</div>
    `;
    syncTranslationLoadingState();
    return;
  }

  const html = commentary
    .map((entry) => {
      const eventType = formatEventType(entry.eventType);
      const eventStyle = EVENT_STYLES[String(entry.eventType).toLowerCase()] || 'warn';
      const actorLine = [entry.actor, entry.team].filter(Boolean).join(' · ');
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      const isTranslationPending = isEntryPendingForLocale(entry);
      const translationMeta = translationStatusMeta(entry);

      return `
        <article class="commentary-item">
          <p class="commentary-meta">
            <span>${escapeHtml(formatTimelineTime(entry.createdAt))}</span>
            ${
              Number.isFinite(entry.minute)
                ? `<span class="chip">${entry.minute}'</span>`
                : ''
            }
            ${
              entry.period
                ? `<span class="chip">${escapeHtml(entry.period)}</span>`
                : ''
            }
            <span class="chip event ${eventStyle}">${escapeHtml(eventType)}</span>
          </p>

          ${
            actorLine
              ? `<p class="actor-line">${escapeHtml(actorLine)}</p>`
              : ''
          }

          <p class="message-card">${escapeHtml(resolveCommentaryMessage(entry))}</p>

          <p class="translation-status ${escapeHtml(translationMeta.className)}">
            ${escapeHtml(translationMeta.label)}
          </p>

          ${
            isTranslationPending
              ? `<p class="translation-loading"><span class="loading-dot" aria-hidden="true"></span>${escapeHtml(t('commentary.translating', 'Translating...'))}</p>`
              : ''
          }

          ${
            tags.length
              ? `
                <div class="tags-row">
                  ${tags
                    .map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`)
                    .join('')}
                </div>
              `
              : ''
          }
        </article>
      `;
    })
    .join('');

  const loadOlderHtml = (hasMoreCommentary || state.loadingOlderCommentary)
    ? `
      <div class="commentary-pagination">
        <button
          class="load-older-btn"
          type="button"
          data-load-older-commentary="1"
          ${state.loadingOlderCommentary || !hasMoreCommentary ? 'disabled' : ''}
        >
          ${escapeHtml(
            state.loadingOlderCommentary
              ? t('commentary.loadingOlder', 'Loading older commentary...')
              : t('commentary.loadOlder', 'Load older commentary')
          )}
        </button>
      </div>
    `
    : '';

  elements.commentaryList.innerHTML = `${html}${loadOlderHtml}`;
  syncTranslationLoadingState();
}

function formatEventType(eventType) {
  if (!eventType) return t('event.update', 'UPDATE');

  const key = `event.${String(eventType).toLowerCase()}`;
  const translated = getMessage(key);
  if (translated) return translated;

  return String(eventType).replace(/_/g, ' ').toUpperCase();
}

function findMatchById(matchId) {
  return state.matches.find((match) => match.id === matchId) || null;
}

function connectWebSocket() {
  const candidates = buildWsCandidates();
  const wsUrl = candidates[state.reconnectAttempts % candidates.length];
  if (state.reconnectAttempts > 0) {
    console.warn(`WebSocket reconnect attempt #${state.reconnectAttempts} using ${wsUrl}`);
  }
  const socket = new WebSocket(wsUrl);

  state.socket = socket;
  setConnectionState(false);

  socket.addEventListener('open', () => {
    state.reconnectAttempts = 0;
    state.subscribedMatchId = null;
    setConnectionState(true);
    syncSocketSubscription();
  });

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    handleSocketMessage(payload);
  });

  socket.addEventListener('close', () => {
    setConnectionState(false);
    state.subscribedMatchId = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    socket.close();
  });
}

function setConnectionState(isConnected) {
  state.socketConnected = isConnected;
  elements.connectionPill.classList.toggle('connected', isConnected);
  elements.connectionPill.classList.toggle('disconnected', !isConnected);
  elements.connectionText.textContent = isConnected
    ? t('connection.connected', 'LIVE CONNECTED')
    : state.reconnectAttempts > 0
      ? t('connection.reconnecting', 'RECONNECTING')
      : t('connection.connecting', 'CONNECTING');
}

function handleDataReset(metadata = {}) {
  const scope = String(metadata?.scope || 'all').trim().toLowerCase();

  state.commentaryRequestToken += 1;
  state.commentaryByMatchId.clear();
  state.commentaryCursorByMatchId.clear();
  state.commentaryHasMoreByMatchId.clear();
  state.loadingCommentary = false;
  state.loadingOlderCommentary = false;
  state.pendingTranslationIds.clear();
  state.localeSwitchPending = false;

  if (scope === 'commentary') {
    state.matches = state.matches.map((match) => ({
      ...match,
      homeScore: 0,
      awayScore: 0,
    }));
    renderMatches();
    renderCommentary();
    updateApiCount(getVisibleMatches());
    syncTranslationLoadingState();
    return;
  }

  state.matches = [];
  state.selectedMatchId = null;
  state.sportFilter = 'all';
  state.subscribedMatchId = null;

  syncSportFilterOptions();
  renderMatches();
  renderCommentary();
  updateApiCount([]);
  syncTranslationLoadingState();
}

function handleSocketMessage(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.type === 'welcome') {
    syncSocketSubscription();
    return;
  }

  if (payload.type === 'data_reset') {
    handleDataReset(payload.data || {});
    return;
  }

  if (payload.type === 'demo_status' && payload.data) {
    if (payload.data.sessionId) {
      state.demoSessionId = payload.data.sessionId;
    }
    updateDemoStatusPill(payload.data.status || 'idle');
    if (String(payload.data.status || '').toLowerCase() === 'ready') {
      void loadMatches();
    }
    return;
  }

  if (payload.type === 'translation_health' && payload.data) {
    // Keep this lightweight in the fan UI; the full stream is shown in /admin/lingo.
    if (payload.data.availability?.available === false) {
      elements.connectionText.textContent = 'LIVE · FALLBACK';
    } else {
      elements.connectionText.textContent = state.socketConnected
        ? t('connection.connected', 'LIVE CONNECTED')
        : state.reconnectAttempts > 0
          ? t('connection.reconnecting', 'RECONNECTING')
          : t('connection.connecting', 'CONNECTING');
    }
    return;
  }

  if (payload.type === 'match_created' && payload.data) {
    upsertMatch(payload.data);
    renderMatches();
    return;
  }

  if (payload.type === 'match_updated' && payload.data) {
    upsertMatch(payload.data);
    renderMatches();
    return;
  }

  if ((payload.type === 'commentary' || payload.type === 'commentary_translation_ready') && payload.data) {
    pushLiveCommentary(payload.data, payload.locale, payload.type);
  }
}

function upsertMatch(match) {
  const index = state.matches.findIndex((entry) => entry.id === match.id);
  if (index === -1) {
    state.matches.unshift(match);
  } else {
    state.matches[index] = { ...state.matches[index], ...match };
  }
  state.matches = sortMatches(state.matches);
  syncSportFilterOptions();
  const visibleMatches = getVisibleMatches();
  updateApiCount(visibleMatches);

  if (
    state.selectedMatchId &&
    !visibleMatches.some((entry) => entry.id === state.selectedMatchId)
  ) {
    state.selectedMatchId = pickDefaultMatchId(visibleMatches);
    void ensureCommentaryLoaded(state.selectedMatchId, {
      limit: INITIAL_COMMENTARY_LIMIT,
    }).then(() => {
      renderCommentary();
      syncSocketSubscription();
    });
  }
}

function pushLiveCommentary(entry, payloadLocale, eventType = 'commentary') {
  if (typeof payloadLocale === 'string' && payloadLocale.trim()) {
    const normalizedPayloadLocale = normalizeLocale(payloadLocale, '');
    if (normalizedPayloadLocale && normalizedPayloadLocale !== state.locale) {
      return;
    }
  }

  const matchId = Number(entry.matchId);
  if (!Number.isInteger(matchId)) return;

  if (eventType === 'commentary_translation_ready') {
    clearTranslationPending(entry.id);
  } else if (eventType === 'commentary') {
    markTranslationPending(entry);
  }

  const existing = state.commentaryByMatchId.get(matchId) ?? [];
  const deduped = [entry, ...existing].filter(
    (item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index
  );
  state.commentaryByMatchId.set(matchId, sortCommentary(deduped));

  if (state.selectedMatchId === matchId) {
    enqueueAudioEntry(entry);
  }

  if (state.selectedMatchId === matchId) {
    renderCommentary();
  }
}

function syncSocketSubscription() {
  const socket = state.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  const nextMatchId = state.selectedMatchId;
  if (
    Number.isInteger(state.subscribedMatchId) &&
    state.subscribedMatchId !== nextMatchId
  ) {
    socket.send(
      JSON.stringify({
        type: 'unsubscribe',
        matchId: state.subscribedMatchId,
      })
    );
    state.subscribedMatchId = null;
  }

  if (
    Number.isInteger(nextMatchId) &&
    state.subscribedMatchId !== nextMatchId
  ) {
    socket.send(
      JSON.stringify({
        type: 'subscribe',
        matchId: nextMatchId,
        locale: state.locale,
        quality: state.quality,
      })
    );
    state.subscribedMatchId = nextMatchId;
  }
}

function scheduleReconnect() {
  state.reconnectAttempts += 1;
  const delayMs = Math.min(5000, 600 * 2 ** (state.reconnectAttempts - 1));
  window.setTimeout(() => {
    connectWebSocket();
  }, delayMs);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
