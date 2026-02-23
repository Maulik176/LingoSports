const MATCH_STATUS_PRIORITY = {
  live: 0,
  scheduled: 1,
  finished: 2,
};

const EVENT_STYLES = {
  goal: "good",
  wicket: "good",
  six: "good",
  four: "good",
  ace: "good",
  spike: "good",
  block: "good",
  yellow_card: "warn",
  foul: "warn",
  substitution: "warn",
  set_point: "warn",
  set_end: "warn",
  red_card: "danger",
};

const state = {
  matches: [],
  selectedMatchId: null,
  sportFilter: "all",
  commentaryByMatchId: new Map(),
  loadingCommentary: false,
  socket: null,
  socketConnected: false,
  reconnectAttempts: 0,
  subscribedMatchId: null,
};

const elements = {
  matchesGrid: document.querySelector("#matches-grid"),
  commentaryList: document.querySelector("#commentary-list"),
  apiCount: document.querySelector("#api-count"),
  sportFilter: document.querySelector("#sport-filter"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionText: document.querySelector("#connection-text"),
};

void bootstrap();

async function bootstrap() {
  bindEvents();
  await loadMatches();
  connectWebSocket();
}

function bindEvents() {
  if (elements.sportFilter) {
    elements.sportFilter.addEventListener("change", async (event) => {
      const nextFilter = String(event.target.value || "all").toLowerCase();
      await applySportFilter(nextFilter);
    });
  }

  elements.matchesGrid.addEventListener("click", async (event) => {
    const watchButton = event.target.closest("[data-watch-match]");
    if (watchButton) {
      const matchId = Number.parseInt(watchButton.dataset.watchMatch ?? "", 10);
      if (!Number.isInteger(matchId)) return;
      await setSelectedMatch(matchId);
      return;
    }

    const closeButton = event.target.closest("[data-close-match]");
    if (closeButton) {
      state.selectedMatchId = null;
      renderMatches();
      renderCommentary();
      syncSocketSubscription();
    }
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
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
    const payload = await fetchJson("/matches?limit=100");
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
        Could not load matches. Check if backend is running.
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
  const firstLive = matches.find((match) => match.status === "live");
  return firstLive?.id ?? matches[0].id;
}

function normalizeSport(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getVisibleMatches() {
  if (state.sportFilter === "all") return state.matches;
  return state.matches.filter(
    (match) => normalizeSport(match.sport) === state.sportFilter,
  );
}

function updateApiCount(matches) {
  elements.apiCount.textContent = `API: ${matches.length}`;
}

function sportOptions(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const label = String(match.sport ?? "").trim();
    if (!label) continue;
    const key = normalizeSport(label);
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return Array.from(byKey.entries()).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
}

function syncSportFilterOptions() {
  if (!elements.sportFilter) return;

  const options = sportOptions(state.matches);
  const optionValues = new Set(options.map(([value]) => value));
  if (state.sportFilter !== "all" && !optionValues.has(state.sportFilter)) {
    state.sportFilter = "all";
  }

  const optionsHtml = [
    '<option value="all">All Sports</option>',
    ...options.map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`,
    ),
  ].join("");

  elements.sportFilter.innerHTML = optionsHtml;
  elements.sportFilter.value = state.sportFilter;
}

async function applySportFilter(nextFilter) {
  state.sportFilter = nextFilter || "all";
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

    const leftCreated = Date.parse(left.createdAt || "") || 0;
    const rightCreated = Date.parse(right.createdAt || "") || 0;
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;

    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function renderMatches() {
  const visibleMatches = getVisibleMatches();
  updateApiCount(visibleMatches);

  if (!visibleMatches.length) {
    const filterLabel =
      state.sportFilter === "all"
        ? "matches"
        : `${state.sportFilter} matches`;
    elements.matchesGrid.innerHTML = `
      <div class="panel-placeholder">No ${escapeHtml(filterLabel)} available right now.</div>
    `;
    return;
  }

  const html = visibleMatches
    .map((match) => {
      const isSelected = match.id === state.selectedMatchId;
      const status = match.status || "scheduled";
      const watchLabel =
        isSelected && status === "live" ? "Watching Live" : "Watch Live";

      return `
        <article class="match-card ${isSelected ? "selected" : ""}">
          <div class="match-top">
            <span class="sport-pill">${escapeHtml(match.sport)}</span>
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
                class="watch-btn ${isSelected ? "active" : ""}"
                data-watch-match="${match.id}"
              >
                ${watchLabel}
              </button>
              ${
                isSelected
                  ? '<button class="close-btn" data-close-match="1">Close</button>'
                  : ""
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.matchesGrid.innerHTML = html;
}

function safeScore(value) {
  return Number.isFinite(value) ? String(value) : "0";
}

function statusLabel(status) {
  if (status === "live") return "Live";
  if (status === "finished") return "Finished";
  return "Scheduled";
}

function formatLocalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTimelineTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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

async function ensureCommentaryLoaded(matchId) {
  if (!Number.isInteger(matchId)) return;
  if (state.commentaryByMatchId.has(matchId)) return;

  state.loadingCommentary = true;
  renderCommentary();

  try {
    const payload = await fetchJson(`/matches/${matchId}/commentary?limit=100`);
    const entries = Array.isArray(payload.data) ? payload.data : [];
    state.commentaryByMatchId.set(matchId, sortCommentary(entries));
  } catch (error) {
    state.commentaryByMatchId.set(matchId, []);
  } finally {
    state.loadingCommentary = false;
  }
}

function sortCommentary(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || "") || 0;
    const rightTime = Date.parse(right.createdAt || "") || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;

    const leftSeq = Number(left.sequence || 0);
    const rightSeq = Number(right.sequence || 0);
    return rightSeq - leftSeq;
  });
}

function renderCommentary() {
  if (!Number.isInteger(state.selectedMatchId)) {
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">Select a match to start streaming commentary.</div>
    `;
    return;
  }

  if (state.loadingCommentary) {
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">Loading commentary...</div>
    `;
    return;
  }

  const selectedMatch = findMatchById(state.selectedMatchId);
  const commentary = state.commentaryByMatchId.get(state.selectedMatchId) ?? [];

  if (!commentary.length) {
    elements.commentaryList.innerHTML = `
      <div class="panel-placeholder">No commentary yet for ${escapeHtml(selectedMatch?.homeTeam || "this match")}.</div>
    `;
    return;
  }

  const html = commentary
    .map((entry) => {
      const eventType = formatEventType(entry.eventType);
      const eventStyle = EVENT_STYLES[String(entry.eventType).toLowerCase()] || "warn";
      const actorLine = [entry.actor, entry.team].filter(Boolean).join(" · ");
      const tags = Array.isArray(entry.tags) ? entry.tags : [];

      return `
        <article class="commentary-item">
          <p class="commentary-meta">
            <span>${escapeHtml(formatTimelineTime(entry.createdAt))}</span>
            ${
              Number.isFinite(entry.minute)
                ? `<span class="chip">${entry.minute}'</span>`
                : ""
            }
            ${
              entry.period
                ? `<span class="chip">${escapeHtml(entry.period)}</span>`
                : ""
            }
            <span class="chip event ${eventStyle}">${escapeHtml(eventType)}</span>
          </p>

          ${
            actorLine
              ? `<p class="actor-line">${escapeHtml(actorLine)}</p>`
              : ""
          }

          <p class="message-card">${escapeHtml(entry.message || "Update")}</p>

          ${
            tags.length
              ? `
                <div class="tags-row">
                  ${tags
                    .map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`)
                    .join("")}
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");

  elements.commentaryList.innerHTML = html;
}

function formatEventType(eventType) {
  if (!eventType) return "UPDATE";
  return String(eventType).replace(/_/g, " ").toUpperCase();
}

function findMatchById(matchId) {
  return state.matches.find((match) => match.id === matchId) || null;
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const socket = new WebSocket(wsUrl);

  state.socket = socket;
  setConnectionState(false);

  socket.addEventListener("open", () => {
    state.reconnectAttempts = 0;
    state.subscribedMatchId = null;
    setConnectionState(true);
    syncSocketSubscription();
  });

  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    handleSocketMessage(payload);
  });

  socket.addEventListener("close", () => {
    setConnectionState(false);
    state.subscribedMatchId = null;
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    socket.close();
  });
}

function setConnectionState(isConnected) {
  state.socketConnected = isConnected;
  elements.connectionPill.classList.toggle("connected", isConnected);
  elements.connectionPill.classList.toggle("disconnected", !isConnected);
  elements.connectionText.textContent = isConnected
    ? "LIVE CONNECTED"
    : state.reconnectAttempts > 0
      ? "RECONNECTING"
      : "CONNECTING";
}

function handleSocketMessage(payload) {
  if (!payload || typeof payload !== "object") return;

  if (payload.type === "welcome") {
    syncSocketSubscription();
    return;
  }

  if (payload.type === "match_created" && payload.data) {
    upsertMatch(payload.data);
    renderMatches();
    return;
  }

  if (payload.type === "match_updated" && payload.data) {
    upsertMatch(payload.data);
    renderMatches();
    return;
  }

  if (payload.type === "commentary" && payload.data) {
    pushLiveCommentary(payload.data);
    return;
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

function pushLiveCommentary(entry) {
  const matchId = Number(entry.matchId);
  if (!Number.isInteger(matchId)) return;

  const existing = state.commentaryByMatchId.get(matchId) ?? [];
  const deduped = [entry, ...existing].filter(
    (item, index, arr) =>
      arr.findIndex((candidate) => candidate.id === item.id) === index,
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
        type: "unsubscribe",
        matchId: state.subscribedMatchId,
      }),
    );
    state.subscribedMatchId = null;
  }

  if (
    Number.isInteger(nextMatchId) &&
    state.subscribedMatchId !== nextMatchId
  ) {
    socket.send(
      JSON.stringify({
        type: "subscribe",
        matchId: nextMatchId,
      }),
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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
