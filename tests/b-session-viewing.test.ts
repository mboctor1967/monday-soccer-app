import { describe, it, expect, afterAll } from "vitest";
import { getSupabase, createTestSession, deleteTestSession } from "./helpers";

let sessionId: string;

afterAll(async () => {
  if (sessionId) await deleteTestSession(sessionId);
});

describe("B. Session Viewing", () => {
  it("B1: Sessions list returns active sessions with correct fields", async () => {
    const session = await createTestSession({ venue: "Test Viewing Venue" });
    sessionId = session.id;

    const sb = getSupabase();
    const { data } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(data).toBeTruthy();
    expect(data.venue).toBe("Test Viewing Venue");
    expect(data.date).toBe("2026-04-14");
    expect(data.status).toBe("upcoming");
  });

  it("B3: Session detail has venue, time, cost per player", async () => {
    const sb = getSupabase();
    const { data } = await sb.from("sessions").select("*").eq("id", sessionId).single();
    expect(data.venue).toBeTruthy();
    expect(data.start_time).toBe("20:45");
    expect(data.end_time).toBe("22:45");
    expect(data.court_cost).toBe(180);
    expect(data.buffer_pct).toBe(10);
    // Cost per player = 180 * 1.10 / 10 = 19.80
    const costPerPlayer = data.court_cost * (1 + data.buffer_pct / 100) / 10;
    expect(costPerPlayer).toBeCloseTo(19.8, 2);
  });
});
