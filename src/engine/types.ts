import type { Bake } from '../player/player';

export interface SystemParam {
  key: string; label: string;
  min?: number; max?: number; step?: number;
  options?: string[];
  def: number | string;
  live?: boolean;
}
export interface SystemInfo { name: string; vector: boolean; living: boolean; params: SystemParam[] }

export interface BakeRequest { type: 'bake'; revision: number; sys: number; seed: number; amount: number; params: Record<string, number | string>;
  /** Simulation grid, shaped like the screen, and the letter mask drawn at that size. */
  grid: [number, number]; glyph: Uint8Array }
export interface BakeMessage { type: 'bake'; revision: number; sys: number; seed: number; amount: number; elapsed: number; grid: [number, number]; bake: Bake;
  /** Vector systems only: strokes as [x0, y0, x1, y1, width, age] in grid units. */
  segments?: Float32Array }
export interface CatalogMessage { type: 'catalog'; systems: SystemInfo[] }
export type WorkerMessage = BakeMessage | CatalogMessage | { type: 'error'; message: string };
