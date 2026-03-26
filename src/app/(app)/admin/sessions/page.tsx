"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar, MapPin } from "lucide-react";
import type { Session } from "@/lib/types/database";

export default function AdminSessionsPage() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) { router.push("/"); return; }
    async function fetch() {
      const { data } = await supabase.from("sessions").select("*").order("date", { ascending: false });
      setSessions((data || []) as Session[]);
      setIsLoading(false);
    }
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const statusColor: Record<string, string> = {
    upcoming: "bg-blue-100 text-blue-800",
    signups_closed: "bg-yellow-100 text-yellow-800",
    teams_published: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    cancelled: "bg-red-100 text-red-800",
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Manage Sessions</h2>
        <Button size="sm" className="bg-green-700 hover:bg-green-800" onClick={() => router.push("/admin/sessions/new")}>
          <Plus className="mr-1 h-4 w-4" /> New
        </Button>
      </div>
      {sessions.map((session) => (
        <Card
          key={session.id}
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => router.push(`/admin/sessions/${session.id}`)}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">
                  {new Date(session.date).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <Badge className={statusColor[session.status]}>{session.status.replace(/_/g, " ")}</Badge>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {session.venue} | {session.start_time}–{session.end_time} | {session.format === "3t" ? "3 teams" : "2 teams"} | ${session.court_cost}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
