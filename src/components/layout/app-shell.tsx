"use client";

import { NavBar } from "./nav-bar";
import { useAuth } from "@/lib/context/auth-context";
import { Shield } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { player, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 border-b bg-green-700 text-white">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold">Monday Night Soccer</h1>
          {player && (
            <div className="flex items-center gap-1.5 text-sm">
              {isAdmin && <Shield className="h-3.5 w-3.5 text-yellow-300" />}
              <span className={isAdmin ? "text-yellow-200 font-medium" : "text-green-100"}>
                {player.name.split(" ")[0]}
              </span>
              {isAdmin && (
                <span className="text-[10px] bg-yellow-500 text-yellow-950 px-1.5 py-0.5 rounded-full font-semibold uppercase">
                  Admin
                </span>
              )}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">
        {children}
      </main>
      <NavBar />
    </div>
  );
}
