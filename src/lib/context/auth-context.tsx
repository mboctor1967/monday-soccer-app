"use client";

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { registerServiceWorker } from "@/lib/register-sw";
import type { Player } from "@/lib/types/database";
import type { User } from "@supabase/supabase-js";

interface AuthContextValue {
  user: User | null;
  player: Player | null;
  isAdmin: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  player: null,
  isAdmin: false,
  isLoading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();
  const initialLoadDone = useRef(false);

  async function loadPlayer(userId: string) {
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("auth_user_id", userId)
      .single();
    if (playerError) {
      console.error("Player lookup failed:", playerError.message, "user.id:", userId);
    }
    return playerData as Player | null;
  }

  useEffect(() => {
    const getSession = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        const playerData = await loadPlayer(user.id);
        setPlayer(playerData);
      }
      setIsLoading(false);
      initialLoadDone.current = true;
    };

    getSession();
    registerServiceWorker();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Skip if initial load hasn't finished — getSession handles it
        if (!initialLoadDone.current) return;

        // Only react to meaningful auth events
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          if (session?.user) {
            setUser(session.user);
            const playerData = await loadPlayer(session.user.id);
            setPlayer(playerData);
          }
        } else if (event === "SIGNED_OUT") {
          setUser(null);
          setPlayer(null);
        }
      }
    );

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setPlayer(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        player,
        isAdmin: player?.is_admin ?? false,
        isLoading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
