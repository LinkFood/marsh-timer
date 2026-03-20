export type LayerCategory = 'environment' | 'migration' | 'weather' | 'intelligence' | 'terrain';

export interface LayerDef {
  id: string;
  label: string;
  category: LayerCategory;
  description?: string;
  /** Mapbox layer IDs this logical layer controls */
  mapboxLayers: string[];
  defaultOn?: boolean;
}

export interface LayerPreset {
  id: string;
  label: string;
  description: string;
  layers: string[];
}
