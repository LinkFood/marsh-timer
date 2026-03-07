import { useState, useEffect, useRef } from "react";

const STATE_COORDS: Record<string, [number, number]> = {
  AL:[32.8,-86.8],AK:[64.2,-152.5],AZ:[34.0,-111.1],AR:[34.8,-92.2],CA:[36.8,-119.4],
  CO:[39.1,-105.4],CT:[41.6,-72.7],DE:[39.0,-75.5],FL:[27.8,-81.8],GA:[32.2,-83.4],
  HI:[19.9,-155.6],ID:[44.1,-114.7],IL:[40.6,-89.4],IN:[40.3,-86.1],IA:[42.0,-93.2],
  KS:[38.5,-98.8],KY:[37.7,-84.7],LA:[30.5,-91.2],ME:[45.4,-69.2],MD:[39.0,-76.6],
  MA:[42.4,-71.4],MI:[44.3,-85.6],MN:[46.4,-94.6],MS:[32.3,-89.4],MO:[38.6,-92.2],
  MT:[46.8,-110.4],NE:[41.1,-98.3],NV:[38.8,-116.4],NH:[43.5,-71.6],NJ:[40.1,-74.5],
  NM:[34.2,-105.9],NY:[43.0,-75.0],NC:[35.8,-79.8],ND:[47.5,-100.5],OH:[40.4,-82.9],
  OK:[35.0,-97.1],OR:[43.8,-120.6],PA:[41.2,-77.2],RI:[41.6,-71.5],SC:[34.0,-81.0],
  SD:[43.9,-99.4],TN:[35.5,-86.6],TX:[31.0,-100.0],UT:[39.3,-111.1],VT:[44.6,-72.6],
  VA:[37.8,-78.2],WA:[47.8,-120.7],WV:[38.6,-80.6],WI:[43.8,-88.8],WY:[43.1,-107.6],
};

export function useNationalWeather() {
  const [cache, setCache] = useState<Map<string, { temp: number; wind: number }>>(new Map());
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchAll() {
      const states = Object.entries(STATE_COORDS);
      const lats = states.map(([, c]) => c[0]).join(",");
      const lngs = states.map(([, c]) => c[1]).join(",");

      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
        );
        if (!res.ok) return;
        const data = await res.json();

        const newCache = new Map<string, { temp: number; wind: number }>();

        if (Array.isArray(data)) {
          data.forEach((d: any, i: number) => {
            if (d.current) {
              newCache.set(states[i][0], {
                temp: d.current.temperature_2m,
                wind: d.current.wind_speed_10m,
              });
            }
          });
        } else if (data.current) {
          newCache.set(states[0][0], {
            temp: data.current.temperature_2m,
            wind: data.current.wind_speed_10m,
          });
        }

        setCache(newCache);
      } catch {
        // silent fail
      }
    }

    fetchAll();
  }, []);

  return cache;
}
