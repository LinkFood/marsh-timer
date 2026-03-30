import { useState, useEffect, useRef } from 'react';
import type { FeatureCollection, Feature } from 'geojson';

// METAR station locations — all 98 ASOS stations tracked by hunt-weather-realtime
// Format: ICAO -> [lng, lat]  (Mapbox uses [lng, lat] order)
const STATION_COORDS: Record<string, [number, number]> = {
  // AL
  KBHM: [-86.752, 33.563],  // Birmingham
  KMOB: [-88.243, 30.691],  // Mobile
  KHSV: [-86.775, 34.637],  // Huntsville
  // AK
  PANC: [-149.996, 61.174], // Anchorage
  PAFA: [-147.856, 64.815], // Fairbanks
  // AZ
  KPHX: [-112.012, 33.434], // Phoenix
  KTUS: [-110.941, 32.116], // Tucson
  // AR
  KLIT: [-92.224, 34.729],  // Little Rock
  KFSM: [-94.365, 35.336],  // Fort Smith
  KJBR: [-90.646, 35.832],  // Jonesboro
  KPBF: [-91.936, 34.175],  // Pine Bluff
  // CA
  KLAX: [-118.408, 33.943], // Los Angeles
  KSFO: [-122.375, 37.619], // San Francisco
  KSMF: [-121.591, 38.695], // Sacramento
  KFAT: [-119.718, 36.776], // Fresno
  // CO
  KDEN: [-104.673, 39.862], // Denver
  KCOS: [-104.700, 38.806], // Colorado Springs
  // CT
  KBDL: [-72.683, 41.939],  // Hartford/Bradley
  // DE
  KILG: [-75.607, 39.679],  // Wilmington
  // FL
  KMIA: [-80.291, 25.796],  // Miami
  KJAX: [-81.688, 30.494],  // Jacksonville
  KTLH: [-84.350, 30.397],  // Tallahassee
  KTPA: [-82.533, 27.976],  // Tampa
  // GA
  KATL: [-84.428, 33.637],  // Atlanta
  KSAV: [-81.202, 32.128],  // Savannah
  // HI
  PHNL: [-157.922, 21.319], // Honolulu
  // ID
  KBOI: [-116.223, 43.564], // Boise
  // IL
  KORD: [-87.904, 41.979],  // Chicago O'Hare
  KSPI: [-89.678, 39.844],  // Springfield
  // IN
  KIND: [-86.295, 39.717],  // Indianapolis
  // IA
  KDSM: [-93.663, 41.534],  // Des Moines
  KDBQ: [-90.709, 42.402],  // Dubuque
  // KS
  KICT: [-97.433, 37.650],  // Wichita
  KTOP: [-95.663, 39.069],  // Topeka
  // KY
  KSDF: [-85.736, 38.174],  // Louisville
  KLEX: [-84.606, 38.037],  // Lexington
  // LA
  KMSY: [-90.258, 29.993],  // New Orleans
  KSHV: [-93.826, 32.447],  // Shreveport
  KLFT: [-91.988, 30.205],  // Lafayette
  KLCH: [-93.223, 30.126],  // Lake Charles
  // ME
  KPWM: [-70.309, 43.646],  // Portland ME
  // MD
  KBWI: [-76.668, 39.176],  // Baltimore
  // MA
  KBOS: [-71.005, 42.364],  // Boston
  // MI
  KDTW: [-83.353, 42.212],  // Detroit
  KGRR: [-85.523, 42.881],  // Grand Rapids
  // MN
  KMSP: [-93.222, 44.882],  // Minneapolis
  KDLH: [-92.194, 46.842],  // Duluth
  // MS
  KJAN: [-90.076, 32.311],  // Jackson
  KGPT: [-89.070, 30.407],  // Gulfport
  KGLH: [-90.986, 33.477],  // Greenville
  // MO
  KSTL: [-90.370, 38.749],  // St Louis
  KMCI: [-94.714, 39.298],  // Kansas City
  // MT
  KBIL: [-108.543, 45.808], // Billings
  KGTF: [-111.371, 47.482], // Great Falls
  // NE
  KOMA: [-95.894, 41.303],  // Omaha
  KLNK: [-96.760, 40.851],  // Lincoln
  // NV
  KLAS: [-115.152, 36.080], // Las Vegas
  KRNO: [-119.768, 39.499], // Reno
  // NH
  KMHT: [-71.437, 42.933],  // Manchester
  // NJ
  KEWR: [-74.169, 40.693],  // Newark
  // NM
  KABQ: [-106.609, 35.040], // Albuquerque
  // NY
  KJFK: [-73.779, 40.640],  // New York JFK
  KBUF: [-78.732, 42.941],  // Buffalo
  KSYR: [-76.106, 43.111],  // Syracuse
  // NC
  KRDU: [-78.787, 35.878],  // Raleigh-Durham
  KCLT: [-80.943, 35.214],  // Charlotte
  // ND
  KFAR: [-96.816, 46.920],  // Fargo
  KBIS: [-100.747, 46.773], // Bismarck
  // OH
  KCLE: [-81.850, 41.412],  // Cleveland
  KCMH: [-82.891, 39.998],  // Columbus
  // OK
  KOKC: [-97.601, 35.393],  // Oklahoma City
  KTUL: [-95.888, 36.198],  // Tulsa
  // OR
  KPDX: [-122.597, 45.589], // Portland OR
  KMED: [-122.873, 42.374], // Medford
  // PA
  KPHL: [-75.241, 39.872],  // Philadelphia
  KPIT: [-80.233, 40.492],  // Pittsburgh
  // RI
  KPVD: [-71.420, 41.725],  // Providence
  // SC
  KCHS: [-80.041, 32.899],  // Charleston
  KCAE: [-81.119, 33.939],  // Columbia
  // SD
  KFSD: [-96.742, 43.582],  // Sioux Falls
  KRAP: [-103.057, 44.043], // Rapid City
  // TN
  KBNA: [-86.678, 36.124],  // Nashville
  KMEM: [-89.977, 35.042],  // Memphis
  // TX
  KDFW: [-97.038, 32.897],  // Dallas-Fort Worth
  KIAH: [-95.342, 29.980],  // Houston
  KSAT: [-98.470, 29.534],  // San Antonio
  KCRP: [-97.501, 27.770],  // Corpus Christi
  KBPT: [-94.021, 29.951],  // Beaumont
  // UT
  KSLC: [-111.969, 40.789], // Salt Lake City
  // VT
  KBTV: [-73.153, 44.472],  // Burlington
  // VA
  KRIC: [-77.320, 37.505],  // Richmond
  KORF: [-76.201, 36.894],  // Norfolk
  // WA
  KSEA: [-122.309, 47.449], // Seattle
  KGEG: [-117.534, 47.620], // Spokane
  // WV
  KCRW: [-81.593, 38.373],  // Charleston WV
  // WI
  KMKE: [-87.897, 42.947],  // Milwaukee
  KMSN: [-89.338, 43.140],  // Madison
  // WY
  KCYS: [-104.812, 41.156], // Cheyenne
  // Legacy (not in edge function but was in original set)
  KCVG: [-84.668, 39.049],  // Cincinnati OH
};

interface WeatherEvent {
  station: string;
  type: string;
  details: string;
  severity: 'high' | 'medium' | 'low';
  timestamp: string;
  lng: number;
  lat: number;
}

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function useWeatherEvents() {
  const [eventsGeoJSON, setEventsGeoJSON] = useState<FeatureCollection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    async function fetchEvents() {
      try {
        // Fetch last 6 hours of weather-realtime entries from hunt_knowledge
        const threeHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(
          `${supabaseUrl}/rest/v1/hunt_knowledge?select=title,content,content_type,created_at&content_type=eq.weather-realtime&created_at=gte.${threeHoursAgo}&order=created_at.desc&limit=100`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        if (!res.ok) return;

        const rows = await res.json();
        if (cancelled || !Array.isArray(rows)) return;

        const features: Feature[] = [];

        for (const row of rows) {
          // Parse station from title (e.g., "METAR Alert: KLIT - Temperature Drop")
          const stationMatch = (row.title || '').match(/([A-Z]{4})/);
          const station = stationMatch?.[1];
          if (!station || !STATION_COORDS[station]) continue;

          const [lng, lat] = STATION_COORDS[station];

          // Determine severity from content
          const content = (row.content || '').toLowerCase();
          let severity = 'low';
          if (content.includes('front passage') || content.includes('rapid') || content.includes('severe')) {
            severity = 'high';
          } else if (content.includes('significant') || content.includes('wind shift') || content.includes('temperature drop')) {
            severity = 'medium';
          }

          // Determine event type
          let eventType = 'weather-event';
          if (content.includes('front passage') || content.includes('front')) {
            eventType = 'front-passage';
          } else if (content.includes('temperature drop') || content.includes('temp drop')) {
            eventType = 'temp-drop';
          } else if (content.includes('wind shift')) {
            eventType = 'wind-shift';
          } else if (content.includes('pressure')) {
            eventType = 'pressure-change';
          }

          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              station,
              eventType,
              severity,
              title: row.title || '',
              content: (row.content || '').slice(0, 200),
              timestamp: row.created_at,
            },
          });
        }

        // Deduplicate — keep latest event per station
        const byStation = new Map<string, Feature>();
        for (const f of features) {
          const s = f.properties?.station;
          if (!byStation.has(s)) byStation.set(s, f);
        }

        setEventsGeoJSON({
          type: 'FeatureCollection',
          features: Array.from(byStation.values()),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('Request timed out: weather events');
        }
      }
    }

    fetchEvents();
    timerRef.current = setInterval(fetchEvents, REFRESH_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return { eventsGeoJSON };
}
