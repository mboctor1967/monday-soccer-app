"use client";

import { NavBar } from "./nav-bar";
import { useAuth } from "@/lib/context/auth-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();

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
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">
        {children}
      </main>
      <NavBar />
    </div>
  );
}
