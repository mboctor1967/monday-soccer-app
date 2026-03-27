"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar, Users, DollarSign, Plus, AlertTriangle, CheckCircle,
  TrendingUp, UserX, Download
} from "lucide-react";
import { toast } from "sonner";
import type { Session, Player } from "@/lib/types/database";

interface PlayerAttendance {
  id: string;
  name: string;
  player_type: string;
  is_active: boolean;
  sessionsPlayed: number;
  totalSessions: number;
  attendanceRate: number;
  sessionsPaid: number;
  sessionsOwed: number;
  paymentRate: number;
  lastPlayed: string | null;
}

interface DataQualityIssue {
  type: "warning" | "info";
  label: string;
  count: number;
  details: string[];
}

export default function AdminDashboard() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [playerStats, setPlayerStats] = useState<PlayerAttendance[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQualityIssue[]>([]);
  const [totalCollected, setTotalCollected] = useState(0);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [sessionTrends, setSessionTrends] = useState<{ date: string; confirmed: number; max: number; waitlisted: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { router.push("/"); return; }
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, authLoading]);

  async function fetchDashboard() {
    const [sessionsRes, allPlayersRes, rsvpsRes, paymentsRes] = await Promise.all([
      supabase.from("sessions").select("*").order("date", { ascending: false }),
      supabase.from("players").select("*").order("name"),
      supabase.from("rsvps").select("session_id, player_id, status, is_waitlist, rsvp_at"),
      supabase.from("payments").select("session_id, player_id, payment_status, amount_paid, amount_due"),
    ]);

    const allSessions = (sessionsRes.data || []) as Session[];
    const allPlayers = (allPlayersRes.data || []) as Player[];
    const allRsvps = rsvpsRes.data || [];
    const allPayments = paymentsRes.data || [];

    setSessions(allSessions);
    setPlayerCount(allPlayers.filter((p) => p.is_active).length);
    setInactiveCount(allPlayers.filter((p) => !p.is_active).length);

    // Payment totals
    const collected = allPayments.reduce((s, p) => s + (p.amount_paid || 0), 0);
    const due = allPayments.reduce((s, p) => s + (p.amount_due || 0), 0);
    setTotalCollected(collected);
    setTotalOutstanding(due - collected);

    // Completed sessions for attendance calculation
    const completedSessions = allSessions.filter((s) => s.status === "completed" || s.status === "teams_published");
    const completedSessionIds = new Set(completedSessions.map((s) => s.id));

    // Per-player stats
    const stats: PlayerAttendance[] = allPlayers.map((player) => {
      const playerRsvps = allRsvps.filter(
        (r) => r.player_id === player.id && r.status === "confirmed" && !r.is_waitlist && completedSessionIds.has(r.session_id)
      );
      const playerPayments = allPayments.filter((p) => p.player_id === player.id);
      const paid = playerPayments.filter((p) => p.payment_status === "paid").length;
      const lastRsvp = playerRsvps.length > 0
        ? playerRsvps.sort((a, b) => b.rsvp_at.localeCompare(a.rsvp_at))[0].rsvp_at
        : null;

      return {
        id: player.id,
        name: player.name,
        player_type: player.player_type,
        is_active: player.is_active,
        sessionsPlayed: playerRsvps.length,
        totalSessions: completedSessions.length,
        attendanceRate: completedSessions.length > 0 ? (playerRsvps.length / completedSessions.length) * 100 : 0,
        sessionsPaid: paid,
        sessionsOwed: playerPayments.length,
        paymentRate: playerPayments.length > 0 ? (paid / playerPayments.length) * 100 : -1,
        lastPlayed: lastRsvp,
      };
    });
    setPlayerStats(stats);

    // Data quality checks
    const issues: DataQualityIssue[] = [];

    const noEmail = allPlayers.filter((p) => p.is_active && !p.email);
    if (noEmail.length > 0) {
      issues.push({
        type: "warning",
        label: "Players without email",
        count: noEmail.length,
        details: noEmail.map((p) => p.name),
      });
    }

    const defaultRating = allPlayers.filter((p) => p.is_active && p.skill_rating === 3);
    if (defaultRating.length > 5) {
      issues.push({
        type: "info",
        label: "Players with default skill rating (3)",
        count: defaultRating.length,
        details: defaultRating.map((p) => p.name),
      });
    }

    // Potential duplicates — similar names
    const nameMap = new Map<string, string[]>();
    allPlayers.forEach((p) => {
      const key = p.name.toLowerCase().replace(/\s+/g, "").slice(0, 6);
      if (!nameMap.has(key)) nameMap.set(key, []);
      nameMap.get(key)!.push(p.name);
    });
    const dupes = Array.from(nameMap.values()).filter((v) => v.length > 1);
    if (dupes.length > 0) {
      issues.push({
        type: "warning",
        label: "Potential duplicate players",
        count: dupes.length,
        details: dupes.map((d) => d.join(" / ")),
      });
    }

    // Completed sessions without payments
    const sessionsWithoutPayments = completedSessions.filter(
      (s) => !allPayments.some((p) => p.session_id === s.id)
    );
    if (sessionsWithoutPayments.length > 0) {
      issues.push({
        type: "warning",
        label: "Completed sessions without payments",
        count: sessionsWithoutPayments.length,
        details: sessionsWithoutPayments.map(
          (s) => new Date(s.date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
        ),
      });
    }

    // Inactive players with recent RSVPs
    const inactiveWithRsvps = allPlayers.filter((p) => {
      if (p.is_active) return false;
      return allRsvps.some((r) => r.player_id === p.id);
    });
    if (inactiveWithRsvps.length > 0) {
      issues.push({
        type: "info",
        label: "Inactive players with session history",
        count: inactiveWithRsvps.length,
        details: inactiveWithRsvps.map((p) => p.name),
      });
    }

    // Active players who never played
    const neverPlayed = allPlayers.filter((p) => {
      if (!p.is_active) return false;
      return !allRsvps.some((r) => r.player_id === p.id && r.status === "confirmed");
    });
    if (neverPlayed.length > 0) {
      issues.push({
        type: "info",
        label: "Active players who never played",
        count: neverPlayed.length,
        details: neverPlayed.map((p) => p.name),
      });
    }

    setDataQuality(issues);

    // Session trends
    const trends = completedSessions.slice(0, 10).reverse().map((s) => {
      const sessionRsvps = allRsvps.filter((r) => r.session_id === s.id && r.status === "confirmed");
      return {
        date: new Date(s.date).toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
        confirmed: sessionRsvps.filter((r) => !r.is_waitlist).length,
        max: s.format === "3t" ? 15 : 10,
        waitlisted: sessionRsvps.filter((r) => r.is_waitlist).length,
      };
    });
    setSessionTrends(trends);

    setIsLoading(false);
  }

  async function handleExportExcel() {
    setIsExporting(true);
    try {
      const res = await fetch("/api/export/csv");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `monday-soccer-export-${new Date().toISOString().split("T")[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed");
    }
    setIsExporting(false);
  }

  const statusColor: Record<string, string> = {
    upcoming: "bg-blue-100 text-blue-800",
    signups_closed: "bg-yellow-100 text-yellow-800",
    teams_published: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    cancelled: "bg-red-100 text-red-800",
  };

  const completedCount = sessions.filter((s) => s.status === "completed" || s.status === "teams_published").length;
  const collectionRate = totalCollected + totalOutstanding > 0
    ? (totalCollected / (totalCollected + totalOutstanding)) * 100
    : 0;

  const activePlayers = playerStats.filter((p) => p.is_active);
  const inactivePlayers = playerStats.filter((p) => !p.is_active);


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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Calendar className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{sessions.filter((s) => s.status === "upcoming").length}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{completedCount}</p>
            <p className="text-xs text-muted-foreground">Sessions Played</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Users className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{playerCount}</p>
            <p className="text-xs text-muted-foreground">Active Players</p>
            {inactiveCount > 0 && (
              <p className="text-xs text-muted-foreground">({inactiveCount} inactive)</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <DollarSign className="mx-auto h-5 w-5 text-green-700" />
            <p className="text-lg font-bold">{Math.round(collectionRate)}%</p>
            <p className="text-xs text-muted-foreground">Collection Rate</p>
            {totalOutstanding > 0 && (
              <p className="text-xs text-red-600">${totalOutstanding.toFixed(0)} outstanding</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attendance Report */}
      {(() => {
        const regulars = activePlayers.filter((p) => p.attendanceRate >= 75);
        const sometimes = activePlayers.filter((p) => p.attendanceRate >= 30 && p.attendanceRate < 75);
        const rarely = activePlayers.filter((p) => p.attendanceRate > 0 && p.attendanceRate < 30);
        const never = activePlayers.filter((p) => p.attendanceRate === 0);

        const PlayerBar = ({ p, opacity }: { p: PlayerAttendance; opacity?: string }) => (
          <div className={`space-y-0.5 ${opacity || ""}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="truncate">{p.name}</span>
              <span className="text-muted-foreground shrink-0 ml-2">
                {p.sessionsPlayed}/{p.totalSessions} ({Math.round(p.attendanceRate)}%)
                {!p.is_active && " · inactive"}
                {p.lastPlayed && !p.is_active && ` · last ${new Date(p.lastPlayed).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  p.is_active ? (
                    p.attendanceRate >= 75 ? "bg-green-500" :
                    p.attendanceRate >= 30 ? "bg-yellow-500" : "bg-red-400"
                  ) : "bg-gray-400"
                }`}
                style={{ width: `${Math.max(p.attendanceRate, 2)}%` }}
              />
            </div>
          </div>
        );

        const CategorySection = ({ label, color, players, defaultOpen }: { label: string; color: string; players: PlayerAttendance[]; defaultOpen?: boolean }) => {
          if (players.length === 0) return null;
          return (
            <details open={defaultOpen} className="text-sm">
              <summary className="flex items-center gap-2 cursor-pointer py-1">
                <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
                <span className="font-medium">{label}</span>
                <Badge variant="outline" className="text-xs ml-auto">{players.length}</Badge>
              </summary>
              <div className="pl-4 pt-1 space-y-1.5">
                {players.sort((a, b) => b.attendanceRate - a.attendanceRate).map((p) => (
                  <PlayerBar key={p.id} p={p} />
                ))}
              </div>
            </details>
          );
        };

        return (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Card className="w-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-green-700 shrink-0" />
                    <span className="font-semibold text-sm">Attendance</span>
                    {completedCount > 0 && <span className="text-xs text-muted-foreground ml-auto">{completedCount} sessions</span>}
                  </div>
                  {completedCount > 0 && (
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-green-500" /> {regulars.length} regulars</span>
                      <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-yellow-500" /> {sometimes.length} sometimes</span>
                      <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-red-400" /> {rarely.length} rarely</span>
                      {never.length > 0 && <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-gray-400" /> {never.length} never</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            </summary>
            <Card className="mt-1">
              <CardContent className="p-4">
                {completedCount === 0 ? (
                  <p className="text-sm text-muted-foreground">No completed sessions yet.</p>
                ) : (
                  <div className="space-y-3">
                    <CategorySection label="Regulars (75%+)" color="bg-green-500" players={regulars} defaultOpen />
                    <CategorySection label="Sometimes (30-74%)" color="bg-yellow-500" players={sometimes} />
                    <CategorySection label="Rarely (<30%)" color="bg-red-400" players={rarely} />
                    <CategorySection label="Never played" color="bg-gray-400" players={never} />
                    {inactivePlayers.length > 0 && (
                      <details className="text-sm">
                        <summary className="flex items-center gap-2 cursor-pointer py-1">
                          <UserX className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium text-muted-foreground">Inactive players</span>
                          <Badge variant="outline" className="text-xs ml-auto">{inactivePlayers.length}</Badge>
                        </summary>
                        <div className="pl-4 pt-1 space-y-1.5">
                          {inactivePlayers.sort((a, b) => b.attendanceRate - a.attendanceRate).map((p) => (
                            <PlayerBar key={p.id} p={p} opacity="opacity-50" />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </details>
        );
      })()}

      {/* Payment Report */}
      {(() => {
        const playersWithPayments = activePlayers.filter((p) => p.sessionsOwed > 0);
        const allPaid = playersWithPayments.filter((p) => p.paymentRate === 100);
        const mostlyPaid = playersWithPayments.filter((p) => p.paymentRate >= 50 && p.paymentRate < 100);
        const poorPayers = playersWithPayments.filter((p) => p.paymentRate > 0 && p.paymentRate < 50);
        const neverPaid = playersWithPayments.filter((p) => p.paymentRate === 0);

        const PaymentBar = ({ p }: { p: PlayerAttendance }) => (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate">{p.name}</span>
              <span className="text-muted-foreground shrink-0 ml-2">
                {p.sessionsPaid}/{p.sessionsOwed} paid ({Math.round(p.paymentRate)}%)
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  p.paymentRate === 100 ? "bg-green-500" :
                  p.paymentRate >= 50 ? "bg-yellow-500" : "bg-red-400"
                }`}
                style={{ width: `${Math.max(p.paymentRate, 2)}%` }}
              />
            </div>
          </div>
        );

        const PayCategory = ({ label, color, players, defaultOpen }: { label: string; color: string; players: PlayerAttendance[]; defaultOpen?: boolean }) => {
          if (players.length === 0) return null;
          return (
            <details open={defaultOpen} className="text-sm">
              <summary className="flex items-center gap-2 cursor-pointer py-1">
                <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
                <span className="font-medium">{label}</span>
                <Badge variant="outline" className="text-xs ml-auto">{players.length}</Badge>
              </summary>
              <div className="pl-4 pt-1 space-y-1.5">
                {players.sort((a, b) => a.paymentRate - b.paymentRate).map((p) => (
                  <PaymentBar key={p.id} p={p} />
                ))}
              </div>
            </details>
          );
        };

        return (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Card className="w-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-700 shrink-0" />
                    <span className="font-semibold text-sm">Payments</span>
                    {totalOutstanding > 0 && <span className="text-xs text-red-600 ml-auto">${totalOutstanding.toFixed(0)} outstanding</span>}
                  </div>
                  {playersWithPayments.length > 0 && (
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-green-500" /> {allPaid.length} fully paid</span>
                      <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-yellow-500" /> {mostlyPaid.length} mostly</span>
                      {(poorPayers.length + neverPaid.length) > 0 && (
                        <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-red-400" /> {poorPayers.length + neverPaid.length} behind</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </summary>
            <Card className="mt-1">
              <CardContent className="p-4">
                {playersWithPayments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payment data yet.</p>
                ) : (
                  <div className="space-y-3">
                    <PayCategory label="Never paid" color="bg-red-500" players={neverPaid} defaultOpen />
                    <PayCategory label="Poor payers (<50%)" color="bg-red-400" players={poorPayers} defaultOpen />
                    <PayCategory label="Mostly paid (50-99%)" color="bg-yellow-500" players={mostlyPaid} />
                    <PayCategory label="Fully paid (100%)" color="bg-green-500" players={allPaid} />
                  </div>
                )}
              </CardContent>
            </Card>
          </details>
        );
      })()}

      {/* Session Trends */}
      {sessionTrends.length > 0 && (() => {
        const avgTurnout = sessionTrends.length > 0
          ? Math.round(sessionTrends.reduce((s, t) => s + t.confirmed, 0) / sessionTrends.length)
          : 0;
        const fullSessions = sessionTrends.filter((t) => t.confirmed >= t.max).length;
        return (
        <details className="group">
          <summary className="cursor-pointer list-none">
            <Card className="w-full">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-700 shrink-0" />
                  <span className="font-semibold text-sm">Session Trends</span>
                  <span className="text-xs text-muted-foreground ml-auto">Last {sessionTrends.length}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Avg {avgTurnout} players · {fullSessions}/{sessionTrends.length} sessions full
                </p>
              </CardContent>
            </Card>
          </summary>
          <Card className="mt-1">
            <CardContent className="p-4">
              <div className="space-y-2">
                {sessionTrends.map((t, idx) => (
                  <div key={idx} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span>{t.date}</span>
                      <span className="text-muted-foreground">
                        {t.confirmed}/{t.max} players
                        {t.waitlisted > 0 && ` (+${t.waitlisted} waitlist)`}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          t.confirmed >= t.max ? "bg-green-500" :
                          t.confirmed >= t.max * 0.7 ? "bg-yellow-500" : "bg-red-400"
                        }`}
                        style={{ width: `${(t.confirmed / t.max) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </details>
        );
      })()}

      {/* Recent Sessions */}
      <details className="group">
        <summary className="cursor-pointer list-none">
          <Card className="w-full">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-700 shrink-0" />
                <span className="font-semibold text-sm">Recent Sessions</span>
                <span className="text-xs text-muted-foreground ml-auto">{sessions.length} total</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {sessions.filter((s) => s.status === "upcoming").length} upcoming · {sessions.filter((s) => s.status === "completed").length} completed
                {sessions.filter((s) => s.status === "cancelled").length > 0 && ` · ${sessions.filter((s) => s.status === "cancelled").length} cancelled`}
              </p>
            </CardContent>
          </Card>
        </summary>
        <Card className="mt-1">
          <CardContent className="p-4">
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No sessions yet.</p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 10).map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center justify-between border-b py-2 last:border-0 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2 ${
                      ["completed", "cancelled"].includes(session.status) ? "opacity-50" : ""
                    }`}
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
      </details>

      {/* Data Quality */}
      {dataQuality.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none">
            <Card className="w-full">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                  <span className="font-semibold text-sm">Data Quality</span>
                  <Badge variant="outline" className="text-xs ml-auto">{dataQuality.reduce((s, i) => s + i.count, 0)} issues</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {dataQuality.filter((i) => i.type === "warning").length} warnings, {dataQuality.filter((i) => i.type === "info").length} info — tap to review
                </p>
              </CardContent>
            </Card>
          </summary>
          <Card className="mt-1">
            <CardContent className="p-4">
              <div className="space-y-2">
                {dataQuality.map((issue, idx) => (
                  <details key={idx} className="text-sm">
                    <summary className="flex items-center gap-2 cursor-pointer py-1">
                      {issue.type === "warning" ? (
                        <AlertTriangle className="h-3 w-3 text-yellow-600 shrink-0" />
                      ) : (
                        <CheckCircle className="h-3 w-3 text-blue-500 shrink-0" />
                      )}
                      <span>{issue.label}</span>
                      <Badge variant="outline" className="text-xs ml-auto">{issue.count}</Badge>
                    </summary>
                    <div className="pl-5 pt-1 text-xs text-muted-foreground">
                      {issue.details.slice(0, 10).join(", ")}
                      {issue.details.length > 10 && ` ...and ${issue.details.length - 10} more`}
                    </div>
                  </details>
                ))}
              </div>
            </CardContent>
          </Card>
        </details>
      )}

      {/* Export */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Export Data</p>
            <p className="text-xs text-muted-foreground">Download attendance & payment history as Excel</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={isExporting}>
            <Download className="mr-1 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export Excel"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
