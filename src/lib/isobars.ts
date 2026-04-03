import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Point, MultiLineString } from 'geojson';

export interface PressurePoint {
  lng: number;
  lat: number;
  pressure: number;
}

export interface IsobarResult {
  contours: FeatureCollection<MultiLineString>;
  centers: FeatureCollection<Point>;
}

// Pressure thresholds every 4mb
const ISOBAR_LEVELS = [992, 996, 1000, 1004, 1008, 1012, 1016, 1020, 1024, 1028, 1032, 1036];
const MAJOR_INTERVAL = 8; // every 8mb is a "major" isobar (1000, 1008, 1016, 1024, 1032)

/**
 * Generate isobar contour lines and H/L pressure center markers
 * from sparse 50-state pressure data using turf interpolation.
 */
export function generateIsobars(points: PressurePoint[]): IsobarResult {
  if (points.length < 3) {
    return {
      contours: { type: 'FeatureCollection', features: [] },
      centers: { type: 'FeatureCollection', features: [] },
    };
  }

  // 1. Create point features with pressure property
  const pointFeatures = turf.featureCollection(
    points.map(p => turf.point([p.lng, p.lat], { pressure: p.pressure }))
  );

  // 2. Interpolate to a dense grid (~1 degree resolution across CONUS)
  const grid = turf.interpolate(pointFeatures, 1, {
    gridType: 'square',
    property: 'pressure',
    units: 'degrees',
  });

  // 3. Build a 2D array from the grid for marching squares
  const gridPoints = grid.features;
  if (gridPoints.length === 0) {
    return {
      contours: { type: 'FeatureCollection', features: [] },
      centers: { type: 'FeatureCollection', features: [] },
    };
  }

  // Extract unique sorted lngs and lats to build a 2D matrix
  const lngSet = new Set<number>();
  const latSet = new Set<number>();
  for (const f of gridPoints) {
    const coords = (f.geometry as Point).coordinates;
    lngSet.add(Math.round(coords[0] * 1000) / 1000);
    latSet.add(Math.round(coords[1] * 1000) / 1000);
  }
  const lngs = Array.from(lngSet).sort((a, b) => a - b);
  const lats = Array.from(latSet).sort((a, b) => a - b);

  // Build pressure matrix [row=lat][col=lng]
  const pressureMap = new Map<string, number>();
  for (const f of gridPoints) {
    const coords = (f.geometry as Point).coordinates;
    const key = `${Math.round(coords[0] * 1000)},${Math.round(coords[1] * 1000)}`;
    pressureMap.set(key, (f.properties?.pressure ?? 0) as number);
  }

  const getP = (lngIdx: number, latIdx: number): number | undefined => {
    const key = `${Math.round(lngs[lngIdx] * 1000)},${Math.round(lats[latIdx] * 1000)}`;
    return pressureMap.get(key);
  };

  // 4. Generate contour line segments for each threshold
  const contourFeatures: Feature<MultiLineString>[] = [];

  for (const threshold of ISOBAR_LEVELS) {
    const segments: [number, number][][] = [];

    for (let j = 0; j < lats.length - 1; j++) {
      for (let i = 0; i < lngs.length - 1; i++) {
        const p00 = getP(i, j);
        const p10 = getP(i + 1, j);
        const p01 = getP(i, j + 1);
        const p11 = getP(i + 1, j + 1);

        if (p00 === undefined || p10 === undefined || p01 === undefined || p11 === undefined) continue;

        // Check each edge of the cell for threshold crossings
        const edges: [[number, number], [number, number]][] = [];

        // Bottom edge (p00 -> p10)
        if ((p00 - threshold) * (p10 - threshold) < 0) {
          const t = (threshold - p00) / (p10 - p00);
          edges.push([[lngs[i] + t * (lngs[i + 1] - lngs[i]), lats[j]], [0, 0]]);
        }
        // Top edge (p01 -> p11)
        if ((p01 - threshold) * (p11 - threshold) < 0) {
          const t = (threshold - p01) / (p11 - p01);
          edges.push([[lngs[i] + t * (lngs[i + 1] - lngs[i]), lats[j + 1]], [0, 0]]);
        }
        // Left edge (p00 -> p01)
        if ((p00 - threshold) * (p01 - threshold) < 0) {
          const t = (threshold - p00) / (p01 - p00);
          edges.push([[lngs[i], lats[j] + t * (lats[j + 1] - lats[j])], [0, 0]]);
        }
        // Right edge (p10 -> p11)
        if ((p10 - threshold) * (p11 - threshold) < 0) {
          const t = (threshold - p10) / (p11 - p10);
          edges.push([[lngs[i + 1], lats[j] + t * (lats[j + 1] - lats[j])], [0, 0]]);
        }

        // Connect crossing points in pairs
        if (edges.length >= 2) {
          segments.push([edges[0][0], edges[1][0]]);
          if (edges.length === 4) {
            segments.push([edges[2][0], edges[3][0]]);
          }
        }
      }
    }

    if (segments.length > 0) {
      const isMajor = (threshold - 1000) % MAJOR_INTERVAL === 0;
      contourFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: segments,
        },
        properties: {
          pressure: threshold,
          major: isMajor,
        },
      });
    }
  }

  // 5. Find H/L pressure centers (local extrema in the grid)
  const centerFeatures: Feature<Point>[] = [];

  for (let j = 1; j < lats.length - 1; j++) {
    for (let i = 1; i < lngs.length - 1; i++) {
      const center = getP(i, j);
      if (center === undefined) continue;

      let isMax = true;
      let isMin = true;

      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const neighbor = getP(i + di, j + dj);
          if (neighbor === undefined) {
            isMax = false;
            isMin = false;
            continue;
          }
          if (neighbor >= center) isMax = false;
          if (neighbor <= center) isMin = false;
        }
      }

      if (isMax) {
        centerFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lngs[i], lats[j]] },
          properties: { type: 'H', pressure: Math.round(center) },
        });
      } else if (isMin) {
        centerFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lngs[i], lats[j]] },
          properties: { type: 'L', pressure: Math.round(center) },
        });
      }
    }
  }

  return {
    contours: { type: 'FeatureCollection', features: contourFeatures },
    centers: { type: 'FeatureCollection', features: centerFeatures },
  };
}

// --- Weather Front Detection ---

export interface FrontSegment {
  type: 'cold' | 'warm' | 'stationary';
  coordinates: [number, number][];
  gradient: number; // mb per 100km
}

/**
 * Detect weather fronts from pressure gradient analysis.
 * Fronts are where pressure changes rapidly over short distance — visible as isobar crowding.
 * Returns GeoJSON LineStrings colored by front type.
 */
export function detectFronts(
  pressurePoints: { lng: number; lat: number; pressure: number; temp?: number; windDir?: number }[]
): FeatureCollection {
  if (pressurePoints.length < 10) return { type: 'FeatureCollection', features: [] };

  const GRADIENT_THRESHOLD = 1.5; // mb per 100km — fronts typically 2-4mb/200km
  const MAX_DISTANCE_KM = 500;

  const segments: { from: [number, number]; to: [number, number]; gradient: number; type: string }[] = [];

  for (let i = 0; i < pressurePoints.length; i++) {
    for (let j = i + 1; j < pressurePoints.length; j++) {
      const a = pressurePoints[i];
      const b = pressurePoints[j];

      // Haversine distance approximation (good enough for CONUS)
      const dlat = (b.lat - a.lat) * 111;
      const dlng = (b.lng - a.lng) * 111 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
      const distKm = Math.sqrt(dlat * dlat + dlng * dlng);

      if (distKm > MAX_DISTANCE_KM || distKm < 50) continue;

      const gradient = Math.abs(b.pressure - a.pressure) / (distKm / 100);

      if (gradient >= GRADIENT_THRESHOLD) {
        // Midpoint of the front segment
        const midLng = (a.lng + b.lng) / 2;
        const midLat = (a.lat + b.lat) / 2;

        // Perpendicular to the pressure gradient = front line direction
        const angle = Math.atan2(b.lat - a.lat, b.lng - a.lng);
        const perpAngle = angle + Math.PI / 2;
        const halfLen = distKm / 4 * 0.009; // ~degrees

        const lineStart: [number, number] = [
          midLng + Math.cos(perpAngle) * halfLen,
          midLat + Math.sin(perpAngle) * halfLen,
        ];
        const lineEnd: [number, number] = [
          midLng - Math.cos(perpAngle) * halfLen,
          midLat - Math.sin(perpAngle) * halfLen,
        ];

        // Classify: temperature difference > 5°F between stations
        let frontType = 'stationary';
        if (a.temp != null && b.temp != null) {
          const tempDiff = b.temp - a.temp;
          if (Math.abs(tempDiff) > 5) {
            frontType = tempDiff < 0 ? 'cold' : 'warm';
          }
        }

        segments.push({
          from: lineStart,
          to: lineEnd,
          gradient,
          type: frontType,
        });
      }
    }
  }

  // Convert segments to GeoJSON LineStrings
  const features: Feature[] = segments.map(seg => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: [seg.from, seg.to],
    },
    properties: {
      type: seg.type,
      gradient: Math.round(seg.gradient * 10) / 10,
    },
  }));

  return { type: 'FeatureCollection', features };
}
