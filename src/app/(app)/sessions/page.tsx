"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, Users, ChevronRight, Clock } from "lucide-react";
import type { Session } from "@/lib/types/database";

interface SessionWithStats extends Session {
  creator_name?: string;
  confirmed_count: number;
  waitlist_count: number;
  paid_count: number;
  payment_total: number;
  total_collected: number;
  total_due: number;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function fetch() {
      const { data: rawSessions } = await supabase
        .from("sessions")
        .select("*, creator:players!sessions_created_by_fkey(name)")
        .order("date", { ascending: false })
        .limit(20);

      if (!rawSessions) { setIsLoading(false); return; }

      const sessionsWithStats: SessionWithStats[] = await Promise.all(
        rawSessions.map(async (s: Record<string, unknown>) => {
          const session = s as unknown as Session & { creator?: { name: string } };

          const [rsvpRes, paymentRes] = await Promise.all([
            supabase.from("rsvps").select("is_waitlist, status").eq("session_id", session.id),
            supabase.from("payments").select("payment_status, amount_paid, amount_due").eq("session_id", session.id),
          ]);

          const rsvps = rsvpRes.data || [];
          const payments = paymentRes.data || [];

          return {
            ...session,
            creator_name: (s.creator as { name: string } | null)?.name || "Unknown",
            confirmed_count: rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist).length,
            waitlist_count: rsvps.filter((r) => r.is_waitlist).length,
            paid_count: payments.filter((p) => p.payment_status === "paid").length,
            payment_total: payments.length,
            total_collected: payments.reduce((sum, p) => sum + (p.amount_paid || 0), 0),
            total_due: payments.reduce((sum, p) => sum + (p.amount_due || 0), 0),
          };
        })
      );

      setSessions(sessionsWithStats);
      setIsLoading(false);
    }
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getWorkflowStep(s: SessionWithStats) {
    if (s.status === "cancelled") return { label: "Cancelled", color: "bg-red-100 text-red-800" };
    if (s.status === "completed") return { label: "Completed", color: "bg-gray-100 text-gray-800" };
    if (s.status === "teams_published" && s.payment_total > 0) return { label: "Payments", color: "bg-purple-100 text-purple-800" };
    if (s.status === "teams_published") return { label: "Teams", color: "bg-green-100 text-green-800" };
    if (s.status === "signups_closed") return { label: "Closed", color: "bg-yellow-100 text-yellow-800" };
    if (s.confirmed_count > 0) return { label: "Sign-ups", color: "bg-blue-100 text-blue-800" };
    return { label: "Created", color: "bg-blue-50 text-blue-600" };
  }

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
      ) : (<>
        {sessions.filter((s) => ["upcoming", "signups_closed", "teams_published"].includes(s.status)).map((session) => {
          const maxPlayers = session.format === "3t" ? 15 : 10;
          const step = getWorkflowStep(session);
          return (
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
                  <Badge className={step.color}>
                    {step.label}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {session.venue}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {session.start_time}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {session.confirmed_count}/{maxPlayers} confirmed
                    </span>
                    {session.waitlist_count > 0 && (
                      <span className="text-orange-600">{session.waitlist_count} waitlisted</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">by {session.creator_name} · {new Date(session.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                    {session.payment_total > 0 && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {session.paid_count}/{session.payment_total} paid
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {sessions.filter((s) => ["completed", "cancelled"].includes(s.status)).length > 0 && (
          <>
            <h3 className="text-sm font-medium text-muted-foreground pt-2">Past Sessions</h3>
            {sessions.filter((s) => ["completed", "cancelled"].includes(s.status)).map((session) => {
              const maxPlayers = session.format === "3t" ? 15 : 10;
              const step = getWorkflowStep(session);
              return (
                <Card
                  key={session.id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors opacity-50"
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
                      <Badge className={step.color}>
                        {step.label}
                      </Badge>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {session.venue}</span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {session.confirmed_count}/{maxPlayers}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>by {session.creator_name} · {new Date(session.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                        {session.payment_total > 0 && (
                          <span>{session.paid_count}/{session.payment_total} paid</span>
                        )}
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </>)}
    </div>
  );
}
