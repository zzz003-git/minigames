-- 미니게임 4종 초기 스키마
-- 기획서 12장 「공통 API / 데이터 명세」의 GameSession 구조를 기준으로 설계.
-- 모든 시각(ts)은 서버 기준 Unix epoch 밀리초(INTEGER)로 저장합니다.

-- ---------------------------------------------------------------
-- 게임 세션
-- secret_json 에는 클라이언트에 절대 노출하면 안 되는 값이 들어갑니다.
--   STOPWATCH : { "target_ms": 3470 }
--   BASEBALL  : { "answer": "371" }
--   MEMORY    : { "digits": "837149" }   (노출은 하지만 채점 기준값으로 보관)
--   TYPING    : { "sentence_id": 42 }
-- ---------------------------------------------------------------
CREATE TABLE sessions (
  session_id    TEXT PRIMARY KEY,
  game_type     TEXT NOT NULL CHECK (game_type IN ('STOPWATCH','BASEBALL','TYPING','MEMORY')),
  user_id       TEXT NOT NULL,
  start_ts      INTEGER NOT NULL,  -- 세션 생성 시각
  armed_ts      INTEGER,           -- 실제 플레이가 시작된 시각 (START 탭 / 카운트다운 종료)
  end_ts        INTEGER,
  secret_json   TEXT NOT NULL DEFAULT '{}',
  meta_json     TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  attempts_left INTEGER NOT NULL DEFAULT 0,
  ad_views      INTEGER NOT NULL DEFAULT 0,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id, game_type, created_at DESC);
CREATE INDEX idx_sessions_status ON sessions (status, created_at);

-- ---------------------------------------------------------------
-- 게임 결과 (통계·랭킹 집계 대상)
-- bucket = 통계 묶음 키. 같은 bucket 안에서 Percentile을 계산합니다.
--   STOPWATCH : 목표 타임        예) '3.47'
--   TYPING    : 언어:난이도      예) 'ko:normal'
--   MEMORY    : 레벨            예) 'LV6'
--   BASEBALL  : 전체 단일 묶음   예) 'all'
-- rank_metric = 순위 계산용 단일 실수값. 값이 "작을수록 좋은" 지표로 정규화해서 저장합니다.
--   STOPWATCH : 오차(ms)              작을수록 좋음
--   BASEBALL  : 시도 횟수             작을수록 좋음
--   TYPING    : -최종점수             작을수록 좋음(점수는 클수록 좋으므로 부호 반전)
--   MEMORY    : -(맞힌 자리수 * 1000 - 소요초)  작을수록 좋음
-- ---------------------------------------------------------------
CREATE TABLE results (
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
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (session_id)
);

CREATE INDEX idx_results_bucket ON results (game_type, bucket, suspect, rank_metric);
CREATE INDEX idx_results_user ON results (user_id, game_type, created_at DESC);

-- ---------------------------------------------------------------
-- 광고 시청 기록 (기획서 11장 트리거 명세)
-- ad_type: REWARDED | INTERSTITIAL
-- ---------------------------------------------------------------
CREATE TABLE ad_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  session_id TEXT,
  game_type  TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  ad_type    TEXT NOT NULL CHECK (ad_type IN ('REWARDED','INTERSTITIAL')),
  ip_hash    TEXT,
  day        TEXT NOT NULL,                   -- 'YYYY-MM-DD' (UTC) 일일 한도 집계용
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_adviews_daily ON ad_views (user_id, game_type, trigger, day);
CREATE INDEX idx_adviews_ip ON ad_views (ip_hash, day);

-- ---------------------------------------------------------------
-- 도전 기회 잔여 (일일 리셋)
-- ---------------------------------------------------------------
CREATE TABLE attempts (
  user_id    TEXT NOT NULL,
  game_type  TEXT NOT NULL,
  day        TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  granted    INTEGER NOT NULL DEFAULT 0,      -- 광고로 추가 지급된 기회
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_type, day)
);

-- ---------------------------------------------------------------
-- 유저 진행도 (기억력 최고 레벨 등)
-- ---------------------------------------------------------------
CREATE TABLE user_progress (
  user_id    TEXT NOT NULL,
  game_type  TEXT NOT NULL,
  best_level INTEGER NOT NULL DEFAULT 0,
  best_score REAL NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_type)
);

-- ---------------------------------------------------------------
-- 타이핑 문장 DB (기획서 7장 — 한국어 100+/영어 100+/혼합 50+)
-- ---------------------------------------------------------------
CREATE TABLE sentences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lang       TEXT NOT NULL CHECK (lang IN ('ko','en','mix')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','normal','hard')),
  text       TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  word_count INTEGER NOT NULL
);

CREATE INDEX idx_sentences_pick ON sentences (lang, difficulty);
