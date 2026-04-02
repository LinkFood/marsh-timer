import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import OpsPage from "./pages/OpsPage";
import IntelligencePage from "./pages/IntelligencePage";
import NotFound from "./pages/NotFound";

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/map" element={<Index legacyLayout />} />
        <Route path="/:first" element={<Index />} />
        <Route path="/:first/:second" element={<Index />} />
        <Route path="/:first/:second/:third" element={<Index />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/intelligence" element={<IntelligencePage />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
