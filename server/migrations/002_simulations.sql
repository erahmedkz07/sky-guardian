-- ─── Simulation Results ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS simulation_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  operator_name VARCHAR(100),
  scenario_id   VARCHAR(20)  NOT NULL,
  scenario_name VARCHAR(200) NOT NULL,
  difficulty    VARCHAR(20)  NOT NULL,
  score         SMALLINT     NOT NULL,
  neutralized   SMALLINT     NOT NULL,
  threats       SMALLINT     NOT NULL,
  elapsed_s     INTEGER      NOT NULL,
  aborted       BOOLEAN      NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sim_results_user_id      ON simulation_results(user_id);
CREATE INDEX IF NOT EXISTS idx_sim_results_completed_at ON simulation_results(completed_at DESC);
