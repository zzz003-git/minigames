-- ㉙ 소등 — 어제의 나 (docs/lightout-game.md §3)
--
-- 이 게임의 재방문 장치는 **어제 기록**입니다(원리 9). 개인 최고 기록으로 대신할 수
-- 없습니다 — 개인 최고는 한 번 잘 나오면 몇 달을 못 넘고, 그러면 8장의 광고 조건
-- (「어제보다 느렸을 때만 제안한다」)이 거의 항상 참이 되어 구원이 아니라 관문이 됩니다.
--
-- 하루 한 행이고 두 가지를 씁니다.
--   rooms    오늘 완주한 방 수 → 다음 방의 불빛 개수(첫 방 16 · 이후 24, 기획서 10장)
--   best_ms  오늘의 최고 기록 → 내일의 「어제 기록」
CREATE TABLE lightout_daily (
  user_id    TEXT NOT NULL,
  day        TEXT NOT NULL,              -- KST 'YYYY-MM-DD'
  rooms      INTEGER NOT NULL DEFAULT 0,
  best_ms    INTEGER,                    -- NULL = 아직 방을 완주하지 않음
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
