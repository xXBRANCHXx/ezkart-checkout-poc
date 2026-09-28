-- Preserve immutable original $0.01 attempts; richer evidence reserves an atomic supplement.
CREATE TABLE jev_budget_supplements(
 attempt_id TEXT PRIMARY KEY REFERENCES jev_attempts(id),
 budget_microusd INTEGER NOT NULL CHECK(budget_microusd>0 AND budget_microusd<=990000)
);
CREATE TRIGGER jev_budget_supplements_no_update BEFORE UPDATE ON jev_budget_supplements BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_budget_supplements_no_delete BEFORE DELETE ON jev_budget_supplements BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
