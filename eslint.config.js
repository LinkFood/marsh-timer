import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  /* ======================================================================
   *  THE OFFLINE BOUNDARY
   * ======================================================================
   *
   *  The files listed below run in a marsh at 05:15 with no bars. They are
   *  allowed to do arithmetic on data that was already frozen at save time,
   *  and nothing else. A network read in here does not fail in CI or in
   *  review — it fails at the boat ramp, silently, as a spinner that never
   *  resolves while legal light comes and goes.
   *
   *  So the boundary is enforced by the linter instead of by discipline:
   *
   *    - no Supabase client, by any import path (`@/lib/supabase`, a relative
   *      `../lib/supabase`, or `@supabase/supabase-js` directly)
   *    - no bare `fetch`, and no `window.fetch` / `globalThis.fetch` either,
   *      which is the obvious way around a global ban
   *
   *  Several of these paths do not exist yet. That is intentional — the rule
   *  is a tripwire laid ahead of the files, so the boundary is already there
   *  on the day someone creates `src/lib/tide.ts`.
   *
   *  If you genuinely need data in one of these files: resolve it at SAVE
   *  time (see `src/lib/spot.ts`, which is online on purpose and is NOT in
   *  this list), freeze it, and pass it in as an argument.
   * ==================================================================== */
  {
    files: [
      "src/lib/sky.ts",
      "src/lib/tide.ts",
      "src/lib/geometry.ts",
      "src/lib/gates/**/*.{ts,tsx}",
      "src/pages/FieldPage.tsx",
      // The rails and their pure helpers. FieldPage alone was the tripwire's
      // original target, but the surface it renders now lives in these files —
      // leaving them uncovered would put the whole offline path outside the
      // boundary that exists to protect it.
      "src/components/field/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase",
              message:
                "OFFLINE PATH: no Supabase in the field. There is no signal in the marsh. " +
                "Resolve it at save time in src/lib/spot.ts and pass the frozen value in.",
            },
            {
              name: "@supabase/supabase-js",
              message:
                "OFFLINE PATH: no Supabase client in the field. There is no signal in the marsh. " +
                "Resolve it at save time in src/lib/spot.ts and pass the frozen value in.",
            },
          ],
          patterns: [
            {
              group: ["**/lib/supabase", "**/lib/supabase.ts", "@supabase/*"],
              message:
                "OFFLINE PATH: no Supabase in the field, by any import path. " +
                "Resolve it at save time and pass the frozen value in.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "OFFLINE PATH: no network reads in the field. This code runs with no signal. " +
            "Fetch it at save time (src/lib/spot.ts) and pass the frozen value in.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "fetch",
          message: "OFFLINE PATH: no network reads in the field. Routing around the bare-fetch ban does not make the marsh have signal.",
        },
        {
          object: "globalThis",
          property: "fetch",
          message: "OFFLINE PATH: no network reads in the field. Routing around the bare-fetch ban does not make the marsh have signal.",
        },
      ],
    },
  },
);
