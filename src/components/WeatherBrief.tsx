import { useWeather } from "@/hooks/useWeather";
import { Wind, Thermometer, Droplets, ArrowUp } from "lucide-react";

// State centroids for weather lookups
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

function windDirection(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

export default function WeatherBrief({ stateAbbr }: { stateAbbr: string }) {
  const coords = STATE_COORDS[stateAbbr];
  const { data: weather, isLoading } = useWeather(
    coords?.[0] ?? null,
    coords?.[1] ?? null,
    stateAbbr,
  );

  if (isLoading || !weather?.hourly) return null;

  const hourly = weather.hourly;
  const now = new Date();
  const currentHour = now.getUTCHours();
  const idx = Math.min(currentHour, hourly.time.length - 1);

  const temp = hourly.temperature_2m?.[idx];
  const wind = hourly.wind_speed_10m?.[idx];
  const windDir = hourly.wind_direction_10m?.[idx];
  const precip = hourly.precipitation?.[idx];
  const pressure = hourly.pressure_msl?.[idx];

  if (temp == null) return null;

  return (
    <div className="grid grid-cols-4 gap-2">
      <div className="bg-secondary/50 rounded-lg p-2 text-center">
        <Thermometer size={14} className="mx-auto text-primary/60 mb-1" />
        <p className="text-sm font-semibold text-foreground tabular-nums">{Math.round(temp)}°F</p>
        <p className="text-[9px] text-muted-foreground">Temp</p>
      </div>
      <div className="bg-secondary/50 rounded-lg p-2 text-center">
        <Wind size={14} className="mx-auto text-primary/60 mb-1" />
        <p className="text-sm font-semibold text-foreground tabular-nums">{Math.round(wind || 0)}</p>
        <p className="text-[9px] text-muted-foreground">mph {windDir != null ? windDirection(windDir) : ""}</p>
      </div>
      <div className="bg-secondary/50 rounded-lg p-2 text-center">
        <Droplets size={14} className="mx-auto text-primary/60 mb-1" />
        <p className="text-sm font-semibold text-foreground tabular-nums">{(precip || 0).toFixed(1)}</p>
        <p className="text-[9px] text-muted-foreground">mm precip</p>
      </div>
      <div className="bg-secondary/50 rounded-lg p-2 text-center">
        <ArrowUp size={14} className="mx-auto text-primary/60 mb-1" />
        <p className="text-sm font-semibold text-foreground tabular-nums">{pressure ? Math.round(pressure) : "—"}</p>
        <p className="text-[9px] text-muted-foreground">mb</p>
      </div>
    </div>
  );
}
