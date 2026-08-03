-- 페어 링크 — 스위트 3종이 공유하는 단일 인프라 (SUITE-SPEC-01 §1.6)
--
-- ── 링크만으로 참여한다 ──────────────────────────────────────────────────
-- 상대는 가입도 설치도 이름 입력도 하지 않는다. `/p/{token}` 하나로 끝난다.
-- 기획서가 유입의 본체로 지목한 동선이고(여정 B), 마찰이 0 이어야 성립한다.
--
-- ── 원문을 오래 갖고 있지 않는다 ─────────────────────────────────────────
-- `answer` 는 상대의 응답 원문이 잠깐 들어왔다가, 지수를 계산한 **직후 요약으로
-- 치환**된다(적중 배열과 지수만 남는다). 남의 답을 원문으로 쥐고 있을 이유가 없다.
-- 사주 페어의 상대 생년월일은 아예 서버로 오지 않는다(클라 계산·즉시 폐기).
CREATE TABLE pair_link (
  token       TEXT PRIMARY KEY,              -- 128bit urlsafe 랜덤
  service     TEXT NOT NULL,                 -- 'mind' | 'saju' | 'tarot'
  owner_id    TEXT NOT NULL,
  relation    TEXT NOT NULL,                 -- 'lover'|'friend'|'family'|'coworker'
  day         TEXT NOT NULL,
  payload     TEXT NOT NULL,                 -- JSON (서비스별 — mind = 문항idx + 내 추측 + 근거)
  status      TEXT NOT NULL DEFAULT 'open',  -- open | answered | expired
  answer      TEXT,                          -- JSON 요약 (원문 아님 — 위 주석)
  created_at  INTEGER NOT NULL,
  answered_at INTEGER
);

CREATE INDEX idx_pair_owner ON pair_link (owner_id, day);
-- 30일 지난 행 삭제 배치가 쓴다
CREATE INDEX idx_pair_created ON pair_link (created_at);

-- 관계별 최고 지수 — "엄마와 64%" 를 다음에 보여 주기 위한 것.
-- 관계 태그는 4종뿐이고 이름·연락처는 받지 않는다.
CREATE TABLE mind_pair_best (
  user_id  TEXT NOT NULL,
  relation TEXT NOT NULL,
  best_pct INTEGER NOT NULL,
  last_day TEXT NOT NULL,
  PRIMARY KEY (user_id, relation)
);
