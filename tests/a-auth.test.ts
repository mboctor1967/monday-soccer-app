import { describe, it, expect } from "vitest";
import { getSupabase, getPlayerByName, getAllActivePlayers } from "./helpers";

describe("A. Authentication & Login", () => {
  it("A1: Admin player exists and has admin flag", async () => {
    const player = await getPlayerByName("Maged Boctor");
    expect(player).toBeTruthy();
    expect(player.is_admin).toBe(true);
    expect(player.is_active).toBe(true);
  });

  it("A2: Non-admin regular player exists", async () => {
    const player = await getPlayerByName("Andrew Beshara");
    expect(player).toBeTruthy();
    expect(player.is_admin).toBe(false);
    expect(player.player_type).toBe("regular");
    expect(player.is_active).toBe(true);
  });

  it("A3: Casual player exists", async () => {
    const player = await getPlayerByName("Billy Michael_Friend");
    expect(player).toBeTruthy();
    expect(player.player_type).toBe("casual");
    expect(player.is_active).toBe(true);
  });
});
