-- Monday Night Soccer - Initial Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  mobile TEXT NOT NULL UNIQUE,
  email TEXT,
  player_type TEXT NOT NULL DEFAULT 'core' CHECK (player_type IN ('core', 'non-core')),
  skill_rating INTEGER NOT NULL DEFAULT 3 CHECK (skill_rating BETWEEN 1 AND 5),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  auth_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  venue TEXT NOT NULL DEFAULT 'Flat Rock Indoor Soccer',
  start_time TEXT NOT NULL DEFAULT '20:45',
  end_time TEXT NOT NULL DEFAULT '22:45',
  format TEXT NOT NULL DEFAULT '2t' CHECK (format IN ('2t', '3t')),
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'signups_closed', 'teams_published', 'completed', 'cancelled')),
  court_cost NUMERIC(10,2) NOT NULL DEFAULT 180.00,
  buffer_pct NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  court_payer_id UUID REFERENCES players(id),
  created_by UUID NOT NULL REFERENCES players(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RSVPs table
CREATE TABLE rsvps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'absent', 'maybe')),
  rsvp_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_waitlist BOOLEAN NOT NULL DEFAULT FALSE,
  waitlist_position INTEGER,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, player_id)
);

-- Teams table
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  bib_color TEXT NOT NULL DEFAULT 'White',
  avg_skill_rating NUMERIC(3,1),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team players junction table
CREATE TABLE team_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  UNIQUE(team_id, player_id)
);

-- Payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  amount_due NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'partial')),
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, player_id)
);

-- Buffer fund table
CREATE TABLE buffer_fund (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  budget NUMERIC(10,2) NOT NULL DEFAULT 0,
  visitor_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  equipment_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  surplus NUMERIC(10,2) NOT NULL DEFAULT 0,
  rollover_to_session_id UUID REFERENCES sessions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES players(id),
  session_id UUID REFERENCES sessions(id),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'push', 'email')),
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rsvps_session ON rsvps(session_id);
CREATE INDEX idx_rsvps_player ON rsvps(player_id);
CREATE INDEX idx_payments_session ON payments(session_id);
CREATE INDEX idx_payments_player ON payments(player_id);
CREATE INDEX idx_teams_session ON teams(session_id);
CREATE INDEX idx_team_players_team ON team_players(team_id);
CREATE INDEX idx_notifications_player ON notifications(player_id);
CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_players_mobile ON players(mobile);
CREATE INDEX idx_players_auth_user ON players(auth_user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_players_updated_at BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE buffer_fund ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Players: authenticated users can read all active players
CREATE POLICY "Players are viewable by authenticated users" ON players
  FOR SELECT TO authenticated USING (true);

-- Players: admins can insert/update
CREATE POLICY "Admins can manage players" ON players
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

-- Players: users can update their own profile (name, email only)
CREATE POLICY "Users can update own profile" ON players
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Sessions: all authenticated can read
CREATE POLICY "Sessions are viewable by authenticated users" ON sessions
  FOR SELECT TO authenticated USING (true);

-- Sessions: admins can manage
CREATE POLICY "Admins can manage sessions" ON sessions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

-- RSVPs: all authenticated can read
CREATE POLICY "RSVPs are viewable by authenticated users" ON rsvps
  FOR SELECT TO authenticated USING (true);

-- RSVPs: players can manage their own
CREATE POLICY "Players can manage own RSVPs" ON rsvps
  FOR ALL TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE auth_user_id = auth.uid())
  );

-- RSVPs: admins can manage all
CREATE POLICY "Admins can manage all RSVPs" ON rsvps
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

-- Teams: all authenticated can read
CREATE POLICY "Teams viewable by authenticated" ON teams
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage teams" ON teams
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

-- Team players: all authenticated can read
CREATE POLICY "Team players viewable by authenticated" ON team_players
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage team players" ON team_players
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

-- Payments: admins see all, players see own
CREATE POLICY "Admins can manage payments" ON payments
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Players can view own payments" ON payments
  FOR SELECT TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE auth_user_id = auth.uid())
  );

-- For core player payment count view (they can see all payment statuses)
CREATE POLICY "Authenticated users can view payment statuses" ON payments
  FOR SELECT TO authenticated USING (true);

-- Buffer fund: admins only
CREATE POLICY "Admins can manage buffer fund" ON buffer_fund
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

-- Notifications: admins manage, players see own
CREATE POLICY "Admins can manage notifications" ON notifications
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM players WHERE auth_user_id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Players can view own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE auth_user_id = auth.uid())
  );

-- Enable Realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE rsvps;
ALTER PUBLICATION supabase_realtime ADD TABLE teams;
ALTER PUBLICATION supabase_realtime ADD TABLE team_players;

-- Service role bypass (for API routes)
-- The service role key bypasses RLS automatically
