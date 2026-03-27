export type PlayerType = "regular" | "casual";
export type RsvpStatus = "confirmed" | "absent" | "maybe";
export type SessionStatus = "upcoming" | "signups_closed" | "teams_published" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "paid";
export type NotificationChannel = "sms" | "push" | "email" | "whatsapp";
export type SessionFormat = "2t" | "3t";

export interface Player {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  player_type: PlayerType;
  skill_rating: number;
  is_admin: boolean;
  is_active: boolean;
  auth_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  date: string;
  venue: string;
  start_time: string;
  end_time: string;
  format: SessionFormat;
  status: SessionStatus;
  court_cost: number;
  buffer_pct: number;
  court_payer_id: string | null;
  created_by: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Rsvp {
  id: string;
  session_id: string;
  player_id: string;
  status: RsvpStatus;
  rsvp_at: string;
  is_waitlist: boolean;
  waitlist_position: number | null;
  promoted_at: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  session_id: string;
  team_name: string;
  bib_color: string;
  avg_skill_rating: number | null;
  published_at: string | null;
  created_at: string;
}

export interface TeamPlayer {
  id: string;
  team_id: string;
  player_id: string;
}

export interface Payment {
  id: string;
  session_id: string;
  player_id: string;
  amount_due: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BufferFund {
  id: string;
  session_id: string;
  budget: number;
  visitor_cost: number;
  equipment_cost: number;
  surplus: number;
  rollover_to_session_id: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  player_id: string;
  session_id: string | null;
  channel: NotificationChannel;
  message: string;
  sent_at: string;
  status: string;
  created_at: string;
}

// Supabase Database type for type-safe queries
export interface Database {
  public: {
    Tables: {
      players: {
        Row: Player;
        Insert: Omit<Player, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Player, "id" | "created_at" | "updated_at">>;
      };
      sessions: {
        Row: Session;
        Insert: Omit<Session, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Session, "id" | "created_at" | "updated_at">>;
      };
      rsvps: {
        Row: Rsvp;
        Insert: Omit<Rsvp, "id" | "created_at">;
        Update: Partial<Omit<Rsvp, "id" | "created_at">>;
      };
      teams: {
        Row: Team;
        Insert: Omit<Team, "id" | "created_at">;
        Update: Partial<Omit<Team, "id" | "created_at">>;
      };
      team_players: {
        Row: TeamPlayer;
        Insert: Omit<TeamPlayer, "id">;
        Update: Partial<Omit<TeamPlayer, "id">>;
      };
      payments: {
        Row: Payment;
        Insert: Omit<Payment, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Payment, "id" | "created_at" | "updated_at">>;
      };
      buffer_fund: {
        Row: BufferFund;
        Insert: Omit<BufferFund, "id" | "created_at">;
        Update: Partial<Omit<BufferFund, "id" | "created_at">>;
      };
      notifications: {
        Row: Notification;
        Insert: Omit<Notification, "id" | "created_at">;
        Update: Partial<Omit<Notification, "id" | "created_at">>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
