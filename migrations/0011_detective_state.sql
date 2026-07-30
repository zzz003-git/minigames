-- ㉒ 3초 탐정 — 미해결 사건 이월
--
-- 못 찾은 사건은 다음 날 **그 장면 그대로** 다시 옵니다(기획서 4장 7번).
-- 그래서 장면(아이콘 배치 + 변경 대상)을 보관해야 합니다. 한 건에 아이콘 8~12개 ×
-- 약 40바이트라 최대 5건이어도 2KB 안쪽입니다.
--
-- user_progress 를 쓰지 않는 이유: 그 테이블은 best_level / best_score / play_count
-- 세 값이 전부라 장면을 담을 수 없습니다.
CREATE TABLE detective_state (
  user_id    TEXT PRIMARY KEY,
  cases_json TEXT NOT NULL DEFAULT '[]',  -- 미해결 사건 (해결하면 빠집니다)
  runs       INTEGER NOT NULL DEFAULT 0,  -- 누적 판 수 (첫 주 노출 완화의 기준)
  solved     INTEGER NOT NULL DEFAULT 0,
  redone     INTEGER NOT NULL DEFAULT 0,  -- 미해결을 다음 날 해결한 횟수
  updated_at INTEGER NOT NULL
);
