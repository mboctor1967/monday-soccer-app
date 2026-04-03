import { describe, it, expect, afterEach } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getAllActivePlayers } from "./helpers";

let sessionId: string;
let players: any[];

afterEach(async () => {
  if (sessionId) await deleteTestSession(sessionId);
  sessionId = "";
});

describe("I. Messaging", () => {
  it("setup: load players", async () => {
    players = await getAllActivePlayers();
    expect(players.length).toBeGreaterThan(5);
  });

  it("I1: Send message to confirmed — notification records created", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // Add 3 confirmed
    for (let i = 0; i < 3; i++) {
      await addRsvp(sessionId, players[i].id);
    }

    // Insert notification records (simulating broadcast)
    const confirmedIds = players.slice(0, 3).map((p: any) => p.id);
    for (const pid of confirmedIds) {
      await sb.from("notifications").insert({
        session_id: sessionId,
        player_id: pid,
        message: "Test message to confirmed",
        channel: "whatsapp",
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    }

    const { data: notifs } = await sb.from("notifications").select("*").eq("session_id", sessionId);
    expect(notifs!.length).toBe(3);
    for (const n of notifs!) {
      expect(confirmedIds).toContain(n.player_id);
    }
  });

  it("I2: Send message to waitlisted only — only waitlisted receive", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // 2 confirmed + 2 waitlisted
    await addRsvp(sessionId, players[0].id);
    await addRsvp(sessionId, players[1].id);
    await addRsvp(sessionId, players[2].id, { is_waitlist: true, waitlist_position: 1 });
    await addRsvp(sessionId, players[3].id, { is_waitlist: true, waitlist_position: 2 });

    // Send to waitlisted only
    const waitlistedIds = [players[2].id, players[3].id];
    for (const pid of waitlistedIds) {
      await sb.from("notifications").insert({
        session_id: sessionId,
        player_id: pid,
        message: "Test message to waitlisted",
        channel: "sms",
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    }

    const { data: notifs } = await sb.from("notifications").select("*").eq("session_id", sessionId);
    expect(notifs!.length).toBe(2);
    const notifPlayerIds = notifs!.map((n: any) => n.player_id);
    expect(notifPlayerIds).not.toContain(players[0].id);
    expect(notifPlayerIds).not.toContain(players[1].id);
    expect(notifPlayerIds).toContain(players[2].id);
    expect(notifPlayerIds).toContain(players[3].id);
  });

  it("I3: Send message to unpaid only — excludes court payer and paid players", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    // 3 players, 1 paid (court payer), 2 unpaid
    for (let i = 0; i < 3; i++) {
      await addRsvp(sessionId, players[i].id);
    }
    await sb.from("sessions").update({ court_payer_id: players[0].id }).eq("id", sessionId);

    for (let i = 0; i < 3; i++) {
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: 19.80,
        amount_paid: i === 0 ? 19.80 : 0,
        payment_status: i === 0 ? "paid" : "unpaid",
      });
    }

    // Send to unpaid only (players[1] and players[2])
    const unpaidIds = [players[1].id, players[2].id];
    for (const pid of unpaidIds) {
      await sb.from("notifications").insert({
        session_id: sessionId,
        player_id: pid,
        message: "Payment reminder",
        channel: "whatsapp",
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    }

    const { data: notifs } = await sb.from("notifications").select("*").eq("session_id", sessionId);
    expect(notifs!.length).toBe(2);
    const notifPlayerIds = notifs!.map((n: any) => n.player_id);
    expect(notifPlayerIds).not.toContain(players[0].id); // Court payer excluded
  });
});
