import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";

/**
 * The `/hunt` route's entry module. The precache list is computed by walking out
 * from here and from the app entry — never hand-maintained, because a hand-kept
 * asset list goes stale on the first build after someone edits it, and it goes
 * stale SILENTLY: the app keeps working online and only fails at the boat ramp.
 */
const FIELD_ROUTE_MODULE = "/pages/HuntPage.tsx";

/**
 * field-pwa — links the manifest and stamps the service worker's precache list.
 *
 * `vite-plugin-pwa` is deliberately NOT a dependency. What it would do for us is
 * this file plus `public/sw.js`, roughly 200 lines total, in exchange for a
 * plugin whose defaults precache the WHOLE bundle — including the museum routes
 * and Recharts — which is the opposite of what a field app wants to spend a
 * phone's evictable storage on.
 *
 * Two jobs:
 *
 *  1. INJECT THE MANIFEST LINK into `index.html` at transform time, rather than
 *     editing `index.html` on disk. `index.html` is shared ground; doing it here
 *     keeps the PWA wiring in one file that explains itself.
 *
 *  2. COMPUTE THE PRECACHE LIST from the real Rollup output and substitute it
 *     into `dist/sw.js`. The list is the app shell, the entry chunk, and the
 *     `/hunt` chunk — each with its transitive imports and CSS. Museum chunks
 *     are excluded by construction: they are simply never reached by the walk.
 *
 * IT THROWS IF IT CANNOT FIND THE `/hunt` CHUNK. A build that quietly produced
 * an empty precache would ship an app that looks fine in every online test and
 * has no offline mode at all.
 */
function fieldPwa(): Plugin {
  let precache: string[] = [];
  let buildId = "dev";
  let outDir = "dist";

  return {
    name: "field-pwa",

    configResolved(config) {
      outDir = config.build.outDir;
    },

    transformIndexHtml() {
      return [
        {
          tag: "link",
          attrs: { rel: "manifest", href: "/manifest.webmanifest" },
          injectTo: "head" as const,
        },
      ];
    },

    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (c): c is import("rollup").OutputChunk => c.type === "chunk",
      );

      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const seen = new Set<string>();
      const assets = new Set<string>();

      const walk = (fileName: string) => {
        if (seen.has(fileName)) return;
        seen.add(fileName);
        const chunk = byFile.get(fileName);
        if (!chunk) return;
        assets.add(`/${chunk.fileName}`);
        const meta = (chunk as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata;
        for (const css of meta?.importedCss ?? []) assets.add(`/${css}`);
        for (const imp of chunk.imports) walk(imp);
      };

      const entry = chunks.find((c) => c.isEntry);
      if (!entry) {
        this.error("field-pwa: no entry chunk in the bundle — cannot build a precache list.");
        return;
      }
      walk(entry.fileName);

      const field = chunks.find((c) =>
        c.facadeModuleId?.replace(/\\/g, "/").endsWith(FIELD_ROUTE_MODULE),
      );
      if (!field) {
        // Loud, at build time. See the header.
        this.error(
          `field-pwa: could not find the chunk for ${FIELD_ROUTE_MODULE}. FIELD mode would ` +
            `ship with no offline shell. If the page moved, update FIELD_ROUTE_MODULE.`,
        );
        return;
      }
      walk(field.fileName);

      assets.add("/manifest.webmanifest");
      assets.add("/favicon.ico");

      precache = [...assets].sort();
      // Content-addressed: the id changes exactly when the precached set does,
      // which is what makes the old cache safe to drop on activate.
      buildId = createBuildId(precache);
    },

    closeBundle() {
      // Runs after Vite has copied `publicDir`, so `dist/sw.js` is on disk.
      const swPath = path.resolve(outDir, "sw.js");
      if (!fs.existsSync(swPath)) {
        throw new Error(
          `field-pwa: ${swPath} not found. public/sw.js is the field service worker and the ` +
            `build cannot ship an offline mode without it.`,
        );
      }
      const src = fs.readFileSync(swPath, "utf8");
      const stamped = src
        .replace('/* __BUILD_ID__ */ "dev"', JSON.stringify(buildId))
        .replace("/* __PRECACHE_MANIFEST__ */ []", JSON.stringify(precache));

      if (stamped === src) {
        throw new Error(
          "field-pwa: the substitution anchors in public/sw.js did not match. The worker " +
            "would ship precaching nothing and FIELD mode would have no offline shell.",
        );
      }
      fs.writeFileSync(swPath, stamped);
    },
  };
}

/** A short stable id derived from the precached set. No crypto import needed. */
function createBuildId(files: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const f of files) {
    for (let i = 0; i < f.length; i++) {
      h ^= f.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), fieldPwa()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          recharts: ["recharts"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
  },
});
