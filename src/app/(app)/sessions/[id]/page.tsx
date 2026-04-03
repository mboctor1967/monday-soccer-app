"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Calendar, Clock, MapPin, Users, DollarSign, Star, LogOut, UserPlus, CreditCard, Phone, Shield, Search } from "lucide-react";
import type { Session, Rsvp, Player, Team, Payment } from "@/lib/types/database";

interface TeamWithPlayers extends Team {
  players: (Player & { team_player_id: string })[];
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { player, isAdmin, isLoading: authLoading } = useAuth();
  const supabase = createClient();

  const [session, setSession] = useState<Session | null>(null);
  const [rsvps, setRsvps] = useState<(Rsvp & { player: Player })[]>([]);
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [allPayments, setAllPayments] = useState<(Payment & { player?: { name: string } })[]>([]);
  const [paymentSummary, setPaymentSummary] = useState({ paid: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showAddWaitlist, setShowAddWaitlist] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ name: "", mobile: "", email: "" });
  const [addingToWaitlist, setAddingToWaitlist] = useState(false);
  const [playerWaitlistSearch, setPlayerWaitlistSearch] = useState("");
  const [playerWaitlistHighlight, setPlayerWaitlistHighlight] = useState(-1);
  const [showNewPlayerForm, setShowNewPlayerForm] = useState(false);
  const [allActivePlayers, setAllActivePlayers] = useState<Player[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [showPayIdDialog, setShowPayIdDialog] = useState(false);
  const [payIdRef, setPayIdRef] = useState<string[]>([]);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());

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

  async function handleRsvp(status: "confirmed" | "absent" | "maybe") {
    if (!player || !session) return;
    setRsvpLoading(true);

    const myRsvp = rsvps.find((r) => r.player_id === player.id);

    if (myRsvp) {
      await supabase
        .from("rsvps")
        .update({ status, rsvp_at: new Date().toISOString() })
        .eq("id", myRsvp.id);
    } else {
      const sessionMaxPlayers = session.format === "3t" ? 15 : 10;
      const confirmedCount = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist).length;
      const isFull = status === "confirmed" && confirmedCount >= sessionMaxPlayers;
      let waitlistPosition = null;
      if (isFull) {
        const { count } = await supabase
          .from("rsvps")
          .select("*", { count: "exact", head: true })
          .eq("session_id", session.id)
          .eq("is_waitlist", true);
        waitlistPosition = (count || 0) + 1;
      }

      await supabase.from("rsvps").insert({
        session_id: session.id,
        player_id: player.id,
        status,
        rsvp_at: new Date().toISOString(),
        is_waitlist: isFull,
        waitlist_position: waitlistPosition,
        promoted_at: null,
      });
    }

    const label = status === "confirmed" ? "I'm In" : status === "maybe" ? "Maybe" : "Can't Make It";
    toast.success(`RSVP updated: ${label}`);
    await fetchAll();
    setRsvpLoading(false);
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

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    const checkoutSessionId = searchParams.get("checkout_session_id");
    if (paymentStatus === "success" && checkoutSessionId) {
      // Verify and mark payments as paid via Stripe confirmation
      fetch("/api/payments/verify-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: checkoutSessionId }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "paid") {
            toast.success(`Payment successful! ${data.count} payment(s) confirmed.`);
          } else if (data.status === "already_paid") {
            toast.success("Payment already confirmed.");
          } else {
            toast.success("Payment successful! Thank you.");
          }
          fetchAll();
        })
        .catch(() => {
          toast.success("Payment successful! Thank you.");
        });
    } else if (paymentStatus === "success") {
      toast.success("Payment successful! Thank you.");
    } else if (paymentStatus === "cancelled") {
      toast.info("Payment was cancelled.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function togglePaymentSelection(paymentId: string) {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId); else next.add(paymentId);
      return next;
    });
  }

  const selectedPayments = allPayments.filter((p) => selectedPaymentIds.has(p.id));
  const selectedTotal = selectedPayments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0);
  const selectedTotalWithFee = selectedTotal * 1.035;

  async function handleStripeCheckout() {
    if (selectedPaymentIds.size === 0) return;
    setPaymentProcessing(true);
    try {
      const res = await fetch("/api/payments/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_ids: Array.from(selectedPaymentIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
      setPaymentProcessing(false);
    }
  }

  async function handlePayIdConfirm() {
    if (selectedPaymentIds.size === 0) return;
    setPaymentProcessing(true);
    try {
      const res = await fetch("/api/payments/payid-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_ids: Array.from(selectedPaymentIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPayIdRef(data.references || []);
      toast.success("Payment marked as sent — awaiting admin confirmation");
      setShowPayIdDialog(false);
      setSelectedPaymentIds(new Set());
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
    setPaymentProcessing(false);
  }

  async function handleMarkPaidCash() {
    if (selectedPaymentIds.size === 0) return;
    setPaymentProcessing(true);
    for (const payId of Array.from(selectedPaymentIds)) {
      await supabase.from("payments").update({
        payment_status: "paid",
        amount_paid: allPayments.find((p) => p.id === payId)?.amount_due || 0,
        payment_method: "cash",
        pending_confirmation: false,
      }).eq("id", payId);
    }
    toast.success(`${selectedPaymentIds.size} payment(s) marked as paid`);
    setSelectedPaymentIds(new Set());
    setPaymentProcessing(false);
    await fetchAll();
  }

  async function fetchAll() {
    if (!player) {
      setIsLoading(false);
      return;
    }

    const [sessionRes, rsvpRes, teamsRes, , paymentSummaryRes] = await Promise.all([
      supabase.from("sessions").select("*").eq("id", id).single(),
      supabase.from("rsvps").select("*, player:players(*)").eq("session_id", id).order("rsvp_at"),
      supabase.from("teams").select("*").eq("session_id", id).order("team_name"),
      supabase.from("payments").select("*").eq("session_id", id).eq("player_id", player.id).maybeSingle(),
      supabase.from("payments").select("*, player:players(name)").eq("session_id", id as string),
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

    // Fetch all active players for search
    const { data: activePlayers } = await supabase.from("players").select("*").eq("is_active", true).order("name");
    setAllActivePlayers((activePlayers || []) as Player[]);

    if (paymentSummaryRes.data) {
      const paymentsWithPlayer = paymentSummaryRes.data.map((p: Record<string, unknown>) => ({
        ...p,
        player: p.player as { name: string } | undefined,
      })) as (Payment & { player?: { name: string } })[];
      setAllPayments(paymentsWithPlayer);
      const paid = paymentsWithPlayer.filter((p) => p.payment_status === "paid").length;
      setPaymentSummary({ paid, total: paymentsWithPlayer.length });

      // Auto-select own unpaid payment
      const ownPayment = paymentsWithPlayer.find((p) => p.player_id === player.id);
      if (ownPayment && ownPayment.payment_status !== "paid" && !ownPayment.pending_confirmation) {
        setSelectedPaymentIds((prev) => {
          if (prev.size === 0) return new Set([ownPayment.id]);
          return prev;
        });
      }
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
        <div className="flex items-center gap-2">
          <Badge className={
            session.status === "upcoming" ? "bg-blue-100 text-blue-800" :
            session.status === "cancelled" ? "bg-red-100 text-red-800" :
            "bg-green-100 text-green-800"
          }>
            {session.status.replace(/_/g, " ")}
          </Badge>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => window.location.href = `/admin/sessions/${session.id}`}
            >
              <Shield className="mr-1 h-3 w-3" /> Admin
            </Button>
          )}
        </div>
      </div>

      {/* Session Recap — completed sessions */}
      {session.status === "completed" && paymentSummary.total > 0 && (() => {
        const recapCollected = allPayments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);
        const recapDue = allPayments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0);
        const recapPct = paymentSummary.total > 0 ? (paymentSummary.paid / paymentSummary.total) * 100 : 0;
        const recapBar = recapPct === 100 ? "bg-green-500" : recapPct >= 50 ? "bg-yellow-500" : "bg-red-500";
        return (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-sm">
                Session Recap — {new Date(session.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{confirmed.length} players attended</span>
                <span>{paymentSummary.paid}/{paymentSummary.total} paid</span>
                <span>${recapCollected.toFixed(0)}/${recapDue.toFixed(0)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                <div className={`h-full rounded-full ${recapBar}`} style={{ width: `${recapPct}%` }} />
              </div>
              {recapDue - recapCollected > 0 && (
                <p className="text-xs text-red-600">${(recapDue - recapCollected).toFixed(0)} outstanding</p>
              )}
            </CardContent>
          </Card>
        );
      })()}

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

      {/* RSVP Status & Buttons */}
      {session.status === "upcoming" && player && (() => {
        const myRsvp = rsvps.find((r) => r.player_id === player.id);
        const rsvpStatusLabel: Record<string, string> = {
          confirmed: "I'm In",
          absent: "Can't Make It",
          maybe: "Maybe",
        };
        return (
          <div className="space-y-3">
            {myRsvp && (
              <div className={`rounded-md p-3 text-sm font-medium ${
                myRsvp.status === "confirmed" ? "bg-green-100 text-green-800" :
                myRsvp.status === "maybe" ? "bg-yellow-100 text-yellow-800" :
                "bg-red-100 text-red-800"
              }`}>
                Your RSVP: <span className="font-semibold">{rsvpStatusLabel[myRsvp.status]}</span>
                {myRsvp.is_waitlist && (
                  <span className="ml-1">(Waitlist #{myRsvp.waitlist_position})</span>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleRsvp("confirmed")}
                disabled={rsvpLoading || myRsvp?.status === "confirmed"}
                className="flex-1 bg-green-700 hover:bg-green-800"
              >
                I&apos;m In
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRsvp("maybe")}
                disabled={rsvpLoading || myRsvp?.status === "maybe"}
                className="flex-1"
              >
                Maybe
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRsvp("absent")}
                disabled={rsvpLoading || myRsvp?.status === "absent"}
                className="flex-1"
              >
                Can&apos;t Make It
              </Button>
            </div>
          </div>
        );
      })()}

      {/* Withdraw from session */}
      {session.status === "upcoming" && player && rsvps.some((r) => r.player_id === player.id) && (
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => setShowWithdrawConfirm(true)}
          disabled={withdrawing}
        >
          <LogOut className="mr-1 h-4 w-4" />
          {withdrawing ? "Withdrawing..." : "Withdraw from Session"}
        </Button>
      )}

      {/* Withdraw Confirmation */}
      <Dialog open={showWithdrawConfirm} onOpenChange={setShowWithdrawConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw from Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to withdraw from this session?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowWithdrawConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              setShowWithdrawConfirm(false);
              handleWithdraw();
            }} disabled={withdrawing}>
              {withdrawing ? "Withdrawing..." : "Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Teams — shown when teams exist */}
      {teams.length > 0 && (
        <div className="space-y-3">
          {(() => { let playerNum = 0; return teams.map((team) => {
            const teamPayments = allPayments.filter((pay) => team.players.some((p) => p.id === pay.player_id));
            const teamPaid = teamPayments.filter((p) => p.payment_status === "paid").length;
            const teamCollected = teamPayments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);
            const teamDue = teamPayments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0);
            const teamPct = teamPayments.length > 0 ? (teamPaid / teamPayments.length) * 100 : 0;
            const teamBarColor = teamPct === 100 ? "bg-green-500" : teamPct >= 50 ? "bg-yellow-500" : "bg-red-500";
            const teamStartNum = playerNum;
            playerNum += team.players.length;

            return (
              <Card key={team.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-5 w-5 rounded-full ${bibColors[team.bib_color] || "bg-gray-300"}`} />
                    <CardTitle className="text-sm">Team {team.team_name}</CardTitle>
                    {isAdmin && team.avg_skill_rating && (
                      <span className="text-xs text-muted-foreground">Avg: {Number(team.avg_skill_rating).toFixed(1)}</span>
                    )}
                  </div>
                  {teamPayments.length > 0 && (
                    <div className="pt-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{teamPaid}/{teamPayments.length} paid</span>
                        <span>${teamCollected.toFixed(0)}/${teamDue.toFixed(0)}{teamDue - teamCollected > 0 ? ` · $${(teamDue - teamCollected).toFixed(0)} left` : ""}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden mt-1">
                        <div className={`h-full rounded-full transition-all ${teamBarColor}`} style={{ width: `${teamPct}%` }} />
                      </div>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {team.players.map((p, idx) => {
                    const teamPayment = allPayments.find((pay) => pay.player_id === p.id);
                    const rowBg = p.is_admin
                      ? "bg-purple-100"
                      : p.player_type === "regular"
                      ? "bg-blue-100"
                      : "bg-orange-100";
                    const isUnpaid = session.status !== "completed" && teamPayment && teamPayment.payment_status !== "paid" && !teamPayment.pending_confirmation;
                    const isSelected = teamPayment ? selectedPaymentIds.has(teamPayment.id) : false;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between py-1 px-2 -mx-2 rounded text-sm ${rowBg} ${isUnpaid ? "cursor-pointer" : ""} ${isSelected ? "ring-1 ring-green-500" : ""}`}
                        onClick={() => { if (isUnpaid && teamPayment) togglePaymentSelection(teamPayment.id); }}
                      >
                        <div className="flex items-center gap-2">
                          {teamPayment && (
                            isUnpaid ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePaymentSelection(teamPayment.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded h-3.5 w-3.5"
                              />
                            ) : (
                              <div className="w-3.5" />
                            )
                          )}
                          <span className="text-muted-foreground w-5">#{teamStartNum + idx + 1}</span>
                          <span className={p.id === player?.id ? "font-semibold" : ""}>{p.name}</span>
                          {p.id === session.court_payer_id && <Badge variant="outline" className="text-[10px] px-1">Court</Badge>}
                        </div>
                        <div className="flex items-center gap-1">
                          {isAdmin && Array.from({ length: p.skill_rating || 0 }).map((_, i) => (
                            <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          ))}
                          {teamPayment && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              teamPayment.payment_status === "paid"
                                ? "bg-green-100 text-green-800"
                                : teamPayment.pending_confirmation
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {teamPayment.pending_confirmation ? "Pending" : teamPayment.payment_status === "paid" ? "Paid" : "Unpaid"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          }); })()}

          {/* Payment action bar — shown when players are selected */}
          {selectedPaymentIds.size > 0 && (
            <Card className="border-2 border-green-600">
              <CardContent className="p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{selectedPaymentIds.size} player{selectedPaymentIds.size !== 1 ? "s" : ""} selected</span>
                  <span className="font-semibold">${selectedTotal.toFixed(2)}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                    onClick={handleStripeCheckout}
                    disabled={paymentProcessing}
                  >
                    <CreditCard className="mr-1 h-3 w-3" />
                    {paymentProcessing ? "..." : `Card $${selectedTotalWithFee.toFixed(2)}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowPayIdDialog(true)}
                    disabled={paymentProcessing}
                  >
                    <Phone className="mr-1 h-3 w-3" />
                    PayID
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={handleMarkPaidCash}
                      disabled={paymentProcessing}
                    >
                      {paymentProcessing ? "..." : "Cash"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
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
                  const confPayment = allPayments.find((pay) => pay.player_id === r.player_id);
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
                    <div className="flex items-center gap-1">
                      {isAdmin && Array.from({ length: r.player?.skill_rating || 0 }).map((_, i) => (
                        <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      ))}
                      {confPayment && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          confPayment.payment_status === "paid"
                            ? "bg-green-100 text-green-800"
                            : confPayment.pending_confirmation
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-700"
                        }`}>
                          {confPayment.pending_confirmation ? "Pending" : confPayment.payment_status === "paid" ? "Paid" : "Unpaid"}
                        </span>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Player type legend */}
      {(teams.length > 0 || confirmed.length > 0) && (
        <div className="flex justify-center gap-4 text-xs">
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-purple-100 border" /> Admin</div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-blue-100 border" /> Regular</div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-orange-100 border" /> Casual</div>
        </div>
      )}

      {/* Waitlist */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Waiting List ({waitlist.length})</CardTitle>
            {(session.status === "upcoming" || (isAdmin && session.status !== "completed" && session.status !== "cancelled")) && (
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
                  <div className="flex items-center gap-1">
                    {isAdmin && confirmed.length < maxPlayers && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-2 text-green-700"
                        onClick={async () => {
                          await supabase.from("rsvps").update({ is_waitlist: false, promoted_at: new Date().toISOString() }).eq("id", r.id);
                          toast.success(`Promoted ${r.player?.name}`);
                          await fetchAll();
                        }}
                      >
                        Promote
                      </Button>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {r.status === "confirmed" ? "Ready" : r.status}
                    </Badge>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          {waitlist.length === 0 && !showAddWaitlist && (
            <p className="text-sm text-muted-foreground">No one on the waitlist.</p>
          )}
          {showAddWaitlist && (() => {
            const availableForWl = allActivePlayers.filter((p) => !rsvps.some((r) => r.player_id === p.id));
            const filteredForWl = availableForWl.filter((p) => p.name.toLowerCase().includes(playerWaitlistSearch.toLowerCase()));

            async function addExistingToWaitlist(playerId: string) {
              if (!session) return;
              await supabase.from("rsvps").insert({
                session_id: session.id,
                player_id: playerId,
                status: "confirmed",
                rsvp_at: new Date().toISOString(),
                is_waitlist: true,
                waitlist_position: waitlist.length + 1,
                promoted_at: null,
              });
              toast.success("Added to waitlist");
              setPlayerWaitlistSearch("");
              setPlayerWaitlistHighlight(-1);
              await fetchAll();
            }

            return (
              <div className="space-y-3 border-t pt-3">
                {/* Search existing players */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search existing player..."
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={playerWaitlistSearch}
                    onChange={(e) => { setPlayerWaitlistSearch(e.target.value); setPlayerWaitlistHighlight(-1); }}
                    onKeyDown={(e) => {
                      if (!playerWaitlistSearch || filteredForWl.length === 0) return;
                      if (e.key === "ArrowDown") { e.preventDefault(); setPlayerWaitlistHighlight((h) => Math.min(h + 1, filteredForWl.length - 1)); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setPlayerWaitlistHighlight((h) => Math.max(h - 1, 0)); }
                      else if (e.key === "Enter" && playerWaitlistHighlight >= 0) { e.preventDefault(); addExistingToWaitlist(filteredForWl[playerWaitlistHighlight].id); }
                    }}
                  />
                </div>
                {playerWaitlistSearch && (
                  <div className="border rounded-md max-h-[120px] overflow-y-auto">
                    {filteredForWl.map((p, idx) => (
                      <button
                        key={p.id}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between border-b last:border-0 ${idx === playerWaitlistHighlight ? "bg-green-100" : "hover:bg-muted/50"}`}
                        onClick={() => addExistingToWaitlist(p.id)}
                        onMouseEnter={() => setPlayerWaitlistHighlight(idx)}
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.player_type}</span>
                      </button>
                    ))}
                    {filteredForWl.length === 0 && (
                      <p className="text-xs text-muted-foreground py-2 text-center">No matching players</p>
                    )}
                  </div>
                )}

                {/* New player form toggle */}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => setShowNewPlayerForm(!showNewPlayerForm)}
                >
                  <UserPlus className="mr-1 h-3 w-3" /> {showNewPlayerForm ? "Cancel" : "New player not in the system"}
                </Button>

                {showNewPlayerForm && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Name *</Label>
                      <Input placeholder="Player name" value={waitlistForm.name} onChange={(e) => setWaitlistForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Mobile *</Label>
                      <Input type="tel" placeholder="04XX XXX XXX" value={waitlistForm.mobile} onChange={(e) => setWaitlistForm((f) => ({ ...f, mobile: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Email (optional)</Label>
                      <Input type="email" placeholder="email@example.com" value={waitlistForm.email} onChange={(e) => setWaitlistForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                    <Button
                      size="sm"
                      className="w-full bg-green-700 hover:bg-green-800"
                      onClick={handleAddToWaitlist}
                      disabled={addingToWaitlist || !waitlistForm.name || !waitlistForm.mobile}
                    >
                      {addingToWaitlist ? "Adding..." : "Add to Waitlist"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Cost Summary — shown when payments exist */}
      {paymentSummary.total > 0 && (
        <div className="text-xs text-muted-foreground text-center space-y-0.5">
          <p>Court ${session.court_cost.toFixed(0)} + {session.buffer_pct}% buffer = ${(session.court_cost * (1 + session.buffer_pct / 100)).toFixed(0)} · ${costPerPlayer.toFixed(2)}/player</p>
          <p>{paymentSummary.paid}/{paymentSummary.total} paid · ${allPayments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0).toFixed(0)}/${allPayments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0).toFixed(0)}</p>
        </div>
      )}

      {/* PayID Dialog */}
      <Dialog open={showPayIdDialog} onOpenChange={setShowPayIdDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay via PayID</DialogTitle>
            <DialogDescription>
              Transfer the amount using your banking app, then confirm below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-muted rounded-md p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">PayID (Phone)</span>
                <span className="font-mono font-semibold">{process.env.NEXT_PUBLIC_PAYID_PHONE || "Not configured"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">${selectedTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">For</span>
                <span className="text-right">{selectedPayments.map((p) => p.player?.name || "Unknown").join(", ")}</span>
              </div>
              {payIdRef.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reference</span>
                  <span className="font-mono font-semibold">{payIdRef.join(", ")}</span>
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>1. Open your banking app</p>
              <p>2. Pay to the PayID phone number above</p>
              <p>3. Use the exact amount shown</p>
              <p>4. Tap &quot;I&apos;ve Paid&quot; below</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPayIdDialog(false)}>Cancel</Button>
            <Button
              onClick={handlePayIdConfirm}
              disabled={paymentProcessing}
              className="bg-green-700 hover:bg-green-800"
            >
              {paymentProcessing ? "Confirming..." : "I've Paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
