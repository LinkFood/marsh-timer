/* eslint-env serviceworker */
/**
 * sw.js — the field service worker. Hand-rolled, no Workbox.
 *
 * ONE JOB: make `/hunt` open with the radio off. Nothing else.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IT CACHES, AND — MORE IMPORTANTLY — WHAT IT REFUSES TO.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   CACHED   the app shell (`/index.html`), the entry chunk and its CSS, the
 *            shared vendor chunk, and the lazy chunk `/hunt` itself loads. That
 *            list is not written by hand — it is computed from the real Rollup
 *            bundle at build time by the `field-pwa` plugin in `vite.config.ts`
 *            and substituted into `PRECACHE` below. A hand-maintained asset list
 *            goes stale on the first build after someone edits it, and it goes
 *            stale SILENTLY: the app keeps working online and only fails at the
 *            boat ramp.
 *
 *   NOT CACHED — THE MUSEUM. `/`, `/atlas`, `/court`, `/date/*`, `/board/*`,
 *            `/ops` and their chunks (Recharts alone is a third of the bundle)
 *            are deliberately absent. They are a reading experience for a couch
 *            with wifi. Precaching them would spend a hunter's storage — the
 *            storage iOS is deciding whether to evict — on pages he will never
 *            open in a marsh.
 *
 *   NOT CACHED — PACK DATA. Not one byte of tide or weather passes through here.
 *            That lives in IndexedDB (`src/lib/pack/packStore.ts`), because pack
 *            data has a `fetchedAt` and an age a surface must be able to print,
 *            and the Cache API has no place to put one. A tide cached as an HTTP
 *            response is a tide with no age, which is the exact lie this product
 *            is built against.
 *
 *   NOT INTERCEPTED — EVERYTHING ELSE. The `fetch` handler calls
 *            `respondWith` ONLY for a precached URL or a `/hunt` navigation. For
 *            every other request it returns without touching the event, so the
 *            browser does exactly what it would do with no service worker at
 *            all. That is what keeps a bad deploy of this file from being able
 *            to brick duckcountdown.com.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE INSTALL DOES NOT USE `cache.addAll`.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `addAll` is atomic: one 404 rejects the whole promise, the worker never
 * activates, and the hunter gets NO offline at all because a favicon moved. Each
 * URL is fetched individually instead, and the failures are written into the
 * cache at `/__precache-status` as JSON so `readPrecacheStatus()` in
 * `src/lib/pack/pwa.ts` can read them back and the app can say out loud which
 * assets are missing. A partial precache is a real state; the alternative is not
 * "everything works", it is "nothing works and nobody knows why".
 */

/* ────────────────────────── build-stamped constants ────────────────────────── */

/**
 * Replaced at build time by the `field-pwa` plugin. The comment markers are the
 * substitution anchors, and the values after them are valid JavaScript so this
 * file still parses and installs (precaching nothing) when it is served
 * unsubstituted by the dev server — dev has no hashed asset URLs to cache.
 */
const BUILD_ID = /* __BUILD_ID__ */ "dev";
const PRECACHE = /* __PRECACHE_MANIFEST__ */ [];

/** Versioned by build id, so a deploy cannot serve last week's chunks. */
const CACHE_NAME = `dcd-field-${BUILD_ID}`;

/** The one route this worker exists for. */
const FIELD_ROUTE = "/hunt";

/** The SPA shell every route is served from. */
const SHELL_URL = "/index.html";

/** Where the install writes what it could not cache. Read by `pwa.ts`. */
const STATUS_URL = "/__precache-status";

/* ────────────────────────────── install ────────────────────────────── */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const wanted = [SHELL_URL, ...PRECACHE];
      const missing = [];

      for (const url of wanted) {
        try {
          // `cache: "reload"` bypasses the HTTP cache so a precache cannot
          // capture a stale copy of a chunk the browser happens to be holding.
          const res = await fetch(new Request(url, { cache: "reload" }));
          if (!res || !res.ok) {
            missing.push({ url, why: res ? `HTTP ${res.status}` : "no response" });
            continue;
          }
          await cache.put(url, res);
        } catch (e) {
          missing.push({ url, why: e instanceof Error ? e.message : String(e) });
        }
      }

      const status = {
        buildId: BUILD_ID,
        installedAt: new Date().toISOString(),
        wanted: wanted.length,
        cached: wanted.length - missing.length,
        missing,
      };
      await cache.put(
        STATUS_URL,
        new Response(JSON.stringify(status), {
          headers: { "content-type": "application/json" },
        }),
      );

      // Activate immediately. The alternative is a hunter who installs an update
      // in the driveway and drives out still running the old worker.
      await self.skipWaiting();
    })(),
  );
});

/* ────────────────────────────── activate ────────────────────────────── */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("dcd-field-") && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/* ──────────────────────────────── fetch ──────────────────────────────── */

/**
 * The precached set, as a Set of pathnames, built once per worker start.
 * `STATUS_URL` is deliberately NOT in here — it is written into the cache but
 * never served over the network, so a page cannot fetch it by accident.
 */
const PRECACHED_PATHS = new Set([SHELL_URL, ...PRECACHE]);

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Never touch anything but a plain GET on our own origin. A POST, a range
  // request, or a call out to NOAA or Open-Meteo goes straight to the network.
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // A navigation to /hunt — and ONLY to /hunt — is served from the shell so the
  // route opens with no network. Every other navigation, including the museum
  // front door at `/`, is left alone.
  if (req.mode === "navigate") {
    if (url.pathname !== FIELD_ROUTE) return;
    event.respondWith(
      (async () => {
        const cached = await caches.match(SHELL_URL, { cacheName: CACHE_NAME });
        if (cached) return cached;
        return fetch(req);
      })(),
    );
    return;
  }

  // A precached asset. Cache-first: these URLs are content-hashed by Vite, so a
  // hit is byte-identical to what the network would return and a new deploy
  // produces new URLs rather than a stale hit.
  if (PRECACHED_PATHS.has(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(url.pathname, { cacheName: CACHE_NAME });
        if (cached) return cached;
        // Not in the cache — the install failed for this one. Go to the network
        // and, if it works, repair the cache so the next flight is offline.
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(url.pathname, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Everything else: no `respondWith`, so the browser behaves exactly as it
  // would with no service worker installed.
});
