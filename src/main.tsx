// Stale chunk auto-reload — catch Vite lazy-import errors from deploy chunk hash changes
window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Loading chunk') ||
      msg.includes('Loading CSS chunk')) {
    console.warn('[Auto-reload] Stale chunk detected, reloading...');
    window.location.reload();
  }
});

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from "@vercel/analytics/react";
import { applyOwnerParam, recordVisit } from "./lib/analytics";
import App from "./App.tsx";
import "./index.css";

// Gate-3 instrumentation (POSTING-PLAN §0): honor ?owner=1|0 before anything
// counts, then stamp first-seen / fire return_visit once for this page load.
applyOwnerParam();
recordVisit();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <Analytics />
  </QueryClientProvider>
);
