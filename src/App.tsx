import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ExplorerLanding from "./pages/ExplorerLanding";
import DatePage from "./pages/DatePage";
import StatePage from "./pages/StatePage";
import CourtPage from "./pages/CourtPage";
import CascadePage from "./pages/CascadePage";
import CascadeSept2020Page from "./pages/CascadeSept2020Page";
import CascadeIndexPage from "./pages/CascadeIndexPage";
import Auth from "./pages/Auth";
import OpsPage from "./pages/OpsPage";
import NotFound from "./pages/NotFound";

const App = () => (
  <BrowserRouter>
    <AuthProvider>
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
    </AuthProvider>
  </BrowserRouter>
);

export default App;
