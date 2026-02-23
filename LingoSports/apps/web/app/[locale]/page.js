import { notFound } from 'next/navigation';
import Script from 'next/script';
import { SUPPORTED_LOCALES, loadMessages, normalizeLocale } from '@/lib/i18n';

export async function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocalePage({ params }) {
  const rawLocale = (await params).locale;
  const locale = normalizeLocale(rawLocale, '');

  if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
    notFound();
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8002';
  const wsBaseUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8002/ws';
  const messagesByLocale = Object.fromEntries(
    await Promise.all(
      SUPPORTED_LOCALES.map(async (code) => [code, await loadMessages(code)])
    )
  );

  const runtimeConfig = {
    apiBaseUrl,
    wsBaseUrl,
    supportedLocales: SUPPORTED_LOCALES,
    messagesByLocale,
    locale,
    quality: 'standard',
  };

  return (
    <>
      <main className="app-shell">
        <header className="hero-card">
          <div>
            <p id="hero-eyebrow" className="eyebrow">Realtime Sports Engine</p>
            <h1>Lingo Sports</h1>
            <p id="hero-subtitle" className="subtitle">Multilingual commentary and scores</p>
          </div>
          <div className="hero-right">
            <label className="locale-pill" htmlFor="language-select">
              <span id="language-label" className="locale-label">Language</span>
              <select id="language-select" className="locale-select" defaultValue={locale}>
                {SUPPORTED_LOCALES.map((code) => (
                  <option key={code} value={code}>{code.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <div id="connection-pill" className="connection-pill disconnected">
              <span className="dot" aria-hidden="true"></span>
              <span id="connection-text">CONNECTING</span>
            </div>
          </div>
        </header>

        <section className="workspace">
          <section className="matches-panel">
            <div className="section-header">
              <h2 id="matches-title">Current Matches</h2>
              <div className="header-controls">
                <label className="sport-filter-wrap" htmlFor="sport-filter">
                  <span id="sport-filter-label" className="sport-filter-label">Sport</span>
                  <select id="sport-filter" className="sport-filter-select" defaultValue="all">
                    <option value="all">All Sports</option>
                  </select>
                </label>
                <span id="api-count" className="api-pill">API: 0</span>
              </div>
            </div>
            <div id="matches-grid" className="matches-grid">
              <div className="panel-placeholder">Loading matches...</div>
            </div>
          </section>

          <aside className="commentary-panel">
            <div className="commentary-header">
              <h2 id="commentary-title">Live Commentary</h2>
              <span id="realtime-pill" className="realtime-pill">Real-time</span>
            </div>
            <div id="commentary-list" className="commentary-list">
              <div className="panel-placeholder">Select a match to start streaming commentary.</div>
            </div>
          </aside>
        </section>
      </main>

      <Script
        id="lingosports-runtime-config"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.__LINGOSPORTS_CONFIG = ${JSON.stringify(runtimeConfig)};`,
        }}
      />
      <Script src="/app-legacy.js" type="module" strategy="afterInteractive" />
    </>
  );
}
