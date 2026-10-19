# Handover — Soccer App database (5 Oct 2026)

**Context:** Maged asked to close the Soccer App's Supabase project and move it to Neon, as part of cutting the Supabase bill (org "StMark_SundaySchool", ~US$55/month).

## Current state
- Supabase project: `punekqewhvthvzmjwsvr` (in `.env.local`). Still live (DNS resolves).
- An older ref `oxoigjrfyrgnnhsywzeo` appears in `.claude/.env.local` — that is **Servant Hub's** project, not Soccer's. Don't touch it from here.
- Last commit: 24 Aug 2026 ("backup: snapshot 2026-08-25").

## What the app uses from Supabase (counted in `src/`, 5 Oct 2026)
| Feature | Uses | Neon equivalent |
|---|---|---|
| Auth (`supabase.auth`, with Twilio Verify OTP) | 10 | Neon Auth — different API, code changes |
| Query builder (`.from(...)`) | 173 | Rewrite to SQL / Drizzle |
| Realtime channels (`.channel(`) | 3 | None on Neon — needs another service |
| Storage, Edge Functions, RPC | 0 | — |

## Options
1. **Transfer the project to a free Supabase organisation** (Dashboard → Project settings → Transfer project). No code change; saves ~US$10/month. Free projects pause after 7 days of no activity.
2. **Port to Neon** (Neon Auth + Drizzle + a realtime substitute). Several days of work and testing for ~US$10/month saving.
3. **Pause/delete** if the app is no longer needed — export first.

## Status
- **Decision (5 Oct 2026): option 1 — transfer to a free Supabase organisation.** Maged does the transfer in the dashboard (no Supabase access token or CLI on this PC).
- Steps: (1) check Database size < 500 MB and Storage < 1 GB (free limits); (2) Dashboard → New organization → Free plan; (3) Soccer project → Project Settings → General → **Transfer project** → choose the free org; (4) open the app and sign in to confirm it still works; (5) next Supabase invoice should drop by ~US$10.
- No code or `.env.local` changes needed: the project URL and keys stay the same.
- If the app sits unused 7+ days it pauses; restore it from the dashboard before the next game day.
