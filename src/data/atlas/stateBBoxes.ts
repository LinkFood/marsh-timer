/**
 * stateBBoxes.ts — full state names per USPS abbreviation, derived at module
 * load from the committed usStates.geojson (US Census TIGER lineage). Zero
 * runtime fetches, zero new deps.
 *
 * (This module once also derived geographic bounding boxes for the old
 * letter-tile atlas; the atlas now renders real Albers geography from
 * src/data/atlas/stateShapesAlbers.ts, so only the names remain.)
 */
import { US_STATES_GEOJSON } from './usStates.geojson';

/** Full state name per USPS abbreviation ("PA" → "Pennsylvania"). */
export const STATE_NAMES: Record<string, string> = {};

for (const feature of US_STATES_GEOJSON.features) {
  STATE_NAMES[feature.properties.state] = feature.properties.name;
}
