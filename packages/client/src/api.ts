import type {
  CreateRoomResponse,
  GetRoomResponse,
  JoinRoomResponse,
  StartGameResponse,
} from "@card-games/shared";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json();
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// -- Rooms --

export function createRoom(gameType: string): Promise<CreateRoomResponse> {
  return request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ gameType }),
  });
}

export function getRoom(roomId: string): Promise<GetRoomResponse> {
  return request(`/api/rooms/${roomId}`);
}

export function joinRoom(
  roomId: string,
  playerId: string,
  displayName: string,
): Promise<JoinRoomResponse> {
  return request(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ playerId, displayName }),
  });
}

export function leaveRoom(roomId: string, token: string): Promise<void> {
  return request(`/api/rooms/${roomId}/leave`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function startGame(
  roomId: string,
  token: string,
): Promise<StartGameResponse> {
  return request(`/api/rooms/${roomId}/start`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

// -- Games --

export interface GameStateResponse<TView> {
  view: TView;
  version: number;
}

export function getGameState<TView>(
  gameId: string,
  token?: string,
): Promise<GameStateResponse<TView>> {
  return request(`/api/games/${gameId}/state`, {
    headers: token ? authHeaders(token) : {},
  });
}

export function submitAction<TView>(
  gameId: string,
  token: string,
  action: unknown,
): Promise<GameStateResponse<TView>> {
  return request(`/api/games/${gameId}/action`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(action),
  });
}

export { ApiError };
