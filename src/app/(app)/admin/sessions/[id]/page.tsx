"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Calendar, Clock, MapPin, Users, DollarSign, Lock, UserPlus,
  Shuffle, Send, XCircle, Star, Edit, Trash2
} from "lucide-react";
import type { Session, Rsvp, Player, Payment } from "@/lib/types/database";

export default function AdminSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [session, setSession] = useState<Session | null>(null);
  const [rsvps, setRsvps] = useState<(Rsvp & { player: Player })[]>([]);
  const [payments, setPayments] = useState<(Payment & { player?: Player })[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [showNewPlayerForm, setShowNewPlayerForm] = useState(false);
  const [newPlayerForm, setNewPlayerForm] = useState({ name: "", mobile: "", email: "" });

  useEffect(() => {
    if (!isAdmin) { router.push("/"); return; }
    if (id) fetchAll();

    const channel = supabase
      .channel(`admin-session-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rsvps", filter: `session_id=eq.${id}` }, fetchAll)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isAdmin]);

  async function fetchAll() {
    const [sessionRes, rsvpRes, paymentRes, playersRes] = await Promise.all([
      supabase.from("sessions").select("*").eq("id", id).single(),
      supabase.from("rsvps").select("*, player:players(*)").eq("session_id", id).order("rsvp_at"),
      supabase.from("payments").select("*, player:players(*)").eq("session_id", id),
      supabase.from("players").select("*").eq("is_active", true).order("name"),
    ]);

    setSession(sessionRes.data as Session);
    setRsvps((rsvpRes.data || []).map((r: Record<string, unknown>) => ({
      ...r,
      player: r.player as unknown as Player,
    })) as (Rsvp & { player: Player })[]);
    setPayments((paymentRes.data || []).map((p: Record<string, unknown>) => ({
      ...p,
      player: p.player as unknown as Player,
    })) as (Payment & { player?: Player })[]);
    setAllPlayers((playersRes.data || []) as Player[]);
    setIsLoading(false);
  }

  async function handleCloseSignups() {
    setActionLoading("close");
    await supabase
      .from("sessions")
      .update({ status: "signups_closed", closed_at: new Date().toISOString() })
      .eq("id", id);
    toast.success("Sign-ups closed");
    await fetchAll();
    setActionLoading("");
  }

  async function handleCancelSession() {
    setActionLoading("cancel");
    await supabase.from("sessions").update({ status: "cancelled" }).eq("id", id);
    toast.success("Session cancelled");
    await fetchAll();
    setActionLoading("");
  }

  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  async function handleCompleteSession() {
    setActionLoading("complete");
    await supabase.from("sessions").update({ status: "completed" }).eq("id", id);
    toast.success("Session marked complete");
    setShowCompleteDialog(false);
    await fetchAll();
    setActionLoading("");
  }

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  async function handleDeleteSession() {
    setActionLoading("delete");
    // Delete related data first (teams, team_players, rsvps, payments)
    const { data: existingTeams } = await supabase.from("teams").select("id").eq("session_id", id);
    if (existingTeams && existingTeams.length > 0) {
      const teamIds = existingTeams.map((t) => t.id);
      await supabase.from("team_players").delete().in("team_id", teamIds);
      await supabase.from("teams").delete().eq("session_id", id);
    }
    await supabase.from("payments").delete().eq("session_id", id);
    await supabase.from("rsvps").delete().eq("session_id", id);
    await supabase.from("sessions").delete().eq("id", id);
    toast.success("Session deleted");
    router.push("/admin/sessions");
  }

  async function handlePromoteWaitlist() {
    if (!session) return;
    setActionLoading("promote");

    const maxPlayers = session.format === "3t" ? 15 : 10;
    const confirmed = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist);
    const spotsAvailable = maxPlayers - confirmed.length;
    const waitlist = rsvps
      .filter((r) => r.is_waitlist && r.status === "confirmed")
      .sort((a, b) => (a.waitlist_position || 99) - (b.waitlist_position || 99));

    const toPromote = waitlist.slice(0, spotsAvailable);
    for (const r of toPromote) {
      await supabase
        .from("rsvps")
        .update({ is_waitlist: false, promoted_at: new Date().toISOString() })
        .eq("id", r.id);
    }

    toast.success(`Promoted ${toPromote.length} player(s) from waitlist`);
    await fetchAll();
    setActionLoading("");
  }

  async function handleCreatePayments() {
    if (!session) return;
    setActionLoading("payments");

    const confirmed = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist);
    const maxPlayers = session.format === "3t" ? 15 : 10;
    const costPerPlayer = session.court_cost * (1 + session.buffer_pct / 100) / maxPlayers;

    const existingPlayerIds = payments.map((p) => p.player_id);
    const newPayments = confirmed
      .filter((r) => !existingPlayerIds.includes(r.player_id))
      .map((r) => {
        const isCourtPayer = r.player_id === session.court_payer_id;
        return {
          session_id: session.id,
          player_id: r.player_id,
          amount_due: costPerPlayer,
          amount_paid: isCourtPayer ? costPerPlayer : 0,
          payment_status: (isCourtPayer ? "paid" : "unpaid") as "paid" | "unpaid",
          payment_method: null,
          notes: null,
        };
      });

    if (newPayments.length > 0) {
      await supabase.from("payments").insert(newPayments);
      toast.success(`Created ${newPayments.length} payment records`);
    } else {
      toast.info("All payment records already exist");
    }
    await fetchAll();
    setActionLoading("");
  }

  async function handlePaymentUpdate(paymentId: string, status: string) {
    const payment = payments.find((p) => p.id === paymentId);
    if (!payment) return;

    await supabase.from("payments").update({
      payment_status: status as "paid" | "unpaid",
      amount_paid: status === "paid" ? payment.amount_due : 0,
    }).eq("id", paymentId);

    await fetchAll();
  }

  async function handleSetCourtPayer(playerId: string) {
    await supabase.from("sessions").update({ court_payer_id: playerId }).eq("id", id);
    // Auto-mark court payer as paid
    const courtPayerPayment = payments.find((p) => p.player_id === playerId);
    if (courtPayerPayment && courtPayerPayment.payment_status !== "paid") {
      await supabase.from("payments").update({
        payment_status: "paid",
        amount_paid: courtPayerPayment.amount_due,
      }).eq("id", courtPayerPayment.id);
    }
    toast.success("Court payer updated");
    await fetchAll();
  }

  async function handleAddNewPlayerToWaitlist() {
    if (!session || !newPlayerForm.name || !newPlayerForm.mobile) return;
    setActionLoading("newPlayer");

    const formatMobile = (input: string) => {
      const digits = input.replace(/\D/g, "");
      if (digits.startsWith("61")) return `+${digits}`;
      if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
      return `+61${digits}`;
    };

    const formattedMobile = formatMobile(newPlayerForm.mobile);

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
      const { data: newPlayer, error } = await supabase.from("players").insert({
        name: newPlayerForm.name,
        mobile: formattedMobile,
        email: newPlayerForm.email || null,
        player_type: "casual",
        skill_rating: 3,
        is_admin: false,
        is_active: true,
        auth_user_id: null,
      }).select().single();

      if (error || !newPlayer) {
        toast.error("Failed to create player");
        setActionLoading("");
        return;
      }
      playerId = newPlayer.id;
    }

    const alreadyIn = rsvps.some((r) => r.player_id === playerId);
    if (alreadyIn) {
      toast.info("This player is already in the session");
      setActionLoading("");
      return;
    }

    const waitlistPosition = rsvps.filter((r) => r.is_waitlist).length + 1;
    await supabase.from("rsvps").insert({
      session_id: session.id,
      player_id: playerId,
      status: "confirmed",
      rsvp_at: new Date().toISOString(),
      is_waitlist: true,
      waitlist_position: waitlistPosition,
      promoted_at: null,
    });

    toast.success(`${newPlayerForm.name} added to waitlist`);
    setNewPlayerForm({ name: "", mobile: "", email: "" });
    setShowNewPlayerForm(false);
    setActionLoading("");
    await fetchAll();
  }

  async function handleRemovePlayer(rsvpId: string, playerName: string) {
    await supabase.from("rsvps").delete().eq("id", rsvpId);
    toast.success(`${playerName} removed from session`);
    await fetchAll();
  }

  if (isLoading || !session) {
    return <div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" /></div>;
  }

  const confirmed = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist);
  const maybe = rsvps.filter((r) => r.status === "maybe");
  const absent = rsvps.filter((r) => r.status === "absent");
  const waitlist = rsvps.filter((r) => r.is_waitlist);
  const maxPlayers = session.format === "3t" ? 15 : 10;
  const costPerPlayer = session.court_cost * (1 + session.buffer_pct / 100) / maxPlayers;
  const totalCollected = payments.reduce((s, p) => s + p.amount_paid, 0);
  const totalDue = payments.reduce((s, p) => s + p.amount_due, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <h2 className="text-xl font-bold">Session Admin</h2>
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
        <CardContent className="space-y-1 p-4 text-sm">
          <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />{new Date(session.date).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</div>
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" />{session.start_time} – {session.end_time}</div>
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{session.venue}</div>
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" />{confirmed.length}/{maxPlayers} confirmed</div>
          <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-muted-foreground" />${costPerPlayer.toFixed(2)}/player (${session.court_cost} + {session.buffer_pct}% buffer)</div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {session.status === "upcoming" && (
          <>
            <Button size="sm" variant="outline" onClick={() => router.push(`/admin/sessions/${id}/edit`)}>
              <Edit className="mr-1 h-4 w-4" /> Edit
            </Button>
            <Button size="sm" onClick={handleCloseSignups} disabled={actionLoading === "close"} className="bg-yellow-600 hover:bg-yellow-700">
              <Lock className="mr-1 h-4 w-4" /> Close Sign-ups
            </Button>
            <Button size="sm" variant="destructive" onClick={handleCancelSession} disabled={actionLoading === "cancel"}>
              <XCircle className="mr-1 h-4 w-4" /> Cancel
            </Button>
          </>
        )}
        {session.status === "signups_closed" && (
          <>
            <Button size="sm" onClick={handlePromoteWaitlist} disabled={actionLoading === "promote"} className="bg-blue-600 hover:bg-blue-700">
              <UserPlus className="mr-1 h-4 w-4" /> Promote Waitlist
            </Button>
            <Button size="sm" onClick={() => router.push(`/admin/sessions/${id}/teams`)} className="bg-green-700 hover:bg-green-800">
              <Shuffle className="mr-1 h-4 w-4" /> Generate Teams
            </Button>
          </>
        )}
        {(session.status === "signups_closed" || session.status === "teams_published") && (
          <>
            <Button size="sm" variant="outline" onClick={handleCreatePayments} disabled={actionLoading === "payments"}>
              <DollarSign className="mr-1 h-4 w-4" /> Create Payments
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCompleteDialog(true)} disabled={actionLoading === "complete"}>
              Complete Session
            </Button>
          </>
        )}
      </div>

      {/* Delete Session */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogTrigger asChild>
          <Button size="sm" variant="destructive" className="w-full">
            <Trash2 className="mr-1 h-4 w-4" /> Delete Session
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
            <DialogDescription>
              This will permanently delete this session and all related data (RSVPs, teams, payments). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSession} disabled={actionLoading === "delete"}>
              {actionLoading === "delete" ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Session Confirmation */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Session</DialogTitle>
            <DialogDescription>
              {payments.filter((p) => p.payment_status !== "paid").length > 0
                ? `Warning: ${payments.filter((p) => p.payment_status !== "paid").length} player(s) have not paid yet. Are you sure you want to complete this session?`
                : "All players have paid. Mark this session as complete?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>Cancel</Button>
            <Button onClick={handleCompleteSession} disabled={actionLoading === "complete"} className="bg-green-700 hover:bg-green-800">
              {actionLoading === "complete" ? "Completing..." : "Complete Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Player type legend */}
      <div className="flex gap-3 text-xs">
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-purple-100 border" /> Admin</div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-blue-100 border" /> Regular</div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-orange-100 border" /> Casual</div>
      </div>

      {/* Confirmed Players */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Confirmed ({confirmed.length}/{maxPlayers})</CardTitle>
            {payments.length > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                <div>${totalCollected.toFixed(2)} / ${totalDue.toFixed(2)} collected</div>
                <div>{payments.filter((p) => p.payment_status === "paid").length} / {payments.length} paid</div>
              </div>
            )}
          </div>
          <div className="pt-1">
            <Select value={session.court_payer_id || ""} onValueChange={(v) => v && handleSetCourtPayer(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select court payer..." /></SelectTrigger>
              <SelectContent>
                {confirmed.map((r) => (
                  <SelectItem key={r.player_id} value={r.player_id}>{r.player?.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {confirmed.map((r, idx) => {
            const playerPayment = payments.find((p) => p.player_id === r.player_id);
            const isCourtPayer = r.player_id === session.court_payer_id;
            const rowBg = r.player?.is_admin
              ? "bg-purple-100"
              : r.player?.player_type === "regular"
              ? "bg-blue-100"
              : "bg-orange-100";
            return (
              <div key={r.id} className={`flex items-center justify-between py-1.5 px-2 -mx-2 rounded text-sm border-b last:border-0 ${rowBg}`}>
                <div className="flex items-center gap-1 min-w-0">
                  {session.status === "upcoming" && (
                    <button
                      onClick={() => handleRemovePlayer(r.id, r.player?.name || "Player")}
                      className="text-muted-foreground hover:text-red-600 shrink-0"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                  <span className="text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                  <span className="truncate">{r.player?.name}</span>
                  {isCourtPayer && <Badge variant="outline" className="text-xs shrink-0">Court Payer</Badge>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {Array.from({ length: r.player?.skill_rating || 0 }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  ))}
                  {playerPayment && (
                    isCourtPayer ? (
                      <Badge className="text-xs bg-green-100 text-green-800 w-20 justify-center">Paid</Badge>
                    ) : (
                      <Select value={playerPayment.payment_status} onValueChange={(v) => v && handlePaymentUpdate(playerPayment.id, v)}>
                        <SelectTrigger className={`w-20 h-7 text-xs ${
                          playerPayment.payment_status === "paid" ? "text-green-700" :
                          "text-red-700"
                        }`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                        </SelectContent>
                      </Select>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Add Player to Session */}
      {session.status === "upcoming" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add Player</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <Select onValueChange={async (playerId) => {
              if (!playerId) return;
              const alreadyIn = rsvps.some((r) => r.player_id === playerId);
              if (alreadyIn) { toast.info("Player already in session"); return; }
              const isFull = confirmed.length >= maxPlayers;
              let waitlistPosition = null;
              if (isFull) {
                waitlistPosition = waitlist.length + 1;
              }
              await supabase.from("rsvps").insert({
                session_id: session.id,
                player_id: playerId,
                status: "confirmed",
                rsvp_at: new Date().toISOString(),
                is_waitlist: isFull,
                waitlist_position: waitlistPosition,
                promoted_at: null,
              });
              toast.success(isFull ? "Added to waitlist (session full)" : "Player added");
              fetchAll();
            }}>
              <SelectTrigger><SelectValue placeholder="Add to confirmed..." /></SelectTrigger>
              <SelectContent>
                {allPlayers
                  .filter((p) => !rsvps.some((r) => r.player_id === p.id))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.player_type})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Maybe & Absent */}
      {(maybe.length > 0 || absent.length > 0) && (
        <Card>
          <CardContent className="p-4">
            {maybe.length > 0 && (
              <div className="mb-2">
                <p className="text-sm font-medium mb-1">Maybe ({maybe.length})</p>
                {maybe.map((r) => <p key={r.id} className="text-sm text-muted-foreground">{r.player?.name}</p>)}
              </div>
            )}
            {absent.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Can&apos;t Make It ({absent.length})</p>
                {absent.map((r) => <p key={r.id} className="text-sm text-muted-foreground">{r.player?.name}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Waitlist */}
      {waitlist.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Waitlist ({waitlist.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {waitlist.sort((a, b) => (a.waitlist_position || 99) - (b.waitlist_position || 99)).map((r, i) => {
              const rowBg = r.player?.is_admin
                ? "bg-purple-100"
                : r.player?.player_type === "regular"
                ? "bg-blue-100"
                : "bg-orange-100";
              return (
              <div key={r.id} className={`flex items-center justify-between py-1 px-2 -mx-2 rounded text-sm border-b last:border-0 ${rowBg}`}>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRemovePlayer(r.id, r.player?.name || "Player")}
                    className="text-muted-foreground hover:text-red-600"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                  <span>#{i + 1} {r.player?.name}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={async () => {
                    await supabase.from("rsvps").update({ is_waitlist: false, promoted_at: new Date().toISOString() }).eq("id", r.id);
                    toast.success(`Promoted ${r.player?.name}`);
                    fetchAll();
                  }}
                >
                  Promote
                </Button>
              </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Add to Waitlist */}
      {session.status === "upcoming" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add to Waitlist</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <Select onValueChange={async (playerId) => {
              if (!playerId) return;
              const alreadyIn = rsvps.some((r) => r.player_id === playerId);
              if (alreadyIn) { toast.info("Player already in session"); return; }
              const waitlistPosition = waitlist.length + 1;
              await supabase.from("rsvps").insert({
                session_id: session.id,
                player_id: playerId,
                status: "confirmed",
                rsvp_at: new Date().toISOString(),
                is_waitlist: true,
                waitlist_position: waitlistPosition,
                promoted_at: null,
              });
              toast.success("Added to waitlist");
              fetchAll();
            }}>
              <SelectTrigger><SelectValue placeholder="Select existing player..." /></SelectTrigger>
              <SelectContent>
                {allPlayers
                  .filter((p) => !rsvps.some((r) => r.player_id === p.id))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.player_type})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={() => setShowNewPlayerForm(!showNewPlayerForm)}
            >
              <UserPlus className="mr-1 h-3 w-3" /> {showNewPlayerForm ? "Cancel" : "New player not in the system"}
            </Button>
            {showNewPlayerForm && (
              <div className="space-y-3 mt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Name *</Label>
                  <Input
                    placeholder="Player name"
                    value={newPlayerForm.name}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mobile *</Label>
                  <Input
                    type="tel"
                    placeholder="04XX XXX XXX"
                    value={newPlayerForm.mobile}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, mobile: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email (optional)</Label>
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={newPlayerForm.email}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full bg-green-700 hover:bg-green-800"
                  onClick={handleAddNewPlayerToWaitlist}
                  disabled={actionLoading === "newPlayer" || !newPlayerForm.name || !newPlayerForm.mobile}
                >
                  {actionLoading === "newPlayer" ? "Adding..." : "Add to Waitlist"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Send Payment Follow-up */}
      {payments.some((p) => p.payment_status !== "paid" && p.player_id !== session.court_payer_id) && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => router.push(`/admin/sessions/${id}/payment-followup`)}
        >
          <Send className="mr-2 h-4 w-4" /> Send Payment Follow-up
        </Button>
      )}
    </div>
  );
}
