import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();

    // Get all unpaid, non-paused, non-pending payments with session and player info
    const { data: unpaidPayments } = await supabase
      .from("payments")
      .select("*, player:players(id, name, mobile), session:sessions(id, date, court_payer_id)")
      .eq("payment_status", "unpaid")
      .eq("chase_paused", false)
      .eq("pending_confirmation", false);

    if (!unpaidPayments || unpaidPayments.length === 0) {
      return NextResponse.json({ success: true, chased: 0 });
    }

    const now = new Date();
    let chasedCount = 0;

    // Group by chase stage
    for (const payment of unpaidPayments) {
      const session = payment.session as unknown as { id: string; date: string; court_payer_id: string | null };
      const player = payment.player as unknown as { id: string; name: string; mobile: string };

      // Skip court payer
      if (payment.player_id === session.court_payer_id) continue;

      const daysSinceCreated = Math.floor(
        (now.getTime() - new Date(payment.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Skip if already chased today
      if (payment.last_chased_at) {
        const daysSinceChased = Math.floor(
          (now.getTime() - new Date(payment.last_chased_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceChased < 1) continue;
      }

      let message = "";
      const sessionDate = new Date(session.date).toLocaleDateString("en-AU", {
        weekday: "long", day: "numeric", month: "long",
      });
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monday-soccer-app.vercel.app";

      if (daysSinceCreated >= 7) {
        // T+7: Alert admin only
        const { data: admins } = await supabase
          .from("players")
          .select("id")
          .eq("is_admin", true)
          .eq("is_active", true);

        if (admins && admins.length > 0) {
          await fetch(`${appUrl}/api/notifications/broadcast`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `⚠️ *Payment Alert*\n\n${player.name} has not paid $${payment.amount_due.toFixed(2)} for the session on ${sessionDate} after 7 days.\n\nConsider following up directly or excluding from next session.`,
              player_ids: admins.map((a) => a.id),
              session_id: session.id,
              channel: "whatsapp",
            }),
          });
        }
        message = "admin_alert";
      } else if (daysSinceCreated >= 5) {
        // T+5: Escalation
        message = `⚠️ *Payment Overdue*\n\nHi ${player.name}, your payment of $${payment.amount_due.toFixed(2)} for Monday Night Soccer on ${sessionDate} is now overdue.\n\nPlease settle as soon as possible.\n\n👉 ${appUrl}/sessions/${session.id}`;
      } else if (daysSinceCreated >= 2) {
        // T+2: Friendly reminder
        message = `💰 *Payment Reminder*\n\nHi ${player.name}, just a reminder that $${payment.amount_due.toFixed(2)} is due for Monday Night Soccer on ${sessionDate}.\n\nPay easily in the app:\n👉 ${appUrl}/sessions/${session.id}`;
      } else {
        continue; // Too early to chase
      }

      // Send via broadcast (except admin alerts which are already sent above)
      if (message && message !== "admin_alert") {
        await fetch(`${appUrl}/api/notifications/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            player_ids: [player.id],
            session_id: session.id,
            channel: "whatsapp",
          }),
        });
      }

      // Update last_chased_at
      await supabase
        .from("payments")
        .update({ last_chased_at: now.toISOString() })
        .eq("id", payment.id);

      chasedCount++;
    }

    return NextResponse.json({ success: true, chased: chasedCount });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Chase failed";
    console.error("Payment chase error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
