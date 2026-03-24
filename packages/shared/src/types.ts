export type PlayerId = string; // "player-0", "player-1", etc. — positional
export type GameId = string;
export type RoomId = string;
export type PlayerToken = string;

export interface GameMeta {
  id: string; // "air-land-sea", "coup", etc.
  name: string;
  minPlayers: number;
  maxPlayers: number;
}
