import type { FeatureCollection } from 'geojson';

// 4 major flyway corridor polygons — wide bands (~200-300mi) following migration routes
export const FLYWAY_CORRIDORS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Atlantic Flyway',
        color: 'rgba(59, 130, 246, 0.15)',
        lineColor: 'rgba(59, 130, 246, 0.4)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // Eastern seaboard — Maine to Florida tip
          [-78, 47], [-67, 47], [-66, 44], [-69, 42], [-71, 41],
          [-74, 39], [-75, 37], [-76, 35], [-78, 33], [-80, 31],
          [-81, 28], [-80, 25], [-82, 25], [-83, 27], [-82, 29],
          [-81, 31], [-80, 33], [-79, 35], [-77, 37], [-76, 39],
          [-75, 41], [-73, 43], [-71, 45], [-78, 47],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Mississippi Flyway',
        color: 'rgba(34, 197, 94, 0.15)',
        lineColor: 'rgba(34, 197, 94, 0.4)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // Mississippi River valley — Minnesota to Gulf Coast
          [-95, 49], [-84, 49], [-83, 45], [-84, 42], [-86, 39],
          [-87, 36], [-88, 33], [-89, 31], [-91, 29], [-93, 29],
          [-95, 30], [-94, 33], [-93, 36], [-92, 39], [-91, 42],
          [-90, 45], [-91, 48], [-95, 49],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Central Flyway',
        color: 'rgba(250, 204, 21, 0.15)',
        lineColor: 'rgba(250, 204, 21, 0.4)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // Great Plains — Montana/Dakotas to Texas Gulf Coast
          [-109, 49], [-96, 49], [-96, 45], [-96, 42], [-97, 39],
          [-97, 36], [-97, 33], [-97, 30], [-97, 28], [-99, 26],
          [-101, 27], [-103, 29], [-104, 33], [-105, 36], [-106, 39],
          [-107, 42], [-108, 45], [-109, 49],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: {
        name: 'Pacific Flyway',
        color: 'rgba(168, 85, 247, 0.15)',
        lineColor: 'rgba(168, 85, 247, 0.4)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // Pacific coast — Washington to Southern California/Mexico border
          [-125, 49], [-116, 49], [-115, 46], [-116, 43],
          [-118, 40], [-119, 37], [-118, 34], [-117, 33],
          [-116, 32], [-118, 31], [-120, 32], [-121, 34],
          [-122, 37], [-123, 40], [-123, 43], [-124, 46], [-125, 49],
        ]],
      },
    },
  ],
};

// Center lines for animated directional flow down each corridor
export const FLYWAY_FLOW_LINES: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Atlantic Flyway', lineColor: 'rgba(59, 130, 246, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-73, 46], [-71, 43], [-73, 40], [-75, 38], [-77, 35],
          [-79, 33], [-80, 30], [-81, 27],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Mississippi Flyway', lineColor: 'rgba(34, 197, 94, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-90, 48], [-88, 45], [-87, 42], [-88, 39], [-89, 36],
          [-90, 33], [-91, 30],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Central Flyway', lineColor: 'rgba(250, 204, 21, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-103, 48], [-101, 45], [-100, 42], [-99, 39], [-99, 36],
          [-98, 33], [-98, 29],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Pacific Flyway', lineColor: 'rgba(168, 85, 247, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-122, 48], [-121, 45], [-120, 42], [-120, 39], [-120, 36],
          [-118, 34], [-117, 32],
        ],
      },
    },
  ],
};
