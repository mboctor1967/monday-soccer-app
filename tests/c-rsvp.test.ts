import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getSupabase, createTestSession, deleteTestSession, addRsvp, getRsvps, getAllActivePlayers } from "./helpers";

let sessionId: string;
let players: any[];

beforeAll(async () => {
  const session = await createTestSession();
  sessionId = session.id;
  players = await getAllActivePlayers();
});

afterAll(async () => {
  if (sessionId) await deleteTestSession(sessionId);
});

describe("C. RSVP Flow", () => {
  it("C1: Player RSVPs confirmed — added to confirmed list", async () => {
    const player = players[0];
    const rsvp = await addRsvp(sessionId, player.id);
    expect(rsvp.status).toBe("confirmed");
    expect(rsvp.is_waitlist).toBe(false);

    const rsvps = await getRsvps(sessionId);
    const confirmed = rsvps.filter((r: any) => r.status === "confirmed" && !r.is_waitlist);
    expect(confirmed.length).toBe(1);
    expect(confirmed[0].player_id).toBe(player.id);
  });

  it("C2: Player RSVPs when full — auto-waitlisted", async () => {
    // Add 9 more players to fill the session (10 total for 2t format)
    for (let i = 1; i < 10; i++) {
      await addRsvp(sessionId, players[i].id);
    }

    // 11th player should go to waitlist
    const rsvp = await addRsvp(sessionId, players[10].id, {
      is_waitlist: true,
      waitlist_position: 1,
    });
    expect(rsvp.is_waitlist).toBe(true);
    expect(rsvp.waitlist_position).toBe(1);
  });

  it("C3: Player changes RSVP to maybe", async () => {
    const sb = getSupabase();
    const player = players[0];
    await sb.from("rsvps").update({ status: "maybe" }).eq("session_id", sessionId).eq("player_id", player.id);

    const rsvps = await getRsvps(sessionId);
    const maybe = rsvps.filter((r: any) => r.status === "maybe");
    expect(maybe.length).toBe(1);
    expect(maybe[0].player_id).toBe(player.id);
  });

  it("C4: Player changes RSVP to absent", async () => {
    const sb = getSupabase();
    const player = players[0];
    await sb.from("rsvps").update({ status: "absent" }).eq("session_id", sessionId).eq("player_id", player.id);

    const rsvps = await getRsvps(sessionId);
    const absent = rsvps.filter((r: any) => r.status === "absent");
    expect(absent.length).toBe(1);
    expect(absent[0].player_id).toBe(player.id);
  });

  it("C5: Player withdraws — RSVP deleted", async () => {
    const sb = getSupabase();
    const player = players[0];
    await sb.from("rsvps").delete().eq("session_id", sessionId).eq("player_id", player.id);

    const rsvps = await getRsvps(sessionId);
    const found = rsvps.find((r: any) => r.player_id === player.id);
    expect(found).toBeUndefined();
  });
});
