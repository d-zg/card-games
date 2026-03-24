import type { PlayerId } from "./types.js";

// -- Room API --

export interface CreateRoomRequest {
  gameType: string;
}

export interface CreateRoomResponse {
  roomId: string;
}

export interface RoomPlayer {
  playerId: PlayerId;
  displayName: string;
}

export interface GetRoomResponse {
  id: string;
  gameType: string;
  status: "waiting" | "playing" | "finished";
  gameId: string | null;
  players: RoomPlayer[];
  wins: Record<string, number>;
}

export interface JoinRoomRequest {
  playerId: PlayerId;
  displayName: string;
}

export interface JoinRoomResponse {
  token: string;
}

export interface StartGameResponse {
  gameId: string;
}

// -- Game API --

export interface ErrorResponse {
  error: string;
}
