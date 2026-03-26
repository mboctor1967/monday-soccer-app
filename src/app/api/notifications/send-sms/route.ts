import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(request: NextRequest) {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
    const { mobile, message } = await request.json();

    if (!mobile || !message) {
      return NextResponse.json({ error: "Mobile and message required" }, { status: 400 });
    }

    const msg = await client.messages.create({
      body: message,
      to: mobile,
      from: process.env.TWILIO_PHONE_NUMBER || undefined,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
    });

    return NextResponse.json({ success: true, sid: msg.sid });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to send SMS";
    console.error("SMS error:", errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
