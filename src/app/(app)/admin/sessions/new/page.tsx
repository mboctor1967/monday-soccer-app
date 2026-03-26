"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function NewSessionPage() {
  const { player } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getNextMonday = () => {
    const today = new Date();
    const day = today.getDay(); // 0=Sun, 1=Mon, ...
    const daysUntilMonday = (8 - day) % 7 || 7;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    const year = nextMonday.getFullYear();
    const month = String(nextMonday.getMonth() + 1).padStart(2, "0");
    const date = String(nextMonday.getDate()).padStart(2, "0");
    return `${year}-${month}-${date}`;
  };

  const [form, setForm] = useState({
    date: getNextMonday(),
    venue: "Hurstville Aquatic Centre",
    start_time: "20:45",
    end_time: "22:45",
    format: "2t" as "2t" | "3t",
    court_cost: "180",
    buffer_pct: "10",
  });

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  async function handleSubmit() {
    if (!form.date) { toast.error("Please select a date"); return; }
    if (!player) return;

    setIsSubmitting(true);

    const { data, error } = await supabase.from("sessions").insert({
      date: form.date,
      venue: form.venue,
      start_time: form.start_time,
      end_time: form.end_time,
      format: form.format,
      status: "upcoming",
      court_cost: parseFloat(form.court_cost),
      buffer_pct: parseFloat(form.buffer_pct),
      court_payer_id: player.id,
      created_by: player.id,
      closed_at: null,
    }).select().single();

    if (error) {
      toast.error("Failed to create session");
      console.error(error);
    } else {
      // Auto-add the session creator as confirmed
      await supabase.from("rsvps").insert({
        session_id: data.id,
        player_id: player.id,
        status: "confirmed",
        rsvp_at: new Date().toISOString(),
        is_waitlist: false,
        waitlist_position: null,
        promoted_at: null,
      });

      toast.success("Session created!");
      router.push(`/admin/sessions/${data.id}`);
    }
    setIsSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Create Session</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" value={form.date} onChange={(e) => handleChange("date", e.target.value)} />
            {form.date && (
              <p className="text-sm text-muted-foreground">
                {new Date(form.date + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Venue</Label>
            <Input value={form.venue} onChange={(e) => handleChange("venue", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start Time</Label>
              <Input type="time" value={form.start_time} onChange={(e) => handleChange("start_time", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>End Time</Label>
              <Input type="time" value={form.end_time} onChange={(e) => handleChange("end_time", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Format</Label>
            <Select value={form.format} onValueChange={(v) => v && handleChange("format", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2t">2 Teams (10 players)</SelectItem>
                <SelectItem value="3t">3 Teams (15 players)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Court Cost ($)</Label>
              <Input type="number" value={form.court_cost} onChange={(e) => handleChange("court_cost", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Buffer (%)</Label>
              <Input type="number" value={form.buffer_pct} onChange={(e) => handleChange("buffer_pct", e.target.value)} />
            </div>
          </div>

          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">Cost Preview</p>
            <p className="text-muted-foreground">
              Total: ${(parseFloat(form.court_cost || "0") * (1 + parseFloat(form.buffer_pct || "0") / 100)).toFixed(2)}
              {" | "}
              Per player: ${(parseFloat(form.court_cost || "0") * (1 + parseFloat(form.buffer_pct || "0") / 100) / (form.format === "3t" ? 15 : 10)).toFixed(2)}
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 bg-green-700 hover:bg-green-800">
              {isSubmitting ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
