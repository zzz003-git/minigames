-- ⑲ 내 가게 채우기 — 계정 단위 영속 상태 (docs/store-game.md §3)
--
-- 앞의 18종은 판이 끝나면 results 에 기록만 남고 상태는 사라집니다.
-- 이 게임은 진열한 선반이 계정에 계속 쌓이므로 담을 곳이 필요합니다.
--
-- user_progress 를 쓰지 않는 이유: 그 테이블은 best_level / best_score / play_count
-- 세 값이 전부라 칸별 진열 내용과 도감을 담을 수 없습니다.
--
-- **진행 중인 선반만 저장합니다.** 완성된 선반은 칸 내용을 버리고 개수만 셉니다.
-- 전부 보관하면 오래 한 사용자의 행이 계속 자라 D1 용량에 그대로 얹히는데,
-- 화면에 필요한 것은 "몇 개 완성했는가" 와 "지금 채우는 선반이 어디까지 찼는가" 뿐입니다.

CREATE TABLE store_state (
  user_id      TEXT PRIMARY KEY,

  -- 코너별 진행 중인 선반. { "drink": [itemId|null × 4], "snack": [...], "living": [...] }
  shelves_json TEXT NOT NULL DEFAULT '{}',

  -- 도감 — 한 번이라도 진열해 본 상품 id. [1, 4, 7, ...]
  dex_json     TEXT NOT NULL DEFAULT '[]',

  -- 완성한 선반 수. 성장 단계의 근거입니다.
  done_shelves INTEGER NOT NULL DEFAULT 0,

  -- 누적 진열 칸 수. 순위 지표(rank_metric)로 씁니다.
  placed       INTEGER NOT NULL DEFAULT 0,

  updated_at   INTEGER NOT NULL
);
