import { useState, useEffect } from "react";
import { X, Map, Feather, MessageSquare } from "lucide-react";

const STORAGE_KEY = "dc_help_dismissed";

const STEPS = [
  {
    icon: Map,
    title: "Map Modes",
    body: "Switch between Default, Scout, Weather, Terrain, and Intel modes using the controls on the right side of the map. Each mode highlights different layers — radar, convergence heatmaps, wind flow, and more.",
  },
  {
    icon: Feather,
    title: "Species Intelligence",
    body: "Tap the species pills in the header to switch between Duck, Goose, Deer, Turkey, and Dove. Each species shows its own seasons, state rankings, and intel.",
  },
  {
    icon: MessageSquare,
    title: "Chat Brain",
    body: "Ask the AI chat about hunting conditions in any state — weather patterns, migration activity, solunar data, and season dates. It searches thousands of embedded knowledge entries to give you data-backed answers.",
  },
] as const;

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpModal({ open, onClose }: HelpModalProps) {
  const [step, setStep] = useState(0);

  // Reset step when opened
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm glass-panel rounded-xl border border-white/[0.08] p-6 space-y-4">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-white/30 hover:text-white/60 transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center">
            <Icon size={24} className="text-cyan-400" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h3 className="text-sm font-display font-bold text-white/90">
            {current.title}
          </h3>
          <p className="text-xs font-body text-white/60 leading-relaxed">
            {current.body}
          </p>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step ? "bg-cyan-400" : "bg-white/20"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-2 rounded-lg text-xs font-body font-semibold text-white/50 hover:text-white/70 border border-white/10 transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={isLast ? handleDismiss : () => setStep(step + 1)}
            className="flex-1 py-2 rounded-lg text-xs font-body font-semibold bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-400/20 transition-colors"
          >
            {isLast ? "Got It" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useHelpModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) setOpen(true);
  }, []);

  return {
    open,
    show: () => setOpen(true),
    close: () => setOpen(false),
  };
}
