"use client";

import { useState } from "react";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Send } from "lucide-react";

export default function AdminSettingsPage() {
  const { isAdmin } = useAuth();
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function handleBroadcast() {
    if (!broadcastMessage.trim()) { toast.error("Enter a message"); return; }
    setIsSending(true);

    try {
      const res = await fetch("/api/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: broadcastMessage }),
      });
      const data = await res.json();

      if (res.ok) {
        toast.success(`Broadcast sent to ${data.sent}/${data.total} players`);
        setBroadcastMessage("");
      } else {
        toast.error(data.error);
      }
    } catch {
      toast.error("Failed to send broadcast");
    }
    setIsSending(false);
  }

  async function handleExportData() {
    try {
      const res = await fetch("/api/export/csv");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `monday-soccer-export-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed");
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Settings</h2>

      {/* Broadcast */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Broadcast Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="space-y-1">
            <Label>Message to all players</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px]"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="Type your message..."
            />
          </div>
          <Button onClick={handleBroadcast} disabled={isSending} size="sm" className="bg-green-700 hover:bg-green-800">
            <Send className="mr-1 h-4 w-4" /> {isSending ? "Sending..." : "Send to All Players"}
          </Button>
        </CardContent>
      </Card>

      {/* Export */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Data Export</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-sm text-muted-foreground mb-2">Export attendance and payment history to CSV.</p>
          <Button variant="outline" size="sm" onClick={handleExportData}>
            Download CSV Export
          </Button>
        </CardContent>
      </Card>

      {/* App Info */}
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          <p>Monday Night Soccer v1.0</p>
          <p>Court: Flat Rock Indoor Soccer</p>
          <p>Session: Every Monday, 8:45 PM - 10:45 PM</p>
        </CardContent>
      </Card>
    </div>
  );
}
