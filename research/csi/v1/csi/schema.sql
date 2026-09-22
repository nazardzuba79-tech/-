CREATE TABLE IF NOT EXISTS series (
 source TEXT NOT NULL, metric TEXT NOT NULL, asset TEXT NOT NULL DEFAULT '',
 date TEXT NOT NULL, available_at TEXT NOT NULL, value REAL,
 ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY (source,metric,asset,date)
);
CREATE TABLE IF NOT EXISTS collection_log (
 source TEXT, metric TEXT, asset TEXT, rows INTEGER, first_date TEXT, last_date TEXT,
 status TEXT, message TEXT, run_at TEXT NOT NULL DEFAULT (datetime('now'))
);