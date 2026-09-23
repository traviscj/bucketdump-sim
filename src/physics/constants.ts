/** Physical constants. The sim is 2D: "volume" is area (m²) × a nominal depth. */
export const G = 9.81; // m/s²
export const RHO_WATER = 1000; // kg/m³
/** Out-of-plane depth used to turn 2D areas into volumes/masses. */
export const DEPTH = 0.6; // m

/** m² of 2D area → litres, for display. */
export const toLitres = (area: number): number => area * DEPTH * 1000;
