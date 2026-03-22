import { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, CloudRain, Info } from 'lucide-react';
import { useNWSAlerts } from '@/hooks/useNWSAlerts';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import type { PanelComponentProps } from './PanelTypes';

// NWS areaDesc uses full state names — map abbreviations for filtering
const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

const SEVERITY_CONFIG: Record<string, { border: string; badge: string; icon: typeof AlertTriangle }> = {
  Extreme: { border: 'border-l-red-500', badge: 'bg-red-500/20 text-red-400', icon: ShieldAlert },
  Severe:  { border: 'border-l-orange-500', badge: 'bg-orange-500/20 text-orange-400', icon: AlertTriangle },
  Moderate:{ border: 'border-l-yellow-500', badge: 'bg-yellow-500/20 text-yellow-400', icon: CloudRain },
  Minor:   { border: 'border-l-blue-500', badge: 'bg-blue-500/20 text-blue-400', icon: Info },
};

const STATE_ABBRS = Object.keys(STATE_NAMES);

function extractStateAbbr(areaDesc: string): string | null {
  if (!areaDesc) return null;
  // Match ", XX" or "; XX" where XX is a valid state abbreviation
  for (const abbr of STATE_ABBRS) {
    if (areaDesc.includes(`, ${abbr}`) || areaDesc.includes(`; ${abbr}`)) return abbr;
  }
  return null;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function NWSAlertsPanel({}: PanelComponentProps) {
  const { alertsGeoJSON } = useNWSAlerts();
  const { flyTo } = useMapAction();
  const { selectedState, setSelectedState } = useDeck();

  const allAlerts = useMemo(() => {
    if (!alertsGeoJSON?.features) return [];
    return alertsGeoJSON.features.map(f => ({
      event: f.properties?.event as string,
      severity: f.properties?.severity as string,
      headline: f.properties?.headline as string,
      areaDesc: f.properties?.areaDesc as string,
      onset: f.properties?.onset as string,
      expires: f.properties?.expires as string,
    }));
  }, [alertsGeoJSON]);

  const alerts = useMemo(() => {
    if (!selectedState) return allAlerts;
    const stateName = STATE_NAMES[selectedState];
    return allAlerts.filter(a => {
      // Check areaDesc for state abbreviation or full name (e.g., "Scott, KS; Lane, KS")
      if (a.areaDesc) {
        if (a.areaDesc.includes(`, ${selectedState}`) || a.areaDesc.includes(`; ${selectedState}`)) return true;
        if (stateName && a.areaDesc.includes(stateName)) return true;
      }
      // Fallback: check headline
      if (a.headline) {
        if (a.headline.includes(selectedState) || (stateName && a.headline.includes(stateName))) return true;
      }
      return false;
    });
  }, [allAlerts, selectedState]);

  if (!alertsGeoJSON) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading NWS alerts...
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        {selectedState ? `No NWS alerts for ${selectedState}` : 'No active NWS alerts'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto h-full p-2">
      {alerts.map((alert, i) => {
        const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.Minor;
        const Icon = config.icon;
        const stateAbbr = extractStateAbbr(alert.areaDesc);
        return (
          <button
            key={i}
            onClick={() => {
              if (stateAbbr) {
                flyTo(stateAbbr);
                setSelectedState(stateAbbr);
              }
            }}
            className={`w-full text-left border-l-2 ${config.border} rounded-r bg-white/[0.02] px-2.5 py-2
              hover:bg-white/[0.05] transition-colors${stateAbbr ? ' cursor-pointer' : ' cursor-default'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon size={13} className="text-white/50 shrink-0" />
              <span className="text-xs font-mono font-semibold text-white/90 flex-1">{alert.event}</span>
              <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${config.badge}`}>
                {alert.severity}
              </span>
            </div>
            <p className="text-[11px] text-white/50 leading-snug mb-1">{alert.headline}</p>
            <div className="text-[9px] font-mono text-white/20">
              {formatTime(alert.onset)} — {formatTime(alert.expires)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
