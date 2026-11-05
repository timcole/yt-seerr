'use strict';

// Chrome only exposes the promise-based APIs as `chrome`.
globalThis.browser ??= chrome;

const DEFAULTS = { url: '', apiKey: '', username: '' };
const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  $('status').textContent = text;
  $('status').className = cls || '';
}

// A username only means something alongside an API key.
function syncUsername() {
  const hasKey = !!$('apiKey').value.trim();
  $('username').disabled = !hasKey;
  $('username').placeholder = hasKey ? 'Optional' : 'Requires an API key';
}

async function load() {
  const cfg = await browser.storage.sync.get(DEFAULTS);
  $('url').value = cfg.url;
  $('apiKey').value = cfg.apiKey;
  $('username').value = cfg.username;
  syncUsername();
}

async function save() {
  let url = $('url').value.trim().replace(/\/+$/, '');
  const apiKey = $('apiKey').value.trim();
  const username = apiKey ? $('username').value.trim() : '';

  if (!url) {
    setStatus('Enter your Seerr URL', 'err');
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  $('url').value = url;

  // Host permission must be requested synchronously from the click handler,
  // before any other await.
  let origin;
  try {
    origin = new URL(url).origin + '/*';
  } catch {
    setStatus('Invalid URL', 'err');
    return;
  }
  const granted = await browser.permissions.request({ origins: [origin] });
  if (!granted) {
    setStatus('Permission to access that host was denied', 'err');
    return;
  }

  await browser.storage.sync.set({ url, apiKey, username });
  setStatus('Testing…');

  const res = await browser.runtime.sendMessage({ type: 'test' });
  if (res && res.ok) {
    const who =
      res.data.displayName || res.data.username || res.data.email || 'user';
    setStatus(`Connected as ${who}`, 'ok');
  } else {
    setStatus(res ? res.error : 'No response', 'err');
  }
}

$('apiKey').addEventListener('input', syncUsername);
$('save').addEventListener('click', save);
load();
