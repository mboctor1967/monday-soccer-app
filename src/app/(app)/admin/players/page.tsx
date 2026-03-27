"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Plus, Search, Star, Upload, UserX, UserCheck, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import type { Player } from "@/lib/types/database";

export default function AdminPlayersPage() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    player_type: "regular" as "regular" | "casual",
    skill_rating: "3",
    is_admin: false,
  });

  useEffect(() => {
    if (!isAdmin) { router.push("/"); return; }
    fetchPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function fetchPlayers() {
    const { data } = await supabase
      .from("players")
      .select("*")
      .order("name");
    setPlayers((data || []) as Player[]);
    setIsLoading(false);
  }

  function resetForm() {
    setForm({ name: "", mobile: "", email: "", player_type: "regular", skill_rating: "3", is_admin: false });
    setEditPlayer(null);
  }

  function openEdit(player: Player) {
    setForm({
      name: player.name,
      mobile: player.mobile,
      email: player.email || "",
      player_type: player.player_type,
      skill_rating: player.skill_rating.toString(),
      is_admin: player.is_admin,
    });
    setEditPlayer(player);
    setShowAdd(true);
  }

  async function handleSave() {
    const formattedMobile = form.mobile.startsWith("+61")
      ? form.mobile
      : `+61${form.mobile.replace(/^0/, "").replace(/\D/g, "")}`;

    const data = {
      name: form.name,
      mobile: formattedMobile,
      email: form.email || null,
      player_type: form.player_type,
      skill_rating: parseInt(form.skill_rating),
      is_admin: form.is_admin,
      is_active: true,
      auth_user_id: editPlayer?.auth_user_id || null,
    };

    if (editPlayer) {
      const { error } = await supabase.from("players").update(data).eq("id", editPlayer.id);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Player updated");
    } else {
      const { error } = await supabase.from("players").insert(data);
      if (error) { toast.error(error.message); return; }
      toast.success("Player added");
    }

    setShowAdd(false);
    resetForm();
    fetchPlayers();
  }

  const [deletePlayer, setDeletePlayer] = useState<Player | null>(null);

  async function handleDeletePlayer() {
    if (!deletePlayer) return;
    // Delete related data first
    const { data: rsvps } = await supabase.from("rsvps").select("id").eq("player_id", deletePlayer.id);
    if (rsvps && rsvps.length > 0) {
      await supabase.from("rsvps").delete().eq("player_id", deletePlayer.id);
    }
    await supabase.from("payments").delete().eq("player_id", deletePlayer.id);
    const { error } = await supabase.from("players").delete().eq("id", deletePlayer.id);
    if (error) {
      toast.error("Failed to delete player. They may be referenced in sessions.");
    } else {
      toast.success(`${deletePlayer.name} deleted`);
    }
    setDeletePlayer(null);
    fetchPlayers();
  }

  async function handleToggleActive(player: Player) {
    await supabase.from("players").update({ is_active: !player.is_active }).eq("id", player.id);
    toast.success(player.is_active ? "Player deactivated" : "Player reactivated");
    fetchPlayers();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

    let imported = 0;
    for (const row of rows) {
      const name = row["Name"] || row["name"] || "";
      const mobile = row["Mobile"] || row["mobile"] || row["Phone"] || row["phone"] || "";
      const email = row["Email"] || row["email"] || "";
      const type = (row["Type"] || row["type"] || "regular").toLowerCase();
      const skill = parseInt(row["Skill"] || row["skill_rating"] || row["Skill Rating"] || "3");

      if (!name || !mobile) continue;

      const formattedMobile = mobile.startsWith("+61")
        ? mobile
        : `+61${mobile.toString().replace(/^0/, "").replace(/\D/g, "")}`;

      const { error } = await supabase.from("players").insert({
        name,
        mobile: formattedMobile,
        email: email || null,
        player_type: type === "casual" ? "casual" : "regular",
        skill_rating: isNaN(skill) ? 3 : Math.min(5, Math.max(1, skill)),
        is_admin: false,
        is_active: true,
        auth_user_id: null,
      });

      if (!error) imported++;
    }

    toast.success(`Imported ${imported} player(s)`);
    fetchPlayers();
    if (fileRef.current) fileRef.current.value = "";
  }

  const filtered = players.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.mobile.includes(search)
  );

  const activePlayers = filtered.filter((p) => p.is_active);
  const inactivePlayers = filtered.filter((p) => !p.is_active);

  if (isLoading) return <div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Players ({activePlayers.length})</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch("/api/export/csv");
                if (!res.ok) throw new Error("Export failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "monday-soccer-export.csv";
                a.click();
                URL.revokeObjectURL(url);
                toast.success("CSV exported");
              } catch {
                toast.error("Failed to export CSV");
              }
            }}
          >
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> Import
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <Dialog open={showAdd} onOpenChange={(v) => { setShowAdd(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-green-700 hover:bg-green-800">
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editPlayer ? "Edit Player" : "Add Player"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-1">
                  <Label>Mobile</Label>
                  <div className="flex gap-2">
                    <div className="flex items-center rounded-md border bg-muted px-3 text-sm">+61</div>
                    <Input value={form.mobile.replace("+61", "")} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="4XX XXX XXX" />
                  </div>
                </div>
                <div className="space-y-1"><Label>Email (optional)</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Type</Label>
                    <Select value={form.player_type} onValueChange={(v) => v && setForm({ ...form, player_type: v as "regular" | "casual" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">Regular</SelectItem>
                        <SelectItem value="casual">Casual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Skill (1-5)</Label>
                    <Select value={form.skill_rating} onValueChange={(v) => v && setForm({ ...form, skill_rating: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={n.toString()}>{n} - {["Beginner", "Below Avg", "Average", "Above Avg", "Elite"][n - 1]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} />
                  Admin access
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setShowAdd(false); resetForm(); }} className="flex-1">Cancel</Button>
                  <Button onClick={handleSave} className="flex-1 bg-green-700 hover:bg-green-800">Save</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search players..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Active Players */}
      {activePlayers.map((player) => (
        <Card
          key={player.id}
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => openEdit(player)}
        >
          <CardContent className="flex items-center justify-between p-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{player.name}</span>
                <Badge variant="outline" className="text-xs">{player.player_type}</Badge>
                {player.is_admin && <Badge className="text-xs bg-purple-100 text-purple-800">Admin</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{player.mobile}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`h-3 w-3 ${i < player.skill_rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); handleToggleActive(player); }}
                title="Deactivate"
              >
                <UserX className="h-4 w-4 text-red-500" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); setDeletePlayer(player); }}
                title="Delete"
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Delete Confirmation */}
      <Dialog open={!!deletePlayer} onOpenChange={(v) => { if (!v) setDeletePlayer(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Player</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deletePlayer?.name}? This will also remove all their RSVPs and payment records. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeletePlayer(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeletePlayer}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inactive Players */}
      {inactivePlayers.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-muted-foreground pt-2">Inactive ({inactivePlayers.length})</h3>
          {inactivePlayers.map((player) => (
            <Card key={player.id} className="opacity-60">
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <span className="text-sm">{player.name}</span>
                  <p className="text-xs text-muted-foreground">{player.mobile}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => handleToggleActive(player)}
                >
                  <UserCheck className="h-4 w-4 text-green-600 mr-1" /> Reactivate
                </Button>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
