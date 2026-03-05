import { useState, useRef, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import StatusBar from "@/components/StatusBar";
import SearchBar from "@/components/SearchBar";
import USMap from "@/components/USMap";
import StateDetail from "@/components/StateDetail";
import StateList from "@/components/StateList";
import Footer from "@/components/Footer";

const Index = () => {
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const handleSelectState = useCallback((abbr: string) => {
    setSelectedState(abbr);
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, []);

  return (
    <div className="min-h-screen bg-background relative">
      <div className="grain-overlay" />
      <div className="relative z-10">
        <Header />
        <StatusBar />
        <SearchBar onSelectState={handleSelectState} />
        <USMap selectedState={selectedState} onSelectState={handleSelectState} />
        <div ref={detailRef}>
          <AnimatePresence mode="wait">
            {selectedState && <StateDetail key={selectedState} abbreviation={selectedState} />}
          </AnimatePresence>
        </div>
        <StateList onSelectState={handleSelectState} selectedState={selectedState} />
        <Footer />
      </div>
    </div>
  );
};

export default Index;
