-- ㉗ 오늘의 전국 게이지 — 사용자 간 공용 상태 (docs/gauge-game.md §4)
--
-- ⑮ 다들 뭐 골랐을까에 이어 **두 번째 공용 테이블**입니다. 하루 한 행이고, 증가는
-- `SET total = total + ?` 한 문장으로 합니다 — 읽고 더해서 쓰는 방식이 아니라 한 문장이라
-- 동시 기여에서 값이 유실되지 않습니다(SQLite 가 쓰기를 직렬화합니다).
--
-- 대규모에서 걸리는 것은 정확성이 아니라 **쓰기 처리량**입니다. 그 지점에서는 캐시
-- 계층이나 Durable Objects 로 옮겨야 하고, 그때도 이 표의 뜻은 그대로입니다.
CREATE TABLE gauge_daily (
  day        TEXT PRIMARY KEY,           -- KST 'YYYY-MM-DD'
  total      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 개인 기여량. 순위 지표(내 누적 기여)와 하루 한도 확인에 씁니다.
CREATE TABLE gauge_contrib (
  user_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  tokens     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
