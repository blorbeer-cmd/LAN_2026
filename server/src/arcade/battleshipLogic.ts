export const BATTLESHIP_SIZE = 10;

export const FLEET = [
  { id: 'carrier', name: 'Flugzeugträger', length: 5 },
  { id: 'battleship', name: 'Schlachtschiff', length: 4 },
  { id: 'cruiser', name: 'Kreuzer', length: 3 },
  { id: 'submarine', name: 'U-Boot', length: 3 },
  { id: 'destroyer', name: 'Zerstörer', length: 2 },
] as const;

export type Orientation = 'horizontal' | 'vertical';

export interface Placement {
  shipId: string;
  row: number;
  col: number;
  orientation: Orientation;
}

export interface ShipState {
  shipId: string;
  name: string;
  length: number;
  cells: number[];
  hits: Set<number>;
}

export type ShotResult =
  | { ok: true; kind: 'miss' | 'hit' | 'sunk'; coordinate: number; shipId?: string; remainingSegments: number }
  | { ok: false; error: 'invalid-coordinate' | 'already-shot' };

export function coordinate(row: number, col: number): number | null {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= BATTLESHIP_SIZE || col >= BATTLESHIP_SIZE) return null;
  return row * BATTLESHIP_SIZE + col;
}

export function cellsForPlacement(placement: Placement, length: number): number[] | null {
  if (!['horizontal', 'vertical'].includes(placement.orientation)) return null;
  const cells: number[] = [];
  for (let offset = 0; offset < length; offset += 1) {
    const row = placement.row + (placement.orientation === 'vertical' ? offset : 0);
    const col = placement.col + (placement.orientation === 'horizontal' ? offset : 0);
    const cell = coordinate(row, col);
    if (cell === null) return null;
    cells.push(cell);
  }
  return cells;
}

export function validatePlacements(placements: unknown): { ok: true; fleet: ShipState[] } | { ok: false; error: string } {
  if (!Array.isArray(placements) || placements.length !== FLEET.length) return { ok: false, error: 'Es müssen genau fünf Schiffe platziert werden.' };
  const seenShips = new Set<string>();
  const occupied = new Set<number>();
  const fleet: ShipState[] = [];
  for (const raw of placements) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Eine Schiffsposition ist ungültig.' };
    const value = raw as Partial<Placement>;
    const definition = FLEET.find((ship) => ship.id === value.shipId);
    if (!definition || seenShips.has(definition.id)) return { ok: false, error: 'Jedes Schiff darf genau einmal platziert werden.' };
    if (!Number.isInteger(value.row) || !Number.isInteger(value.col)) return { ok: false, error: 'Schiffskoordinaten sind ungültig.' };
    const cells = cellsForPlacement({ shipId: definition.id, row: value.row as number, col: value.col as number, orientation: value.orientation as Orientation }, definition.length);
    if (!cells) return { ok: false, error: `${definition.name} liegt außerhalb des Rasters.` };
    if (cells.some((cell) => occupied.has(cell))) return { ok: false, error: 'Schiffe dürfen sich nicht überschneiden.' };
    seenShips.add(definition.id);
    cells.forEach((cell) => occupied.add(cell));
    fleet.push({ shipId: definition.id, name: definition.name, length: definition.length, cells, hits: new Set() });
  }
  return { ok: true, fleet };
}

export function applyShot(fleet: ShipState[], fired: Set<number>, row: number, col: number): ShotResult {
  const cell = coordinate(row, col);
  if (cell === null) return { ok: false, error: 'invalid-coordinate' };
  if (fired.has(cell)) return { ok: false, error: 'already-shot' };
  fired.add(cell);
  const ship = fleet.find((entry) => entry.cells.includes(cell));
  if (!ship) return { ok: true, kind: 'miss', coordinate: cell, remainingSegments: remainingSegments(fleet) };
  ship.hits.add(cell);
  const sunk = ship.hits.size === ship.cells.length;
  return { ok: true, kind: sunk ? 'sunk' : 'hit', coordinate: cell, shipId: ship.shipId, remainingSegments: remainingSegments(fleet) };
}

export function remainingSegments(fleet: ShipState[]): number {
  return fleet.reduce((total, ship) => total + ship.cells.length - ship.hits.size, 0);
}

export function remainingShips(fleet: ShipState[]): number {
  return fleet.filter((ship) => ship.hits.size < ship.cells.length).length;
}

export function fleetSnapshot(fleet: ShipState[], includeCells: boolean) {
  return fleet.map((ship) => ({
    shipId: ship.shipId,
    name: ship.name,
    length: ship.length,
    ...(includeCells ? { cells: ship.cells } : {}),
    hits: [...ship.hits],
    sunk: ship.hits.size === ship.cells.length,
  }));
}

