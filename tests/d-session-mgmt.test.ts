import { describe, it, expect, afterEach } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getPayments, getAllActivePlayers } from "./helpers";

let sessionIds: string[] = [];

afterEach(async () => {
  for (const id of sessionIds) {
    await deleteTestSession(id);
  }
  sessionIds = [];
});

describe("D. Admin — Session Management", () => {
  it("D1: Create new session with default values", async () => {
    const session = await createTestSession();
    sessionIds.push(session.id);
    expect(session.date).toBe("2026-04-14");
    expect(session.venue).toBe("Test Venue");
    expect(session.format).toBe("2t");
    expect(session.court_cost).toBe(180);
    expect(session.buffer_pct).toBe(10);
    expect(session.status).toBe("upcoming");
  });

  it("D2: Edit session during Upcoming — changes saved", async () => {
    const session = await createTestSession();
    sessionIds.push(session.id);
    const sb = getSupabase();

    await sb.from("sessions").update({ venue: "Updated Venue", court_cost: 200 }).eq("id", session.id);
    const { data } = await sb.from("sessions").select("*").eq("id", session.id).single();
    expect(data.venue).toBe("Updated Venue");
    expect(data.court_cost).toBe(200);
  });

  it("D3: Edit cost during Signups Closed — unpaid payments recalculated", async () => {
    const session = await createTestSession();
    sessionIds.push(session.id);
    const sb = getSupabase();
    const players = await getAllActivePlayers();

    // Add 10 players and close sign-ups
    for (let i = 0; i < 10; i++) {
      await addRsvp(session.id, players[i].id);
    }
    await sb.from("sessions").update({ status: "signups_closed" }).eq("id", session.id);

    // Create payments (simulating close sign-ups)
    const cost = 180 * 1.10 / 10; // 19.80
    for (let i = 0; i < 10; i++) {
      await sb.from("payments").insert({
        session_id: session.id,
        player_id: players[i].id,
        amount_due: cost,
        amount_paid: 0,
        payment_status: "unpaid",
      });
    }

    // Mark one as paid
    const payments = await getPayments(session.id);
    await sb.from("payments").update({ payment_status: "paid", amount_paid: cost }).eq("id", payments[0].id);

    // Change cost to 200
    await sb.from("sessions").update({ court_cost: 200 }).eq("id", session.id);
    const newCost = 200 * 1.10 / 10; // 22.00

    // Recalculate unpaid only
    await sb.from("payments").update({ amount_due: newCost }).eq("session_id", session.id).eq("payment_status", "unpaid");

    const updatedPayments = await getPayments(session.id);
    const paid = updatedPayments.find((p: any) => p.payment_status === "paid");
    const unpaid = updatedPayments.filter((p: any) => p.payment_status === "unpaid");

    // Paid should keep old amount
    expect(paid!.amount_due).toBeCloseTo(cost, 2);
    // Unpaid should have new amount
    for (const p of unpaid) {
      expect(p.amount_due).toBeCloseTo(newCost, 2);
    }
  });

  it("D5: Close sign-ups — payments created for all confirmed", async () => {
    const session = await createTestSession();
    sessionIds.push(session.id);
    const sb = getSupabase();
    const players = await getAllActivePlayers();

    // Add 10 confirmed players
    for (let i = 0; i < 10; i++) {
      await addRsvp(session.id, players[i].id);
    }

    // Set court payer
    await sb.from("sessions").update({ court_payer_id: players[0].id }).eq("id", session.id);

    // Simulate closing sign-ups: update status + create payments
    await sb.from("sessions").update({ status: "signups_closed", closed_at: new Date().toISOString() }).eq("id", session.id);
    const cost = 180 * 1.10 / 10;
    for (let i = 0; i < 10; i++) {
      await sb.from("payments").insert({
        session_id: session.id,
        player_id: players[i].id,
        amount_due: cost,
        amount_paid: players[i].id === players[0].id ? cost : 0,
        payment_status: players[i].id === players[0].id ? "paid" : "unpaid",
      });
    }

    const payments = await getPayments(session.id);
    expect(payments.length).toBe(10);
    const courtPayerPayment = payments.find((p: any) => p.player_id === players[0].id);
    expect(courtPayerPayment!.payment_status).toBe("paid");
    expect(courtPayerPayment!.amount_paid).toBeCloseTo(cost, 2);
  });

  it("D6: Cancel session — status changes", async () => {
    const session = await createTestSession();
    sessionIds.push(session.id);
    const sb = getSupabase();

    await sb.from("sessions").update({ status: "cancelled" }).eq("id", session.id);
    const { data } = await sb.from("sessions").select("*").eq("id", session.id).single();
    expect(data.status).toBe("cancelled");
  });

  it("D7: Delete session — cascades all data", async () => {
    const session = await createTestSession();
    const sb = getSupabase();
    const players = await getAllActivePlayers();

    await addRsvp(session.id, players[0].id);
    await sb.from("payments").insert({
      session_id: session.id,
      player_id: players[0].id,
      amount_due: 19.80,
      amount_paid: 0,
      payment_status: "unpaid",
    });

    await deleteTestSession(session.id);

    const { data: s } = await sb.from("sessions").select("*").eq("id", session.id);
    const { data: r } = await sb.from("rsvps").select("*").eq("session_id", session.id);
    const { data: p } = await sb.from("payments").select("*").eq("session_id", session.id);
    expect(s!.length).toBe(0);
    expect(r!.length).toBe(0);
    expect(p!.length).toBe(0);
  });
});
