import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import TodayPage from "./pages/TodayPage";
import NotFound from "./pages/NotFound";

// The front door + catch-all stay eager for fastest first paint on `/`.
// Everything else loads on demand — keeps Recharts (OpsPage only) and the
// secondary routes out of the initial bundle.
const AskPage = lazy(() => import("./pages/AskPage"));
const DatePage = lazy(() => import("./pages/DatePage"));
const CourtPage = lazy(() => import("./pages/CourtPage"));
const CascadePage = lazy(() => import("./pages/CascadePage"));
const CascadeSept2020Page = lazy(() => import("./pages/CascadeSept2020Page"));
const CascadeIndexPage = lazy(() => import("./pages/CascadeIndexPage"));
const Auth = lazy(() => import("./pages/Auth"));
const OpsPage = lazy(() => import("./pages/OpsPage"));
const AtlasPage = lazy(() => import("./pages/AtlasPage"));
const MorningPage = lazy(() => import("./pages/MorningPage"));
const BornPage = lazy(() => import("./pages/BornPage"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const PlantPage = lazy(() => import("./pages/PlantPage"));

/** /state/:stateAbbr → /atlas?state=XX — the descent IS the state page. */
function StateRedirect() {
  const { stateAbbr } = useParams<{ stateAbbr: string }>();
  const abbr = (stateAbbr || "").toUpperCase();
  return <Navigate to={/^[A-Z]{2}$/.test(abbr) ? `/atlas?state=${abbr}` : "/atlas"} replace />;
}

/** /explore → /ask, deep-link params (?q=, ?state=) preserved. */
function ExploreRedirect() {
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  return <Navigate to={`/ask${qs ? `?${qs}` : ""}`} replace />;
}

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
        <Routes>
          {/* The five doors */}
          <Route path="/" element={<TodayPage />} />
          <Route path="/plant" element={<PlantPage />} />
          <Route path="/date/:dateStr" element={<DatePage />} />
          <Route path="/court" element={<CourtPage />} />
          <Route path="/ask" element={<AskPage />} />

          {/* Today's wing */}
          <Route path="/atlas" element={<AtlasPage />} />
          <Route path="/morning" element={<MorningPage />} />
          <Route path="/morning/:date" element={<MorningPage />} />

          {/* Museum wings */}
          <Route path="/born" element={<BornPage />} />
          <Route path="/board/:story" element={<BoardPage />} />
          <Route path="/cascade" element={<CascadeIndexPage />} />
          <Route path="/cascade/july-2026-heat" element={<CascadePage />} />
          <Route path="/cascade/sept-2020-whiplash" element={<CascadeSept2020Page />} />

          {/* Unlisted */}
          <Route path="/ops" element={<OpsPage />} />
          <Route path="/auth" element={<Auth />} />

          {/* Killed rooms → their heirs (edge middleware 301s these too;
              these cover client-side navigations and stale SPA sessions) */}
          <Route path="/welcome" element={<Navigate to="/" replace />} />
          <Route path="/explore" element={<ExploreRedirect />} />
          <Route path="/state/:stateAbbr" element={<StateRedirect />} />
          <Route path="/concepts" element={<Navigate to="/" replace />} />
          <Route path="/concepts/*" element={<Navigate to="/" replace />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
