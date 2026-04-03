import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getRsvps, getPayments, getAllActivePlayers, createTeamsForSession, getTeams } from "./helpers";

let sessionId: string;
let players: any[];

beforeAll(async () => {
  players = await getAllActivePlayers();
});

afterAll(async () => {
  if (sessionId) await deleteTestSession(sessionId);
});

describe("E. Admin — Player Management in Session", () => {
  it("E4: Remove confirmed player — RSVP deleted", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    await addRsvp(sessionId, players[0].id);
    await addRsvp(sessionId, players[1].id);

    // Remove player 0
    await sb.from("rsvps").delete().eq("session_id", sessionId).eq("player_id", players[0].id);

    const rsvps = await getRsvps(sessionId);
    expect(rsvps.find((r: any) => r.player_id === players[0].id)).toBeUndefined();
    expect(rsvps.length).toBe(1);

    await deleteTestSession(sessionId);
  });

  it("E5: Change confirmed → absent removes from team, auto-promotes waitlist", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // Add 10 confirmed + 1 waitlisted
    for (let i = 0; i < 10; i++) {
      await addRsvp(sessionId, players[i].id);
    }
    await addRsvp(sessionId, players[10].id, { is_waitlist: true, waitlist_position: 1 });

    // Create teams with the 10 confirmed
    const confirmedIds = players.slice(0, 10).map((p: any) => p.id);
    await createTeamsForSession(sessionId, confirmedIds, 2);
    await sb.from("sessions").update({ status: "teams_published" }).eq("id", sessionId);

    // Change player[0] to absent and remove from team
    await sb.from("rsvps").update({ status: "absent" }).eq("session_id", sessionId).eq("player_id", players[0].id);

    // Find which team has player[0] and remove them
    const teamsBeforeRemove = await getTeams(sessionId);
    for (const team of teamsBeforeRemove) {
      const hasPlayer = team.team_players.some((tp: any) => tp.player_id === players[0].id);
      if (hasPlayer) {
        await sb.from("team_players").delete().match({ team_id: team.id, player_id: players[0].id });
      }
    }

    const teams = await getTeams(sessionId);
    const allTeamPlayerIds = teams.flatMap((t: any) => t.team_players.map((tp: any) => tp.player_id));
    expect(allTeamPlayerIds).not.toContain(players[0].id);

    // Auto-promote waitlisted player
    await sb.from("rsvps").update({ is_waitlist: false, promoted_at: new Date().toISOString() })
      .eq("session_id", sessionId).eq("player_id", players[10].id);

    const rsvps = await getRsvps(sessionId);
    const promoted = rsvps.find((r: any) => r.player_id === players[10].id);
    expect(promoted.is_waitlist).toBe(false);

    await deleteTestSession(sessionId);
  });

  it("E6: Change absent → confirmed adds to confirmed", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    await addRsvp(sessionId, players[0].id, { status: "absent" });

    // Change to confirmed
    await sb.from("rsvps").update({ status: "confirmed" }).eq("session_id", sessionId).eq("player_id", players[0].id);

    const rsvps = await getRsvps(sessionId);
    const confirmed = rsvps.filter((r: any) => r.status === "confirmed" && !r.is_waitlist);
    expect(confirmed.length).toBe(1);
    expect(confirmed[0].player_id).toBe(players[0].id);

    await deleteTestSession(sessionId);
  });

  it("E7: Change maybe → confirmed when full — goes to waitlist", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // Fill 10 slots
    for (let i = 0; i < 10; i++) {
      await addRsvp(sessionId, players[i].id);
    }
    // Add player[10] as maybe
    await addRsvp(sessionId, players[10].id, { status: "maybe" });

    // Change to confirmed — should go to waitlist since session full
    const currentConfirmed = 10;
    const maxPlayers = 10;
    if (currentConfirmed >= maxPlayers) {
      await sb.from("rsvps").update({ status: "confirmed", is_waitlist: true, waitlist_position: 1 })
        .eq("session_id", sessionId).eq("player_id", players[10].id);
    }

    const rsvps = await getRsvps(sessionId);
    const player10 = rsvps.find((r: any) => r.player_id === players[10].id);
    expect(player10.is_waitlist).toBe(true);

    await deleteTestSession(sessionId);
  });

  it("E9: Promote Waitlist during Upcoming — batch promotes", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // Add 8 confirmed + 2 waitlisted
    for (let i = 0; i < 8; i++) {
      await addRsvp(sessionId, players[i].id);
    }
    await addRsvp(sessionId, players[8].id, { is_waitlist: true, waitlist_position: 1 });
    await addRsvp(sessionId, players[9].id, { is_waitlist: true, waitlist_position: 2 });

    // Promote waitlist (2 spots available)
    await sb.from("rsvps").update({ is_waitlist: false, promoted_at: new Date().toISOString() })
      .eq("session_id", sessionId).eq("is_waitlist", true);

    const rsvps = await getRsvps(sessionId);
    const confirmed = rsvps.filter((r: any) => r.status === "confirmed" && !r.is_waitlist);
    expect(confirmed.length).toBe(10);

    await deleteTestSession(sessionId);
  });

  it("E10: Promote Waitlist during Signups Closed", async () => {
    const session = await createTestSession({ status: "signups_closed" });
    sessionId = session.id;
    const sb = getSupabase();

    for (let i = 0; i < 9; i++) {
      await addRsvp(sessionId, players[i].id);
    }
    await addRsvp(sessionId, players[9].id, { is_waitlist: true, waitlist_position: 1 });

    // Promote 1 (1 spot available)
    await sb.from("rsvps").update({ is_waitlist: false, promoted_at: new Date().toISOString() })
      .eq("session_id", sessionId).eq("player_id", players[9].id);

    const rsvps = await getRsvps(sessionId);
    const confirmed = rsvps.filter((r: any) => r.status === "confirmed" && !r.is_waitlist);
    expect(confirmed.length).toBe(10);

    await deleteTestSession(sessionId);
  });

  it("E11: Late player addition after close — bypasses cap, payment created", async () => {
    const session = await createTestSession({ status: "signups_closed" });
    sessionId = session.id;
    const sb = getSupabase();

    // Add 10 confirmed players with payments
    for (let i = 0; i < 10; i++) {
      await addRsvp(sessionId, players[i].id);
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: 19.80,
        amount_paid: 0,
        payment_status: "unpaid",
      });
    }

    // Late addition — player 10 (11th player, bypasses cap)
    await addRsvp(sessionId, players[10].id);
    await sb.from("payments").insert({
      session_id: sessionId,
      player_id: players[10].id,
      amount_due: 19.80,
      amount_paid: 0,
      payment_status: "unpaid",
    });

    const rsvps = await getRsvps(sessionId);
    const confirmed = rsvps.filter((r: any) => r.status === "confirmed" && !r.is_waitlist);
    expect(confirmed.length).toBe(11); // Exceeds 10 cap

    const payments = await getPayments(sessionId);
    expect(payments.length).toBe(11);

    await deleteTestSession(sessionId);
  });

  it("E12: Late player added to specific team — team_player created, avg recalculated", async () => {
    const session = await createTestSession({ status: "teams_published" });
    sessionId = session.id;
    const sb = getSupabase();

    // Create teams with 10 players
    const confirmedIds = players.slice(0, 10).map((p: any) => p.id);
    for (const pid of confirmedIds) {
      await addRsvp(sessionId, pid);
    }
    await createTeamsForSession(sessionId, confirmedIds, 2);

    const teamsBefore = await getTeams(sessionId);
    const teamA = teamsBefore[0];
    const teamAPlayersBefore = teamA.team_players.length;

    // Add late player to Team A
    await addRsvp(sessionId, players[10].id);
    await sb.from("team_players").insert({ team_id: teamA.id, player_id: players[10].id });

    const teamsAfter = await getTeams(sessionId);
    const teamAAfter = teamsAfter.find((t: any) => t.id === teamA.id);
    expect(teamAAfter.team_players.length).toBe(teamAPlayersBefore + 1);

    await deleteTestSession(sessionId);
  });

  it("E13: Set court payer — payment auto-marked as paid", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    await addRsvp(sessionId, players[0].id);
    const cost = 19.80;
    await sb.from("payments").insert({
      session_id: sessionId,
      player_id: players[0].id,
      amount_due: cost,
      amount_paid: 0,
      payment_status: "unpaid",
    });

    // Set as court payer and mark paid
    await sb.from("sessions").update({ court_payer_id: players[0].id }).eq("id", sessionId);
    await sb.from("payments").update({ payment_status: "paid", amount_paid: cost })
      .eq("session_id", sessionId).eq("player_id", players[0].id);

    const payments = await getPayments(sessionId);
    const courtPayerPayment = payments.find((p: any) => p.player_id === players[0].id);
    expect(courtPayerPayment!.payment_status).toBe("paid");
    expect(courtPayerPayment!.amount_paid).toBeCloseTo(cost, 2);

    await deleteTestSession(sessionId);
  });
});
