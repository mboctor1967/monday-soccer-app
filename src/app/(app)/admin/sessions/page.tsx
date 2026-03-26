"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar, MapPin, Users, DollarSign } from "lucide-react";
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

export default function AdminSessionsPage() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) { router.push("/"); return; }
    async function fetch() {
      const { data: rawSessions } = await supabase
        .from("sessions")
        .select("*, creator:players!sessions_created_by_fkey(name)")
        .order("date", { ascending: false });

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
      {sessions.map((session) => {
        const maxPlayers = session.format === "3t" ? 15 : 10;
        const pctPaid = session.payment_total > 0 ? (session.paid_count / session.payment_total) * 100 : 0;
        const barColor = pctPaid === 100 ? "bg-green-500" : pctPaid >= 50 ? "bg-yellow-500" : "bg-red-500";
        return (
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
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {session.venue}</span>
                  <span>{session.start_time}–{session.end_time}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {session.confirmed_count}/{maxPlayers}
                  </span>
                  {session.waitlist_count > 0 && (
                    <span className="text-orange-600">{session.waitlist_count} waitlisted</span>
                  )}
                  <span>${session.court_cost}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>by {session.creator_name}</span>
                  {session.payment_total > 0 && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      ${session.total_collected.toFixed(0)} / ${session.total_due.toFixed(0)}
                      ({session.paid_count}/{session.payment_total} paid)
                    </span>
                  )}
                </div>
                {session.payment_total > 0 && (
                  <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pctPaid}%` }} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
