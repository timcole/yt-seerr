'use strict';

// Chrome only exposes the promise-based APIs as `chrome`.
globalThis.browser ??= chrome;

/* ------------------------------------------------------------------ *
 * Title parsing
 * ------------------------------------------------------------------ */

const TRAILER_RE = /\b(trailers?|teasers?)\b/i;

// "Official Trailer #2", "Final Teaser Trailer", "Red Band Trailer 2", etc.
const TRAILER_PHRASE_RE = new RegExp(
  String.raw`(?:\b(?:the|official|final|new|main|first|second|third|full|international|exclusive|extended|red[\s-]?band|green[\s-]?band|uk|us|hd|4k|uhd|launch|announcement|release|date|special|look|sneak|peek)\s+)*` +
    String.raw`\b(?:teaser\s+)?(?:trailers?|teasers?)\b(?:\s*(?:#|no\.?\s*)?\d+\b)?`,
  'gi',
);

// Marketing tails that aren't part of the title.
const TAIL_RE =
  /\b(?:(?:only|now|exclusively|coming)\s+)?(?:in\s+(?:theaters|theatres|cinemas)|streaming|playing|on\s+(?:netflix|disney\+?|prime\s+video|hulu|max|hbo\s+max|apple\s+tv\+?|peacock|paramount\+?))\b.*$/i;

const STUDIOS = new Set(
  [
    'netflix',
    'disney',
    'disney+',
    'pixar',
    'marvel',
    'marvel entertainment',
    'marvel studios',
    'dc',
    'warner bros',
    'warner bros.',
    'warner bros pictures',
    'universal',
    'universal pictures',
    'sony',
    'sony pictures',
    'sony pictures entertainment',
    'paramount',
    'paramount pictures',
    'paramount+',
    '20th century studios',
    'lionsgate',
    'a24',
    'neon',
    'focus features',
    'searchlight pictures',
    'mgm',
    'amazon mgm studios',
    'prime video',
    'amazon prime video',
    'apple tv',
    'apple tv+',
    'hbo',
    'hbo max',
    'max',
    'hulu',
    'peacock',
    'blumhouse',
    'illumination',
    'dreamworks',
    'movieclips',
    'movieclips trailers',
    'rotten tomatoes trailers',
    'ign',
    'fandango',
    'kinocheck',
    'imdb',
    'official',
    'hd',
    '4k',
  ].map(norm),
);

function norm(s) {
  return (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseTrailerTitle(rawTitle, channelName) {
  if (!rawTitle || !TRAILER_RE.test(rawTitle)) return null;

  let title = rawTitle.replace(/\s+/g, ' ').trim();

  let year = null;
  const yearMatch = title.match(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  const tvHint = /\b(season|series|s\d{1,2}\b|limited series|episode)\b/i.test(
    title,
  );

  // Drop bracketed bits: (2024), [4K], (Official Trailer)...
  title = title.replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ');

  // Split on strong separators. Hyphens only count when spaced, so
  // "Spider-Man" survives but "Movie - Official Trailer" splits. The trailer
  // phrase is a separator too: in "ETERNAL RETURN Trailer (2026) Naomi Scott"
  // what follows it is cast, not title. `cut` marks those trailing pieces.
  const segments = [];
  for (const part of title.split(/\s*[|•–—~]\s*|\s+-\s+|\s*\/\/\s*/)) {
    part
      .split(TRAILER_PHRASE_RE)
      .forEach((text, i) => segments.push({ text, cut: i > 0 }));
  }

  const channel = norm(channelName);
  const segs = [];

  for (const { text, cut } of segments) {
    const seg = text
      .replace(TAIL_RE, ' ')
      .replace(/\b(?:season|series)\s+\d+\b/gi, ' ')
      .replace(/\bs\d{1,2}\b/gi, ' ')
      .replace(/^\s*[:\-–,.]+|[:\-–,.]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!year) {
      const bareYear = seg.match(/^((?:19|20)\d{2})$/);
      if (bareYear) {
        year = parseInt(bareYear[1], 10);
        continue;
      }
    }

    const n = norm(seg);
    if (!n || n.length < 2) continue;
    if (STUDIOS.has(n) || (channel && n === channel)) continue;
    segs.push({ text: seg, cut });
  }
  if (!segs.length) return null;

  // Weighted candidates: the full first segment is the best guess; fragments
  // count for less so "Dune" doesn't beat "Dune: Part Two".
  const candidates = [];
  const add = (q, w) => {
    q = q.trim();
    if (norm(q).length < 2 || candidates.some((c) => norm(c.q) === norm(q)))
      return;
    candidates.push({ q, w });
  };
  add(segs[0].text, 1);
  // "Mission: Impossible – The Final Reckoning" splits on the dash, but don't
  // glue the title to whatever followed the word "Trailer".
  if (segs.length > 1 && !segs[1].cut)
    add(`${segs[0].text} ${segs[1].text}`, 1);
  for (const s of segs.slice(1)) add(s.text, s.cut ? 0.75 : 0.9);
  for (const { text } of segs) {
    if (text.includes(':')) for (const part of text.split(':')) add(part, 0.85);
  }

  return {
    candidates: candidates.slice(0, 5),
    query: segs[0].text,
    year,
    tvHint,
  };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

function bigrams(s) {
  const out = new Map();
  const str = s.replace(/ /g, '');
  for (let i = 0; i < str.length - 1; i++) {
    const g = str.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Drop leading article differences.
  const strip = (s) => s.replace(/^(the|a|an) /, '');
  if (strip(a) === strip(b)) return 0.98;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, c] of A) {
    inter += Math.min(c, B.get(g) || 0);
    total += c;
  }
  for (const c of B.values()) total += c;
  return total ? (2 * inter) / total : 0;
}

function resultTitle(r) {
  return r.mediaType === 'movie' ? r.title : r.name;
}

function resultYear(r) {
  const d = r.mediaType === 'movie' ? r.releaseDate : r.firstAirDate;
  return d ? parseInt(d.slice(0, 4), 10) : null;
}

function scoreResult(r, parsed, index) {
  const titles = [
    resultTitle(r),
    r.mediaType === 'movie' ? r.originalTitle : r.originalName,
  ];
  let sim = 0;
  for (const c of parsed.candidates) {
    for (const t of titles) sim = Math.max(sim, similarity(c.q, t) * c.w);
  }
  let score = sim;
  const ry = resultYear(r);
  if (parsed.year && ry) {
    const diff = Math.abs(parsed.year - ry);
    if (diff === 0) score += 0.15;
    else if (diff === 1) score += 0.08;
    else score -= 0.1;
  } else if (!parsed.year && ry) {
    // Trailers are usually for upcoming / recent releases.
    const now = new Date().getFullYear();
    if (ry >= now - 1) score += 0.05;
  }
  if (parsed.tvHint ? r.mediaType === 'tv' : r.mediaType === 'movie')
    score += 0.06;
  score += Math.min((r.popularity || 0) / 2000, 0.03);
  score -= index * 0.01;
  return { sim, score };
}

/* ------------------------------------------------------------------ *
 * Messaging
 * ------------------------------------------------------------------ */

async function send(msg) {
  const res = await browser.runtime.sendMessage(msg);
  if (!res || !res.ok)
    throw new Error(res ? res.error : 'No response from extension');
  return res.data;
}

let seerrUrl = '';
send({ type: 'config' })
  .then((c) => (seerrUrl = c.url))
  .catch(() => {});
browser.storage.onChanged.addListener((changes) => {
  if (changes.url)
    seerrUrl = (changes.url.newValue || '').trim().replace(/\/+$/, '');
  if (changes.url || changes.apiKey || changes.username) {
    cache.clear();
    lastKey = null;
  }
});

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

const cache = new Map(); // key -> Promise<{ best, results, parsed }>

async function lookup(parsed) {
  const queries = parsed.candidates.slice(0, 3).map((c) => c.q);
  const settled = await Promise.allSettled(
    queries.map((query) => send({ type: 'search', query })),
  );
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;

  const pool = new Map(); // "type:id" -> { r, score, sim }
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    s.value.forEach((r, i) => {
      const id = `${r.mediaType}:${r.id}`;
      const scored = scoreResult(r, parsed, i);
      const prev = pool.get(id);
      if (!prev || scored.score > prev.score) pool.set(id, { r, ...scored });
    });
  }

  const ranked = [...pool.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0] && ranked[0].sim >= 0.6 ? ranked[0].r : null;
  return { best, results: ranked.slice(0, 8).map((p) => p.r), parsed };
}

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

const STATUS = {
  UNKNOWN: 1,
  PENDING: 2,
  PROCESSING: 3,
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
  BLOCKLISTED: 6,
  DELETED: 7,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(pathD) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', pathD);
  p.setAttribute('fill', 'currentColor');
  svg.appendChild(p);
  return svg;
}

const ICONS = {
  plus: 'M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  clock:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  play: 'M8 5v14l11-7z',
  search:
    'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  alert: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
  block:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.32L5.68 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.68L18.32 7.1A7.9 7.9 0 0 1 20 12a8 8 0 0 1-8 8z',
  caret: 'M7 10l5 5 5-5z',
};

function spinner() {
  const s = document.createElement('span');
  s.className = 'seerr-spinner';
  return s;
}

function labelFor(r) {
  const y = resultYear(r);
  return y ? `${resultTitle(r)} (${y})` : resultTitle(r);
}

function pageUrl(r) {
  return `${seerrUrl}/${r.mediaType}/${r.id}`;
}

function open(url) {
  window.open(url, '_blank', 'noopener');
}

let wrap = null;
let menu = null;
let currentState = null;

function ensureWrap() {
  if (wrap && wrap.isConnected) return wrap;

  const meta = document.querySelector('ytd-watch-metadata');
  if (!meta) return null;

  wrap = document.createElement('div');
  wrap.className = 'seerr-wrap';

  const owner = meta.querySelector('#owner');
  const title = meta.querySelector('#title');
  if (owner) owner.appendChild(wrap);
  else if (title) title.insertAdjacentElement('afterend', wrap);
  else return null;

  return wrap;
}

function removeWrap() {
  if (wrap) wrap.remove();
  wrap = null;
  menu = null;
  currentState = null;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function render(state) {
  currentState = state;
  const el = ensureWrap();
  if (!el) return false;
  clear(el);
  menu = null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `seerr-btn seerr-${state.kind}`;
  const text = document.createElement('span');
  text.className = 'seerr-text';

  const r = state.result;

  switch (state.kind) {
    case 'loading':
      btn.appendChild(spinner());
      text.textContent = state.text || 'Checking Seerr…';
      btn.disabled = true;
      break;

    case 'request':
      btn.appendChild(icon(ICONS.plus));
      text.textContent = `Request ${labelFor(r)}`;
      btn.title = 'Request in Seerr';
      btn.addEventListener('click', () => doRequest(state));
      break;

    case 'requested':
      btn.appendChild(icon(ICONS.clock));
      text.textContent = state.justRequested
        ? `Requested ${labelFor(r)}`
        : `Requested · ${labelFor(r)}`;
      btn.title = 'Open in Seerr';
      btn.addEventListener('click', () => open(pageUrl(r)));
      break;

    case 'partial':
      btn.appendChild(icon(ICONS.play));
      text.textContent = `Partially available · ${labelFor(r)}`;
      btn.title = 'Open in Seerr';
      btn.addEventListener('click', () => open(pageUrl(r)));
      break;

    case 'available':
      btn.appendChild(icon(ICONS.check));
      text.textContent = `Available · ${labelFor(r)}`;
      btn.title =
        r.mediaInfo && r.mediaInfo.mediaUrl ? 'Watch now' : 'Open in Seerr';
      btn.addEventListener('click', () =>
        open((r.mediaInfo && r.mediaInfo.mediaUrl) || pageUrl(r)),
      );
      break;

    case 'blocked':
      btn.appendChild(icon(ICONS.block));
      text.textContent = `Blocklisted · ${labelFor(r)}`;
      btn.title = 'Open in Seerr';
      btn.addEventListener('click', () => open(pageUrl(r)));
      break;

    case 'nomatch':
      btn.appendChild(icon(ICONS.search));
      text.textContent = 'Not found in Seerr';
      btn.title = `Search Seerr for “${state.query}”`;
      btn.addEventListener('click', () =>
        open(`${seerrUrl}/search?query=${encodeURIComponent(state.query)}`),
      );
      break;

    case 'error':
      btn.appendChild(icon(ICONS.alert));
      text.textContent = state.error;
      btn.title = 'Open extension settings';
      btn.addEventListener('click', () =>
        send({ type: 'openOptions' }).catch(() => {}),
      );
      break;
  }

  btn.appendChild(text);
  el.appendChild(btn);

  // Alternate-match picker
  if (state.results && state.results.length && state.kind !== 'loading') {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'seerr-more';
    more.title = 'Wrong match? Pick another';
    more.appendChild(icon(ICONS.caret));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(state);
    });
    el.appendChild(more);
  }
  return true;
}

function toggleMenu(state) {
  if (menu) {
    menu.remove();
    menu = null;
    return;
  }
  menu = document.createElement('div');
  menu.className = 'seerr-menu';

  for (const r of state.results) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'seerr-item';
    if (
      state.result &&
      r.id === state.result.id &&
      r.mediaType === state.result.mediaType
    ) {
      item.classList.add('seerr-current');
    }
    const t = document.createElement('span');
    t.textContent = labelFor(r);
    const badge = document.createElement('span');
    badge.className = 'seerr-badge';
    badge.textContent = r.mediaType === 'tv' ? 'TV' : 'Movie';
    item.append(t, badge);
    item.addEventListener('click', () => {
      const entry = cache.get(lastKey);
      if (entry) entry.then((d) => (d.best = r));
      showResult(r, state.results, state.query);
    });
    menu.appendChild(item);
  }

  const searchLink = document.createElement('button');
  searchLink.type = 'button';
  searchLink.className = 'seerr-item seerr-search';
  searchLink.textContent = `Search Seerr for “${state.query}”`;
  searchLink.addEventListener('click', () =>
    open(`${seerrUrl}/search?query=${encodeURIComponent(state.query)}`),
  );
  menu.appendChild(searchLink);

  wrap.appendChild(menu);
}

document.addEventListener('click', (e) => {
  if (menu && wrap && !wrap.contains(e.target)) {
    menu.remove();
    menu = null;
  }
});

function stateFor(r) {
  const status = r.mediaInfo ? r.mediaInfo.status : STATUS.UNKNOWN;
  switch (status) {
    case STATUS.PENDING:
    case STATUS.PROCESSING:
      return 'requested';
    case STATUS.PARTIALLY_AVAILABLE:
      return 'partial';
    case STATUS.AVAILABLE:
      return 'available';
    case STATUS.BLOCKLISTED:
      return 'blocked';
    default:
      return 'request';
  }
}

function showResult(r, results, query) {
  render({ kind: stateFor(r), result: r, results, query });
}

async function doRequest(state) {
  const r = state.result;
  const key = lastKey;
  render({ ...state, kind: 'loading', text: `Requesting ${resultTitle(r)}…` });
  try {
    const req = await send({
      type: 'request',
      mediaType: r.mediaType,
      mediaId: r.id,
    });
    r.mediaInfo = Object.assign({}, r.mediaInfo, {
      status: (req && req.media && req.media.status) || STATUS.PENDING,
    });
    if (r.mediaInfo.status === STATUS.UNKNOWN)
      r.mediaInfo.status = STATUS.PENDING;
    if (key === lastKey)
      render({ ...state, kind: stateFor(r), justRequested: true });
  } catch (e) {
    if (key === lastKey) {
      // "already requested" style errors: refresh status from the server.
      try {
        const d = await send({
          type: 'details',
          mediaType: r.mediaType,
          mediaId: r.id,
        });
        if (d && d.mediaInfo) r.mediaInfo = d.mediaInfo;
      } catch {
        /* ignore */
      }
      if (stateFor(r) !== 'request') render({ ...state, kind: stateFor(r) });
      else
        render({
          ...state,
          kind: 'error',
          error: `Request failed: ${e.message}`,
        });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Page watching (YouTube is a SPA)
 * ------------------------------------------------------------------ */

let lastKey = null;
let pendingKey = null;

function currentVideo() {
  if (location.pathname !== '/watch') return null;
  const id = new URLSearchParams(location.search).get('v');
  if (!id) return null;

  const flexy = document.querySelector('ytd-watch-flexy');
  if (
    flexy &&
    flexy.getAttribute('video-id') &&
    flexy.getAttribute('video-id') !== id
  ) {
    return null; // metadata hasn't caught up yet
  }
  const h1 = document.querySelector('ytd-watch-metadata #title h1');
  const title = h1 && h1.textContent.trim();
  if (!title) return null;
  const channelEl = document.querySelector(
    'ytd-watch-metadata #owner #channel-name a',
  );
  const channel = channelEl ? channelEl.textContent.trim() : '';
  return { id, title, channel };
}

async function tick() {
  const v = currentVideo();
  if (!v) {
    if (location.pathname !== '/watch') {
      removeWrap();
      lastKey = null;
    }
    return;
  }

  const key = `${v.id}|${v.title}`;

  // Same video, already handled; just make sure our button is still mounted
  // (YouTube sometimes re-renders the metadata block).
  if (key === lastKey) {
    if (currentState && (!wrap || !wrap.isConnected)) render(currentState);
    return;
  }

  // Require the title to be stable for two ticks to avoid acting on the
  // previous video's title during SPA navigation.
  if (pendingKey !== key) {
    pendingKey = key;
    return;
  }

  lastKey = key;
  const parsed = parseTrailerTitle(v.title, v.channel);
  if (!parsed) {
    removeWrap();
    return;
  }

  render({ kind: 'loading' });

  if (!cache.has(key)) {
    const p = lookup(parsed);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }

  try {
    const d = await cache.get(key);
    if (key !== lastKey) return;
    const query = parsed.query;
    if (d.best) showResult(d.best, d.results, query);
    else render({ kind: 'nomatch', results: d.results, query });
  } catch (e) {
    if (key !== lastKey) return;
    // Stays until the next video or a settings change (which resets lastKey).
    render({ kind: 'error', error: e.message });
  }
}

setInterval(tick, 600);
document.addEventListener('yt-navigate-finish', () => setTimeout(tick, 100));
tick();
