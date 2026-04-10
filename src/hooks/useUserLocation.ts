import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'dcd-user-state';

/** Approximate centroids for each US state (lat, lng) */
const STATE_CENTROIDS: Record<string, { lat: number; lng: number; name: string }> = {
  AL: { lat: 32.8, lng: -86.8, name: 'Alabama' },
  AK: { lat: 64.2, lng: -152.5, name: 'Alaska' },
  AZ: { lat: 34.3, lng: -111.7, name: 'Arizona' },
  AR: { lat: 34.8, lng: -92.2, name: 'Arkansas' },
  CA: { lat: 36.8, lng: -119.4, name: 'California' },
  CO: { lat: 39.0, lng: -105.5, name: 'Colorado' },
  CT: { lat: 41.6, lng: -72.7, name: 'Connecticut' },
  DE: { lat: 39.0, lng: -75.5, name: 'Delaware' },
  FL: { lat: 28.6, lng: -82.4, name: 'Florida' },
  GA: { lat: 33.0, lng: -83.5, name: 'Georgia' },
  HI: { lat: 20.8, lng: -156.3, name: 'Hawaii' },
  ID: { lat: 44.1, lng: -114.7, name: 'Idaho' },
  IL: { lat: 40.0, lng: -89.2, name: 'Illinois' },
  IN: { lat: 39.8, lng: -86.3, name: 'Indiana' },
  IA: { lat: 42.0, lng: -93.5, name: 'Iowa' },
  KS: { lat: 38.5, lng: -98.3, name: 'Kansas' },
  KY: { lat: 37.8, lng: -85.7, name: 'Kentucky' },
  LA: { lat: 31.0, lng: -91.9, name: 'Louisiana' },
  ME: { lat: 45.4, lng: -69.2, name: 'Maine' },
  MD: { lat: 39.0, lng: -76.8, name: 'Maryland' },
  MA: { lat: 42.3, lng: -72.0, name: 'Massachusetts' },
  MI: { lat: 44.3, lng: -84.5, name: 'Michigan' },
  MN: { lat: 46.3, lng: -94.3, name: 'Minnesota' },
  MS: { lat: 32.7, lng: -89.7, name: 'Mississippi' },
  MO: { lat: 38.4, lng: -92.5, name: 'Missouri' },
  MT: { lat: 47.1, lng: -109.6, name: 'Montana' },
  NE: { lat: 41.5, lng: -99.8, name: 'Nebraska' },
  NV: { lat: 39.3, lng: -116.6, name: 'Nevada' },
  NH: { lat: 43.7, lng: -71.6, name: 'New Hampshire' },
  NJ: { lat: 40.1, lng: -74.7, name: 'New Jersey' },
  NM: { lat: 34.5, lng: -106.0, name: 'New Mexico' },
  NY: { lat: 42.9, lng: -75.5, name: 'New York' },
  NC: { lat: 35.6, lng: -79.4, name: 'North Carolina' },
  ND: { lat: 47.4, lng: -100.5, name: 'North Dakota' },
  OH: { lat: 40.4, lng: -82.8, name: 'Ohio' },
  OK: { lat: 35.6, lng: -97.5, name: 'Oklahoma' },
  OR: { lat: 44.0, lng: -120.5, name: 'Oregon' },
  PA: { lat: 40.9, lng: -77.8, name: 'Pennsylvania' },
  RI: { lat: 41.7, lng: -71.5, name: 'Rhode Island' },
  SC: { lat: 33.9, lng: -80.9, name: 'South Carolina' },
  SD: { lat: 44.4, lng: -100.2, name: 'South Dakota' },
  TN: { lat: 35.8, lng: -86.4, name: 'Tennessee' },
  TX: { lat: 31.5, lng: -99.4, name: 'Texas' },
  UT: { lat: 39.3, lng: -111.7, name: 'Utah' },
  VT: { lat: 44.1, lng: -72.6, name: 'Vermont' },
  VA: { lat: 37.5, lng: -78.9, name: 'Virginia' },
  WA: { lat: 47.4, lng: -120.7, name: 'Washington' },
  WV: { lat: 38.6, lng: -80.6, name: 'West Virginia' },
  WI: { lat: 44.6, lng: -89.8, name: 'Wisconsin' },
  WY: { lat: 43.0, lng: -107.6, name: 'Wyoming' },
};

export const US_STATES = Object.entries(STATE_CENTROIDS).map(([abbr, { name }]) => ({
  abbr,
  name,
})).sort((a, b) => a.name.localeCompare(b.name));

function nearestState(lat: number, lng: number): string {
  let best = 'TX';
  let bestDist = Infinity;
  for (const [abbr, c] of Object.entries(STATE_CENTROIDS)) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = abbr;
    }
  }
  return best;
}

export function getStateName(abbr: string): string {
  return STATE_CENTROIDS[abbr]?.name || abbr;
}

export function useUserLocation() {
  const [state, setState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'TX';
    return localStorage.getItem(STORAGE_KEY) || 'TX'; // Default to TX immediately
  });
  const [detecting, setDetecting] = useState(false);
  const [denied, setDenied] = useState(false);

  // Try geolocation in background — update if we get a better answer
  useEffect(() => {
    // If user manually chose a state, don't override
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (!navigator.geolocation) return;

    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const found = nearestState(pos.coords.latitude, pos.coords.longitude);
        setState(found);
        localStorage.setItem(STORAGE_KEY, found);
        setDetecting(false);
      },
      () => {
        setDenied(true);
        setDetecting(false);
        // Keep the TX default
      },
      { timeout: 5000, maximumAge: 3600000 }
    );
  }, []);

  const setUserState = useCallback((abbr: string) => {
    setState(abbr);
    localStorage.setItem(STORAGE_KEY, abbr);
  }, []);

  return {
    state,
    stateName: getStateName(state || 'TX'),
    detecting,
    denied,
    setUserState,
  };
}
