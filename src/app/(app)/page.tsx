"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, Clock, Users, ChevronRight } from "lucide-react";
import type { Session, Rsvp } from "@/lib/types/database";

interface SessionWithRsvp extends Session {
  my_rsvp?: Rsvp | null;
  confirmed_count: number;
}

export default function HomePage() {
  const { player, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [nextSession, setNextSession] = useState<SessionWithRsvp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    fetchNextSession();

    const channel = supabase
      .channel("home-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, fetchNextSession)
      .on("postgres_changes", { event: "*", schema: "public", table: "rsvps" }, fetchNextSession)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, authLoading]);

  async function fetchNextSession() {
    if (!player) {
      setIsLoading(false);
      return;
    }

    const { data: sessions } = await supabase
      .from("sessions")
      .select("*")
      .in("status", ["upcoming", "signups_closed", "teams_published"])
      .gte("date", new Date().toISOString().split("T")[0])
      .order("date", { ascending: true })
      .limit(1);

    if (sessions && sessions.length > 0) {
      const session = sessions[0] as Session;

      const { data: myRsvp } = await supabase
        .from("rsvps")
        .select("*")
        .eq("session_id", session.id)
        .eq("player_id", player.id)
        .single();

      const { count } = await supabase
        .from("rsvps")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session.id)
        .eq("status", "confirmed")
        .eq("is_waitlist", false);

      setNextSession({
        ...session,
        my_rsvp: myRsvp as Rsvp | null,
        confirmed_count: count || 0,
      });
    } else {
      setNextSession(null);
    }
    setIsLoading(false);
  }

  async function handleRsvp(status: "confirmed" | "absent" | "maybe") {
    if (!player || !nextSession) return;
    setRsvpLoading(true);

    if (nextSession.my_rsvp) {
      await supabase
        .from("rsvps")
        .update({ status, rsvp_at: new Date().toISOString() })
        .eq("id", nextSession.my_rsvp.id);
    } else {
      // Waitlist if session is full and player is confirming
      const isFull = status === "confirmed" && nextSession.confirmed_count >= maxPlayers;
      let waitlistPosition = null;
      if (isFull) {
        const { count } = await supabase
          .from("rsvps")
          .select("*", { count: "exact", head: true })
          .eq("session_id", nextSession.id)
          .eq("is_waitlist", true);
        waitlistPosition = (count || 0) + 1;
      }

      await supabase.from("rsvps").insert({
        session_id: nextSession.id,
        player_id: player.id,
        status,
        rsvp_at: new Date().toISOString(),
        is_waitlist: isFull,
        waitlist_position: waitlistPosition,
        promoted_at: null,
      });
    }

    await fetchNextSession();
    setRsvpLoading(false);
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const statusColor: Record<string, string> = {
    upcoming: "bg-blue-100 text-blue-800",
    signups_closed: "bg-yellow-100 text-yellow-800",
    teams_published: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    cancelled: "bg-red-100 text-red-800",
  };

  const rsvpStatusLabel: Record<string, string> = {
    confirmed: "I'm In",
    absent: "Can't Make It",
    maybe: "Maybe",
  };

  const maxPlayers = nextSession?.format === "3t" ? 15 : 10;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">
          Welcome, {player?.name?.split(" ")[0] || "Player"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {player?.player_type === "regular" ? "Regular Player" : "Casual Player"}
        </p>
      </div>

      {nextSession ? (
        <Card className="border-green-200">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <CardTitle className="text-lg">Next Session</CardTitle>
              <Badge className={statusColor[nextSession.status]}>
                {nextSession.status.replace(/_/g, " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {formatDate(nextSession.date)}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {nextSession.start_time} – {nextSession.end_time}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {nextSession.venue}
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                {nextSession.confirmed_count} / {maxPlayers} players confirmed
                {nextSession.format === "3t" ? " (3 teams)" : " (2 teams)"}
              </div>
            </div>

            {/* Current RSVP status */}
            {nextSession.my_rsvp && (
              <div className="rounded-md bg-muted p-2 text-sm">
                Your status: <span className="font-semibold">{rsvpStatusLabel[nextSession.my_rsvp.status]}</span>
                {nextSession.my_rsvp.is_waitlist && (
                  <span className="text-muted-foreground">
                    {" "}(Waitlist #{nextSession.my_rsvp.waitlist_position})
                  </span>
                )}
              </div>
            )}

            {/* RSVP Buttons */}
            {nextSession.status === "upcoming" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleRsvp("confirmed")}
                  disabled={rsvpLoading || nextSession.my_rsvp?.status === "confirmed"}
                  className="flex-1 bg-green-700 hover:bg-green-800"
                >
                  I&apos;m In
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRsvp("maybe")}
                  disabled={rsvpLoading || nextSession.my_rsvp?.status === "maybe"}
                  className="flex-1"
                >
                  Maybe
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRsvp("absent")}
                  disabled={rsvpLoading || nextSession.my_rsvp?.status === "absent"}
                  className="flex-1"
                >
                  Can&apos;t Make It
                </Button>
              </div>
            )}

            <Button
              variant="ghost"
              className="w-full justify-between"
              onClick={() => router.push(`/sessions/${nextSession.id}`)}
            >
              View Session Details
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No upcoming sessions scheduled.
          </CardContent>
        </Card>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Card
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => router.push("/sessions")}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <Calendar className="h-8 w-8 text-green-700" />
            <div>
              <p className="font-medium text-sm">Sessions</p>
              <p className="text-xs text-muted-foreground">View all sessions</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => router.push("/profile")}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="h-8 w-8 text-green-700" />
            <div>
              <p className="font-medium text-sm">Profile</p>
              <p className="text-xs text-muted-foreground">History & stats</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
