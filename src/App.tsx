import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuth, AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import OpsPage from "./pages/OpsPage";
import NotFound from "./pages/NotFound";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-white/30 text-sm font-medium tracking-widest uppercase">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return <>{children}</>;
}

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <AuthGate>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/:first" element={<Index />} />
          <Route path="/:first/:second" element={<Index />} />
          <Route path="/:first/:second/:third" element={<Index />} />
          <Route path="/ops" element={<OpsPage />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthGate>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
