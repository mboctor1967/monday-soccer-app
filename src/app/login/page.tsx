"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  useEffect(() => {
    if (lockedUntil) {
      const interval = setInterval(() => {
        if (Date.now() >= lockedUntil) {
          setLockedUntil(null);
          setAttempts(0);
          clearInterval(interval);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [lockedUntil]);

  const formatMobile = (input: string) => {
    const digits = input.replace(/\D/g, "");
    if (digits.startsWith("61")) return `+${digits}`;
    if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
    return `+61${digits}`;
  };

  const handleSendOtp = async () => {
    setError("");
    setIsLoading(true);

    try {
      const formattedMobile = formatMobile(mobile);
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: formattedMobile }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("otp");
      setResendTimer(60);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (lockedUntil) {
      setError(`Account locked. Try again in ${Math.ceil((lockedUntil - Date.now()) / 60000)} minutes.`);
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const formattedMobile = formatMobile(mobile);
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: formattedMobile, code: otp }),
      });

      const data = await res.json();

      if (!res.ok) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 5) {
          setLockedUntil(Date.now() + 15 * 60 * 1000);
          throw new Error("Too many failed attempts. Account locked for 15 minutes.");
        }
        throw new Error(data.error);
      }

      // Sign in with the temporary credentials to establish a browser session
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (signInError) {
        throw new Error("Failed to establish session");
      }

      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-900 via-green-800 to-emerald-900 p-4">
      {process.env.NEXT_PUBLIC_DEV_SKIP_OTP === "true" && (
        <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-900 text-center text-xs font-semibold py-1 z-50">
          DEV MODE — OTP disabled, enter any 6-digit code to log in
        </div>
      )}
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-700" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold">Monday Night Soccer</CardTitle>
          <CardDescription>
            {step === "phone"
              ? "Enter your Australian mobile number to log in"
              : `Enter the 6-digit code sent to ${mobile}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile Number</Label>
                <div className="flex gap-2">
                  <div className="flex items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                    +61
                  </div>
                  <Input
                    id="mobile"
                    type="tel"
                    placeholder="4XX XXX XXX"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                onClick={handleSendOtp}
                disabled={isLoading || !mobile}
                className="w-full bg-green-700 hover:bg-green-800"
              >
                {isLoading ? "Sending..." : "Send Verification Code"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                onClick={handleVerifyOtp}
                disabled={isLoading || otp.length !== 6 || !!lockedUntil}
                className="w-full bg-green-700 hover:bg-green-800"
              >
                {isLoading ? "Verifying..." : "Verify & Log In"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                  className="text-muted-foreground hover:underline"
                >
                  Change number
                </button>
                <button
                  onClick={handleSendOtp}
                  disabled={resendTimer > 0}
                  className={`${resendTimer > 0 ? "text-muted-foreground" : "text-green-700 hover:underline"}`}
                >
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend code"}
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
