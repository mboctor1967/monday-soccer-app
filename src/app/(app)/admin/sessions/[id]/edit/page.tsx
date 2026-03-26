"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function EditSessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    date: "",
    venue: "",
    start_time: "",
    end_time: "",
    format: "2t",
    court_cost: "",
    buffer_pct: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("sessions").select("*").eq("id", id).single();
      if (data) {
        setForm({
          date: data.date,
          venue: data.venue,
          start_time: data.start_time,
          end_time: data.end_time,
          format: data.format,
          court_cost: data.court_cost.toString(),
          buffer_pct: data.buffer_pct.toString(),
        });
      }
      setIsLoading(false);
    }
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSubmit() {
    setIsSubmitting(true);
    const { error } = await supabase.from("sessions").update({
      date: form.date,
      venue: form.venue,
      start_time: form.start_time,
      end_time: form.end_time,
      format: form.format as "2t" | "3t",
      court_cost: parseFloat(form.court_cost),
      buffer_pct: parseFloat(form.buffer_pct),
    }).eq("id", id);

    if (error) {
      toast.error("Failed to update session");
    } else {
      toast.success("Session updated");
      router.push(`/admin/sessions/${id}`);
    }
    setIsSubmitting(false);
  }

  if (isLoading) return <div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Edit Session</h2>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="space-y-1"><Label>Venue</Label><Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Start</Label><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div className="space-y-1"><Label>End</Label><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
          </div>
          <div className="space-y-1">
            <Label>Format</Label>
            <Select value={form.format} onValueChange={(v) => v && setForm({ ...form, format: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2t">2 Teams (10)</SelectItem>
                <SelectItem value="3t">3 Teams (15)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Court Cost ($)</Label><Input type="number" value={form.court_cost} onChange={(e) => setForm({ ...form, court_cost: e.target.value })} /></div>
            <div className="space-y-1"><Label>Buffer (%)</Label><Input type="number" value={form.buffer_pct} onChange={(e) => setForm({ ...form, buffer_pct: e.target.value })} /></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 bg-green-700 hover:bg-green-800">
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
