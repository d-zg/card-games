import { useState, useCallback } from "react";

const KEY_PREFIX = "card-games:token:";

export function useIdentity(roomId: string) {
  const key = KEY_PREFIX + roomId;

  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(key),
  );

  const save = useCallback(
    (newToken: string) => {
      localStorage.setItem(key, newToken);
      setToken(newToken);
    },
    [key],
  );

  const clear = useCallback(() => {
    localStorage.removeItem(key);
    setToken(null);
  }, [key]);

  return { token, save, clear };
}
