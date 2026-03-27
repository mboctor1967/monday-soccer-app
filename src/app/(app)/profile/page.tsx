"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Star, CheckCircle, XCircle, HelpCircle, Pencil, TrendingUp, DollarSign, Calendar, Flame } from "lucide-react";
import { toast } from "sonner";
import type { Payment, Session, Team } from "@/lib/types/database";

interface SessionHistory {
  sessionId: string;
  date: string;
  venue: string;
  status: string;
  rsvpStatus: string;
  teamName: string | null;
  bibColor: string | null;
  paymentStatus: string | null;
  amountDue: number;
  amountPaid: number;
}

export default function ProfilePage() {
  const { player, isAdmin, refreshPlayer } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Stats
  const [sessionsPlayed, setSessionsPlayed] = useState(0);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [paymentRate, setPaymentRate] = useState(0);
  const [streak, setStreak] = useState(0);
  const [favouriteTeamColour, setFavouriteTeamColour] = useState<string | null>(null);
  const [monthlyData, setMonthlyData] = useState<{ month: string; count: number }[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionHistory[]>([]);

  useEffect(() => {
    if (player) {
      setName(player.name);
      setEmail(player.email || "");
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  async function fetchStats() {
    if (!player) return;

    const [sessionsRes, rsvpsRes, paymentsRes, teamPlayersRes] = await Promise.all([
      supabase.from("sessions").select("*").order("date", { ascending: false }),
      supabase.from("rsvps").select("session_id, status, is_waitlist, rsvp_at").eq("player_id", player.id),
      supabase.from("payments").select("*").eq("player_id", player.id),
      supabase.from("team_players").select("team_id, player_id, team:teams(*)").eq("player_id", player.id),
    ]);

    const allSessions = (sessionsRes.data || []) as Session[];
    const myRsvps = rsvpsRes.data || [];
    const myPayments = (paymentsRes.data || []) as Payment[];
    const myTeamPlayers = teamPlayersRes.data || [];

    // Completed sessions
    const completedSessions = allSessions.filter((s) => s.status === "completed" || s.status === "teams_published");
    const completedIds = new Set(completedSessions.map((s) => s.id));
    setTotalCompleted(completedSessions.length);

    // Sessions played (confirmed, not waitlisted, in completed sessions)
    const played = myRsvps.filter(
      (r) => r.status === "confirmed" && !r.is_waitlist && completedIds.has(r.session_id)
    );
    setSessionsPlayed(played.length);

    // Payment stats
    const paidTotal = myPayments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);
    const dueTotal = myPayments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0);
    const paidCount = myPayments.filter((p) => p.payment_status === "paid").length;
    setTotalPaid(paidTotal);
    setTotalOutstanding(dueTotal - paidTotal);
    setPaymentRate(myPayments.length > 0 ? Math.round((paidCount / myPayments.length) * 100) : 100);

    // Streak — consecutive completed sessions attended (most recent first)
    let currentStreak = 0;
    for (const session of completedSessions) {
      const attended = myRsvps.some(
        (r) => r.session_id === session.id && r.status === "confirmed" && !r.is_waitlist
      );
      if (attended) currentStreak++;
      else break;
    }
    setStreak(currentStreak);

    // Favourite team colour
    const colourCounts: Record<string, number> = {};
    for (const tp of myTeamPlayers) {
      const team = tp.team as unknown as Team;
      if (team?.bib_color) {
        colourCounts[team.bib_color] = (colourCounts[team.bib_color] || 0) + 1;
      }
    }
    const topColour = Object.entries(colourCounts).sort((a, b) => b[1] - a[1])[0];
    setFavouriteTeamColour(topColour ? topColour[0] : null);

    // Monthly attendance (last 6 months)
    const months: { month: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = d.toLocaleDateString("en-AU", { month: "short" });
      const count = played.filter((r) => {
        const session = allSessions.find((s) => s.id === r.session_id);
        return session && session.date.startsWith(monthKey);
      }).length;
      months.push({ month: monthLabel, count });
    }
    setMonthlyData(months);

    // Session history — build per session
    const history: SessionHistory[] = allSessions
      .filter((s) => myRsvps.some((r) => r.session_id === s.id))
      .slice(0, 20)
      .map((session) => {
        const rsvp = myRsvps.find((r) => r.session_id === session.id);
        const payment = myPayments.find((p) => p.session_id === session.id);
        const tp = myTeamPlayers.find((t) => {
          const team = t.team as unknown as Team;
          return team?.session_id === session.id;
        });
        const team = tp?.team as unknown as Team | null;

        return {
          sessionId: session.id,
          date: session.date,
          venue: session.venue,
          status: session.status,
          rsvpStatus: rsvp?.status || "unknown",
          teamName: team?.team_name || null,
          bibColor: team?.bib_color || null,
          paymentStatus: payment?.payment_status || null,
          amountDue: Number(payment?.amount_due) || 0,
          amountPaid: Number(payment?.amount_paid) || 0,
        };
      });
    setSessionHistory(history);
    setIsLoading(false);
  }

  async function handleSave() {
    if (!player) return;
    setIsSaving(true);
    const { error } = await supabase
      .from("players")
      .update({ name, email: email || null })
      .eq("id", player.id);

    if (error) {
      toast.error("Failed to update profile");
    } else {
      toast.success("Profile updated");
      await refreshPlayer();
      setIsEditing(false);
    }
    setIsSaving(false);
  }

  const bibColorMap: Record<string, string> = {
    White: "bg-white border border-gray-300",
    Black: "bg-gray-900",
    Red: "bg-red-600",
    Blue: "bg-blue-600",
    Yellow: "bg-yellow-400",
    Green: "bg-green-600",
  };

  const rsvpIcon: Record<string, React.ReactNode> = {
    confirmed: <CheckCircle className="h-3.5 w-3.5 text-green-600" />,
    absent: <XCircle className="h-3.5 w-3.5 text-red-500" />,
    maybe: <HelpCircle className="h-3.5 w-3.5 text-yellow-500" />,
  };

  if (isLoading || !player) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" />
      </div>
    );
  }

  const attendanceRate = totalCompleted > 0 ? Math.round((sessionsPlayed / totalCompleted) * 100) : 0;
  const maxMonthly = Math.max(...monthlyData.map((m) => m.count), 1);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">My Profile</h2>

      {/* Profile Card */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{player.name}</p>
              <p className="text-sm text-muted-foreground">{player.mobile}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <Badge>{player.player_type}</Badge>
                {isAdmin && (
                  <div className="mt-1 flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${i < player.skill_rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              {!isEditing && (
                <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)} className="h-8 w-8">
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {isEditing ? (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={isSaving} size="sm" className="bg-green-700 hover:bg-green-800">
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="outline" size="sm" disabled={isSaving} onClick={() => { setName(player.name); setEmail(player.email || ""); setIsEditing(false); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          ) : (
            player.email && (
              <>
                <Separator />
                <div className="text-sm text-muted-foreground">{player.email}</div>
              </>
            )
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp className="mx-auto h-4 w-4 text-green-700" />
            <p className="text-xl font-bold text-green-700">{sessionsPlayed}</p>
            <p className="text-[10px] text-muted-foreground">Sessions Played</p>
            <p className="text-[10px] text-muted-foreground">{attendanceRate}% attendance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <DollarSign className="mx-auto h-4 w-4 text-green-700" />
            <p className="text-xl font-bold text-green-700">${totalPaid.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">Total Paid</p>
            {totalOutstanding > 0 && (
              <p className="text-[10px] text-red-600">${totalOutstanding.toFixed(0)} outstanding</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Flame className="mx-auto h-4 w-4 text-orange-500" />
            <p className="text-xl font-bold">{streak}</p>
            <p className="text-[10px] text-muted-foreground">Session Streak</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Calendar className="mx-auto h-4 w-4 text-green-700" />
            <p className="text-xl font-bold">{paymentRate}%</p>
            <p className="text-[10px] text-muted-foreground">Payment Rate</p>
            {favouriteTeamColour && (
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <div className={`h-3 w-3 rounded-full ${bibColorMap[favouriteTeamColour] || "bg-gray-300"}`} />
                <span className="text-[10px] text-muted-foreground">{favouriteTeamColour}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Attendance */}
      {monthlyData.some((m) => m.count > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Attendance</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-end justify-between gap-1 h-16">
              {monthlyData.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end h-12">
                    <div
                      className="w-full bg-green-500 rounded-t transition-all"
                      style={{ height: `${(m.count / maxMonthly) * 100}%`, minHeight: m.count > 0 ? "4px" : "0" }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{m.month}</span>
                  {m.count > 0 && <span className="text-[9px] font-medium">{m.count}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Session History</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {sessionHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <div className="space-y-1">
              {sessionHistory.map((entry) => (
                <div
                  key={entry.sessionId}
                  className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
                  onClick={() => router.push(`/sessions/${entry.sessionId}`)}
                >
                  <div className="flex items-center gap-2">
                    {rsvpIcon[entry.rsvpStatus] || <div className="w-3.5" />}
                    {entry.bibColor && (
                      <div className={`h-3 w-3 rounded-full shrink-0 ${bibColorMap[entry.bibColor] || "bg-gray-300"}`} />
                    )}
                    <div>
                      <span className="text-xs">
                        {new Date(entry.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-1">{entry.venue}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {entry.teamName && (
                      <span className="text-[10px] text-muted-foreground">{entry.teamName}</span>
                    )}
                    {entry.paymentStatus && (
                      <Badge
                        variant={entry.paymentStatus === "paid" ? "default" : "destructive"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {entry.paymentStatus === "paid" ? "Paid" : `$${(entry.amountDue - entry.amountPaid).toFixed(0)}`}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
