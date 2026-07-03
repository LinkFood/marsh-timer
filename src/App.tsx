import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ExplorerLanding from "./pages/ExplorerLanding";
import DatePage from "./pages/DatePage";
import StatePage from "./pages/StatePage";
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
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
