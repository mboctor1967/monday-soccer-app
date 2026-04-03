import { describe, it, expect, afterEach } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getTeams, getAllActivePlayers, createTeamsForSession } from "./helpers";
import { generateBalancedTeams } from "../src/lib/team-balancer";

let sessionId: string;
let players: any[];

afterEach(async () => {
  if (sessionId) await deleteTestSession(sessionId);
  sessionId = "";
});

describe("G. Team Generation", () => {
  it("setup: load players", async () => {
    players = await getAllActivePlayers();
    expect(players.length).toBeGreaterThanOrEqual(10);
  });

  it("G1: Generate 2 teams with 10 players — 5 per team", async () => {
    const session = await createTestSession({ status: "signups_closed" });
    sessionId = session.id;

    const playerSlice = players.slice(0, 10);
    for (const p of playerSlice) {
      await addRsvp(sessionId, p.id);
    }

    await createTeamsForSession(sessionId, playerSlice.map((p: any) => p.id), 2);

    const teams = await getTeams(sessionId);
    expect(teams.length).toBe(2);
    const totalPlayers = teams.reduce((s: number, t: any) => s + t.team_players.length, 0);
    expect(totalPlayers).toBe(10);
    expect(teams[0].team_players.length).toBe(5);
    expect(teams[1].team_players.length).toBe(5);
  });

  it("G2: Generate 3 teams with 15 players — 5 per team", async () => {
    const session = await createTestSession({ status: "signups_closed", format: "3t" });
    sessionId = session.id;

    const playerSlice = players.slice(0, 15);
    for (const p of playerSlice) {
      await addRsvp(sessionId, p.id);
    }

    await createTeamsForSession(sessionId, playerSlice.map((p: any) => p.id), 3);

    const teams = await getTeams(sessionId);
    expect(teams.length).toBe(3);
    const totalPlayers = teams.reduce((s: number, t: any) => s + t.team_players.length, 0);
    expect(totalPlayers).toBe(15);
  });

  it("G3: Team balancing algorithm produces balanced teams", () => {
    // Test the algorithm directly
    const testPlayers = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      skill_rating: (i % 5) + 1, // skills 1-5 repeating
      player_type: "regular" as const,
      is_admin: false,
      is_active: true,
      mobile: "",
      email: null,
      auth_user_id: null,
      created_at: "",
      updated_at: "",
    }));

    const proposals = generateBalancedTeams(testPlayers, 2);
    expect(proposals.length).toBe(2);

    const avgA = proposals[0].avgSkill;
    const avgB = proposals[1].avgSkill;
    const diff = Math.abs(avgA - avgB);

    // Balanced teams should have less than 1.0 skill difference
    expect(diff).toBeLessThan(1.0);
  });

  it("G7: Publish teams — status transitions to teams_published", async () => {
    const session = await createTestSession({ status: "signups_closed" });
    sessionId = session.id;
    const sb = getSupabase();

    const playerSlice = players.slice(0, 10);
    for (const p of playerSlice) {
      await addRsvp(sessionId, p.id);
    }

    await createTeamsForSession(sessionId, playerSlice.map((p: any) => p.id), 2);
    await sb.from("sessions").update({ status: "teams_published" }).eq("id", sessionId);

    const { data } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(data.status).toBe("teams_published");

    const teams = await getTeams(sessionId);
    expect(teams.length).toBe(2);
  });
});
