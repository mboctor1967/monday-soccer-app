"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { ChevronDown, ChevronUp, Send, Search, Copy } from "lucide-react";
import type { NotificationChannel, Player, Session } from "@/lib/types/database";

interface NotificationRow {
  id: string;
  player_id: string;
  session_id: string | null;
  channel: NotificationChannel;
  message: string;
  sent_at: string;
  status: string;
  created_at: string;
  players: { name: string } | null;
  sessions: { date: string } | null;
}

const channelColors: Record<NotificationChannel, string> = {
  sms: "bg-blue-100 text-blue-800",
  email: "bg-purple-100 text-purple-800",
  push: "bg-orange-100 text-orange-800",
  whatsapp: "bg-green-100 text-green-800",
};

const channelLabels: Record<NotificationChannel, string> = {
  sms: "SMS",
  email: "Email",
  push: "Push",
  whatsapp: "WhatsApp",
};

type FilterChannel = "all" | NotificationChannel;

type RecipientFilter =
  | "all_active"
  | "admins"
  | "regular"
  | "casual"
  | "inactive"
  | "individual"
  | `session_confirmed_${string}`
  | `session_waitlist_${string}`
  | `session_unpaid_${string}`;

export default function AdminMessagesPage() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [sessionRsvps, setSessionRsvps] = useState<Record<string, { player_id: string; is_waitlist: boolean }[]>>({});
  const [sessionPayments, setSessionPayments] = useState<Record<string, { player_id: string; payment_status: string }[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterChannel>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Send message state
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>("all_active");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [messageText, setMessageText] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [sendChannel, setSendChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!isAdmin) { router.push("/"); return; }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function fetchAll() {
    const [notifRes, playersRes, sessionsRes, rsvpsRes, paymentsRes] = await Promise.all([
      supabase.from("notifications").select("*, players(name), sessions(date)").order("sent_at", { ascending: false }),
      supabase.from("players").select("*").order("name"),
      supabase.from("sessions").select("*").order("date", { ascending: false }).limit(10),
      supabase.from("rsvps").select("session_id, player_id, is_waitlist, status"),
      supabase.from("payments").select("session_id, player_id, payment_status"),
    ]);

    setNotifications((notifRes.data as NotificationRow[] | null) || []);
    setAllPlayers((playersRes.data || []) as Player[]);
    setAllSessions((sessionsRes.data || []) as Session[]);

    // Group rsvps by session
    const rsvpMap: Record<string, { player_id: string; is_waitlist: boolean }[]> = {};
    (rsvpsRes.data || []).forEach((r: { session_id: string; player_id: string; is_waitlist: boolean; status: string }) => {
      if (r.status !== "confirmed") return;
      if (!rsvpMap[r.session_id]) rsvpMap[r.session_id] = [];
      rsvpMap[r.session_id].push({ player_id: r.player_id, is_waitlist: r.is_waitlist });
    });
    setSessionRsvps(rsvpMap);

    // Group payments by session
    const payMap: Record<string, { player_id: string; payment_status: string }[]> = {};
    (paymentsRes.data || []).forEach((p: { session_id: string; player_id: string; payment_status: string }) => {
      if (!payMap[p.session_id]) payMap[p.session_id] = [];
      payMap[p.session_id].push({ player_id: p.player_id, payment_status: p.payment_status });
    });
    setSessionPayments(payMap);

    setIsLoading(false);
  }

  // Compute matching players based on filter
  const matchingPlayers = useMemo(() => {
    let ids: string[] = [];

    if (recipientFilter === "all_active") {
      ids = allPlayers.filter((p) => p.is_active).map((p) => p.id);
    } else if (recipientFilter === "admins") {
      ids = allPlayers.filter((p) => p.is_admin && p.is_active).map((p) => p.id);
    } else if (recipientFilter === "regular") {
      ids = allPlayers.filter((p) => p.player_type === "regular" && p.is_active).map((p) => p.id);
    } else if (recipientFilter === "casual") {
      ids = allPlayers.filter((p) => p.player_type === "casual" && p.is_active).map((p) => p.id);
    } else if (recipientFilter === "inactive") {
      ids = allPlayers.filter((p) => !p.is_active).map((p) => p.id);
    } else if (recipientFilter === "individual") {
      return []; // manual selection, don't auto-select
    } else if (recipientFilter.startsWith("session_confirmed_")) {
      const sessionId = recipientFilter.replace("session_confirmed_", "");
      ids = (sessionRsvps[sessionId] || []).filter((r) => !r.is_waitlist).map((r) => r.player_id);
    } else if (recipientFilter.startsWith("session_waitlist_")) {
      const sessionId = recipientFilter.replace("session_waitlist_", "");
      ids = (sessionRsvps[sessionId] || []).filter((r) => r.is_waitlist).map((r) => r.player_id);
    } else if (recipientFilter.startsWith("session_unpaid_")) {
      const sessionId = recipientFilter.replace("session_unpaid_", "");
      ids = (sessionPayments[sessionId] || []).filter((p) => p.payment_status !== "paid").map((p) => p.player_id);
    }

    return ids;
  }, [recipientFilter, allPlayers, sessionRsvps, sessionPayments]);

  // When filter changes, auto-select all matching players
  useEffect(() => {
    if (recipientFilter !== "individual") {
      setSelectedPlayerIds(new Set(matchingPlayers));
    }
  }, [matchingPlayers, recipientFilter]);

  function togglePlayer(id: string) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (selectedPlayerIds.size === 0 || !messageText.trim()) {
      toast.error("Select recipients and enter a message");
      return;
    }
    setIsSending(true);

    try {
      const res = await fetch("/api/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText.trim(),
          player_ids: Array.from(selectedPlayerIds),
          session_id: null,
          channel: sendChannel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Sent to ${data.sent}/${data.total} players`);
      setMessageText("");
      setSelectedPlayerIds(new Set());
      setRecipientFilter("all_active");
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
    setIsSending(false);
  }

  const filteredNotifications = filter === "all"
    ? notifications
    : notifications.filter((n) => n.channel === filter);

  // Players to show in the checklist
  const checklistPlayers = recipientFilter === "individual"
    ? allPlayers.filter((p) => p.is_active)
    : allPlayers.filter((p) => matchingPlayers.includes(p.id));

  function formatTimestamp(ts: string) {
    const d = new Date(ts);
    return d.toLocaleDateString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function formatSessionLabel(s: Session) {
    return new Date(s.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
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
      <h2 className="text-xl font-bold">Messages</h2>

      {/* Send Message */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" /> Send Message
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {/* Recipient filter */}
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Select value={recipientFilter} onValueChange={(v) => setRecipientFilter(v as RecipientFilter)}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active">All active players</SelectItem>
                <SelectItem value="admins">Admins only</SelectItem>
                <SelectItem value="regular">Regular players</SelectItem>
                <SelectItem value="casual">Casual players</SelectItem>
                <SelectItem value="inactive">Inactive players</SelectItem>
                <SelectItem value="individual">Pick individually</SelectItem>
                {allSessions.filter((s) => s.status !== "cancelled").slice(0, 5).map((s) => (
                  <SelectItem key={`conf_${s.id}`} value={`session_confirmed_${s.id}`}>
                    Confirmed in {formatSessionLabel(s)}
                  </SelectItem>
                ))}
                {allSessions.filter((s) => s.status !== "cancelled").slice(0, 5).map((s) => {
                  const wl = (sessionRsvps[s.id] || []).filter((r) => r.is_waitlist).length;
                  if (wl === 0) return null;
                  return (
                    <SelectItem key={`wl_${s.id}`} value={`session_waitlist_${s.id}`}>
                      Waitlisted in {formatSessionLabel(s)} ({wl})
                    </SelectItem>
                  );
                })}
                {allSessions.filter((s) => s.status !== "cancelled").slice(0, 5).map((s) => {
                  const unpaid = (sessionPayments[s.id] || []).filter((p) => p.payment_status !== "paid").length;
                  if (unpaid === 0) return null;
                  return (
                    <SelectItem key={`unpaid_${s.id}`} value={`session_unpaid_${s.id}`}>
                      Unpaid in {formatSessionLabel(s)} ({unpaid})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Player search + checklist */}
          <div className="space-y-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search players..."
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{selectedPlayerIds.size} selected</span>
                <div className="flex gap-2">
                  <button
                    className="text-xs text-green-700 hover:underline"
                    onClick={() => {
                      const visible = (recipientFilter === "individual" ? allPlayers.filter((p) => p.is_active) : checklistPlayers)
                        .filter((p) => !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase()));
                      setSelectedPlayerIds(new Set(visible.map((p) => p.id)));
                    }}
                  >
                    Select all
                  </button>
                  <button
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => setSelectedPlayerIds(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {(() => {
                const playersToShow = recipientFilter === "individual"
                  ? allPlayers.filter((p) => p.is_active)
                  : checklistPlayers;
                const filtered = playerSearch
                  ? playersToShow.filter((p) => p.name.toLowerCase().includes(playerSearch.toLowerCase()))
                  : playersToShow;
                return filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">No players match</p>
                ) : (
                  filtered.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={selectedPlayerIds.has(p.id)}
                        onChange={() => togglePlayer(p.id)}
                        className="rounded"
                      />
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{p.player_type}</span>
                    </label>
                  ))
                );
              })()}
            </div>
          </div>

          {/* Generate session summary */}
          <div className="space-y-1">
            <Label className="text-xs">Generate session summary</Label>
            <Select onValueChange={(sessionId) => {
              const session = allSessions.find((s) => s.id === sessionId);
              if (!session) return;

              const rsvps = sessionRsvps[sessionId] || [];
              const payments = sessionPayments[sessionId] || [];
              const confirmedIds = rsvps.filter((r) => !r.is_waitlist).map((r) => r.player_id);
              const waitlistIds = rsvps.filter((r) => r.is_waitlist).map((r) => r.player_id);
              const confirmedNames = confirmedIds.map((id) => allPlayers.find((p) => p.id === id)?.name).filter(Boolean);
              const waitlistNames = waitlistIds.map((id) => allPlayers.find((p) => p.id === id)?.name).filter(Boolean);
              const maxPlayers = session.format === "3t" ? 15 : 10;
              const paidCount = payments.filter((p) => p.payment_status === "paid").length;
              const unpaidNames = payments
                .filter((p) => p.payment_status !== "paid")
                .map((p) => allPlayers.find((pl) => pl.id === p.player_id)?.name)
                .filter(Boolean);

              const sessionDate = new Date(session.date).toLocaleDateString("en-AU", {
                weekday: "long", day: "numeric", month: "long",
              });

              let draft = `⚽ *Monday Night Soccer*\n`;
              draft += `📅 ${sessionDate}\n`;
              draft += `📍 ${session.venue}\n`;
              draft += `🕗 ${session.start_time} – ${session.end_time}\n`;
              draft += `🏟️ ${session.format === "3t" ? "3 teams (15 players)" : "2 teams (10 players)"}\n\n`;

              draft += `✅ *Confirmed (${confirmedNames.length}/${maxPlayers}):*\n`;
              confirmedNames.forEach((name, i) => { draft += `${i + 1}. ${name}\n`; });

              if (waitlistNames.length > 0) {
                draft += `\n⏳ *Waitlist (${waitlistNames.length}):*\n`;
                waitlistNames.forEach((name, i) => { draft += `${i + 1}. ${name}\n`; });
              }

              if (confirmedNames.length < maxPlayers) {
                draft += `\n🔔 *${maxPlayers - confirmedNames.length} spot${maxPlayers - confirmedNames.length !== 1 ? "s" : ""} available!*\n`;
              }

              if (payments.length > 0) {
                draft += `\n💰 *Payments:* ${paidCount}/${payments.length} paid`;
                if (unpaidNames.length > 0) {
                  draft += `\nOutstanding: ${unpaidNames.join(", ")}`;
                }
                draft += "\n";
              }

              draft += `\n👉 RSVP in the app: ${process.env.NEXT_PUBLIC_APP_URL || "https://monday-soccer-app.vercel.app"}`;

              setMessageText(draft);
            }}>
              <SelectTrigger className="text-sm h-8"><SelectValue placeholder="Pick a session to generate summary..." /></SelectTrigger>
              <SelectContent>
                {allSessions.filter((s) => s.status !== "cancelled").slice(0, 10).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {formatSessionLabel(s)} — {s.status.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-ring whitespace-pre-wrap"
              placeholder="Type your message or generate a session summary above..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
          </div>

          {/* Channel + Send */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedPlayerIds.size} recipient{selectedPlayerIds.size !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={sendChannel === "whatsapp" ? "default" : "outline"}
                  className={`h-6 text-xs px-2 ${sendChannel === "whatsapp" ? "bg-green-700 hover:bg-green-800" : ""}`}
                  onClick={() => setSendChannel("whatsapp")}
                >
                  WhatsApp
                </Button>
                <Button
                  size="sm"
                  variant={sendChannel === "sms" ? "default" : "outline"}
                  className={`h-6 text-xs px-2 ${sendChannel === "sms" ? "bg-blue-700 hover:bg-blue-800" : ""}`}
                  onClick={() => setSendChannel("sms")}
                >
                  SMS
                </Button>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(messageText.trim());
                  toast.success("Copied to clipboard");
                }}
                disabled={!messageText.trim()}
              >
                <Copy className="mr-1 h-4 w-4" /> Copy
              </Button>
              <Button
                size="sm"
                className="bg-green-700 hover:bg-green-800"
                onClick={handleSend}
                disabled={isSending || selectedPlayerIds.size === 0 || !messageText.trim()}
              >
                <Send className="mr-1 h-4 w-4" />
                {isSending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message History */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">History ({filteredNotifications.length})</CardTitle>
            <div className="flex gap-1">
              {(["all", "whatsapp", "sms", "email", "push"] as FilterChannel[]).map((ch) => (
                <Button
                  key={ch}
                  size="sm"
                  variant={filter === ch ? "default" : "ghost"}
                  className={`h-6 text-xs px-2 ${filter === ch ? "bg-green-700 hover:bg-green-800" : ""}`}
                  onClick={() => setFilter(ch)}
                >
                  {ch === "all" ? "All" : channelLabels[ch]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {filteredNotifications.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">No messages sent yet.</p>
          ) : (
            <div className="space-y-2">
              {filteredNotifications.map((notif) => {
                const isExpanded = expandedId === notif.id;
                return (
                  <div
                    key={notif.id}
                    className="border-b last:border-0 pb-2 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : notif.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm">{notif.players?.name || "Unknown"}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 ${channelColors[notif.channel]}`}>
                            {channelLabels[notif.channel]}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              notif.status === "sent" || notif.status === "delivered"
                                ? "border-green-300 text-green-700"
                                : notif.status === "failed"
                                ? "border-red-300 text-red-700"
                                : ""
                            }`}
                          >
                            {notif.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTimestamp(notif.sent_at)}
                          {notif.sessions?.date && (
                            <span> · {new Date(notif.sessions.date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 pt-1">
                        {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                        {notif.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
