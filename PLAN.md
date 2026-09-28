# Gaia — plan

A live 3D globe of the natural world: earthquakes, volcanoes, storms, fires,
floods, sea ice, wind and weather. It runs on every Nexiom box, in the browser
and on the TV (an app you drive with the remote, which is also the TV's
screensaver).

Written 2026-09-28, before any code. Update it as decisions change. The
brief below records the choices made with Thom that day.

## Decided (with Thom)

- **Our own code, not a fork.** [JhonRiv21/Radar](https://github.com/JhonRiv21/Radar)
  is the look and feel to beat, but it has no licence, so none of its code is
  copied. We use the same public feeds.
- **Its own repo** (`~/Developer/Gaia`, later `superthom196/gaia`), like CRATE
  and Cinematica. Nexiom only pulls the image.
- **Name:** Gaia. Image `ghcr.io/superthom196/gaia`, web address `gaia.<domain>`.
- **Main view:** a 3D globe with layers you switch on and off.
- **In Nexiom:** a base service (on every box), `pillar = "home"`.
- **TV:** a TV app (the remote spins the globe and steps through events) that
  is also the TV's screensaver.
- **Web and TV are built together**, not the TV afterwards.
- **First extras beyond Radar:** ice sheets and sea ice, live wind and
  weather, and more detail on volcanoes. Faster updates come anyway, because
  the box fetches the data itself.

## Brief (agreed with Thom, 2026-09-28)

What the first build delivers, settled in one round of questions.

- **Scope:** the full skeleton (phases 0 and 1) plus the real page layout
  with live events: FastAPI backend, scheduler, `/data` snapshots,
  `/api/status`, Dockerfile, image workflow, TV app shell.
- **The TV does no 3D work.** The box renders the globe and streams it to
  the TV over **WebRTC** (about 100–200 ms, so the remote feels live). The
  TV app plays the stream and sends key presses back.
  - One **shared ambient stream** for every TV in screensaver mode. A TV gets
    **its own interactive stream** when someone presses a button, and drops
    back to the shared one when idle.
  - **Quality levels, picked automatically** from the box's hardware, with an
    admin override: **Lite** (720p, no wind particles, static clouds, no
    night lights: for thin clients like a T630), **Standard** (1080p30),
    **High** (1080p60).
- **Browsers render the globe themselves.** Only TVs are streamed. The
  renderer on the box is the same page in headless Chromium, so there's one
  code base.
- **Engine:** my call, since the TV only shows video. Start with MapLibre GL
  v5 globe, and fall back to globe.gl/three.js if wind particles fail.
- **Look:** scientific instrument, **dark and neutral**: a graphite
  background, off-white hairlines and graticule, monospaced numbers, colour
  only on event markers.
- **Desktop layout:** the globe fills the screen, with floating collapsible
  panels (layers on the left, latest events and sea ice on the right,
  credits and feed status along the bottom). The **event card opens next to
  its marker**.
- **Markers:** coloured **by kind, with a shape per kind** (quake circle,
  volcano triangle, storm spiral, fire flame, ice diamond, flood drop).
  Severity shows as size.
- **On at first load:** earthquakes (**M4.5+, past day**), storms, fires and
  floods, volcanoes, wind particles.
- **Extras in the first build:** near-live **infrared clouds** (GIBS
  GOES-East, GOES-West and Himawari band 13, every 10 min, day and night,
  instead of MODIS daily composites with seams), **storm tracks** (EONET
  history), **quake clusters** ("6 quakes near Tadine").
- **Login:** Gaia is **open on the LAN** (a new Nexiom manifest field, done
  in phase 7) and behind the household login away from home.
- **Units:** metric, 24-hour, the box's local time.
- **Remote:** as in "TV app" below. **Screensaver:** slow spin, and every
  ~60 s it flies to a recent event and shows its card for 15–20 s.
- **Phones:** later.
- **Repo:** a local git repo plus a **private GitHub repo**
  `superthom196/gaia`, with commits as the work goes.
- **Testing:** deploy straight to **nexiom0** (Ryzen 3 2200GE, Vega iGPU,
  `/dev/dri/renderD128`) as its own compose project, `/opt/gaia`, on
  `127.0.0.1:8040`, outside Nexiom releases until phase 7.

## How it works

One container:

- **Backend:** Python 3.13 and FastAPI, like CRATE and Nexiom. An in-process
  scheduler fetches each feed on its own interval, turns it into Gaia's own
  shapes, and writes the latest snapshot to `/data` (JSON, plus PNG textures
  for wind and weather). No database, no API keys, no accounts. If a feed
  fails, the last good snapshot stays up with its age shown.
- **Frontend:** static files served by the same app. The browser only calls
  Gaia's `/api/*`, plus NASA GIBS for satellite image tiles.
- **Image:** `python:3.13-slim`, multi-arch (amd64 and arm64), built by GitHub
  Actions on each `vX.Y.Z` tag. Copy CRATE's `.github/workflows/image.yml`.
  Nexiom's "Debian packages only" rule is for the box itself. Inside Gaia's
  image, pip is fine.

Proposed API (keep it this small until something needs more):

| Route | Returns |
|---|---|
| `GET /api/events` | Every current event as one GeoJSON FeatureCollection with the same properties throughout: `kind`, `title`, `severity`, `started`, `updated`, `source`, `link` |
| `GET /api/volcanoes` | Volcanoes with their current alert level and the latest weekly-report text |
| `GET /api/ice` | Arctic and Antarctic sea-ice extent today, against the 1981–2010 normal for the same day |
| `GET /api/weather/{field}.png` + `.json` | The latest GFS field as a texture, plus its range and run time (`wind`, `temp`, `rain`) |
| `GET /api/status` | Each feed's last success, age and error, for the page's footer and for Nexiom's `status.sh` |

## Data sources

All free and keyless. Every one responded on 2026-09-28 unless noted.

| Layer | Source | Refresh | Notes |
|---|---|---|---|
| Earthquakes | USGS GeoJSON `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` (plus `all_week` for context) | 1 min | Public domain |
| Storms, fires, floods, ice events, volcanoes | NASA EONET v3 `eonet.gsfc.nasa.gov/api/v3/events?status=open` | 15 min | Overlaps with GDACS, so remove duplicates by kind, place and time |
| Disaster alert levels | GDACS `www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF` (or `www.gdacs.org/xml/rss.xml`) | 15 min | Green, Orange or Red severity. The bare `/MAP` endpoint returned 400. Check the terms of use |
| Volcano list | Smithsonian GVP Holocene volcanoes | Ships in the image | The GVP web service (`webservices.volcano.si.edu`) timed out, so bundle the list as a data file and refresh it by hand now and then |
| Volcano activity | GVP weekly report RSS `volcano.si.edu/news/WeeklyVolcanoRSS.xml` | 6 h (published weekly) | Shown as text on the volcano's card |
| US volcano alert levels | USGS HANS `volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes` | 30 min | US only; other countries through GDACS and EONET |
| Sea ice (map) | NASA GIBS WMTS `AMSRU2_Sea_Ice_Concentration_12km` (EPSG:3857) | Daily | Loaded by the browser straight from GIBS |
| Sea ice (numbers) | NSIDC Sea Ice Index v4 `noaadata.apps.nsidc.org/NOAA/G02135/{north,south}/daily/data/*_seaice_extent_daily_v4.0.csv` and `..._climatology_1981-2010_v4.0.csv` | Daily | It's v4 now, not v3 |
| Snow | GIBS `MODIS_Terra_NDSI_Snow_Cover` | Daily | Optional layer |
| Ice sheets | Greenland: DMI Polar Portal (`polarportal.dk`) daily surface melt and mass balance. Antarctica: to find | Daily | **Research first:** find a feed that can be downloaded rather than read off a web page, and check its terms |
| Base map | GIBS `MODIS_Terra_CorrectedReflectance_TrueColor` by day, `VIIRS_Black_Marble` by night | Daily | Or a bundled low-resolution Blue Marble, for when there's no internet |
| Wind, temperature, rain | NOAA GFS via the NOMADS filter `nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl`: `UGRD`/`VGRD` at 10 m, `TMP` at 2 m, `PRATE` | 6 h (00, 06, 12, 18 UTC runs, about 4 h late) | Start at 1°, try 0.5°. Decode GRIB2 with `eccodes` and write PNG textures (u and v in R and G), as in [mapbox/webgl-wind](https://github.com/mapbox/webgl-wind) (ISC licence, credit it). Respect NOMADS' rate limits |

Show a credit line with every source on the page.

## Frontend

- **Globe:** MapLibre GL JS v5 in globe mode (BSD-3). GIBS rasters and GeoJSON
  points work in it out of the box.
- **Wind particles:** a custom WebGL layer. This is the hardest part: MapLibre's
  globe custom layers are new ground. If it doesn't work, fall back to
  globe.gl / three.js (MIT) for the whole globe. The phase 0 spike decides.
- **Layers:** Events (by kind), Earthquakes (sized by magnitude, a ripple when
  new), Volcanoes (coloured by alert level), Sea ice, Snow, Ice sheets, Wind,
  Temperature, Rain. Day/night terminator.
- **Event card:** what it is, where, when, severity, source link, and for
  volcanoes the weekly-report text.
- **Side panel:** the latest events, newest first. Sea-ice extent against
  the normal, as a small chart.
- **TV mode from day one** (`?tv=1`): every control can be reached with the
  arrows, focus is clearly visible, text is readable from the sofa, and
  nothing needs hovering. The TV sees this page too, rendered on the box and
  streamed (see "Streaming to the TV").

## TV app (in this repo, `tv/`)

- **A small Kotlin Android TV app:** a full-screen WebView showing Gaia's
  stream player page (`http://gaia.<domain>/tv`). That page plays the box's
  WebRTC stream and sends key presses back over a data channel. The TV does
  no 3D work. Package `io.github.superthom196.gaia`.
- **Remote:**
  - Arrows spin the globe.
  - OK flies to the next event and opens its card.
  - Up and down change the zoom level.
  - Menu toggles the layer panel.
  - Back returns to slow spin.
- **Screensaver:** a `DreamService` showing the same page in ambient mode:
  slow spin, and every minute or so it flies to a recent event and shows its
  card.
  - Google TV hides third-party screensavers in its settings. Nexiom's TV
    setup sets it over ADB (`settings put secure screensaver_components io.github.superthom196.gaia/.GaiaDream`).
- **Release:** GitHub Actions attaches `Gaia-TV-<version>.apk` to each release
  (as Cinematica does).
- **Watch speed:** the load is on the box now, not the TV. The quality
  level (Lite, Standard or High, see the brief) sets resolution, frame rate
  and the heavy layers.

## Streaming to the TV

- **Renderer:** headless Chromium in the Gaia container (with `/dev/dri`
  passed through for the GPU) loads `/?tv=1&render=<session>`. The page sends
  its own canvas as WebRTC video (`canvas.captureStream()`), so there's no
  separate encoder pipeline. It uses hardware encoding (VAAPI) when Chromium
  can, and software otherwise.
- **Signalling:** a WebSocket on Gaia's backend (`/api/rtc`) pairs a TV
  player with a renderer session.
- **Sessions:** one long-lived **ambient** renderer (screensaver mode) that
  every idle TV watches. A key press asks for an **interactive** renderer of
  its own, started on demand and stopped after a few minutes idle. The number
  running at once is capped by quality level.
- **Remote keys** travel over the WebRTC data channel to the renderer page,
  which handles them exactly as a browser in TV mode would.
- **Quality:** chosen at startup from the hardware (render device, encoder,
  cores), with an override (`GAIA_QUALITY=lite|standard|high`). Shown in
  `/api/status`.

## Nexiom side (done later, in the NEXIOM Server repo)

- **Architecture doc first:** update `docs/architecture.md` before anything
  else.
- **The service:** `services/gaia/` with `service.toml` (`kind = "compose"`,
  `base = true`, `pillar = "home"`, `port = 8040`, `subdomain = "gaia"`) and
  `compose.yaml`. The image is pinned per release, the port bound to
  `127.0.0.1:8040`, and `/data` in `${NEXIOM_DATA}`.
- **The TV app entry:** `tvapps/gaia-tv.toml` with **no pillar**, so it goes
  on every TV (like Projectivy).
- **Screensaver:** `setup-tv.sh` sets it after installing the app. This
  must be idempotent.
- **`status.sh`:** reads `/api/status`.

## Phases

0. **Spike (one session):** a bare MapLibre globe with GIBS imagery, a
   week of quakes and a basic wind-particle layer. Run it in Chrome and in
   headless Chromium on nexiom0, streamed over WebRTC, and note the frame
   rate and CPU load at each quality level. This decides MapLibre or
   globe.gl.
1. **Skeleton:**
   - Repo, FastAPI app, scheduler and `/data` snapshots, `/api/status`.
   - Dockerfile, `compose.yaml` for local runs, ruff, pytest.
   - The image workflow.
   - The TV app shell: a WebView loading the dev URL, the remote's keys
     wired up.
2. **Events:** USGS, EONET and GDACS turned into one shape with duplicates
   removed. Globe markers, event card, side list, TV focus order.
3. **Volcanoes:** bundled GVP list, weekly reports, HANS alert levels.
4. **Ice:** GIBS sea-ice layer, NSIDC extent against the normal, then ice
   sheets once there's a source.
5. **Wind and weather:** GFS fetch, decode and textures; wind particles,
   temperature and rain overlays.
6. **Screensaver** (`DreamService`), and the TV-mode speed pass.
7. **Nexiom integration** (see above) and the first release.

## Open questions for Thom

Ask these as they come up, in batches. Don't assume. (Login, units, look,
colours and screensaver behaviour were settled in the brief above.)

- **Test TV:** which one first gets the TV app?
- **Screensaver layers:** the same as the page defaults for now.
- **Parked, not designed:** history and replay (the last 30 days as a
  timeline), alerts for big events, and a launcher tile that shows the latest
  event.
