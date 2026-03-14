import type { FeatureCollection } from 'geojson';

// 4 major flyway corridor polygons — full continental range (breeding grounds to wintering grounds)
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
          // Counter-clockwise: east coast then west edge
          // North — Labrador/Quebec breeding grounds
          [-78, 60], [-68, 60], [-62, 58], [-60, 55],
          // Atlantic Canada coast south
          [-63, 52], [-64, 48], [-66, 44], [-69, 42],
          // US Eastern seaboard
          [-71, 41], [-74, 39], [-75, 37], [-76, 35],
          // Southeast coast
          [-78, 33], [-80, 31], [-81, 28],
          // Florida tip
          [-80, 25],
          // Caribbean wintering — south through Bahamas/Cuba
          [-78, 23], [-76, 21], [-74, 19], [-76, 18],
          // Return west side north — Cuba/Florida west
          [-79, 18], [-82, 20], [-83, 23],
          [-83, 25], [-83, 27],
          // Interior return north
          [-82, 29], [-81, 31], [-80, 33],
          [-79, 35], [-77, 37], [-76, 39],
          [-75, 41], [-73, 43], [-71, 45],
          // Interior Quebec/Labrador
          [-73, 48], [-75, 52], [-76, 56], [-78, 60],
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
          // Counter-clockwise: east side then west side
          // North — Manitoba/Saskatchewan prairie potholes
          [-95, 58], [-84, 58], [-83, 55],
          // Hudson Bay lowlands south
          [-82, 52], [-82, 49], [-83, 45],
          // Great Lakes / Ohio Valley
          [-84, 42], [-86, 39], [-87, 36],
          // Lower Mississippi
          [-88, 33], [-89, 31],
          // Gulf Coast
          [-89, 29], [-90, 27], [-89, 25],
          // Mexico Gulf wintering
          [-91, 22], [-93, 22],
          // Return west side north
          [-95, 23], [-96, 25], [-95, 28],
          [-95, 30], [-94, 33], [-93, 36],
          [-92, 39], [-91, 42], [-90, 45],
          // Central Canada return
          [-91, 48], [-92, 52], [-93, 55], [-95, 58],
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
          // Counter-clockwise: east side then west side
          // North — Alberta/Saskatchewan breeding
          [-109, 58], [-96, 58], [-96, 55],
          // Prairie provinces south
          [-96, 52], [-96, 49], [-96, 45],
          // Great Plains
          [-96, 42], [-97, 39], [-97, 36],
          [-97, 33], [-97, 30],
          // Texas coast / Mexico
          [-97, 27], [-97, 24], [-98, 21], [-99, 20],
          // Return west side north — Mexico interior
          [-101, 20], [-103, 22], [-104, 25],
          [-105, 28], [-105, 31], [-105, 33],
          [-106, 36], [-106, 39], [-107, 42],
          [-108, 45], [-108, 49],
          // Alberta return
          [-108, 52], [-108, 55], [-109, 58],
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
          // Counter-clockwise: east side then west side
          // North — Alaska breeding grounds (wide)
          [-145, 65], [-140, 65], [-135, 62],
          // Yukon / BC interior
          [-130, 60], [-125, 57], [-120, 54],
          // Interior mountain corridor south
          [-118, 52], [-116, 49], [-115, 46],
          [-116, 43], [-118, 40],
          // California Central Valley
          [-119, 37], [-118, 34], [-117, 33],
          // Baja wintering
          [-116, 30], [-115, 27], [-113, 24], [-112, 22],
          // Return west/coastal side north
          [-114, 22], [-116, 24], [-118, 27],
          [-118, 30], [-120, 32], [-121, 34],
          [-122, 37], [-123, 40], [-123, 43],
          [-124, 46], [-125, 49],
          // BC / Alaska coast
          [-128, 52], [-132, 55], [-138, 58],
          [-145, 60], [-155, 62], [-165, 64],
          [-165, 65], [-145, 65],
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
          [-72, 59], [-66, 55], [-65, 50], [-68, 46],
          [-71, 43], [-73, 40], [-75, 38], [-77, 35],
          [-79, 33], [-80, 30], [-81, 27], [-80, 24],
          [-78, 21], [-76, 19],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Mississippi Flyway', lineColor: 'rgba(34, 197, 94, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-90, 57], [-87, 53], [-85, 49], [-85, 45],
          [-87, 42], [-88, 39], [-89, 36], [-90, 33],
          [-91, 30], [-91, 27], [-92, 24], [-92, 22],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Central Flyway', lineColor: 'rgba(250, 204, 21, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-103, 57], [-101, 53], [-100, 49], [-99, 45],
          [-99, 42], [-99, 39], [-98, 36], [-98, 33],
          [-98, 30], [-98, 27], [-99, 24], [-100, 21],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Pacific Flyway', lineColor: 'rgba(168, 85, 247, 0.5)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-152, 64], [-142, 62], [-133, 59], [-127, 55],
          [-122, 51], [-119, 48], [-119, 45], [-120, 42],
          [-120, 39], [-119, 36], [-118, 34], [-117, 32],
          [-116, 28], [-114, 24], [-113, 22],
        ],
      },
    },
  ],
};
