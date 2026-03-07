/**
 * Backfill hunt_weather_history from Open-Meteo archive API
 * ~50 API calls (one per state), generous rate limits
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-weather-history.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

// State centroids for weather lookups (lat, lng)
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

// Duck season months: September through February (5 years back)
const START_DATE = "2020-09-01";
const END_DATE = "2025-02-28";

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

function msToMph(ms: number): number {
  return ms * 2.237;
}

async function fetchWeatherHistory(
  lat: number,
  lng: number,
): Promise<any> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    start_date: START_DATE,
    end_date: END_DATE,
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "temperature_2m_mean",
      "wind_speed_10m_max",
      "wind_speed_10m_mean",
      "wind_direction_10m_dominant",
      "surface_pressure_mean",
      "precipitation_sum",
      "cloud_cover_mean",
    ].join(","),
    temperature_unit: "celsius",
    wind_speed_unit: "ms",
    timezone: "America/Chicago",
  });

  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function isDuckSeasonMonth(date: string): boolean {
  const month = parseInt(date.split("-")[1], 10);
  return month >= 9 || month <= 2; // Sept-Feb
}

async function backfillState(stateAbbr: string, lat: number, lng: number) {
  console.log(`  Fetching ${stateAbbr} (${lat}, ${lng})...`);
  const data = await fetchWeatherHistory(lat, lng);

  const daily = data.daily;
  if (!daily || !daily.time) {
    console.error(`  No daily data for ${stateAbbr}`);
    return 0;
  }

  const rows: any[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    if (!isDuckSeasonMonth(date)) continue;

    // Calculate 12h pressure change (approximate from daily mean vs prior day)
    let pressureChange = null;
    if (i > 0 && daily.surface_pressure_mean[i] != null && daily.surface_pressure_mean[i - 1] != null) {
      pressureChange = daily.surface_pressure_mean[i] - daily.surface_pressure_mean[i - 1];
    }

    rows.push({
      state_abbr: stateAbbr,
      date,
      temp_high_f: daily.temperature_2m_max[i] != null ? Math.round(celsiusToFahrenheit(daily.temperature_2m_max[i]) * 10) / 10 : null,
      temp_low_f: daily.temperature_2m_min[i] != null ? Math.round(celsiusToFahrenheit(daily.temperature_2m_min[i]) * 10) / 10 : null,
      temp_avg_f: daily.temperature_2m_mean[i] != null ? Math.round(celsiusToFahrenheit(daily.temperature_2m_mean[i]) * 10) / 10 : null,
      wind_speed_avg_mph: daily.wind_speed_10m_mean[i] != null ? Math.round(msToMph(daily.wind_speed_10m_mean[i]) * 10) / 10 : null,
      wind_speed_max_mph: daily.wind_speed_10m_max[i] != null ? Math.round(msToMph(daily.wind_speed_10m_max[i]) * 10) / 10 : null,
      wind_direction_dominant: daily.wind_direction_10m_dominant[i] != null ? Math.round(daily.wind_direction_10m_dominant[i]) : null,
      pressure_avg_msl: daily.surface_pressure_mean[i] != null ? Math.round(daily.surface_pressure_mean[i] * 10) / 10 : null,
      pressure_change_12h: pressureChange != null ? Math.round(pressureChange * 10) / 10 : null,
      precipitation_total_mm: daily.precipitation_sum[i] != null ? Math.round(daily.precipitation_sum[i] * 10) / 10 : null,
      cloud_cover_avg: daily.cloud_cover_mean[i] != null ? Math.round(daily.cloud_cover_mean[i]) : null,
    });
  }

  // Batch upsert in chunks of 500
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_weather_history`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`  Upsert failed for ${stateAbbr} chunk ${i}: ${await res.text()}`);
    } else {
      inserted += chunk.length;
    }
  }

  console.log(`  ${stateAbbr}: ${inserted} days inserted`);
  return inserted;
}

async function main() {
  console.log("=== Backfilling Weather History ===");
  console.log(`Date range: ${START_DATE} to ${END_DATE} (duck season months only)`);

  let total = 0;
  const states = Object.entries(STATE_COORDS);

  for (let i = 0; i < states.length; i++) {
    const [abbr, [lat, lng]] = states[i];
    try {
      const count = await backfillState(abbr, lat, lng);
      total += count;
    } catch (err) {
      console.error(`  FAILED ${abbr}: ${err}`);
    }
    // Be polite to Open-Meteo
    if (i < states.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\nDone! Total: ${total} weather history rows`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
