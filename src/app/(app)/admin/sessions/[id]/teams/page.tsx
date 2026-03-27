"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Shuffle, Check, Star, ArrowLeftRight } from "lucide-react";
import { generateBalancedTeams, getBalanceScoreFromProposals, type TeamProposal } from "@/lib/team-balancer";
import type { Session, Player } from "@/lib/types/database";

const BIB_OPTIONS = ["White", "Black", "Red", "Blue", "Yellow", "Green"];

export default function TeamGenerationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [session, setSession] = useState<Session | null>(null);
  const [confirmedPlayers, setConfirmedPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<TeamProposal[]>([]);
  const [dragPlayer, setDragPlayer] = useState<{ teamIndex: number; playerIndex: number } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const { data: sessionData } = await supabase.from("sessions").select("*").eq("id", id).single();
    setSession(sessionData as Session);

    const { data: rsvps } = await supabase
      .from("rsvps")
      .select("*, player:players(*)")
      .eq("session_id", id)
      .eq("status", "confirmed")
      .eq("is_waitlist", false);

    const players = (rsvps || []).map((r: Record<string, unknown>) => r.player as unknown as Player);
    setConfirmedPlayers(players);

    if (sessionData) {
      const numTeams = sessionData.format === "3t" ? 3 : 2;
      setTeams(generateBalancedTeams(players, numTeams as 2 | 3));
    }
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleRegenerate() {
    if (!session) return;
    const numTeams = session.format === "3t" ? 3 : 2;
    setTeams(generateBalancedTeams(confirmedPlayers, numTeams as 2 | 3));
    toast.success("Teams reshuffled");
  }

  function handleSwap(fromTeam: number, fromPlayer: number, toTeam: number, toPlayer: number) {
    const newTeams = teams.map((t) => ({ ...t, players: [...t.players] }));
    const temp = newTeams[fromTeam].players[fromPlayer];
    newTeams[fromTeam].players[fromPlayer] = newTeams[toTeam].players[toPlayer];
    newTeams[toTeam].players[toPlayer] = temp;

    // Recalculate averages
    newTeams.forEach((t) => {
      t.avgSkill = t.players.reduce((s, p) => s + p.skill_rating, 0) / t.players.length;
    });
    setTeams(newTeams);
  }

  function handleBibChange(teamIndex: number, color: string) {
    const newTeams = [...teams];
    newTeams[teamIndex] = { ...newTeams[teamIndex], bibColor: color };
    setTeams(newTeams);
  }

  async function handlePublish() {
    if (!session) return;
    setIsPublishing(true);

    // Delete existing teams for this session
    const { data: existingTeams } = await supabase.from("teams").select("id").eq("session_id", id);
    if (existingTeams && existingTeams.length > 0) {
      const teamIds = existingTeams.map((t) => t.id);
      await supabase.from("team_players").delete().in("team_id", teamIds);
      await supabase.from("teams").delete().eq("session_id", id);
    }

    // Create new teams
    for (const team of teams) {
      const { data: teamData } = await supabase.from("teams").insert({
        session_id: session.id,
        team_name: team.teamName,
        bib_color: team.bibColor,
        avg_skill_rating: team.avgSkill,
        published_at: new Date().toISOString(),
      }).select().single();

      if (teamData) {
        const teamPlayers = team.players.map((p) => ({
          team_id: teamData.id,
          player_id: p.id,
        }));
        await supabase.from("team_players").insert(teamPlayers);
      }
    }

    await supabase.from("sessions").update({ status: "teams_published" }).eq("id", id);

    // Auto-create payment records for all confirmed players
    const maxPlayers = session.format === "3t" ? 15 : 10;
    const costPerPlayer = session.court_cost * (1 + session.buffer_pct / 100) / maxPlayers;
    const allTeamPlayerIds = teams.flatMap((t) => t.players.map((p) => p.id));

    // Check for existing payments to avoid duplicates
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("player_id")
      .eq("session_id", session.id);
    const existingPlayerIds = new Set((existingPayments || []).map((p) => p.player_id));

    const newPayments = allTeamPlayerIds
      .filter((playerId) => !existingPlayerIds.has(playerId))
      .map((playerId) => {
        const isCourtPayer = playerId === session.court_payer_id;
        return {
          session_id: session.id,
          player_id: playerId,
          amount_due: costPerPlayer,
          amount_paid: isCourtPayer ? costPerPlayer : 0,
          payment_status: (isCourtPayer ? "paid" : "unpaid") as "paid" | "unpaid",
          payment_method: null,
          notes: null,
        };
      });

    if (newPayments.length > 0) {
      await supabase.from("payments").insert(newPayments);
    }

    toast.success(`Teams published! ${newPayments.length} payment records created.`);
    router.push(`/admin/sessions/${id}`);
    setIsPublishing(false);
  }

  const bibColors: Record<string, string> = {
    White: "bg-white text-black border border-gray-300",
    Black: "bg-gray-900 text-white",
    Red: "bg-red-600 text-white",
    Blue: "bg-blue-600 text-white",
    Yellow: "bg-yellow-400 text-black",
    Green: "bg-green-600 text-white",
  };

  if (isLoading || !session) {
    return <div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-green-700 border-t-transparent" /></div>;
  }

  const balanceScore = getBalanceScoreFromProposals(teams);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Team Generator</h2>
        <Badge variant={balanceScore <= 0.5 ? "default" : "destructive"}>
          Balance: {balanceScore.toFixed(2)}
        </Badge>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleRegenerate}>
          <Shuffle className="mr-1 h-4 w-4" /> Reshuffle
        </Button>
        <Button size="sm" onClick={handlePublish} disabled={isPublishing} className="bg-green-700 hover:bg-green-800">
          <Check className="mr-1 h-4 w-4" /> {isPublishing ? "Publishing..." : "Publish Teams"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Tap a player then tap another player on a different team to swap them.
      </p>

      {teams.map((team, teamIndex) => (
        <Card key={teamIndex}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-6 w-6 rounded-full ${bibColors[team.bibColor] || "bg-gray-300"}`} />
                <CardTitle className="text-base">Team {team.teamName}</CardTitle>
                <span className="text-xs text-muted-foreground">Avg: {team.avgSkill.toFixed(1)}</span>
              </div>
              <Select value={team.bibColor} onValueChange={(v) => v && handleBibChange(teamIndex, v)}>
                <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BIB_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {team.players.map((player, playerIndex) => (
              <div
                key={player.id}
                className={`flex items-center justify-between py-1.5 px-2 -mx-2 rounded text-sm cursor-pointer transition-colors ${
                  dragPlayer?.teamIndex === teamIndex && dragPlayer?.playerIndex === playerIndex
                    ? "bg-green-100 ring-2 ring-green-500"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => {
                  if (!dragPlayer) {
                    setDragPlayer({ teamIndex, playerIndex });
                  } else if (dragPlayer.teamIndex !== teamIndex) {
                    handleSwap(dragPlayer.teamIndex, dragPlayer.playerIndex, teamIndex, playerIndex);
                    setDragPlayer(null);
                  } else {
                    setDragPlayer(null);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  {dragPlayer && dragPlayer.teamIndex !== teamIndex && (
                    <ArrowLeftRight className="h-3 w-3 text-green-600" />
                  )}
                  <span>{player.name}</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: player.skill_rating }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
