"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Calendar, Clock, MapPin, Users, DollarSign, Star, LogOut, UserPlus } from "lucide-react";
import type { Session, Rsvp, Player, Team, Payment } from "@/lib/types/database";

interface TeamWithPlayers extends Team {
  players: (Player & { team_player_id: string })[];
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { player, isAdmin, isLoading: authLoading } = useAuth();
  const supabase = createClient();

  const [session, setSession] = useState<Session | null>(null);
  const [rsvps, setRsvps] = useState<(Rsvp & { player: Player })[]>([]);
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [myPayment, setMyPayment] = useState<Payment | null>(null);
  const [paymentSummary, setPaymentSummary] = useState({ paid: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [showAddWaitlist, setShowAddWaitlist] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ name: "", mobile: "", email: "" });
  const [addingToWaitlist, setAddingToWaitlist] = useState(false);

  async function handleWithdraw() {
    if (!player || !session) return;
    setWithdrawing(true);
    const myRsvp = rsvps.find((r) => r.player_id === player.id);
    if (myRsvp) {
      await supabase.from("rsvps").delete().eq("id", myRsvp.id);
      toast.success("You have been removed from this session");
      await fetchAll();
    }
    setWithdrawing(false);
  }

  async function handleAddToWaitlist() {
    if (!session || !waitlistForm.name || !waitlistForm.mobile) return;
    setAddingToWaitlist(true);

    const formatMobile = (input: string) => {
      const digits = input.replace(/\D/g, "");
      if (digits.startsWith("61")) return `+${digits}`;
      if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
      return `+61${digits}`;
    };

    const formattedMobile = formatMobile(waitlistForm.mobile);

    // Check if player already exists by mobile
    const { data: existingPlayer } = await supabase
      .from("players")
      .select("id")
      .eq("mobile", formattedMobile)
      .single();

    let playerId: string;

    if (existingPlayer) {
      playerId = existingPlayer.id;
    } else {
      // Create new non-core player
      const { data: newPlayer, error } = await supabase.from("players").insert({
        name: waitlistForm.name,
        mobile: formattedMobile,
        email: waitlistForm.email || null,
        player_type: "casual",
        skill_rating: 3,
        is_admin: false,
        is_active: true,
        auth_user_id: null,
      }).select().single();

      if (error || !newPlayer) {
        toast.error("Failed to create player");
        setAddingToWaitlist(false);
        return;
      }
      playerId = newPlayer.id;
    }

    // Check if already in session
    const alreadyIn = rsvps.some((r) => r.player_id === playerId);
    if (alreadyIn) {
      toast.info("This player is already in the session");
      setAddingToWaitlist(false);
      return;
    }

    // Get next waitlist position
    const currentWaitlist = rsvps.filter((r) => r.is_waitlist);
    const waitlistPosition = currentWaitlist.length + 1;

    await supabase.from("rsvps").insert({
      session_id: session.id,
      player_id: playerId,
      status: "confirmed",
      rsvp_at: new Date().toISOString(),
      is_waitlist: true,
      waitlist_position: waitlistPosition,
      promoted_at: null,
    });

    toast.success(`${waitlistForm.name} added to waitlist`);
    setWaitlistForm({ name: "", mobile: "", email: "" });
    setShowAddWaitlist(false);
    setAddingToWaitlist(false);
    await fetchAll();
  }

  useEffect(() => {
    if (authLoading || !player) return;
    if (id) fetchAll();

    const channel = supabase
      .channel(`session-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rsvps", filter: `session_id=eq.${id}` }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: `session_id=eq.${id}` }, fetchAll)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, player, authLoading]);

  async function fetchAll() {
    if (!player) {
      setIsLoading(false);
      return;
    }

    const [sessionRes, rsvpRes, teamsRes, paymentRes, paymentSummaryRes] = await Promise.all([
      supabase.from("sessions").select("*").eq("id", id).single(),
      supabase.from("rsvps").select("*, player:players(*)").eq("session_id", id).order("rsvp_at"),
      supabase.from("teams").select("*").eq("session_id", id).order("team_name"),
      supabase.from("payments").select("*").eq("session_id", id).eq("player_id", player.id).single(),
      supabase.from("payments").select("payment_status").eq("session_id", id as string),
    ]);

    setSession(sessionRes.data as Session);

    const typedRsvps = (rsvpRes.data || []).map((r: Record<string, unknown>) => ({
      ...r,
      player: r.player as unknown as Player,
    })) as (Rsvp & { player: Player })[];
    setRsvps(typedRsvps);

    // Fetch team players
    if (teamsRes.data && teamsRes.data.length > 0) {
      const teamIds = teamsRes.data.map((t) => t.id);
      const { data: teamPlayers } = await supabase
        .from("team_players")
        .select("*, player:players(*)")
        .in("team_id", teamIds);

      const teamsWithPlayers: TeamWithPlayers[] = (teamsRes.data as Team[]).map((team) => ({
        ...team,
        players: (teamPlayers || [])
          .filter((tp: Record<string, unknown>) => tp.team_id === team.id)
          .map((tp: Record<string, unknown>) => ({
            ...(tp.player as unknown as Player),
            team_player_id: tp.id as string,
          }))
          .sort((a, b) => b.skill_rating - a.skill_rating),
      }));
      setTeams(teamsWithPlayers);
    } else {
      setTeams([]);
    }

    setMyPayment(paymentRes.data as Payment | null);

    if (paymentSummaryRes.data) {
      const paid = paymentSummaryRes.data.filter((p: { payment_status: string }) => p.payment_status === "paid").length;
      setPaymentSummary({ paid, total: paymentSummaryRes.data.length });
    }

    setIsLoading(false);
  }

  if (isLoading || !session) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" />
      </div>
    );
  }

  const confirmed = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist);
  const waitlist = rsvps.filter((r) => r.is_waitlist).sort((a, b) => (a.waitlist_position || 99) - (b.waitlist_position || 99));
  const maxPlayers = session.format === "3t" ? 15 : 10;
  const costPerPlayer = session.court_cost * (1 + session.buffer_pct / 100) / maxPlayers;

  const bibColors: Record<string, string> = {
    White: "bg-white text-black border",
    Black: "bg-gray-900 text-white",
    Red: "bg-red-600 text-white",
    Blue: "bg-blue-600 text-white",
    Yellow: "bg-yellow-400 text-black",
    Green: "bg-green-600 text-white",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <h2 className="text-xl font-bold">Session Details</h2>
        <Badge className={
          session.status === "upcoming" ? "bg-blue-100 text-blue-800" :
          session.status === "cancelled" ? "bg-red-100 text-red-800" :
          "bg-green-100 text-green-800"
        }>
          {session.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Session Info */}
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {new Date(session.date).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {session.start_time} – {session.end_time}
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {session.venue}
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            {confirmed.length} / {maxPlayers} confirmed
            ({session.format === "3t" ? "3 teams" : "2 teams"})
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            ${costPerPlayer.toFixed(2)} per player
          </div>
        </CardContent>
      </Card>

      {/* Withdraw from session */}
      {session.status === "upcoming" && player && rsvps.some((r) => r.player_id === player.id) && (
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={handleWithdraw}
          disabled={withdrawing}
        >
          <LogOut className="mr-1 h-4 w-4" />
          {withdrawing ? "Withdrawing..." : "Withdraw from Session"}
        </Button>
      )}

      {/* Teams — shown when teams exist */}
      {teams.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold">Teams</h3>
          {teams.map((team) => (
            <Card key={team.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Team {team.team_name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className={`h-6 w-6 rounded-full ${bibColors[team.bib_color] || "bg-gray-300"}`} />
                    {team.avg_skill_rating && (
                      <span className="text-xs text-muted-foreground">
                        Avg: {Number(team.avg_skill_rating).toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {team.players.map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between py-1 text-sm border-b last:border-0">
                    <span>
                      <span className="text-muted-foreground w-6 inline-block">#{idx + 1}</span>
                      {" "}{p.name}
                    </span>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        {Array.from({ length: p.skill_rating || 0 }).map((_, i) => (
                          <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Player type legend */}
      {teams.length === 0 && (
        <div className="flex gap-3 text-xs">
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-purple-100 border" /> Admin</div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-blue-100 border" /> Regular</div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-orange-100 border" /> Casual</div>
        </div>
      )}

      {/* Confirmed Players — shown when no teams yet */}
      {teams.length === 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Confirmed Players ({confirmed.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {confirmed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No players confirmed yet.</p>
            ) : (
              <div className="space-y-1">
                {confirmed.map((r, idx) => {
                  const rowBg = r.player?.is_admin
                    ? "bg-purple-100"
                    : r.player?.player_type === "regular"
                    ? "bg-blue-100"
                    : "bg-orange-100";
                  return (
                  <div key={r.id} className={`flex items-center justify-between py-1 px-2 -mx-2 rounded text-sm ${rowBg}`}>
                    <span>
                      <span className="text-muted-foreground w-6 inline-block">#{idx + 1}</span>
                      {" "}{r.player?.name}
                    </span>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        {Array.from({ length: r.player?.skill_rating || 0 }).map((_, i) => (
                          <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        ))}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Waitlist */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Waiting List ({waitlist.length})</CardTitle>
            {session.status === "upcoming" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddWaitlist(!showAddWaitlist)}>
                <UserPlus className="mr-1 h-3 w-3" /> Add
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {waitlist.length > 0 && (
            <div className="space-y-1 mb-3">
              {waitlist.map((r, i) => {
                const rowBg = r.player?.is_admin
                  ? "bg-purple-100"
                  : r.player?.player_type === "regular"
                  ? "bg-blue-100"
                  : "bg-orange-100";
                return (
                <div key={r.id} className={`flex items-center justify-between py-1 px-2 -mx-2 rounded text-sm ${rowBg}`}>
                  <span>#{i + 1} {r.player?.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {r.status === "confirmed" ? "Ready" : r.status}
                  </Badge>
                </div>
                );
              })}
            </div>
          )}
          {waitlist.length === 0 && !showAddWaitlist && (
            <p className="text-sm text-muted-foreground">No one on the waitlist.</p>
          )}
          {showAddWaitlist && (
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1">
                <Label className="text-xs">Name *</Label>
                <Input
                  placeholder="Player name"
                  value={waitlistForm.name}
                  onChange={(e) => setWaitlistForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mobile *</Label>
                <Input
                  type="tel"
                  placeholder="04XX XXX XXX"
                  value={waitlistForm.mobile}
                  onChange={(e) => setWaitlistForm((f) => ({ ...f, mobile: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email (optional)</Label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={waitlistForm.email}
                  onChange={(e) => setWaitlistForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowAddWaitlist(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1 bg-green-700 hover:bg-green-800"
                  onClick={handleAddToWaitlist}
                  disabled={addingToWaitlist || !waitlistForm.name || !waitlistForm.mobile}
                >
                  {addingToWaitlist ? "Adding..." : "Add to Waitlist"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Payment Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 text-sm">
          {isAdmin ? (
            <div className="space-y-1">
              <p>Court Cost: <span className="font-semibold">${session.court_cost.toFixed(2)}</span></p>
              <p>Total (with {session.buffer_pct}% buffer): <span className="font-semibold">${(session.court_cost * (1 + session.buffer_pct / 100)).toFixed(2)}</span></p>
              <p>Per Player: <span className="font-semibold">${costPerPlayer.toFixed(2)}</span></p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => window.location.href = `/admin/sessions/${session.id}`}
              >
                Manage Payments
              </Button>
            </div>
          ) : player?.player_type === "regular" ? (
            <p>
              {paymentSummary.paid} of {paymentSummary.total} players have paid
              {paymentSummary.total - paymentSummary.paid > 0 &&
                `, ${paymentSummary.total - paymentSummary.paid} outstanding`}
            </p>
          ) : myPayment ? (
            <div className="space-y-1">
              <p>Amount Due: <span className="font-semibold">${myPayment.amount_due.toFixed(2)}</span></p>
              <p>Amount Paid: <span className="font-semibold">${myPayment.amount_paid.toFixed(2)}</span></p>
              <p>Status: <Badge variant={myPayment.payment_status === "paid" ? "default" : "destructive"}>
                {myPayment.payment_status}
              </Badge></p>
            </div>
          ) : (
            <p className="text-muted-foreground">No payment info available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
