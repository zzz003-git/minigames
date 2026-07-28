-- ⑮ 다들 뭐 골랐을까 — 문항 은행과 집계 (docs/majority-game.md)
--
-- 이 게임에만 새 테이블이 필요합니다. 다른 아케이드 게임은 문제를 서버가 즉석에서
-- 만들지만(난수·색·수식), 이 게임의 "정답" 은 **다른 사람들의 선택 집계** 라서
-- 사용자 간에 공유되는 저장소가 있어야 합니다.
--
-- ── 표를 두 벌로 나눠 두는 이유 ────────────────────────────────────────────
-- snap_*  어제까지 확정된 누적 표. **판정은 이 값으로만 합니다.**
-- live_*  오늘 들어온 표. 자정(KST)에 snap_* 로 합쳐집니다.
--
-- 한 벌로 두고 실시간 집계를 정답으로 쓰면 두 가지가 무너집니다.
--   ① 자기실현 — 다수를 따라가면 맞으므로, 실시간 비율이 공개될수록 그쪽으로 쏠리고
--      쏠릴수록 더 따라가게 됩니다. 40:60 을 노려 문항을 설계해도 90:10 으로 수렴합니다.
--   ② 중간 결과 유통 — 오전 참여자가 결과 화면("62%")을 공유하면 오후 참여자는 그대로
--      찍으면 됩니다. 정답형 퀴즈의 정답 아카이브와 같은 실패 모드입니다.
-- 오늘의 표가 오늘의 정답을 바꾸지 않게 하면 ①이 사라지고, ②는 "그 문항의 답이
-- 하루 뒤 바뀔 수 있는" 형태가 되어 아카이브의 유효기간이 하루로 제한됩니다.
-- (완전 차단은 아닙니다 — docs/majority-game.md §6 「남아 있는 한계」)

CREATE TABLE majority_questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 분류. 광고주 문항은 'sponsor:<브랜드>' 로 넣으면 일반 문항과 같은 규칙으로 배정됩니다
  -- (기획서 10장 「선택지 자체가 광고주 상품」).
  topic      TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  option_a   TEXT NOT NULL,
  option_b   TEXT NOT NULL,

  snap_a     INTEGER NOT NULL DEFAULT 0,   -- 어제까지 확정된 표 (판정 기준)
  snap_b     INTEGER NOT NULL DEFAULT 0,
  live_a     INTEGER NOT NULL DEFAULT 0,   -- 오늘 들어온 표 (자정에 snap 으로 합산)
  live_b     INTEGER NOT NULL DEFAULT 0,

  -- 0 = 배정 중지. 문항을 지우지 않고 내리는 이유는 이미 쌓인 표를 잃지 않기 위해서입니다.
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- 배정 쿼리는 `WHERE active = 1 ORDER BY RANDOM() LIMIT n` 형태입니다.
CREATE INDEX idx_majority_active ON majority_questions (active);

-- ---------------------------------------------------------------
-- 일일 스냅샷 이월 기록
--
-- Cron 은 10분마다 돌지만 이월은 하루 한 번이어야 합니다. "오늘 날짜를 먼저 넣는 데
-- 성공한 실행" 만 이월을 수행하도록 해서, 실행이 겹쳐도 두 번 합산되지 않게 합니다.
-- (INSERT OR IGNORE 의 changes 로 판별 — SQLite 는 단일 기록자라 이것으로 충분합니다)
-- ---------------------------------------------------------------
CREATE TABLE majority_roll (
  day       TEXT PRIMARY KEY,   -- 'YYYY-MM-DD' (KST)
  rolled_at INTEGER NOT NULL,
  moved     INTEGER NOT NULL DEFAULT 0   -- 이월된 문항 수 (운영 확인용)
);
