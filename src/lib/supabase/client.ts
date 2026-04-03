import { createBrowserClient } from "@supabase/ssr";
import { Database } from "@/lib/types/supabase";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";
  client = createBrowserClient<Database>(url, key, {
    auth: {
      lock: (async (_name: string, _acquireTimeout: number, fn: () => unknown) => {
        return fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    },
  });
  return client;
}
