"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { getTokens, subscribeTokens } from "./api";
import type { Me } from "./types";

export function useSignedIn() {
  return useSyncExternalStore(
    subscribeTokens,
    () => getTokens().access !== null || getTokens().refresh !== null,
    () => false,
  );
}

type Session = { me: Me; refresh: () => void; setMe: (me: Me) => void };

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export const SessionProvider = Ctx.Provider;
