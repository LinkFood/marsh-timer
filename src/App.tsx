import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ExplorerLanding from "./pages/ExplorerLanding";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import OpsPage from "./pages/OpsPage";
import IntelligencePage from "./pages/IntelligencePage";
import NotFound from "./pages/NotFound";

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        {/* Explorer — the product */}
        <Route path="/" element={<ExplorerLanding />} />
        <Route path="/:stateAbbr" element={<ExplorerLanding />} />

        {/* Old dashboard — preserved at /dashboard */}
        <Route path="/dashboard" element={<Index />} />
        <Route path="/dashboard/:first" element={<Index />} />
        <Route path="/dashboard/:first/:second" element={<Index />} />
        <Route path="/dashboard/:first/:second/:third" element={<Index />} />
        <Route path="/map" element={<Index legacyLayout />} />

        {/* System pages */}
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/intelligence" element={<IntelligencePage />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
