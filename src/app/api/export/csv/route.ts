import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const { data: players } = await supabase.from("players").select("*").order("name");
    const { data: sessions } = await supabase.from("sessions").select("*").order("date", { ascending: false });
    const { data: rsvps } = await supabase.from("rsvps").select("*");
    const { data: payments } = await supabase.from("payments").select("*");

    // Build CSV — Attendance + Payment per player per session
    const lines: string[] = [];
    lines.push("Player,Type,Session Date,RSVP Status,Amount Due,Amount Paid,Payment Status");

    for (const session of sessions || []) {
      for (const player of players || []) {
        const rsvp = (rsvps || []).find((r) => r.session_id === session.id && r.player_id === player.id);
        const payment = (payments || []).find((p) => p.session_id === session.id && p.player_id === player.id);

        if (rsvp || payment) {
          const row = [
            `"${player.name}"`,
            player.player_type,
            session.date,
            rsvp?.status || "N/A",
            payment?.amount_due?.toFixed(2) || "0.00",
            payment?.amount_paid?.toFixed(2) || "0.00",
            payment?.payment_status || "N/A",
          ];
          lines.push(row.join(","));
        }
      }
    }

    const csv = lines.join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="monday-soccer-export.csv"`,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
