import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

const DEV_SKIP_OTP = process.env.DEV_SKIP_OTP === "true";

export async function POST(request: NextRequest) {
  try {
    const { mobile } = await request.json();

    if (!mobile) {
      return NextResponse.json({ error: "Mobile number is required" }, { status: 400 });
    }

    // Ensure Australian format
    const formattedMobile = mobile.startsWith("+61") ? mobile : `+61${mobile.replace(/^0/, "")}`;

    if (DEV_SKIP_OTP) {
      console.warn("[DEV] OTP send skipped — enter any 6-digit code to log in");
      return NextResponse.json({ success: true, status: "pending" });
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verifications.create({
        to: formattedMobile,
        channel: "sms",
      });

    return NextResponse.json({
      success: true,
      status: verification.status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send OTP";
    console.error("Send OTP error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
