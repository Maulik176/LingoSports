'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson, wsBaseUrl } from '@/lib/api';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

const QUALITY_OPTIONS = ['standard', 'fast'];
const MATCH_STATUS_PRIORITY = { live: 0, scheduled: 1, finished: 2 };

function t(messages, key, fallback) {
  return messages?.[key] || fallback;
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

function formatTime(value, opts = { hour: '2-digit', minute: '2-digit' }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat(undefined, opts).format(date);
}

function safeScore(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function statusLabel(status) {
  if (status === 'live') return 'Live';
  if (status === 'finished') return 'Finished';
  return 'Scheduled';
}

export default function LiveEngineClient({ locale, messages }) {
  const router = useRouter();

  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [commentaryByMatchId, setCommentaryByMatchId] = useState({});
  const [loadingCommentary, setLoadingCommentary] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [quality, setQuality] = useState('standard');
  const [sportFilter, setSportFilter] = useState('all');
  const [stats, setStats] = useState(null);
  const [globalFanView, setGlobalFanView] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [globalViewTick, setGlobalViewTick] = useState(0);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) || null,
    [matches, selectedMatchId]
  );

  const visibleMatches = useMemo(() => {
    if (sportFilter === 'all') return matches;
    return matches.filter((match) => String(match.sport || '').toLowerCase() === sportFilter);
  }, [matches, sportFilter]);

  const selectedCommentary = commentaryByMatchId[selectedMatchId] || [];

  useEffect(() => {
    const preferred = localStorage.getItem('lingosports.locale');
    if (preferred && preferred !== locale) {
      router.replace(`/${preferred}`);
    }
  }, [locale, router]);

  useEffect(() => {
    async function loadMatches() {
      try {
        const payload = await fetchJson('/matches?limit=100');
        const list = sortMatches(Array.isArray(payload.data) ? payload.data : []);
        setMatches(list);

        if (!selectedMatchId && list.length > 0) {
          const firstLive = list.find((match) => match.status === 'live');
          setSelectedMatchId(firstLive?.id ?? list[0].id);
        }
      } catch (error) {
        setErrorMessage(error.message);
      }
    }

    void loadMatches();
  }, [selectedMatchId]);

  useEffect(() => {
    async function loadCommentary(matchId) {
      if (!Number.isInteger(matchId)) return;
      setLoadingCommentary(true);
      try {
        const payload = await fetchJson(
          `/matches/${matchId}/commentary?limit=100&locale=${locale}&quality=${quality}&includeSource=1`
        );
        const rows = Array.isArray(payload.data) ? payload.data : [];
        setCommentaryByMatchId((prev) => ({
          ...prev,
          [matchId]: sortCommentary(rows),
        }));
      } catch (error) {
        setErrorMessage(error.message);
      } finally {
        setLoadingCommentary(false);
      }
    }

    void loadCommentary(selectedMatchId);
  }, [selectedMatchId, locale, quality]);

  useEffect(() => {
    let active = true;

    async function loadStats() {
      try {
        const payload = await fetchJson(`/lingo/stats?quality=${quality}`);
        if (active) {
          setStats(payload.data || null);
        }
      } catch {
        if (active) setStats(null);
      }
    }

    void loadStats();
    const timer = setInterval(() => {
      void loadStats();
    }, 10000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [quality]);

  useEffect(() => {
    let active = true;

    async function loadGlobalFanView() {
      if (!Number.isInteger(selectedMatchId)) {
        setGlobalFanView([]);
        return;
      }

      const requests = SUPPORTED_LOCALES.map(async (targetLocale) => {
        const payload = await fetchJson(
          `/matches/${selectedMatchId}/commentary?limit=1&locale=${targetLocale}&quality=${quality}`
        );
        const latest = Array.isArray(payload.data) ? payload.data[0] : null;
        return {
          locale: targetLocale,
          message: latest?.message || t(messages, 'globalFanView.noData', 'No update yet'),
          status: latest?.translation?.status || 'fallback-source',
        };
      });

      try {
        const results = await Promise.all(requests);
        if (active) setGlobalFanView(results);
      } catch {
        if (active) setGlobalFanView([]);
      }
    }

    void loadGlobalFanView();

    return () => {
      active = false;
    };
  }, [selectedMatchId, quality, locale, messages, globalViewTick]);

  useEffect(() => {
    if (!Number.isInteger(selectedMatchId)) return undefined;

    let socket;
    let reconnectTimer;
    let attempts = 0;
    let closedByEffect = false;

    const connect = () => {
      socket = new WebSocket(wsBaseUrl());
      setSocketConnected(false);

      socket.addEventListener('open', () => {
        attempts = 0;
        setReconnectAttempts(0);
        setSocketConnected(true);
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            matchId: selectedMatchId,
            locale,
            quality,
          })
        );
      });

      socket.addEventListener('message', (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (payload.type === 'match_created' && payload.data) {
          setMatches((prev) => sortMatches([payload.data, ...prev]));
          return;
        }

        if (payload.type === 'match_updated' && payload.data) {
          setMatches((prev) => {
            const index = prev.findIndex((entry) => entry.id === payload.data.id);
            if (index === -1) return sortMatches([payload.data, ...prev]);
            const copy = [...prev];
            copy[index] = { ...copy[index], ...payload.data };
            return sortMatches(copy);
          });
          return;
        }

        if (
          (payload.type === 'commentary' || payload.type === 'commentary_translation_ready') &&
          payload.data
        ) {
          const entry = payload.data;
          const matchId = Number(entry.matchId);
          if (!Number.isInteger(matchId)) return;

          setCommentaryByMatchId((prev) => {
            const current = prev[matchId] || [];
            const next = [entry, ...current].filter(
              (item, idx, arr) => arr.findIndex((candidate) => candidate.id === item.id) === idx
            );

            return {
              ...prev,
              [matchId]: sortCommentary(next),
            };
          });

          if (matchId === selectedMatchId) {
            setGlobalViewTick((value) => value + 1);
          }
        }
      });

      socket.addEventListener('close', () => {
        setSocketConnected(false);
        if (closedByEffect) return;
        attempts += 1;
        setReconnectAttempts(attempts);
        const delayMs = Math.min(5000, 600 * 2 ** (attempts - 1));
        reconnectTimer = window.setTimeout(connect, delayMs);
      });

      socket.addEventListener('error', () => {
        socket.close();
      });
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'unsubscribe', matchId: selectedMatchId }));
      }
      socket?.close();
    };
  }, [selectedMatchId, locale, quality]);

  function onLocaleChange(event) {
    const nextLocale = event.target.value;
    localStorage.setItem('lingosports.locale', nextLocale);
    router.push(`/${nextLocale}`);
  }

  const uniqueSports = useMemo(() => {
    const sports = new Set();
    for (const match of matches) {
      if (match.sport) sports.add(String(match.sport).toLowerCase());
    }
    return ['all', ...Array.from(sports)];
  }, [matches]);

  return (
    <main className="app-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <header className="hero-card">
        <div>
          <p className="eyebrow">{t(messages, 'hero.eyebrow', 'Realtime Sports Engine')}</p>
          <h1>{t(messages, 'hero.title', 'LingoSports Global Engine')}</h1>
          <p className="subtitle">{t(messages, 'hero.subtitle', 'Live multilingual commentary in 8 languages')}</p>
        </div>

        <div className="hero-controls">
          <label className="pill-label">
            <span>{t(messages, 'controls.locale', 'Locale')}</span>
            <select value={locale} onChange={onLocaleChange}>
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {code.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="pill-label">
            <span>{t(messages, 'controls.quality', 'Quality')}</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value)}>
              {QUALITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className={`connection-pill ${socketConnected ? 'connected' : 'disconnected'}`}>
            <span className="dot" />
            <span>
              {socketConnected
                ? t(messages, 'connection.connected', 'LIVE CONNECTED')
                : reconnectAttempts > 0
                  ? t(messages, 'connection.reconnecting', 'RECONNECTING')
                  : t(messages, 'connection.connecting', 'CONNECTING')}
            </span>
          </div>
        </div>
      </header>

      <section className="stats-ribbon">
        <article className="stat-card">
          <p>{t(messages, 'stats.coverage', 'Coverage')}</p>
          <strong>{stats ? `${stats.coveragePercent}%` : '--'}</strong>
        </article>
        <article className="stat-card">
          <p>{t(messages, 'stats.cacheHit', 'Cache Hit')}</p>
          <strong>{stats ? `${stats.cacheHitRatio}%` : '--'}</strong>
        </article>
        <article className="stat-card">
          <p>{t(messages, 'stats.latency', 'Avg Latency')}</p>
          <strong>{stats ? `${stats.avgLatencyMs}ms` : '--'}</strong>
        </article>
        <article className="stat-card">
          <p>{t(messages, 'stats.translations', 'Translations')}</p>
          <strong>{stats ? `${stats.translationCount}/${stats.expectedTranslations}` : '--'}</strong>
        </article>
      </section>

      <section className="workspace">
        <section className="panel matches-panel">
          <div className="panel-header">
            <h2>{t(messages, 'matches.title', 'Current Matches')}</h2>
            <div className="panel-actions">
              <select value={sportFilter} onChange={(event) => setSportFilter(event.target.value)}>
                {uniqueSports.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport === 'all' ? t(messages, 'matches.allSports', 'All Sports') : sport}
                  </option>
                ))}
              </select>
              <span className="api-pill">
                {t(messages, 'matches.apiCount', 'API')}: {visibleMatches.length}
              </span>
            </div>
          </div>

          {errorMessage ? <div className="panel-placeholder error">{errorMessage}</div> : null}

          <div className="matches-grid">
            {visibleMatches.map((match) => {
              const isSelected = match.id === selectedMatchId;
              return (
                <article key={match.id} className={`match-card ${isSelected ? 'selected' : ''}`}>
                  <div className="match-top">
                    <span className="sport-pill">{match.sport}</span>
                    <span className={`status ${match.status}`}>{statusLabel(match.status)}</span>
                  </div>

                  <div className="score-row">
                    <p>{match.homeTeam}</p>
                    <span>{safeScore(match.homeScore)}</span>
                  </div>
                  <div className="score-row">
                    <p>{match.awayTeam}</p>
                    <span>{safeScore(match.awayScore)}</span>
                  </div>

                  <div className="match-bottom">
                    <small>{formatTime(match.startTime)}</small>
                    <button type="button" onClick={() => setSelectedMatchId(match.id)}>
                      {isSelected
                        ? t(messages, 'matches.watching', 'Watching')
                        : t(messages, 'matches.watch', 'Watch Live')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="panel commentary-panel">
          <div className="panel-header">
            <h2>{t(messages, 'commentary.title', 'Live Commentary')}</h2>
            <span className="realtime-pill">{quality.toUpperCase()}</span>
          </div>

          <div className="commentary-list">
            {!selectedMatch ? (
              <div className="panel-placeholder">{t(messages, 'commentary.selectPrompt', 'Select a match to stream commentary.')}</div>
            ) : loadingCommentary ? (
              <div className="panel-placeholder">{t(messages, 'commentary.loading', 'Loading commentary...')}</div>
            ) : selectedCommentary.length === 0 ? (
              <div className="panel-placeholder">{t(messages, 'commentary.empty', 'No commentary yet.')}</div>
            ) : (
              selectedCommentary.map((entry) => (
                <article key={entry.id} className="commentary-item">
                  <p className="meta">
                    <span>{formatTime(entry.createdAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="chip">{entry.minute}'</span>
                    <span className={`chip status-pill ${entry.translation?.status || 'fallback-source'}`}>
                      {entry.translation?.status || 'fallback-source'}
                    </span>
                  </p>

                  <p className="actor-line">
                    {[entry.actor, entry.team].filter(Boolean).join(' · ') || t(messages, 'commentary.system', 'System')}
                  </p>
                  <p className="message-card">{entry.message}</p>
                </article>
              ))
            )}
          </div>
        </aside>
      </section>

      <section className="panel global-panel">
        <div className="panel-header">
          <h2>{t(messages, 'globalFanView.title', 'Global Fan View')}</h2>
          <span className="realtime-pill">{t(messages, 'globalFanView.subtitle', 'Same event, every language')}</span>
        </div>

        <div className="global-grid">
          {globalFanView.map((item) => (
            <article key={item.locale} className="global-item">
              <p className="global-locale">{item.locale.toUpperCase()}</p>
              <p className="global-message">{item.message}</p>
              <small className={`status-tag ${item.status}`}>{item.status}</small>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
