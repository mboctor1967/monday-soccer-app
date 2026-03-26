"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send } from "lucide-react";
import type { Session, Payment, Player } from "@/lib/types/database";

const TEMPLATES = {
  "pre-game": `Hey {name}, just a friendly reminder that your share for Monday's soccer is ${"{amount}"} . Please try to pay before the game. Thanks!`,
  "post-game": `Hi {name}, thanks for playing! Your outstanding balance is ${"{amount}"}. Please settle up when you can. Cheers!`,
};

export default function PaymentFollowUpPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [session, setSession] = useState<Session | null>(null);
  const [unpaidPayments, setUnpaidPayments] = useState<(Payment & { player?: Player })[]>([]);
  const [template, setTemplate] = useState<"pre-game" | "post-game">("pre-game");
  const [message, setMessage] = useState(TEMPLATES["pre-game"]);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data: sessionData } = await supabase.from("sessions").select("*").eq("id", id).single();
      setSession(sessionData as Session);

      const { data: payments } = await supabase
        .from("payments")
        .select("*, player:players(*)")
        .eq("session_id", id)
        .neq("payment_status", "paid");

      const filtered = (payments || [])
        .map((p: Record<string, unknown>) => ({ ...p, player: p.player as unknown as Player }) as Payment & { player?: Player })
        .filter((p) => p.player_id !== sessionData?.court_payer_id);

      setUnpaidPayments(filtered);
      setIsLoading(false);
    }
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSend() {
    setIsSending(true);

    for (const payment of unpaidPayments) {
      const outstanding = payment.amount_due - payment.amount_paid;
      const personalMessage = message
        .replace("{name}", payment.player?.name || "Player")
        .replace("{amount}", `$${outstanding.toFixed(2)}`);

      // Log the notification
      await supabase.from("notifications").insert({
        player_id: payment.player_id,
        session_id: session?.id || null,
        channel: "sms",
        message: personalMessage,
        sent_at: new Date().toISOString(),
        status: "queued",
      });

      // Send SMS via API
      try {
        await fetch("/api/notifications/send-sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mobile: payment.player?.mobile,
            message: personalMessage,
          }),
        });
      } catch {
        console.error("Failed to send SMS to", payment.player?.name);
      }
    }

    toast.success(`Follow-up sent to ${unpaidPayments.length} player(s)`);
    router.push(`/admin/sessions/${id}`);
    setIsSending(false);
  }

  if (isLoading) return <div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Payment Follow-up</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Message Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="space-y-1">
            <Label>Template</Label>
            <Select value={template} onValueChange={(v) => {
              if (!v) return;
              const val = v as "pre-game" | "post-game";
              setTemplate(val);
              setMessage(TEMPLATES[val]);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pre-game">Pre-game Reminder</SelectItem>
                <SelectItem value="post-game">Post-game Settle Up</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Message (editable)</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[100px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use {"{name}"} for player name and {"{amount}"} for outstanding amount.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recipients ({unpaidPayments.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {unpaidPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unpaid players (excluding Court Payer).</p>
          ) : (
            unpaidPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1 text-sm border-b last:border-0">
                <span>{p.player?.name}</span>
                <Badge variant="destructive" className="text-xs">
                  ${(p.amount_due - p.amount_paid).toFixed(2)} due
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.back()} className="flex-1">Cancel</Button>
        <Button
          onClick={handleSend}
          disabled={isSending || unpaidPayments.length === 0}
          className="flex-1 bg-green-700 hover:bg-green-800"
        >
          <Send className="mr-1 h-4 w-4" />
          {isSending ? "Sending..." : `Send to ${unpaidPayments.length} player(s)`}
        </Button>
      </div>
    </div>
  );
}
