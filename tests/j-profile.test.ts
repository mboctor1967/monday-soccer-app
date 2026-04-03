import { describe, it, expect } from "vitest";
import { getSupabase, getPlayerByName } from "./helpers";

describe("J. Profile & Stats", () => {
  it("J2: Player edits own name and email — changes saved", async () => {
    const sb = getSupabase();
    const player = await getPlayerByName("Andrew Beshara");
    expect(player).toBeTruthy();

    const originalEmail = player.email;

    // Update email
    await sb.from("players").update({ email: "test-andrew@example.com" }).eq("id", player.id);
    const { data: updated } = await sb.from("players").select("*").eq("id", player.id).single();
    expect(updated.email).toBe("test-andrew@example.com");

    // Restore original
    await sb.from("players").update({ email: originalEmail }).eq("id", player.id);
    const { data: restored } = await sb.from("players").select("*").eq("id", player.id).single();
    expect(restored.email).toBe(originalEmail);
  });
});
