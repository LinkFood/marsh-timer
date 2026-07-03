import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import ExplorerLanding from "./pages/ExplorerLanding";
import NotFound from "./pages/NotFound";

// Landing + catch-all stay eager for fastest first paint on `/`.
// Everything else loads on demand — keeps Recharts (OpsPage only) and the
// secondary routes out of the initial bundle.
const DatePage = lazy(() => import("./pages/DatePage"));
const StatePage = lazy(() => import("./pages/StatePage"));
const CourtPage = lazy(() => import("./pages/CourtPage"));
const CascadePage = lazy(() => import("./pages/CascadePage"));
const CascadeSept2020Page = lazy(() => import("./pages/CascadeSept2020Page"));
const CascadeIndexPage = lazy(() => import("./pages/CascadeIndexPage"));
const Auth = lazy(() => import("./pages/Auth"));
const OpsPage = lazy(() => import("./pages/OpsPage"));

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
        <Routes>
          <Route path="/" element={<ExplorerLanding />} />
          <Route path="/date/:dateStr" element={<DatePage />} />
          <Route path="/state/:stateAbbr" element={<StatePage />} />
          <Route path="/court" element={<CourtPage />} />
          <Route path="/cascade" element={<CascadeIndexPage />} />
          <Route path="/cascade/july-2026-heat" element={<CascadePage />} />
          <Route path="/cascade/sept-2020-whiplash" element={<CascadeSept2020Page />} />
          <Route path="/ops" element={<OpsPage />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
