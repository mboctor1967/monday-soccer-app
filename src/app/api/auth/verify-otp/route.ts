import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createServiceRoleClient } from "@/lib/supabase/server";
import crypto from "crypto";

const DEV_SKIP_OTP = process.env.DEV_SKIP_OTP === "true";

export async function POST(request: NextRequest) {
  try {
    const { mobile, code } = await request.json();

    if (!mobile || !code) {
      return NextResponse.json({ error: "Mobile and code are required" }, { status: 400 });
    }

    const formattedMobile = mobile.startsWith("+61") ? mobile : `+61${mobile.replace(/^0/, "")}`;

    if (DEV_SKIP_OTP) {
      console.warn("[DEV] OTP verification skipped — any 6-digit code accepted");
    } else {
      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID!,
        process.env.TWILIO_AUTH_TOKEN!
      );

      // Verify OTP with Twilio
      const verificationCheck = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
        .verificationChecks.create({
          to: formattedMobile,
          code,
        });

      if (verificationCheck.status !== "approved") {
        return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
      }
    }

    // OTP verified — find or create user in Supabase
    const supabase = createServiceRoleClient();

    // Check if player exists with this mobile
    const { data: player } = await supabase
      .from("players")
      .select("*")
      .eq("mobile", formattedMobile)
      .eq("is_active", true)
      .single();

    if (!player) {
      return NextResponse.json(
        { error: "You are not registered. Please contact an admin." },
        { status: 403 }
      );
    }

    // Use a synthetic email based on phone number for Supabase auth
    const syntheticEmail = `${formattedMobile.replace("+", "")}@phone.mondaysoccer.app`;
    // Generate a random password — user never needs to know it, login is always via OTP
    const password = crypto.randomBytes(32).toString("hex");

    // Create or get Supabase auth user
    let authUserId = player.auth_user_id;

    if (!authUserId) {
      // Create auth user with email + password
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        password,
        email_confirm: true,
        phone: formattedMobile,
        phone_confirm: true,
        user_metadata: {
          player_id: player.id,
          name: player.name,
          is_admin: player.is_admin,
        },
      });

      if (authError) {
        // User might already exist in auth
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(
          u => u.email === syntheticEmail || u.phone === formattedMobile
        );
        if (existingUser) {
          authUserId = existingUser.id;
          // Update the password so we can sign in
          await supabase.auth.admin.updateUserById(existingUser.id, { password });
        } else {
          console.error("Auth error:", authError);
          return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
        }
      } else {
        authUserId = authUser.user.id;
      }

      // Link auth user to player
      await supabase
        .from("players")
        .update({ auth_user_id: authUserId })
        .eq("id", player.id);
    } else {
      // Update the password for existing user so we can sign in
      await supabase.auth.admin.updateUserById(authUserId, { password });
    }

    return NextResponse.json({
      success: true,
      email: syntheticEmail,
      password,
      player: {
        id: player.id,
        name: player.name,
        is_admin: player.is_admin,
        player_type: player.player_type,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Verification failed";
    console.error("Verify OTP error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
