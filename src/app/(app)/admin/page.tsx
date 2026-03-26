"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, DollarSign, Plus } from "lucide-react";
import type { Session } from "@/lib/types/database";

export default function AdminDashboard() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) { router.push("/"); return; }
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function fetchDashboard() {
    const [sessionsRes, playersRes] = await Promise.all([
      supabase.from("sessions").select("*").order("date", { ascending: false }).limit(10),
      supabase.from("players").select("*", { count: "exact", head: true }).eq("is_active", true),
    ]);
    setSessions((sessionsRes.data || []) as Session[]);
    setPlayerCount(playersRes.count || 0);
    setIsLoading(false);
  }

  const statusColor: Record<string, string> = {
    upcoming: "bg-blue-100 text-blue-800",
    signups_closed: "bg-yellow-100 text-yellow-800",
    teams_published: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    cancelled: "bg-red-100 text-red-800",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Admin Dashboard</h2>
        <Button size="sm" className="bg-green-700 hover:bg-green-800" onClick={() => router.push("/admin/sessions/new")}>
          <Plus className="mr-1 h-4 w-4" /> New Session
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Calendar className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{sessions.filter((s) => s.status === "upcoming").length}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Users className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{playerCount}</p>
            <p className="text-xs text-muted-foreground">Active Players</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <DollarSign className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{sessions.length}</p>
            <p className="text-xs text-muted-foreground">Total Sessions</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Sessions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No sessions yet. Create your first session!</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between border-b py-2 last:border-0 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2"
                  onClick={() => router.push(`/admin/sessions/${session.id}`)}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(session.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                    </p>
                    <p className="text-xs text-muted-foreground">{session.venue}</p>
                  </div>
                  <Badge className={statusColor[session.status]}>
                    {session.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
