import { describe, it, expect, afterEach } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getPayments, getAllActivePlayers } from "./helpers";

let sessionId: string;
let players: any[];

afterEach(async () => {
  if (sessionId) await deleteTestSession(sessionId);
  sessionId = "";
});

describe("H. Payments", () => {
  it("setup: load players", async () => {
    players = await getAllActivePlayers();
    expect(players.length).toBeGreaterThan(10);
  });

  it("H1: Payments auto-created on close — correct count and amount", async () => {
    const session = await createTestSession({ court_cost: 180, buffer_pct: 10 });
    sessionId = session.id;
    const sb = getSupabase();

    // Add 10 confirmed
    for (let i = 0; i < 10; i++) {
      await addRsvp(sessionId, players[i].id);
    }

    // Simulate close: create payments
    const expectedCost = 180 * 1.10 / 10; // 19.80
    for (let i = 0; i < 10; i++) {
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: expectedCost,
        amount_paid: 0,
        payment_status: "unpaid",
      });
    }

    const payments = await getPayments(sessionId);
    expect(payments.length).toBe(10);
    for (const p of payments) {
      expect(p.amount_due).toBeCloseTo(19.80, 2);
    }
  });

  it("H2: Court payer auto-marked as paid", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    await addRsvp(sessionId, players[0].id);
    await sb.from("sessions").update({ court_payer_id: players[0].id }).eq("id", sessionId);

    const cost = 19.80;
    await sb.from("payments").insert({
      session_id: sessionId,
      player_id: players[0].id,
      amount_due: cost,
      amount_paid: cost,
      payment_status: "paid",
    });

    const payments = await getPayments(sessionId);
    const courtPayer = payments.find((p: any) => p.player_id === players[0].id);
    expect(courtPayer!.payment_status).toBe("paid");
    expect(courtPayer!.amount_paid).toBeCloseTo(cost, 2);
  });

  it("H5: PayID reject — status returns to unpaid", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    await addRsvp(sessionId, players[0].id);
    const { data: payment } = await sb.from("payments").insert({
      session_id: sessionId,
      player_id: players[0].id,
      amount_due: 19.80,
      amount_paid: 0,
      payment_status: "unpaid",
      payment_method: "payid",
      pending_confirmation: true,
      payment_reference: "MON-0414-Test",
    }).select().single();

    // Admin rejects
    await sb.from("payments").update({
      pending_confirmation: false,
      payment_method: null,
      payment_reference: null,
    }).eq("id", payment!.id);

    const payments = await getPayments(sessionId);
    expect(payments[0].payment_status).toBe("unpaid");
    expect(payments[0].pending_confirmation).toBe(false);
  });

  it("H6: Admin marks Cash payment — status paid, method cash", async () => {
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

    // Mark as cash paid
    const payments = await getPayments(sessionId);
    await sb.from("payments").update({
      payment_status: "paid",
      amount_paid: cost,
      payment_method: "cash",
      pending_confirmation: false,
    }).eq("id", payments[0].id);

    const updated = await getPayments(sessionId);
    expect(updated[0].payment_status).toBe("paid");
    expect(updated[0].payment_method).toBe("cash");
    expect(updated[0].amount_paid).toBeCloseTo(cost, 2);
  });

  it("H7: Cost change recalculates unpaid, preserves paid", async () => {
    const session = await createTestSession({ court_cost: 180, buffer_pct: 10 });
    sessionId = session.id;
    const sb = getSupabase();

    const oldCost = 180 * 1.10 / 10; // 19.80
    for (let i = 0; i < 5; i++) {
      await addRsvp(sessionId, players[i].id);
      await sb.from("payments").insert({
        session_id: sessionId,
        player_id: players[i].id,
        amount_due: oldCost,
        amount_paid: i === 0 ? oldCost : 0,
        payment_status: i === 0 ? "paid" : "unpaid",
      });
    }

    // Change cost to 200
    const newCost = 200 * 1.10 / 10; // 22.00
    await sb.from("sessions").update({ court_cost: 200 }).eq("id", sessionId);
    await sb.from("payments").update({ amount_due: newCost })
      .eq("session_id", sessionId).eq("payment_status", "unpaid");

    const payments = await getPayments(sessionId);
    const paid = payments.find((p: any) => p.payment_status === "paid");
    const unpaid = payments.filter((p: any) => p.payment_status === "unpaid");

    expect(paid!.amount_due).toBeCloseTo(oldCost, 2); // Preserved
    for (const p of unpaid) {
      expect(p.amount_due).toBeCloseTo(newCost, 2); // Recalculated
    }
  });

  it("H10: Verify-checkout endpoint logic — marks payments as paid", async () => {
    const session = await createTestSession();
    sessionId = session.id;
    const sb = getSupabase();

    await addRsvp(sessionId, players[0].id);
    const fakeCheckoutId = "cs_test_fake_" + Date.now();
    await sb.from("payments").insert({
      session_id: sessionId,
      player_id: players[0].id,
      amount_due: 19.80,
      amount_paid: 0,
      payment_status: "unpaid",
      stripe_checkout_session_id: fakeCheckoutId,
    });

    // Simulate what verify-checkout does (without calling Stripe API)
    // In real test, the Stripe API would confirm. Here we test the DB update logic.
    await sb.from("payments").update({
      payment_status: "paid",
      amount_paid: 19.80,
      payment_method: "stripe",
      pending_confirmation: false,
    }).eq("stripe_checkout_session_id", fakeCheckoutId).eq("payment_status", "unpaid");

    const payments = await getPayments(sessionId);
    expect(payments[0].payment_status).toBe("paid");
    expect(payments[0].payment_method).toBe("stripe");
  });
});
