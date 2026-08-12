import examplesData from "./examples.json";

export type PresetData = Record<string, Record<string, string>>;

export const PRESETS_DATA: PresetData = examplesData as PresetData;

/**
 * Returns RLE string for a given preset name.
 * Searches across all categories in examples.json.
 */
export function getPresetRLE(name: string): string | undefined {
  if (!name || name === "Random") return undefined;
  
  for (const category in PRESETS_DATA) {
    const presets = PRESETS_DATA[category];
    if (presets[name]) return presets[name];
    
    // Case-insensitive fallback
    for (const key in presets) {
      if (key.toLowerCase() === name.toLowerCase()) {
        return presets[key];
      }
    }
  }
  
  return undefined;
}

/**
 * Returns all preset categories with their preset names.
 */
export function getAllPresetCategories(): { category: string; names: string[] }[] {
  return Object.keys(PRESETS_DATA).map((category) => ({
    category,
    names: Object.keys(PRESETS_DATA[category]),
  }));
}
