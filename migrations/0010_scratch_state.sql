-- ⑳ 슥슥 긁기 — 계정 단위 영속 상태 (docs/scratch-game.md §3)
--
-- 이 게임의 재방문 장치는 「매일 아침 새 카드」와 「연속 긁기 일수」입니다(기획서 9장).
-- 연속 일수는 판이 끝나도 남아야 하는 값이라 담을 곳이 필요합니다.
-- ⑲ store_state 에 이어 두 번째 영속 상태 테이블입니다.
--
-- user_progress 를 쓰지 않는 이유: best_level / best_score / play_count 세 값이 전부라
-- **마지막으로 긁은 날짜**를 담을 수 없습니다. 날짜가 없으면 "어제 긁었는가" 를 판정할
-- 수 없고, 그러면 연속이라는 개념 자체가 성립하지 않습니다.
--
-- 카드 내용(9칸의 심볼)은 여기 저장하지 않습니다. 그건 그 판의 정답이라
-- 세션에 암호화해 두고 판이 끝나면 사라집니다.

CREATE TABLE scratch_state (
  user_id    TEXT PRIMARY KEY,

  -- 연속으로 긁은 일수. 하루라도 건너뛰면 1로 되돌아갑니다.
  streak     INTEGER NOT NULL DEFAULT 0,

  -- 마지막으로 긁은 날 (KST 기준 'YYYY-MM-DD'). 연속 판정의 기준값입니다.
  last_day   TEXT,

  -- 누적 카드 수. 첫 주(ROOKIE_CARDS 미만) 완화 배정의 기준입니다.
  cards      INTEGER NOT NULL DEFAULT 0,

  -- 누적 매칭 완성 수. 결과 화면과 KPI(매칭 완성률)에 씁니다.
  matches    INTEGER NOT NULL DEFAULT 0,

  updated_at INTEGER NOT NULL
);
