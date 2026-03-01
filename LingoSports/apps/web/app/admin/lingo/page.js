'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson as fetchApiJson, wsBaseUrl } from '@/lib/api';

const DEFAULT_WS_BASE = wsBaseUrl();

function resolveWsUrl() {
  const base = String(DEFAULT_WS_BASE || '').trim();
  if (!base) return '';
  if (window.location.protocol === 'https:' && base.startsWith('ws://')) {
    return `wss://${base.slice('ws://'.length)}`;
  }
  return base;
}

function StatCard({ label, value, hint }) {
  return (
    <article style={styles.card}>
      <p style={styles.cardLabel}>{label}</p>
      <p style={styles.cardValue}>{value}</p>
      {hint ? <p style={styles.cardHint}>{hint}</p> : null}
    </article>
  );
}

export default function AdminLingoPage() {
  const [stats, setStats] = useState(null);
  const [localeStats, setLocaleStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [demoStatus, setDemoStatus] = useState(null);
  const [healthEvent, setHealthEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [spikePending, setSpikePending] = useState(false);

  const localeRows = useMemo(() => {
    const map = localeStats?.locales || {};
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [localeStats]);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [statsRes, localeRes, eventsRes, demoRes] = await Promise.all([
        fetchApiJson('/lingo/stats?quality=fast&windowMin=15'),
        fetchApiJson('/lingo/stats/locales?quality=fast&windowMin=15'),
        fetchApiJson('/lingo/events?quality=fast&limit=40'),
        fetchApiJson('/demo/status'),
      ]);
      setStats(statsRes?.data || null);
      setLocaleStats(localeRes?.data || null);
      setEvents(Array.isArray(eventsRes?.data) ? eventsRes.data : []);
      setDemoStatus(demoRes?.data || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const simulateSpike = useCallback(async () => {
    setSpikePending(true);
    setError('');
    try {
      await fetchApiJson('/demo/simulate-spike', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 12, quality: 'fast' }),
      });
      await loadAll();
    } catch (spikeError) {
      setError(spikeError.message);
    } finally {
      setSpikePending(false);
    }
  }, [loadAll]);

  useEffect(() => {
    void loadAll();
    const timer = window.setInterval(() => {
      void loadAll();
    }, 10000);

    return () => window.clearInterval(timer);
  }, [loadAll]);

  useEffect(() => {
    const wsUrl = resolveWsUrl();
    if (!wsUrl) return undefined;

    let socket = null;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      return undefined;
    }

    socket.addEventListener('open', () => {
      let adminToken = '';
      try {
        adminToken = String(new URLSearchParams(window.location.search).get('adminToken') || '').trim();
      } catch {
        adminToken = '';
      }
      socket.send(JSON.stringify({
        type: 'subscribe_admin',
        channel: 'lingo',
        ...(adminToken ? { adminToken } : {}),
      }));
    });

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'translation_health' && payload.data) {
          setHealthEvent(payload.data);
        }
        if (payload?.type === 'demo_status' && payload.data) {
          setDemoStatus(payload.data);
        }
      } catch {
        // Ignore bad payloads.
      }
    });

    return () => {
      try {
        socket.close();
      } catch {
        // Ignore close errors.
      }
    };
  }, []);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Lingo Proof Dashboard</h1>
          <p style={styles.subtitle}>Realtime translation quality and reliability telemetry</p>
        </div>
        <div style={styles.actions}>
          <button style={styles.button} onClick={() => void loadAll()} type="button">Refresh</button>
          <button style={styles.buttonAccent} onClick={() => void simulateSpike()} type="button" disabled={spikePending}>
            {spikePending ? 'Simulating...' : 'Simulate Spike'}
          </button>
        </div>
      </header>

      {error ? <p style={styles.error}>{error}</p> : null}
      {loading ? <p style={styles.loading}>Loading dashboard...</p> : null}

      <section style={styles.grid}>
        <StatCard label="Coverage" value={`${stats?.coveragePercent ?? 0}%`} hint="Translation coverage" />
        <StatCard label="Cache Hit" value={`${stats?.cacheHitRatio ?? 0}%`} hint="Cache-hit ratio" />
        <StatCard label="P95 Latency" value={`${stats?.p95LatencyMs ?? 0} ms`} hint="Fast mode p95" />
        <StatCard label="Fallback Rate" value={`${stats?.fallbackRatePercent ?? 0}%`} hint="Fallback-source ratio" />
        <StatCard label="Window P95" value={`${stats?.window?.p95LatencyMs ?? 0} ms`} hint="Last 15 min" />
        <StatCard
          label="Lingo Availability"
          value={stats?.availability?.available ? 'Available' : 'Fallback'}
          hint={stats?.availability?.reason || 'ok'}
        />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Demo Session</h2>
        <p style={styles.bodyText}>
          Status: <strong>{demoStatus?.status || 'idle'}</strong> · Active matches:{' '}
          <strong>{demoStatus?.activeMatches ?? 0}</strong> · Socket ready:{' '}
          <strong>{demoStatus?.socketReady ? 'yes' : 'no'}</strong>
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Live Translation Health Event</h2>
        {healthEvent ? (
          <pre style={styles.pre}>{JSON.stringify(healthEvent, null, 2)}</pre>
        ) : (
          <p style={styles.bodyText}>No websocket health event received yet.</p>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Per-Locale Metrics (15 min)</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Locale</th>
              <th style={styles.th}>Translated</th>
              <th style={styles.th}>Cache Hit</th>
              <th style={styles.th}>Fallback</th>
              <th style={styles.th}>Avg Latency</th>
              <th style={styles.th}>P95 Latency</th>
            </tr>
          </thead>
          <tbody>
            {localeRows.map(([locale, row]) => (
              <tr key={locale}>
                <td style={styles.td}>{locale.toUpperCase()}</td>
                <td style={styles.td}>{row.translated}</td>
                <td style={styles.td}>{row.cacheHit}</td>
                <td style={styles.td}>{row.fallback}</td>
                <td style={styles.td}>{row.avgLatencyMs} ms</td>
                <td style={styles.td}>{row.p95LatencyMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Recent Translation Events</h2>
        <div style={styles.logList}>
          {events.map((event) => (
            <article key={event.id} style={styles.logItem}>
              <p style={styles.logMeta}>
                #{event.id} · {event.targetLocale} · {event.status} · {event.quality}
              </p>
              <p style={styles.logMeta}>
                latency={event.latencyMs ?? 0}ms fallback={event.fallbackReason || '-'} at {event.createdAt}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: {
    maxWidth: '1200px',
    margin: '24px auto',
    padding: '0 16px 24px',
    color: '#101014',
    fontFamily: '"Outfit", "Avenir Next", "Segoe UI", sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  title: {
    margin: 0,
    fontSize: '2rem',
  },
  subtitle: {
    margin: '6px 0 0',
    color: '#5d6270',
    fontWeight: 600,
  },
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  button: {
    border: '2px solid #101014',
    borderRadius: '999px',
    padding: '8px 14px',
    background: '#ffffff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  buttonAccent: {
    border: '2px solid #101014',
    borderRadius: '999px',
    padding: '8px 14px',
    background: '#f4db4f',
    fontWeight: 700,
    cursor: 'pointer',
  },
  loading: {
    border: '2px dashed #c6ccd8',
    borderRadius: '12px',
    padding: '14px',
    textAlign: 'center',
    color: '#6b7080',
  },
  error: {
    border: '2px solid #e0a0a0',
    background: '#fff0f0',
    borderRadius: '12px',
    padding: '10px',
    color: '#9f3434',
    fontWeight: 700,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    marginTop: '14px',
  },
  card: {
    border: '2px solid #191b20',
    borderRadius: '14px',
    background: '#f7f7f8',
    padding: '10px',
  },
  cardLabel: {
    margin: 0,
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#636978',
    fontWeight: 700,
  },
  cardValue: {
    margin: '8px 0 0',
    fontSize: '1.3rem',
    fontWeight: 800,
  },
  cardHint: {
    margin: '4px 0 0',
    fontSize: '0.72rem',
    color: '#6f7482',
    fontWeight: 600,
  },
  section: {
    marginTop: '16px',
    border: '2px solid #191b20',
    borderRadius: '14px',
    padding: '12px',
    background: '#f9f9fb',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '1rem',
  },
  bodyText: {
    margin: '8px 0 0',
    fontSize: '0.9rem',
  },
  pre: {
    margin: '8px 0 0',
    borderRadius: '12px',
    background: '#111827',
    color: '#f3f7ff',
    padding: '10px',
    overflowX: 'auto',
    fontSize: '0.76rem',
    lineHeight: 1.4,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '8px',
  },
  th: {
    textAlign: 'left',
    borderBottom: '2px solid #cfd5e2',
    padding: '7px 6px',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  td: {
    borderBottom: '1px solid #dde2ec',
    padding: '7px 6px',
    fontSize: '0.86rem',
    fontWeight: 600,
  },
  logList: {
    display: 'grid',
    gap: '8px',
    marginTop: '8px',
  },
  logItem: {
    border: '1px solid #d6dce8',
    borderRadius: '10px',
    padding: '8px',
    background: '#ffffff',
  },
  logMeta: {
    margin: 0,
    fontSize: '0.78rem',
    color: '#4b5363',
    lineHeight: 1.4,
  },
};
