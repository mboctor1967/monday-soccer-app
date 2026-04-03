import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  _supabase = createClient(url, key);
  return _supabase;
}

// ── Player helpers ──────────────────────────────────────────────────────

export async function getPlayerByName(name: string) {
  const sb = getSupabase();
  const { data } = await sb.from("players").select("*").ilike("name", name).single();
  return data;
}

export async function getPlayersByType(type: "regular" | "casual") {
  const sb = getSupabase();
  const { data } = await sb.from("players").select("*").eq("player_type", type).eq("is_active", true).order("name");
  return data || [];
}

export async function getAdminPlayers() {
  const sb = getSupabase();
  const { data } = await sb.from("players").select("*").eq("is_admin", true).eq("is_active", true).order("name");
  return data || [];
}

export async function getAllActivePlayers() {
  const sb = getSupabase();
  const { data } = await sb.from("players").select("*").eq("is_active", true).order("name");
  return data || [];
}

// ── Session helpers ─────────────────────────────────────────────────────

export async function createTestSession(overrides: Record<string, unknown> = {}) {
  const sb = getSupabase();
  const defaults = {
    date: "2026-04-14",
    venue: "Test Venue",
    start_time: "20:45",
    end_time: "22:45",
    format: "2t",
    court_cost: 180,
    buffer_pct: 10,
    status: "upcoming",
    created_by: "e8ee8bde-e832-41ae-b970-4841692ee66a", // Maged Boctor
  };
  const { data, error } = await sb.from("sessions").insert({ ...defaults, ...overrides }).select().single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data;
}

export async function deleteTestSession(sessionId: string) {
  const sb = getSupabase();
  // Cascade delete in correct order
  await sb.from("notifications").delete().eq("session_id", sessionId);
  const { data: teams } = await sb.from("teams").select("id").eq("session_id", sessionId);
  if (teams && teams.length > 0) {
    const teamIds = teams.map((t) => t.id);
    await sb.from("team_players").delete().in("team_id", teamIds);
    await sb.from("teams").delete().eq("session_id", sessionId);
  }
  await sb.from("payments").delete().eq("session_id", sessionId);
  await sb.from("rsvps").delete().eq("session_id", sessionId);
  await sb.from("sessions").delete().eq("id", sessionId);
}

// ── RSVP helpers ────────────────────────────────────────────────────────

export async function addRsvp(sessionId: string, playerId: string, options: Record<string, unknown> = {}) {
  const sb = getSupabase();
  const defaults = {
    session_id: sessionId,
    player_id: playerId,
    status: "confirmed",
    rsvp_at: new Date().toISOString(),
    is_waitlist: false,
    waitlist_position: null,
    promoted_at: null,
  };
  const { data, error } = await sb.from("rsvps").insert({ ...defaults, ...options }).select().single();
  if (error) throw new Error(`Failed to add RSVP: ${error.message}`);
  return data;
}

export async function getRsvps(sessionId: string) {
  const sb = getSupabase();
  const { data } = await sb.from("rsvps").select("*, player:players(*)").eq("session_id", sessionId);
  return data || [];
}

// ── Payment helpers ─────────────────────────────────────────────────────

export async function getPayments(sessionId: string) {
  const sb = getSupabase();
  const { data } = await sb.from("payments").select("*").eq("session_id", sessionId);
  return data || [];
}

export async function createPaymentsForSession(sessionId: string, playerIds: string[], courtCost: number, bufferPct: number, format: string, courtPayerId?: string) {
  const sb = getSupabase();
  const max = format === "3t" ? 15 : 10;
  const cost = courtCost * (1 + bufferPct / 100) / max;
  const payments = playerIds.map((pid) => ({
    session_id: sessionId,
    player_id: pid,
    amount_due: cost,
    amount_paid: pid === courtPayerId ? cost : 0,
    payment_status: pid === courtPayerId ? "paid" : "unpaid",
    payment_method: null,
    notes: null,
  }));
  const { error } = await sb.from("payments").insert(payments);
  if (error) throw new Error(`Failed to create payments: ${error.message}`);
}

// ── Team helpers ────────────────────────────────────────────────────────

export async function getTeams(sessionId: string) {
  const sb = getSupabase();
  const { data } = await sb.from("teams").select("*, team_players(player_id)").eq("session_id", sessionId);
  return data || [];
}

export async function createTeamsForSession(sessionId: string, playerIds: string[], numTeams: 2 | 3) {
  const sb = getSupabase();
  const teamNames = ["A", "B", "C"].slice(0, numTeams);
  const playersPerTeam = Math.ceil(playerIds.length / numTeams);

  for (let i = 0; i < numTeams; i++) {
    const teamPlayers = playerIds.slice(i * playersPerTeam, (i + 1) * playersPerTeam);
    const { data: team } = await sb.from("teams").insert({
      session_id: sessionId,
      team_name: teamNames[i],
      bib_color: ["White", "Black", "Red"][i],
      avg_skill_rating: 3,
      published_at: new Date().toISOString(),
    }).select().single();

    if (team && teamPlayers.length > 0) {
      await sb.from("team_players").insert(
        teamPlayers.map((pid) => ({ team_id: team.id, player_id: pid }))
      );
    }
  }
}
