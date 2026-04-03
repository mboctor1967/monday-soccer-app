import { describe, it, expect, afterEach } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getPayments, getTeams, getAllActivePlayers, createTeamsForSession } from "./helpers";

let sessionId: string;
let players: any[];

afterEach(async () => {
  if (sessionId) await deleteTestSession(sessionId);
  sessionId = "";
});

describe("F. Admin — Backward Transitions", () => {
  it("setup: load players", async () => {
    players = await getAllActivePlayers();
    expect(players.length).toBeGreaterThan(10);
  });

  it("F1: Reopen Sign-ups — unpaid payments deleted, paid preserved", async () => {
    const session = await createTestSession({ status: "signups_closed" });
    sessionId = session.id;
    const sb = getSupabase();

    // Add players and create payments
    for (let i = 0; i < 5; i++) {
      await addRsvp(sessionId, players[i].id);
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: 19.80,
        amount_paid: i === 0 ? 19.80 : 0,
        payment_status: i === 0 ? "paid" : "unpaid",
        payment_method: i === 0 ? "cash" : null,
      });
    }

    // Reopen sign-ups: delete unpaid, keep paid, set status to upcoming
    await sb.from("payments").delete().eq("session_id", sessionId).eq("payment_status", "unpaid");
    await sb.from("sessions").update({ status: "upcoming", closed_at: null }).eq("id", sessionId);

    const { data: s } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(s.status).toBe("upcoming");
    expect(s.closed_at).toBeNull();

    const payments = await getPayments(sessionId);
    expect(payments.length).toBe(1); // Only the paid one remains
    expect(payments[0].payment_status).toBe("paid");
  });

  it("F2: Unpublish Teams — teams deleted, RSVPs and payments preserved", async () => {
    const session = await createTestSession({ status: "teams_published" });
    sessionId = session.id;
    const sb = getSupabase();

    // Add 10 players, teams, payments
    const confirmedIds = players.slice(0, 10).map((p: any) => p.id);
    for (const pid of confirmedIds) {
      await addRsvp(sessionId, pid);
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: pid,
        amount_due: 19.80,
        amount_paid: 0,
        payment_status: "unpaid",
      });
    }
    await createTeamsForSession(sessionId, confirmedIds, 2);

    // Verify teams exist
    let teams = await getTeams(sessionId);
    expect(teams.length).toBe(2);

    // Unpublish: delete teams, keep rest
    const teamIds = teams.map((t: any) => t.id);
    await sb.from("team_players").delete().in("team_id", teamIds);
    await sb.from("teams").delete().eq("session_id", sessionId);
    await sb.from("sessions").update({ status: "signups_closed" }).eq("id", sessionId);

    const { data: s } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(s.status).toBe("signups_closed");

    teams = await getTeams(sessionId);
    expect(teams.length).toBe(0);

    const rsvps = await sb.from("rsvps").select("*").eq("session_id", sessionId);
    expect(rsvps.data!.length).toBe(10); // RSVPs preserved

    const payments = await getPayments(sessionId);
    expect(payments.length).toBe(10); // Payments preserved
  });

  it("F3: Reopen Session — completed → teams_published", async () => {
    const session = await createTestSession({ status: "completed" });
    sessionId = session.id;
    const sb = getSupabase();

    await sb.from("sessions").update({ status: "teams_published" }).eq("id", sessionId);

    const { data: s } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(s.status).toBe("teams_published");
  });

  it("F4: Uncancel — cancelled → upcoming, RSVPs preserved", async () => {
    const session = await createTestSession({ status: "cancelled" });
    sessionId = session.id;
    const sb = getSupabase();

    // Add RSVPs before uncancelling
    await addRsvp(sessionId, players[0].id);
    await addRsvp(sessionId, players[1].id);

    // Uncancel
    await sb.from("sessions").update({ status: "upcoming" }).eq("id", sessionId);

    const { data: s } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(s.status).toBe("upcoming");

    const rsvps = await sb.from("rsvps").select("*").eq("session_id", sessionId);
    expect(rsvps.data!.length).toBe(2); // RSVPs preserved
  });

  it("F5: Round-trip — close → reopen → close again", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // Add 5 players
    for (let i = 0; i < 5; i++) {
      await addRsvp(sessionId, players[i].id);
    }

    // First close: create payments
    await sb.from("sessions").update({ status: "signups_closed", closed_at: new Date().toISOString() }).eq("id", sessionId);
    for (let i = 0; i < 5; i++) {
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: 19.80,
        amount_paid: 0,
        payment_status: "unpaid",
      });
    }
    let payments = await getPayments(sessionId);
    expect(payments.length).toBe(5);

    // Reopen: delete unpaid payments
    await sb.from("payments").delete().eq("session_id", sessionId).eq("payment_status", "unpaid");
    await sb.from("sessions").update({ status: "upcoming", closed_at: null }).eq("id", sessionId);
    payments = await getPayments(sessionId);
    expect(payments.length).toBe(0);

    // Second close: recreate payments
    await sb.from("sessions").update({ status: "signups_closed", closed_at: new Date().toISOString() }).eq("id", sessionId);
    for (let i = 0; i < 5; i++) {
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: 19.80,
        amount_paid: 0,
        payment_status: "unpaid",
      });
    }
    payments = await getPayments(sessionId);
    expect(payments.length).toBe(5);
  });
});
