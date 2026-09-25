"""
S1 prediction ledger (SQLite). Every prediction the twin makes is written down
BEFORE its outcome is known and resolved afterwards. That record is what the
reliability plot and "how often was the twin right" come from.
"""

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS engines (
  engine_id TEXT PRIMARY KEY, serial TEXT, age0_h REAL, scripted TEXT
);
CREATE TABLE IF NOT EXISTS sorties (
  engine_id TEXT, sortie INTEGER, age_h REAL, duration_h REAL, power REAL,
  failed INTEGER, failure_kind TEXT, sf_channel TEXT, sf_mode TEXT, active_faults TEXT,
  PRIMARY KEY (engine_id, sortie)
);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine_id TEXT, sortie INTEGER, model TEXT, kind TEXT,
  made_at_age_h REAL, value REAL, payload TEXT
);
CREATE TABLE IF NOT EXISTS outcomes (
  prediction_id INTEGER PRIMARY KEY REFERENCES predictions(id),
  realized REAL, correct INTEGER, payload TEXT
);
CREATE INDEX IF NOT EXISTS ix_pred ON predictions(engine_id, sortie, model);
"""


class Ledger:
    def __init__(self, path: Path, fresh: bool = False):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path))
        if fresh:
            # drop rather than delete the file: on Windows the API may hold it open
            self.db.executescript("DROP TABLE IF EXISTS outcomes; DROP TABLE IF EXISTS predictions; "
                                  "DROP TABLE IF EXISTS sorties; DROP TABLE IF EXISTS engines;")
        self.db.executescript(SCHEMA)

    def add_engine(self, engine_id, serial, age0_h, scripted):
        self.db.execute("INSERT OR REPLACE INTO engines VALUES (?,?,?,?)", (engine_id, serial, age0_h, scripted))

    def add_sortie(self, r):
        self.db.execute("INSERT OR REPLACE INTO sorties VALUES (?,?,?,?,?,?,?,?,?,?)", (
            r["engine_id"], int(r["sortie"]), float(r["age_h"]), float(r["duration_h"]), float(r["power"]),
            int(bool(r["failed"])), r["failure_kind"], r["sf_channel"], r["sf_mode"], r["active_faults"]))

    def predict(self, engine_id, sortie, model, kind, age_h, value=None, payload=None) -> int:
        cur = self.db.execute(
            "INSERT INTO predictions (engine_id, sortie, model, kind, made_at_age_h, value, payload) "
            "VALUES (?,?,?,?,?,?,?)",
            (engine_id, int(sortie), model, kind, float(age_h),
             None if value is None else float(value), json.dumps(payload) if payload is not None else None))
        return int(cur.lastrowid)

    def resolve(self, prediction_id, realized=None, correct=None, payload=None):
        self.db.execute("INSERT OR REPLACE INTO outcomes VALUES (?,?,?,?)", (
            prediction_id, None if realized is None else float(realized),
            None if correct is None else int(bool(correct)), json.dumps(payload) if payload is not None else None))

    def commit(self):
        self.db.commit()

    def query(self, sql, args=()):
        cur = self.db.execute(sql, args)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def stats(self):
        return self.query("""
            SELECT p.model, p.kind, COUNT(*) AS n, COUNT(o.prediction_id) AS resolved,
                   AVG(o.correct) AS accuracy
            FROM predictions p LEFT JOIN outcomes o ON o.prediction_id = p.id
            GROUP BY p.model, p.kind ORDER BY p.model""")
