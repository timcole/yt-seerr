'use strict';

// Chrome only exposes the promise-based APIs as `chrome`.
globalThis.browser ??= chrome;

const DEFAULTS = {
  url: '',
  apiKey: '',
  username: '',
};

async function getConfig() {
  const cfg = await browser.storage.sync.get(DEFAULTS);
  cfg.url = (cfg.url || '').trim().replace(/\/+$/, '');
  cfg.apiKey = (cfg.apiKey || '').trim();
  cfg.username = (cfg.username || '').trim();
  return cfg;
}

// Seerr's query validator rejects characters that encodeURIComponent
// leaves alone, so escape those too.
function encodeQuery(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function api(path, opts) {
  const cfg = await getConfig();
  if (!cfg.url) throw new Error('Set up Seerr');
  if (cfg.username && !cfg.apiKey) {
    throw new Error('A username requires an API key');
  }
  const userId = await resolveUserId(cfg);
  return fetchApi(cfg, path, { ...opts, userId });
}

// Username -> Seerr user id. Resolved once per url/key/username combo.
let userCache = null;
browser.storage.onChanged.addListener(() => {
  userCache = null;
});

function resolveUserId(cfg) {
  if (!cfg.username) return null;
  const key = [cfg.url, cfg.apiKey, cfg.username].join('\n');
  if (!userCache || userCache.key !== key) {
    const promise = findUser(cfg);
    userCache = { key, promise };
    promise.catch(() => {
      if (userCache && userCache.promise === promise) userCache = null;
    });
  }
  return userCache.promise;
}

async function findUser(cfg) {
  const want = cfg.username.toLowerCase();
  const take = 100;
  for (let skip = 0; ; skip += take) {
    const page = await fetchApi(cfg, `/user?take=${take}&skip=${skip}`);
    const users = (page && page.results) || [];
    const match = users.find((u) =>
      [u.username, u.displayName, u.email, u.plexUsername, u.jellyfinUsername]
        .filter(Boolean)
        .some((name) => name.toLowerCase() === want),
    );
    if (match) return match.id;
    if (users.length < take) break;
  }
  throw new Error(`No Seerr user named "${cfg.username}"`);
}

async function fetchApi(cfg, path, { method = 'GET', body, userId } = {}) {
  const headers = { Accept: 'application/json' };
  if (cfg.apiKey) headers['X-Api-Key'] = cfg.apiKey;
  // With an API key, Seerr acts as the admin unless told which user to act as.
  if (userId != null) headers['X-Api-User'] = String(userId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(cfg.url + '/api/v1' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Falls back to your browser login session if no API key is set.
      credentials: cfg.apiKey ? 'omit' : 'include',
    });
  } catch (e) {
    throw new Error(`Can't reach Seerr at ${cfg.url}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      cfg.apiKey
        ? 'Seerr rejected the API key'
        : 'Not signed in. Add an API key in the extension settings',
    );
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new Error((data && data.message) || `Seerr error ${res.status}`);
  }
  return data;
}

async function search(query) {
  const data = await api(`/search?query=${encodeQuery(query)}&page=1`);
  return (data?.results || []).filter(
    (r) => r.mediaType === 'movie' || r.mediaType === 'tv',
  );
}

async function request(mediaType, mediaId) {
  const body = { mediaType, mediaId };
  if (mediaType === 'tv') body.seasons = 'all';
  return api('/request', { method: 'POST', body });
}

async function details(mediaType, mediaId) {
  return api(`/${mediaType}/${mediaId}`);
}

async function handle(msg) {
  try {
    switch (msg.type) {
      case 'config': {
        const cfg = await getConfig();
        return { ok: true, data: { url: cfg.url } };
      }
      case 'search':
        return { ok: true, data: await search(msg.query) };
      case 'details':
        return { ok: true, data: await details(msg.mediaType, msg.mediaId) };
      case 'request':
        return { ok: true, data: await request(msg.mediaType, msg.mediaId) };
      case 'test':
        return { ok: true, data: await api('/auth/me') };
      case 'openOptions':
        await browser.runtime.openOptionsPage();
        return { ok: true, data: null };
      default:
        return { ok: false, error: 'Unknown message' };
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Chrome ignores a promise returned from the listener, so reply through
// sendResponse and return true to keep the channel open.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse);
  return true;
});

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

// There's no default instance, so prompt for one on first install.
browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.runtime.openOptionsPage();
});
