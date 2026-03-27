"use client";

import { useEffect, useState, useMemo } from "react";
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
  Shuffle, Send, XCircle, Star, Edit, Trash2, Copy, MessageSquare,
  MessageCircle, Search, CreditCard, Phone, Check, X, PauseCircle
} from "lucide-react";
import { generateBalancedTeams, getBalanceScoreFromProposals, type TeamProposal } from "@/lib/team-balancer";
import type { Session, Rsvp, Player, Payment, Team } from "@/lib/types/database";

interface TeamWithPlayers extends Team {
  players: Player[];
}

export default function AdminSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [session, setSession] = useState<Session | null>(null);
  const [rsvps, setRsvps] = useState<(Rsvp & { player: Player })[]>([]);
  const [payments, setPayments] = useState<(Payment & { player?: Player })[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [showNewPlayerForm, setShowNewPlayerForm] = useState(false);
  const [newPlayerForm, setNewPlayerForm] = useState({ name: "", mobile: "", email: "" });
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [addPlayerHighlight, setAddPlayerHighlight] = useState(-1);
  const [waitlistSearch, setWaitlistSearch] = useState("");
  const [waitlistHighlight, setWaitlistHighlight] = useState(-1);
  const [showMessage, setShowMessage] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [msgChannel, setMsgChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [msgSending, setMsgSending] = useState(false);
  const [msgTemplate, setMsgTemplate] = useState<"summary" | "payment" | "custom">("summary");
  const [msgRecipients, setMsgRecipients] = useState<"confirmed" | "waitlisted" | "unpaid" | "all_active" | "individual">("confirmed");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState("");
  const [lastNotification, setLastNotification] = useState<{ message: string; sent_at: string; count: number } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{rsvpId: string; name: string} | null>(null);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [showPayIdDialog, setShowPayIdDialog] = useState(false);
  const [payIdRef, setPayIdRef] = useState<string[]>([]);
  const [showTeamGen, setShowTeamGen] = useState(false);
  const [teamProposals, setTeamProposals] = useState<TeamProposal[]>([]);
  const [dragPlayer, setDragPlayer] = useState<{ teamIndex: number; playerIndex: number } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [numTeamsChoice, setNumTeamsChoice] = useState<2 | 3>(2);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { router.push("/"); return; }
    if (id) fetchAll();

    const channel = supabase
      .channel(`admin-session-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rsvps", filter: `session_id=eq.${id}` }, fetchAll)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isAdmin, authLoading]);

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

    // Fetch teams if published
    const { data: teamsData } = await supabase.from("teams").select("*").eq("session_id", id).order("team_name");
    if (teamsData && teamsData.length > 0) {
      const teamIds = teamsData.map((t) => t.id);
      const { data: teamPlayers } = await supabase
        .from("team_players")
        .select("*, player:players(*)")
        .in("team_id", teamIds);

      const teamsWithPlayers: TeamWithPlayers[] = (teamsData as Team[]).map((team) => ({
        ...team,
        players: (teamPlayers || [])
          .filter((tp: Record<string, unknown>) => tp.team_id === team.id)
          .map((tp: Record<string, unknown>) => tp.player as unknown as Player),
      }));
      setTeams(teamsWithPlayers);
    } else {
      setTeams([]);
    }

    // Fetch last notification for this session
    const { data: notifData } = await supabase
      .from("notifications")
      .select("message, sent_at")
      .eq("session_id", id)
      .order("sent_at", { ascending: false })
      .limit(1);
    if (notifData && notifData.length > 0) {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("session_id", id)
        .eq("sent_at", notifData[0].sent_at);
      setLastNotification({
        message: notifData[0].message.slice(0, 40),
        sent_at: notifData[0].sent_at,
        count: count || 1,
      });
    }

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
      payment_method: status === "paid" && !payment.payment_method ? "cash" : payment.payment_method,
      pending_confirmation: false,
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

  function generateSessionSummary() {
    if (!session) return "";
    const conf = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist);
    const wl = rsvps.filter((r) => r.is_waitlist);
    const max = session.format === "3t" ? 15 : 10;
    const paidCount = payments.filter((p) => p.payment_status === "paid").length;

    const getPaymentStatus = (playerId: string) => {
      if (playerId === session.court_payer_id) return "💳";
      const p = payments.find((pay) => pay.player_id === playerId);
      if (!p) return "";
      return p.payment_status === "paid" ? "✅" : "❌";
    };

    const sessionDate = new Date(session.date).toLocaleDateString("en-AU", {
      weekday: "long", day: "numeric", month: "long",
    });

    let msg = `⚽ *Monday Night Soccer*\n`;
    msg += `📅 ${sessionDate}\n`;
    msg += `📍 ${session.venue}\n`;
    msg += `🕗 ${session.start_time} – ${session.end_time}\n`;
    msg += `🏟️ ${session.format === "3t" ? "3 teams (15 players)" : "2 teams (10 players)"}\n`;

    // Teams (if published)
    if (teams.length > 0) {
      msg += "\n";
      teams.forEach((team) => {
        msg += `\n🎽 *Team ${team.team_name} (${team.bib_color}):*\n`;
        team.players.forEach((p, i) => {
          const pay = getPaymentStatus(p.id);
          msg += `${i + 1}. ${p.name}${pay ? " " + pay : ""}\n`;
        });
      });
      if (payments.length > 0) {
        msg += `\n💰 ${paidCount}/${payments.length} paid · ✅ paid · ❌ unpaid · 💳 court payer\n`;
      }
    } else {
      // No teams yet — show confirmed list
      msg += "\n";
      msg += `✅ *Confirmed (${conf.length}/${max}):*\n`;
      conf.forEach((r, i) => {
        const pay = getPaymentStatus(r.player_id);
        msg += `${i + 1}. ${r.player?.name}${pay ? " " + pay : ""}\n`;
      });

      if (wl.length > 0) {
        msg += `\n⏳ *Waitlist (${wl.length}):*\n`;
        wl.forEach((r, i) => { msg += `${i + 1}. ${r.player?.name}\n`; });
      }

      if (conf.length < max) {
        const spots = max - conf.length;
        msg += `\n🔔 *${spots} spot${spots !== 1 ? "s" : ""} available!*\n`;
      }

      if (payments.length > 0) {
        msg += `\n💰 ${paidCount}/${payments.length} paid · ✅ paid · ❌ unpaid · 💳 court payer\n`;
      }
    }

    msg += `\n👉 RSVP: ${process.env.NEXT_PUBLIC_APP_URL || "https://monday-soccer-app.vercel.app"}`;
    return msg;
  }

  function generatePaymentReminder() {
    if (!session) return "";
    const unpaid = payments.filter(
      (p) => p.payment_status !== "paid" && p.player_id !== session.court_payer_id
    );
    const sessionDate = new Date(session.date).toLocaleDateString("en-AU", {
      weekday: "long", day: "numeric", month: "long",
    });
    const costPerPlayer = session.court_cost * (1 + session.buffer_pct / 100) / (session.format === "3t" ? 15 : 10);
    const courtPayer = payments.find((p) => p.player_id === session.court_payer_id);
    const courtPayerName = courtPayer?.player?.name || "the court payer";

    let msg = `💰 *Payment Reminder*\n\n`;
    msg += `Hi! You have an outstanding payment for Monday Night Soccer.\n\n`;
    msg += `📅 ${sessionDate}\n`;
    msg += `💵 Amount: $${costPerPlayer.toFixed(2)} per player\n\n`;
    if (unpaid.length > 0) {
      msg += `Outstanding:\n`;
      unpaid.forEach((p) => {
        msg += `• ${p.player?.name || "Unknown"} ($${(p.amount_due || 0).toFixed(2)})\n`;
      });
      msg += `\n`;
    }
    msg += `Please pay ${courtPayerName}. Thanks! ⚽`;
    return msg;
  }

  const recipientPlayerIds = useMemo(() => {
    if (!session) return [];
    if (msgRecipients === "confirmed") {
      return rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist).map((r) => r.player_id);
    } else if (msgRecipients === "waitlisted") {
      return rsvps.filter((r) => r.is_waitlist).map((r) => r.player_id);
    } else if (msgRecipients === "unpaid") {
      return payments.filter((p) => p.payment_status !== "paid" && p.player_id !== session.court_payer_id).map((p) => p.player_id);
    } else if (msgRecipients === "all_active") {
      return allPlayers.map((p) => p.id);
    } else {
      return Array.from(selectedPlayerIds);
    }
  }, [msgRecipients, rsvps, payments, allPlayers, selectedPlayerIds, session]);

  async function handleSendMessage() {
    if (!session || !msgText.trim() || recipientPlayerIds.length === 0) return;
    setMsgSending(true);

    try {
      const res = await fetch("/api/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msgText.trim(),
          player_ids: recipientPlayerIds,
          session_id: session.id,
          channel: msgChannel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Sent to ${data.sent}/${data.total} players via ${msgChannel === "whatsapp" ? "WhatsApp" : "SMS"}`);
      setMsgText("");
      setShowMessage(false);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
    setMsgSending(false);
  }

  async function handlePayIdResolve(paymentId: string, action: "approve" | "reject") {
    try {
      const res = await fetch("/api/payments/payid-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: paymentId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(action === "approve" ? "Payment approved" : "Payment rejected");
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  function handleStartTeamGen() {
    if (!session) return;
    const confirmedPlayers = rsvps
      .filter((r) => r.status === "confirmed" && !r.is_waitlist)
      .map((r) => r.player);
    // Auto-pick: 10 or fewer = 2 teams, 11+ = 3 teams
    const autoTeams: 2 | 3 = confirmedPlayers.length > 10 ? 3 : 2;
    setNumTeamsChoice(autoTeams);
    setTeamProposals(generateBalancedTeams(confirmedPlayers, autoTeams));
    setShowTeamGen(true);
    setDragPlayer(null);
  }

  function handleReshuffle(overrideNum?: 2 | 3) {
    if (!session) return;
    const numTeams = overrideNum || numTeamsChoice;
    const confirmedPlayers = rsvps
      .filter((r) => r.status === "confirmed" && !r.is_waitlist)
      .map((r) => r.player);
    setTeamProposals(generateBalancedTeams(confirmedPlayers, numTeams));
    setDragPlayer(null);
    if (!overrideNum) toast.success("Teams reshuffled");
  }

  function handleSwapPlayers(fromTeam: number, fromPlayer: number, toTeam: number, toPlayer: number) {
    const newTeams = teamProposals.map((t) => ({ ...t, players: [...t.players] }));
    const temp = newTeams[fromTeam].players[fromPlayer];
    newTeams[fromTeam].players[fromPlayer] = newTeams[toTeam].players[toPlayer];
    newTeams[toTeam].players[toPlayer] = temp;
    newTeams.forEach((t) => {
      t.avgSkill = t.players.reduce((s, p) => s + p.skill_rating, 0) / t.players.length;
    });
    setTeamProposals(newTeams);
  }

  function handleBibChange(teamIndex: number, color: string) {
    const newTeams = [...teamProposals];
    newTeams[teamIndex] = { ...newTeams[teamIndex], bibColor: color };
    setTeamProposals(newTeams);
  }

  async function handlePublishTeams() {
    if (!session) return;
    setIsPublishing(true);

    // Delete existing teams
    const { data: existingTeams } = await supabase.from("teams").select("id").eq("session_id", id);
    if (existingTeams && existingTeams.length > 0) {
      const teamIds = existingTeams.map((t) => t.id);
      await supabase.from("team_players").delete().in("team_id", teamIds);
      await supabase.from("teams").delete().eq("session_id", id);
    }

    for (const team of teamProposals) {
      const { data: teamData } = await supabase.from("teams").insert({
        session_id: session.id,
        team_name: team.teamName,
        bib_color: team.bibColor,
        avg_skill_rating: team.avgSkill,
        published_at: new Date().toISOString(),
      }).select().single();

      if (teamData) {
        await supabase.from("team_players").insert(
          team.players.map((p) => ({ team_id: teamData.id, player_id: p.id }))
        );
      }
    }

    await supabase.from("sessions").update({ status: "teams_published" }).eq("id", id);

    // Auto-create payments
    const max = session.format === "3t" ? 15 : 10;
    const costPerPlayer = session.court_cost * (1 + session.buffer_pct / 100) / max;
    const allPlayerIds = teamProposals.flatMap((t) => t.players.map((p) => p.id));
    const { data: existingPayments } = await supabase
      .from("payments").select("player_id").eq("session_id", session.id);
    const existingPaymentIds = new Set((existingPayments || []).map((p) => p.player_id));

    const newPayments = allPlayerIds
      .filter((pid) => !existingPaymentIds.has(pid))
      .map((pid) => ({
        session_id: session.id,
        player_id: pid,
        amount_due: costPerPlayer,
        amount_paid: pid === session.court_payer_id ? costPerPlayer : 0,
        payment_status: (pid === session.court_payer_id ? "paid" : "unpaid") as "paid" | "unpaid",
        payment_method: null,
        notes: null,
      }));

    if (newPayments.length > 0) {
      await supabase.from("payments").insert(newPayments);
    }

    toast.success(`Teams published! ${newPayments.length} payment records created.`);
    setShowTeamGen(false);
    setIsPublishing(false);
    await fetchAll();
  }

  async function handleToggleChasePause(paymentId: string, paused: boolean) {
    await supabase.from("payments").update({ chase_paused: paused }).eq("id", paymentId);
    toast.success(paused ? "Chase paused" : "Chase resumed");
    await fetchAll();
  }

  function togglePaymentSelection(paymentId: string) {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId); else next.add(paymentId);
      return next;
    });
  }

  const selectedPayments = payments.filter((p) => selectedPaymentIds.has(p.id));
  const selectedTotal = selectedPayments.reduce((s, p) => s + p.amount_due, 0);
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
      toast.success("Payment marked as sent — awaiting confirmation");
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
      const pay = payments.find((p) => p.id === payId);
      await supabase.from("payments").update({
        payment_status: "paid",
        amount_paid: pay?.amount_due || 0,
        payment_method: "cash",
        pending_confirmation: false,
      }).eq("id", payId);
    }
    toast.success(`${selectedPaymentIds.size} payment(s) marked as paid`);
    setSelectedPaymentIds(new Set());
    setPaymentProcessing(false);
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

  // Workflow step calculation
  const workflowCurrentStep = (() => {
    if (session.status === "cancelled") return -1;
    if (session.status === "completed") return 5;
    if (session.status === "teams_published" && payments.length > 0) return 4;
    if (session.status === "teams_published") return 3;
    if (session.status === "signups_closed") return 2;
    if (confirmed.length > 0) return 1;
    return 0;
  })();

  const workflowSteps = [
    { label: "Created" },
    { label: "Sign-ups" },
    { label: "Closed" },
    { label: "Teams" },
    { label: "Payments" },
    { label: "Done" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <h2 className="text-xl font-bold">Session Admin</h2>
        <div className="flex items-center gap-2">
          <Badge className={
            session.status === "upcoming" ? "bg-blue-100 text-blue-800" :
            session.status === "cancelled" ? "bg-red-100 text-red-800" :
            "bg-green-100 text-green-800"
          }>
            {session.status.replace(/_/g, " ")}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => router.push(`/sessions/${id}`)}
          >
            <Users className="mr-1 h-3 w-3" /> Player
          </Button>
        </div>
      </div>

      {/* Workflow Stepper */}
      <div className="flex items-center justify-between px-1">
        {workflowSteps.map((step, idx) => {
          const isCancelled = session.status === "cancelled";
          const isCompleted = !isCancelled && idx < workflowCurrentStep;
          const isCurrent = !isCancelled && idx === workflowCurrentStep;
          const isFuture = !isCancelled && idx > workflowCurrentStep;

          return (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`rounded-full flex items-center justify-center transition-all ${
                    isCancelled
                      ? "h-5 w-5 bg-red-200 border-2 border-red-500"
                      : isCompleted
                      ? "h-5 w-5 bg-green-600"
                      : isCurrent
                      ? "h-6 w-6 bg-green-600 ring-2 ring-green-300 ring-offset-1"
                      : "h-5 w-5 bg-gray-200 border-2 border-gray-300"
                  }`}
                >
                  {isCompleted && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                  {isCurrent && (
                    <div className="h-2 w-2 bg-white rounded-full" />
                  )}
                  {isCancelled && idx === 0 && (
                    <X className="h-3 w-3 text-red-600" />
                  )}
                </div>
                <span className={`text-[10px] mt-1 ${
                  isCancelled
                    ? "text-red-500"
                    : isCurrent
                    ? "text-green-700 font-semibold"
                    : isCompleted
                    ? "text-green-600"
                    : "text-muted-foreground"
                }`}>
                  {step.label}
                </span>
              </div>
              {idx < workflowSteps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mt-[-12px] ${
                  isCancelled
                    ? "bg-red-200"
                    : isCompleted
                    ? "bg-green-500"
                    : isCurrent
                    ? "bg-gradient-to-r from-green-500 to-gray-200"
                    : "bg-gray-200"
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Session Recap — completed sessions */}
      {session.status === "completed" && payments.length > 0 && (() => {
        const recapPaid = payments.filter((p) => p.payment_status === "paid").length;
        const recapCollected = payments.reduce((s, p) => s + p.amount_paid, 0);
        const recapDue = payments.reduce((s, p) => s + p.amount_due, 0);
        const recapPct = payments.length > 0 ? (recapPaid / payments.length) * 100 : 0;
        const recapBar = recapPct === 100 ? "bg-green-500" : recapPct >= 50 ? "bg-yellow-500" : "bg-red-500";
        return (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-sm">
                Session Recap — {new Date(session.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{confirmed.length} players attended</span>
                <span>{recapPaid}/{payments.length} paid</span>
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
        <CardContent className="space-y-1 p-4 text-sm">
          <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />{new Date(session.date).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</div>
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" />{session.start_time} – {session.end_time}</div>
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{session.venue}</div>
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" />{confirmed.length}/{maxPlayers} confirmed</div>
          <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-muted-foreground" />${costPerPlayer.toFixed(2)}/player (${session.court_cost} + {session.buffer_pct}% buffer)</div>
        </CardContent>
      </Card>

      {/* Court Payer */}
      {confirmed.length > 0 && session.status !== "completed" && session.status !== "cancelled" && (
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground shrink-0">Court Payer:</span>
          <Select value={session.court_payer_id || ""} onValueChange={(v) => v && handleSetCourtPayer(v)}>
            <SelectTrigger className="h-8 text-sm flex-1">
              <SelectValue placeholder="Select court payer..." />
            </SelectTrigger>
            <SelectContent>
              {confirmed.map((r) => (
                <SelectItem key={r.player_id} value={r.player_id}>{r.player?.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
            <Button size="sm" onClick={handleStartTeamGen} className="bg-green-700 hover:bg-green-800">
              <Shuffle className="mr-1 h-4 w-4" /> Generate Teams
            </Button>
          </>
        )}
      </div>

      {/* Inline Team Generator */}
      {showTeamGen && teamProposals.length > 0 && (() => {
        const BIB_OPTIONS = ["White", "Black", "Red", "Blue", "Yellow", "Green"];
        const bibColorMap: Record<string, string> = {
          White: "bg-white text-black border border-gray-300",
          Black: "bg-gray-900 text-white",
          Red: "bg-red-600 text-white",
          Blue: "bg-blue-600 text-white",
          Yellow: "bg-yellow-400 text-black",
          Green: "bg-green-600 text-white",
        };
        const balanceScore = getBalanceScoreFromProposals(teamProposals);

        return (
          <Card className="border-2 border-green-600">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Team Generator</CardTitle>
                <Badge variant={balanceScore <= 0.5 ? "default" : "destructive"}>
                  Balance: {balanceScore.toFixed(2)}
                </Badge>
              </div>
              <div className="flex gap-2 pt-1 flex-wrap">
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={numTeamsChoice === 2 ? "default" : "outline"}
                    className={`h-7 text-xs ${numTeamsChoice === 2 ? "bg-green-700 hover:bg-green-800" : ""}`}
                    onClick={() => { setNumTeamsChoice(2); handleReshuffle(2); }}
                  >
                    2 Teams
                  </Button>
                  <Button
                    size="sm"
                    variant={numTeamsChoice === 3 ? "default" : "outline"}
                    className={`h-7 text-xs ${numTeamsChoice === 3 ? "bg-green-700 hover:bg-green-800" : ""}`}
                    onClick={() => { setNumTeamsChoice(3); handleReshuffle(3); }}
                  >
                    3 Teams
                  </Button>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleReshuffle()}>
                  <Shuffle className="mr-1 h-4 w-4" /> Reshuffle
                </Button>
                <Button size="sm" onClick={handlePublishTeams} disabled={isPublishing} className="bg-green-700 hover:bg-green-800">
                  <Check className="mr-1 h-4 w-4" /> {isPublishing ? "Publishing..." : "Publish Teams"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowTeamGen(false)} className="ml-auto">
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Tap a player, then tap another on a different team to swap.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {teamProposals.map((team, teamIndex) => (
                <div key={teamIndex} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-5 w-5 rounded-full ${bibColorMap[team.bibColor] || "bg-gray-300"}`} />
                      <span className="font-semibold text-sm">Team {team.teamName}</span>
                      <span className="text-xs text-muted-foreground">Avg: {team.avgSkill.toFixed(1)}</span>
                    </div>
                    <Select value={team.bibColor} onValueChange={(v) => v && handleBibChange(teamIndex, v)}>
                      <SelectTrigger className="w-20 h-6 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BIB_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {team.players.map((p, playerIndex) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between py-1 px-2 rounded text-sm cursor-pointer transition-colors ${
                        dragPlayer?.teamIndex === teamIndex && dragPlayer?.playerIndex === playerIndex
                          ? "bg-green-100 ring-2 ring-green-500"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => {
                        if (!dragPlayer) {
                          setDragPlayer({ teamIndex, playerIndex });
                        } else if (dragPlayer.teamIndex !== teamIndex) {
                          handleSwapPlayers(dragPlayer.teamIndex, dragPlayer.playerIndex, teamIndex, playerIndex);
                          setDragPlayer(null);
                        } else {
                          setDragPlayer(null);
                        }
                      }}
                    >
                      <span>{p.name}</span>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: p.skill_rating }).map((_, i) => (
                          <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}


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

      {/* Published Teams */}
      {teams.length > 0 && (
        <div className="space-y-3">
          {(() => { let playerNum = 0; return teams.map((team) => {
            const bibColors: Record<string, string> = {
              White: "bg-white text-black border",
              Black: "bg-gray-900 text-white",
              Red: "bg-red-600 text-white",
              Blue: "bg-blue-600 text-white",
              Yellow: "bg-yellow-400 text-black",
              Green: "bg-green-600 text-white",
            };
            const teamPays = payments.filter((pay) => team.players.some((p) => p.id === pay.player_id));
            const teamPaid = teamPays.filter((p) => p.payment_status === "paid").length;
            const teamCollected = teamPays.reduce((s, p) => s + p.amount_paid, 0);
            const teamDue = teamPays.reduce((s, p) => s + p.amount_due, 0);
            const teamPct = teamPays.length > 0 ? (teamPaid / teamPays.length) * 100 : 0;
            const teamBarColor = teamPct === 100 ? "bg-green-500" : teamPct >= 50 ? "bg-yellow-500" : "bg-red-500";

            const teamStartNum = playerNum;
            playerNum += team.players.length;

            return (
              <Card key={team.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-5 w-5 rounded-full ${bibColors[team.bib_color] || "bg-gray-300"}`} />
                    <CardTitle className="text-sm">Team {team.team_name}</CardTitle>
                    {team.avg_skill_rating && (
                      <span className="text-xs text-muted-foreground">Avg: {Number(team.avg_skill_rating).toFixed(1)}</span>
                    )}
                  </div>
                  {teamPays.length > 0 && (
                    <div className="pt-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{teamPaid}/{teamPays.length} paid</span>
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
                    const playerPayment = payments.find((pay) => pay.player_id === p.id);
                    const rowBg = p.is_admin
                      ? "bg-purple-100"
                      : p.player_type === "regular"
                      ? "bg-blue-100"
                      : "bg-orange-100";
                    const isUnpaid = playerPayment && playerPayment.payment_status !== "paid" && !playerPayment.pending_confirmation;
                    const isSelected = playerPayment ? selectedPaymentIds.has(playerPayment.id) : false;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between py-1 px-2 -mx-2 rounded text-sm ${rowBg} ${isUnpaid ? "cursor-pointer" : ""} ${isSelected ? "ring-1 ring-green-500" : ""}`}
                        onClick={() => { if (isUnpaid && playerPayment) togglePaymentSelection(playerPayment.id); }}
                      >
                        <div className="flex items-center gap-2">
                          {playerPayment && (
                            isUnpaid ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePaymentSelection(playerPayment.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded h-3.5 w-3.5"
                              />
                            ) : (
                              <div className="w-3.5" />
                            )
                          )}
                          <span className="text-muted-foreground w-5">#{teamStartNum + idx + 1}</span>
                          <span>{p.name}</span>
                          {p.id === session.court_payer_id && <Badge variant="outline" className="text-[10px] px-1">Court</Badge>}
                        </div>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: p.skill_rating || 0 }).map((_, i) => (
                            <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          ))}
                          {playerPayment && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              playerPayment.payment_status === "paid"
                                ? "bg-green-100 text-green-800"
                                : playerPayment.pending_confirmation
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {playerPayment.pending_confirmation ? "Pending" : playerPayment.payment_status === "paid" ? "Paid" : "Unpaid"}
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

          {/* Payment action bar */}
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
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={handleMarkPaidCash}
                    disabled={paymentProcessing}
                  >
                    {paymentProcessing ? "..." : "Cash"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={handleStartTeamGen}
          >
            <Shuffle className="mr-1 h-4 w-4" /> Regenerate Teams
          </Button>
        </div>
      )}

      {/* Confirmed Players — hide when teams are shown */}
      {teams.length === 0 && (<Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Confirmed ({confirmed.length}/{maxPlayers})</CardTitle>
            {payments.length > 0 && (() => {
              const paidCount = payments.filter((p) => p.payment_status === "paid").length;
              const pctPaid = payments.length > 0 ? (paidCount / payments.length) * 100 : 0;
              const barColor = pctPaid === 100 ? "bg-green-500" : pctPaid >= 50 ? "bg-yellow-500" : "bg-red-500";
              return (
                <div className="text-xs text-right min-w-[120px]">
                  <div className="text-muted-foreground">${totalCollected.toFixed(2)} / ${totalDue.toFixed(2)}</div>
                  <div className="text-muted-foreground">{paidCount} / {payments.length} paid</div>
                  <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden mt-1">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pctPaid}%` }} />
                  </div>
                </div>
              );
            })()}
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
                      onClick={() => setRemoveConfirm({rsvpId: r.id, name: r.player?.name || "Player"})}
                      className="text-muted-foreground hover:text-red-600 shrink-0"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                  <span className="text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                  <span className="truncate">{r.player?.name}</span>
                  {isCourtPayer && <Badge variant="outline" className="text-xs shrink-0">Court Payer</Badge>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {Array.from({ length: r.player?.skill_rating || 0 }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  ))}
                  {playerPayment && (
                    playerPayment.pending_confirmation ? (
                      <Badge className="text-xs bg-yellow-100 text-yellow-800 w-14 justify-center">Pending</Badge>
                    ) : (
                      <button
                        onClick={() => handlePaymentUpdate(playerPayment.id, playerPayment.payment_status === "paid" ? "unpaid" : "paid")}
                        className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                          playerPayment.payment_status === "paid"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {playerPayment.payment_status === "paid" ? "Paid" : "Unpaid"}
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>)}

      {/* Player type legend */}
      {(teams.length > 0 || confirmed.length > 0) && (
        <div className="flex justify-center gap-4 text-xs">
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-purple-100 border" /> Admin</div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-blue-100 border" /> Regular</div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-orange-100 border" /> Casual</div>
        </div>
      )}

      {/* Add Player to Session */}
      {session.status === "upcoming" && confirmed.length < maxPlayers && (() => {
        const availablePlayers = allPlayers.filter((p) => !rsvps.some((r) => r.player_id === p.id));

        async function addPlayerToSession(playerId: string) {
          if (!session) return;
          const alreadyIn = rsvps.some((r) => r.player_id === playerId);
          if (alreadyIn) { toast.info("Player already in session"); return; }
          const currentConfirmed = rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist).length;
          const isFull = currentConfirmed >= maxPlayers;
          if (isFull) toast.info("Session is full — adding to waitlist instead");
          await supabase.from("rsvps").insert({
            session_id: session.id,
            player_id: playerId,
            status: "confirmed",
            rsvp_at: new Date().toISOString(),
            is_waitlist: isFull,
            waitlist_position: isFull ? waitlist.length + 1 : null,
            promoted_at: null,
          });
          toast.success(isFull ? "Added to waitlist (session full)" : "Player added");
          setAddPlayerSearch("");
          fetchAll();
        }

        const filteredAdd = availablePlayers.filter((p) => p.name.toLowerCase().includes(addPlayerSearch.toLowerCase()));

        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add Player ({confirmed.length}/{maxPlayers})</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search player name..."
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={addPlayerSearch}
                  onChange={(e) => { setAddPlayerSearch(e.target.value); setAddPlayerHighlight(-1); }}
                  onKeyDown={(e) => {
                    if (!addPlayerSearch || filteredAdd.length === 0) return;
                    if (e.key === "ArrowDown") { e.preventDefault(); setAddPlayerHighlight((h) => Math.min(h + 1, filteredAdd.length - 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setAddPlayerHighlight((h) => Math.max(h - 1, 0)); }
                    else if (e.key === "Enter" && addPlayerHighlight >= 0) { e.preventDefault(); addPlayerToSession(filteredAdd[addPlayerHighlight].id); }
                  }}
                />
              </div>
              {addPlayerSearch && (
                <div className="border rounded-md max-h-[150px] overflow-y-auto">
                  {filteredAdd.map((p, idx) => (
                      <button
                        key={p.id}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between border-b last:border-0 ${idx === addPlayerHighlight ? "bg-green-100" : "hover:bg-muted/50"}`}
                        onClick={() => addPlayerToSession(p.id)}
                        onMouseEnter={() => setAddPlayerHighlight(idx)}
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.player_type}</span>
                      </button>
                    ))}
                  {filteredAdd.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2 text-center">No matching players</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

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
                    onClick={() => setRemoveConfirm({rsvpId: r.id, name: r.player?.name || "Player"})}
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
      {session.status !== "completed" && session.status !== "cancelled" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add to Waitlist</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {(() => {
              const filteredWl = allPlayers
                .filter((p) => !rsvps.some((r) => r.player_id === p.id))
                .filter((p) => p.name.toLowerCase().includes(waitlistSearch.toLowerCase()));

              async function addToWaitlist(playerId: string) {
                if (!session) return;
                const alreadyIn = rsvps.some((r) => r.player_id === playerId);
                if (alreadyIn) { toast.info("Player already in session"); return; }
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
                setWaitlistSearch("");
                setWaitlistHighlight(-1);
                fetchAll();
              }

              return (<>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search player name..."
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={waitlistSearch}
                    onChange={(e) => { setWaitlistSearch(e.target.value); setWaitlistHighlight(-1); }}
                    onKeyDown={(e) => {
                      if (!waitlistSearch || filteredWl.length === 0) return;
                      if (e.key === "ArrowDown") { e.preventDefault(); setWaitlistHighlight((h) => Math.min(h + 1, filteredWl.length - 1)); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setWaitlistHighlight((h) => Math.max(h - 1, 0)); }
                      else if (e.key === "Enter" && waitlistHighlight >= 0) { e.preventDefault(); addToWaitlist(filteredWl[waitlistHighlight].id); }
                    }}
                  />
                </div>
                {waitlistSearch && (
                  <div className="border rounded-md max-h-[150px] overflow-y-auto">
                    {filteredWl.map((p, idx) => (
                      <button
                        key={p.id}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between border-b last:border-0 ${idx === waitlistHighlight ? "bg-green-100" : "hover:bg-muted/50"}`}
                        onClick={() => addToWaitlist(p.id)}
                        onMouseEnter={() => setWaitlistHighlight(idx)}
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.player_type}</span>
                      </button>
                    ))}
                    {filteredWl.length === 0 && (
                      <p className="text-xs text-muted-foreground py-2 text-center">No matching players</p>
                    )}
                  </div>
                )}
              </>);
            })()}
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

      {/* Pending PayID Confirmations */}
      {payments.some((p) => p.pending_confirmation) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4" /> Pending PayID Confirmations
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {payments.filter((p) => p.pending_confirmation).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                <div>
                  <span className="font-medium">{p.player?.name || "Unknown"}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ${p.amount_due.toFixed(2)} · Ref: <span className="font-mono">{p.payment_reference || "N/A"}</span>
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-green-700 hover:bg-green-800"
                    onClick={() => handlePayIdResolve(p.id, "approve")}
                  >
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    onClick={() => handlePayIdResolve(p.id, "reject")}
                  >
                    <X className="h-3 w-3 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Chase Controls — only show when some unpaid payments are older than 2 days */}
      {(() => {
        const chaseable = payments.filter(
          (p) => p.payment_status === "unpaid" && p.player_id !== session.court_payer_id && !p.pending_confirmation
        );
        const hasOverdue = chaseable.some(
          (p) => Math.floor((Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)) >= 2
        );
        if (chaseable.length === 0 || !hasOverdue) return null;

        return (
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Card className="w-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <PauseCircle className="h-4 w-4 text-yellow-600 shrink-0" />
                    <span className="font-semibold text-sm">Payment Chase</span>
                    <Badge variant="outline" className="text-xs ml-auto">
                      {chaseable.length} unpaid
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Auto-chase: T+2 reminder, T+5 escalation, T+7 admin alert
                  </p>
                </CardContent>
              </Card>
            </summary>
            <Card className="mt-1">
              <CardContent className="p-4">
                <div className="space-y-1.5">
                  {chaseable.map((p) => {
                    const daysSince = Math.floor(
                      (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    const stage = daysSince >= 7 ? "Overdue (7d+)" : daysSince >= 5 ? "Escalated (5d)" : daysSince >= 2 ? "Reminded (2d)" : "New";
                    const stageColor = daysSince >= 5 ? "text-red-600" : daysSince >= 2 ? "text-yellow-600" : "text-muted-foreground";
                    return (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{p.player?.name || "Unknown"}</span>
                          <span className={`text-xs ${stageColor}`}>{stage}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-6 text-xs px-2 ${p.chase_paused ? "text-yellow-600" : "text-muted-foreground"}`}
                          onClick={() => handleToggleChasePause(p.id, !p.chase_paused)}
                        >
                          <PauseCircle className="h-3 w-3 mr-1" />
                          {p.chase_paused ? "Paused" : "Pause"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </details>
        );
      })()}

      {/* Message Composer */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Message
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                setShowMessage(!showMessage);
                if (!showMessage && !msgText) {
                  setMsgTemplate("summary");
                  setMsgRecipients("confirmed");
                  setMsgText(generateSessionSummary());
                }
              }}
            >
              {showMessage ? "Close" : "Compose"}
            </Button>
          </div>
        </CardHeader>
        {showMessage && (
          <CardContent className="p-4 pt-0 space-y-3">
            {/* Template Quick-Select */}
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={msgTemplate === "summary" ? "default" : "outline"}
                className={`text-xs h-7 ${msgTemplate === "summary" ? "bg-green-700 hover:bg-green-800" : ""}`}
                onClick={() => {
                  setMsgTemplate("summary");
                  setMsgRecipients("confirmed");
                  setMsgText(generateSessionSummary());
                }}
              >
                Session Summary
              </Button>
              <Button
                size="sm"
                variant={msgTemplate === "payment" ? "default" : "outline"}
                className={`text-xs h-7 ${msgTemplate === "payment" ? "bg-green-700 hover:bg-green-800" : ""}`}
                onClick={() => {
                  setMsgTemplate("payment");
                  setMsgRecipients("unpaid");
                  setMsgText(generatePaymentReminder());
                }}
              >
                Payment Reminder
              </Button>
              <Button
                size="sm"
                variant={msgTemplate === "custom" ? "default" : "outline"}
                className={`text-xs h-7 ${msgTemplate === "custom" ? "bg-green-700 hover:bg-green-800" : ""}`}
                onClick={() => {
                  setMsgTemplate("custom");
                  setMsgText("");
                }}
              >
                Custom
              </Button>
            </div>

            {/* Recipient Selector */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs shrink-0">To:</Label>
                <Select
                  value={msgRecipients}
                  onValueChange={(v) => {
                    setMsgRecipients(v as typeof msgRecipients);
                    if (v === "individual") {
                      setSelectedPlayerIds(new Set());
                    }
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">
                      All confirmed ({rsvps.filter((r) => r.status === "confirmed" && !r.is_waitlist).length})
                    </SelectItem>
                    <SelectItem value="waitlisted">
                      Waitlisted ({rsvps.filter((r) => r.is_waitlist).length})
                    </SelectItem>
                    {payments.length > 0 && (
                      <SelectItem value="unpaid">
                        Unpaid players ({payments.filter((p) => p.payment_status !== "paid" && p.player_id !== session.court_payer_id).length})
                      </SelectItem>
                    )}
                    <SelectItem value="all_active">All active players ({allPlayers.length})</SelectItem>
                    <SelectItem value="individual">Individual selection</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Individual player checklist */}
              {msgRecipients === "individual" && (
                <div className="border rounded-md p-2 space-y-1 max-h-[160px] overflow-y-auto">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search players..."
                        className="w-full pl-7 pr-2 py-1 text-xs rounded border bg-background"
                        value={playerSearch}
                        onChange={(e) => setPlayerSearch(e.target.value)}
                      />
                    </div>
                    <button
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => {
                        const allIds = new Set(allPlayers.map((p) => p.id));
                        setSelectedPlayerIds(allIds);
                      }}
                    >
                      All
                    </button>
                    <button
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => setSelectedPlayerIds(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                  {allPlayers
                    .filter((p) => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()))
                    .map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={selectedPlayerIds.has(p.id)}
                          onChange={() => {
                            const next = new Set(selectedPlayerIds);
                            if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                            setSelectedPlayerIds(next);
                          }}
                          className="rounded"
                        />
                        <span className="truncate">{p.name}</span>
                        <span className="text-muted-foreground ml-auto">{p.player_type}</span>
                      </label>
                    ))}
                </div>
              )}
            </div>

            {/* Message Textarea */}
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-ring whitespace-pre-wrap"
              placeholder="Type your message..."
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
            />

            {/* Channel & Action Buttons */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {recipientPlayerIds.length} recipient{recipientPlayerIds.length !== 1 ? "s" : ""}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={msgChannel === "whatsapp" ? "default" : "outline"}
                      className={`h-6 text-xs px-2 ${msgChannel === "whatsapp" ? "bg-green-700 hover:bg-green-800" : ""}`}
                      onClick={() => setMsgChannel("whatsapp")}
                    >
                      WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      variant={msgChannel === "sms" ? "default" : "outline"}
                      className={`h-6 text-xs px-2 ${msgChannel === "sms" ? "bg-blue-700 hover:bg-blue-800" : ""}`}
                      onClick={() => setMsgChannel("sms")}
                    >
                      SMS
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(msgText.trim());
                    toast.success("Copied to clipboard");
                  }}
                  disabled={!msgText.trim()}
                >
                  <Copy className="mr-1 h-4 w-4" /> Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => {
                    const encoded = encodeURIComponent(msgText.trim());
                    window.open(`https://api.whatsapp.com/send?text=${encoded}`, "_blank");
                  }}
                  disabled={!msgText.trim()}
                >
                  <MessageCircle className="mr-1 h-4 w-4" /> WA Group
                </Button>
                <Button
                  size="sm"
                  className="bg-green-700 hover:bg-green-800 ml-auto"
                  onClick={handleSendMessage}
                  disabled={msgSending || recipientPlayerIds.length === 0 || !msgText.trim()}
                >
                  <Send className="mr-1 h-4 w-4" />
                  {msgSending ? "Sending..." : "Send"}
                </Button>
              </div>
            </div>

            {/* Recent message */}
            {lastNotification && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                Last sent: &quot;{lastNotification.message}...&quot; → {lastNotification.count} sent,{" "}
                {(() => {
                  const diff = Date.now() - new Date(lastNotification.sent_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })()}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Complete & Delete */}
      {session.status !== "completed" && session.status !== "cancelled" && (
        <div className="flex gap-2">
          {(session.status === "signups_closed" || session.status === "teams_published") && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowCompleteDialog(true)}
              disabled={actionLoading === "complete"}
            >
              Complete Session
            </Button>
          )}
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete Session
          </Button>
        </div>
      )}
      {(session.status === "completed" || session.status === "cancelled") && (
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Delete Session
        </Button>
      )}

      {/* Delete Session Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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

      {/* Remove Player Confirmation */}
      <Dialog open={removeConfirm !== null} onOpenChange={(open) => { if (!open) setRemoveConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Player</DialogTitle>
            <DialogDescription>
              Remove {removeConfirm?.name} from this session?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (removeConfirm) {
                handleRemovePlayer(removeConfirm.rsvpId, removeConfirm.name);
                setRemoveConfirm(null);
              }
            }}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
