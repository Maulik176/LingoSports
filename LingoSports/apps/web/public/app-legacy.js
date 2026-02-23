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

const state = {
  locale: INITIAL_LOCALE,
  quality: DEFAULT_QUALITY,
  matches: [],
  selectedMatchId: null,
  sportFilter: 'all',
  commentaryByMatchId: new Map(),
  loadingCommentary: false,
  socket: null,
  socketConnected: false,
  reconnectAttempts: 0,
  subscribedMatchId: null,
  commentaryRequestToken: 0,
  pendingTranslationIds: new Set(),
};
let activeMessages = resolveMessagesForLocale(state.locale);

const elements = {
  heroEyebrow: document.querySelector('#hero-eyebrow'),
  heroSubtitle: document.querySelector('#hero-subtitle'),
  languageLabel: document.querySelector('#language-label'),
  languageSelect: document.querySelector('#language-select'),
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
};

function normalizeLocale(locale, fallback = DEFAULT_LOCALE) {
  if (typeof locale !== 'string') return fallback;
  const normalized = locale.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : fallback;
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
  if (entry.locale === entry.sourceLocale) return false;
  return entry.translation.fallbackReason === 'not_precomputed';
}

function markTranslationPending(entry) {
  const entryId = Number(entry?.id);
  if (!Number.isInteger(entryId)) return;
  if (!isTranslationPendingEntry(entry)) return;
  state.pendingTranslationIds.add(entryId);
}

function clearTranslationPending(entryId) {
  const normalizedId = Number(entryId);
  if (!Number.isInteger(normalizedId)) return;
  state.pendingTranslationIds.delete(normalizedId);
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
}

function syncLanguageSelect() {
  if (!elements.languageSelect) return;

  const optionHtml = SUPPORTED_LOCALES.map((locale) =>
    `<option value="${escapeHtml(locale)}">${escapeHtml(languageLabel(locale))}</option>`
  ).join('');
  elements.languageSelect.innerHTML = optionHtml;
  elements.languageSelect.value = state.locale;
}

async function setLocale(nextLocale, { refreshCommentary = true, updatePath = true } = {}) {
  const normalized = normalizeLocale(nextLocale, state.locale);
  const previousLocale = state.locale;
  const selectedMatchId = state.selectedMatchId;

  state.locale = normalized;
  activeMessages = resolveMessagesForLocale(state.locale);
  setDocumentLocale(state.locale);
  syncLanguageSelect();
  if (previousLocale !== state.locale) {
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
    state.pendingTranslationIds.clear();
    const existingCount = (state.commentaryByMatchId.get(selectedMatchId) || []).length;
    const nextLimit = Math.min(40, Math.max(10, existingCount || 0));
    await ensureCommentaryLoaded(selectedMatchId, {
      force: true,
      showLoading: existingCount === 0,
      limit: nextLimit,
    });
    renderCommentary();
  }

  setConnectionState(state.socketConnected);
}

void bootstrap();

async function bootstrap() {
  setDocumentLocale(state.locale);
  bindEvents();
  syncLanguageSelect();
  applyStaticTranslations();
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
      renderMatches();
      renderCommentary();
      syncSocketSubscription();
    }
  });
}

async function fetchJson(url) {
  const response = await fetch(resolveApiUrl(url));
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
    await ensureCommentaryLoaded(state.selectedMatchId);
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
    await ensureCommentaryLoaded(state.selectedMatchId);
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
  renderMatches();
  await ensureCommentaryLoaded(matchId);
  renderCommentary();
  syncSocketSubscription();
}

async function ensureCommentaryLoaded(matchId, options = {}) {
  const force = options.force === true;
  const showLoading = options.showLoading !== false;
  const requestedLimit = Number.isInteger(options.limit)
    ? options.limit
    : 100;
  const safeLimit = Math.max(1, Math.min(100, requestedLimit));

  if (!Number.isInteger(matchId)) return;
  if (!force && state.commentaryByMatchId.has(matchId)) return;

  const requestToken = state.commentaryRequestToken + 1;
  state.commentaryRequestToken = requestToken;

  if (showLoading) {
    state.loadingCommentary = true;
    renderCommentary();
  }

  try {
    const payload = await fetchJson(
      `/matches/${matchId}/commentary?limit=${safeLimit}&locale=${encodeURIComponent(state.locale)}&quality=${encodeURIComponent(state.quality)}&includeSource=1`
    );
    if (requestToken !== state.commentaryRequestToken) return;

    const entries = Array.isArray(payload.data) ? payload.data : [];
    for (const entry of entries) {
      clearTranslationPending(entry?.id);
      if (isTranslationPendingEntry(entry)) {
        markTranslationPending(entry);
      }
    }
    state.commentaryByMatchId.set(matchId, sortCommentary(entries));
  } catch {
    if (requestToken !== state.commentaryRequestToken) return;
    if (force || !state.commentaryByMatchId.has(matchId)) {
      state.commentaryByMatchId.set(matchId, []);
    }
  } finally {
    if (requestToken === state.commentaryRequestToken) {
      state.loadingCommentary = false;
    }
  }
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

function renderCommentary() {
  if (!Number.isInteger(state.selectedMatchId)) {
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(t('commentary.selectPrompt', 'Select a match to start streaming commentary.'))}</div>
    `;
    return;
  }

  const selectedMatch = findMatchById(state.selectedMatchId);
  const commentary = state.commentaryByMatchId.get(state.selectedMatchId) ?? [];

  if (state.loadingCommentary && commentary.length === 0) {
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(t('commentary.loading', 'Loading commentary...'))}</div>
    `;
    return;
  }

  if (!commentary.length) {
    const teamName = selectedMatch?.homeTeam || t('common.thisMatch', 'this match');
    const template = t('commentary.emptyFor', 'No commentary yet for {team}.');
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">${escapeHtml(formatTemplate(template, { team: teamName }))}</div>
    `;
    return;
  }

  const html = commentary
    .map((entry) => {
      const eventType = formatEventType(entry.eventType);
      const eventStyle = EVENT_STYLES[String(entry.eventType).toLowerCase()] || 'warn';
      const actorLine = [entry.actor, entry.team].filter(Boolean).join(' · ');
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      const isTranslationPending = state.pendingTranslationIds.has(Number(entry.id));

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

          <p class="message-card">${escapeHtml(entry.message || t('commentary.update', 'Update'))}</p>

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

  elements.commentaryList.innerHTML = html;
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
  state.loadingCommentary = false;
  state.pendingTranslationIds.clear();

  if (scope === 'commentary') {
    state.matches = state.matches.map((match) => ({
      ...match,
      homeScore: 0,
      awayScore: 0,
    }));
    renderMatches();
    renderCommentary();
    updateApiCount(getVisibleMatches());
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
    void ensureCommentaryLoaded(state.selectedMatchId).then(() => {
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
