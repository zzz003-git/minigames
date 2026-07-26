-- 아케이드 미니게임 10종 추가 (docs/arcade-10-games.md)
--
-- 새 테이블은 없습니다. sessions / results / attempts / ad_views / user_progress 를 그대로 씁니다.
-- 바꾸는 것은 제약 조건 두 개입니다.
--
-- ① sessions.game_type 의 CHECK
--    기존:  CHECK (game_type IN ('STOPWATCH','BASEBALL','TYPING','MEMORY'))
--           → 게임을 추가할 때마다 마이그레이션이 필요했습니다.
--    변경:  형식 검사(대문자 영문 2~20자)로 완화합니다.
--           허용 목록의 단일 출처는 src/lib/config.js 의 GAME_TYPES 이고 모든 입력이
--           requireOneOf(GAME_TYPES) 를 통과하므로, DB 에 목록을 이중으로 둘 이유가 없습니다.
--           (두 곳이 어긋나면 원인을 찾기 어려운 500 이 납니다)
--
-- ② results → sessions 외래키 제거
--    SQLite 는 CHECK 를 ALTER 로 못 바꾸므로 sessions 를 재생성해야 하는데, results 가
--    sessions 를 참조하고 있어 재생성이 막힙니다(PRAGMA defer_foreign_keys 로도 통과하지 못함).
--    이 외래키가 실제로 하던 일은 앱 코드가 이미 더 엄격하게 합니다 —
--    getOpenSession() 이 세션의 존재·소유자·게임 종류·상태·만료를 전부 확인하고,
--    results 는 그 검증을 통과한 세션으로만 기록됩니다.
--    중복 제출을 막는 results.session_id UNIQUE 제약은 그대로 유지합니다.
--    앞으로 게임을 더 추가할 때는 마이그레이션이 필요 없습니다.
--
-- 순서가 중요합니다: results 의 외래키를 먼저 없애야 sessions 를 자유롭게 재생성할 수 있습니다.

-- ─────────────────────────────────────────────────────────────
-- ① results 재생성 (외래키 제거, 그 외 동일)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE results_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL UNIQUE,          -- 세션 중복 제출 방지
  game_type    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  bucket       TEXT NOT NULL,
  rank_metric  REAL NOT NULL,
  score        REAL NOT NULL DEFAULT 0,
  accuracy     REAL,
  detail_json  TEXT NOT NULL DEFAULT '{}',
  suspect      INTEGER NOT NULL DEFAULT 0,    -- 1 = 검증 이상치 (통계에서 제외)
  created_at   INTEGER NOT NULL
);

INSERT INTO results_new
  (id, session_id, game_type, user_id, bucket, rank_metric, score, accuracy, detail_json, suspect, created_at)
SELECT
   id, session_id, game_type, user_id, bucket, rank_metric, score, accuracy, detail_json, suspect, created_at
FROM results;

DROP TABLE results;

ALTER TABLE results_new RENAME TO results;

CREATE INDEX idx_results_bucket ON results (game_type, bucket, suspect, rank_metric);
CREATE INDEX idx_results_user ON results (user_id, game_type, created_at DESC);

-- 아케이드 게임은 결과 화면에 "내 최고 기록" 을 매번 띄우므로 이 조회가 잦습니다.
CREATE INDEX idx_results_user_game ON results (user_id, game_type, bucket, rank_metric);

-- ─────────────────────────────────────────────────────────────
-- ② sessions 재생성 (game_type CHECK 완화)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE sessions_new (
  session_id    TEXT PRIMARY KEY,
  game_type     TEXT NOT NULL CHECK (
                  length(game_type) BETWEEN 2 AND 20
                  AND game_type GLOB '[A-Z][A-Z]*'
                ),
  user_id       TEXT NOT NULL,
  start_ts      INTEGER NOT NULL,  -- 세션 생성 시각
  armed_ts      INTEGER,           -- 실제 플레이가 시작된 시각
  end_ts        INTEGER,
  secret_json   TEXT NOT NULL DEFAULT '{}',
  meta_json     TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  attempts_left INTEGER NOT NULL DEFAULT 0,
  ad_views      INTEGER NOT NULL DEFAULT 0,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL
);

INSERT INTO sessions_new
  (session_id, game_type, user_id, start_ts, armed_ts, end_ts,
   secret_json, meta_json, status, attempts_left, ad_views, ip_hash, created_at)
SELECT
   session_id, game_type, user_id, start_ts, armed_ts, end_ts,
   secret_json, meta_json, status, attempts_left, ad_views, ip_hash, created_at
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_user ON sessions (user_id, game_type, created_at DESC);
CREATE INDEX idx_sessions_status ON sessions (status, created_at);
