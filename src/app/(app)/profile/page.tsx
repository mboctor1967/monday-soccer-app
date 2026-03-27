"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Star, CheckCircle, XCircle, HelpCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { Rsvp, Payment, Session } from "@/lib/types/database";

interface HistoryEntry {
  session: Session;
  rsvp: Rsvp;
  payment?: Payment;
}

export default function ProfilePage() {
  const { player, isAdmin, refreshPlayer } = useAuth();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (player) {
      setName(player.name);
      setEmail(player.email || "");
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  async function fetchHistory() {
    if (!player) return;

    const { data: rsvps } = await supabase
      .from("rsvps")
      .select("*, session:sessions(*)")
      .eq("player_id", player.id)
      .order("rsvp_at", { ascending: false })
      .limit(20);

    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .eq("player_id", player.id);

    const typedPayments = (payments || []) as Payment[];
    const entries: HistoryEntry[] = (rsvps || []).map((r: Record<string, unknown>) => ({
      session: r.session as unknown as Session,
      rsvp: r as unknown as Rsvp,
      payment: typedPayments.find((p: Payment) => p.session_id === (r.session as Session)?.id),
    }));

    setHistory(entries);
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

  const rsvpIcon: Record<string, React.ReactNode> = {
    confirmed: <CheckCircle className="h-4 w-4 text-green-600" />,
    absent: <XCircle className="h-4 w-4 text-red-500" />,
    maybe: <HelpCircle className="h-4 w-4 text-yellow-500" />,
  };

  if (isLoading || !player) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" />
      </div>
    );
  }

  const totalAttended = history.filter((h) => h.rsvp.status === "confirmed").length;
  const totalOwed = history.reduce((sum, h) => {
    if (h.payment && h.payment.payment_status !== "paid") {
      return sum + (h.payment.amount_due - h.payment.amount_paid);
    }
    return sum;
  }, 0);

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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsEditing(true)}
                  className="h-8 w-8"
                >
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => {
                      setName(player.name);
                      setEmail(player.email || "");
                      setIsEditing(false);
                    }}
                  >
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{totalAttended}</p>
            <p className="text-xs text-muted-foreground">Sessions Attended</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${totalOwed > 0 ? "text-red-600" : "text-green-700"}`}>
              ${totalOwed.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">Outstanding Balance</p>
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Session History</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div key={entry.rsvp.id} className="flex items-center justify-between border-b py-2 last:border-0 text-sm">
                  <div className="flex items-center gap-2">
                    {rsvpIcon[entry.rsvp.status]}
                    <span>
                      {entry.session?.date
                        ? new Date(entry.session.date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
                        : "N/A"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {entry.payment && (
                      <Badge variant={entry.payment.payment_status === "paid" ? "default" : "destructive"} className="text-xs">
                        {entry.payment.payment_status === "paid" ? "Paid" : `$${(entry.payment.amount_due - entry.payment.amount_paid).toFixed(2)} due`}
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
