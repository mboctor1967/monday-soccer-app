import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
    const { message, session_id, player_ids } = await request.json();
    const supabase = createServiceRoleClient();

    // Get players to notify
    let query = supabase.from("players").select("*").eq("is_active", true);
    if (player_ids && player_ids.length > 0) {
      query = query.in("id", player_ids);
    }
    const { data: players } = await query;

    if (!players || players.length === 0) {
      return NextResponse.json({ error: "No players to notify" }, { status: 400 });
    }

    let sent = 0;
    for (const player of players) {
      try {
        await twilioClient.messages.create({
          body: message,
          to: player.mobile,
          from: process.env.TWILIO_PHONE_NUMBER || undefined,
          messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
        });

        await supabase.from("notifications").insert({
          player_id: player.id,
          session_id: session_id || null,
          channel: "sms",
          message,
          sent_at: new Date().toISOString(),
          status: "sent",
        });

        sent++;
      } catch (err) {
        console.error(`Failed to SMS ${player.name}:`, err);
        await supabase.from("notifications").insert({
          player_id: player.id,
          session_id: session_id || null,
          channel: "sms",
          message,
          sent_at: new Date().toISOString(),
          status: "failed",
        });
      }
    }

    return NextResponse.json({ success: true, sent, total: players.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Broadcast failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
