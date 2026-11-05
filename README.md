# YouTube → Seerr

A Firefox and Chrome extension that adds a **Request in Seerr** button to movie and TV
trailers on YouTube.

When you open a trailer, the extension parses the video title, searches your
[Seerr](https://github.com/seerr-team/seerr) instance for a match, and puts a
button under the video showing its current status:

| State                  | Click action                                        |
| ---------------------- | --------------------------------------------------- |
| Request _Title (Year)_ | Submits a request (TV requests all seasons)         |
| Requested              | Opens the title in Seerr                            |
| Partially available    | Opens the title in Seerr                            |
| Available              | Opens it on your media server if linked, else Seerr |
| Blocklisted            | Opens the title in Seerr                            |
| Not found              | Searches Seerr for the parsed title                 |

If it picks the wrong match, use the ▾ button next to it to choose another
result or run a manual search.

## Install

```sh
npm install
```

The same Manifest V3 build runs in both browsers.

```sh
npm run build
# -> dist/youtube_seerr-<version>.zip
```

CI also builds the zip on every push to `main` and attaches it to the run as an
artifact.

### Firefox

For development, run `npm start`, or open
`about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and
select `manifest.json`.

For a permanent install, install the zip from `about:addons` → ⚙ → **Install
Add-on From File…**. Release builds of Firefox require the add-on to be signed
through [AMO](https://addons.mozilla.org/developers/) (self-distributed/unlisted
is fine).

Requires Firefox 142 or later.

### Chrome

Open `chrome://extensions`, turn on **Developer mode**, click **Load
unpacked**, and select this folder (or the unzipped build). `npm run
start:chrome` launches a Chromium profile with it loaded.

Chrome will show a warning that `background.scripts` is ignored. That's
expected: Firefox uses `scripts`, and Chrome uses `service_worker`.

## Configure

The settings page opens on first install. After that, click the toolbar icon
(or open the extension's preferences). Set:

- **Seerr URL**: your instance, e.g. `https://seerr.example.com`. The browser
  will prompt for permission to access the host when you save.
- **API key** _(optional)_: from Seerr → Settings → General. If left blank, the
  extension uses your existing browser login session.
- **Username** _(optional, requires an API key)_: requests made with the API
  key are attributed to the admin account by default. Set a Seerr username (or
  display name, email, or Plex/Jellyfin username) to make them on that user's
  behalf instead.

**Save & test** verifies the connection and shows who you're signed in as.

## How it works

- `content.js` runs on `youtube.com`, watches for SPA navigation, and only acts
  on videos whose title contains "trailer" or "teaser". It strips marketing
  noise (studio names, "Official Trailer #2", "In Theaters…", etc.), builds a
  few weighted search candidates, and ranks results by title similarity, year,
  and movie/TV hints.
- `background.js` makes all calls to the Seerr API
  (`/api/v1/search`, `/request`, `/movie|tv/:id`, `/auth/me`, `/user`) so the content
  script never touches your credentials.
- `options.html` / `options.js` store settings in `browser.storage.sync`.

## Development

```sh
npm run format        # prettier --write
npm run format:check  # what CI runs
npm run lint          # web-ext lint
```

## License

[MIT](LICENSE)
