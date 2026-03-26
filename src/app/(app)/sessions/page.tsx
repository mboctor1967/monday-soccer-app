"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, Users, ChevronRight } from "lucide-react";
import type { Session } from "@/lib/types/database";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .order("date", { ascending: false })
        .limit(20);
      setSessions((data || []) as Session[]);
      setIsLoading(false);
    }
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <h2 className="text-xl font-bold">Sessions</h2>
      {sessions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No sessions found.
          </CardContent>
        </Card>
      ) : (
        sessions.map((session) => (
          <Card
            key={session.id}
            className="cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => router.push(`/sessions/${session.id}`)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">
                    {new Date(session.date).toLocaleDateString("en-AU", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
                <Badge className={statusColor[session.status]}>
                  {session.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {session.venue}
                </div>
                <div className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {session.format === "3t" ? "3 teams (15)" : "2 teams (10)"}
                </div>
                <ChevronRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
