"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { NotificationChannel } from "@/lib/types/database";

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

export default function AdminMessagesPage() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterChannel>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { router.push("/"); return; }
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, authLoading]);

  async function fetchNotifications() {
    const { data } = await supabase
      .from("notifications")
      .select("*, players(name), sessions(date)")
      .order("sent_at", { ascending: false });
    setNotifications((data as NotificationRow[] | null) || []);
    setIsLoading(false);
  }

  const filteredNotifications = filter === "all"
    ? notifications
    : notifications.filter((n) => n.channel === filter);

  function formatTimestamp(ts: string) {
    const d = new Date(ts);
    return d.toLocaleDateString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
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
      <h2 className="text-xl font-bold">Message Log</h2>

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
