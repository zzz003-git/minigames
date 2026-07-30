-- ㉕ 오늘의 한 잔 — 내 앨범 (docs/pour-game.md §3)
--
-- 만든 잔의 **색 조합**만 남깁니다. 잔 그림을 저장하지 않는 이유는 화면에 필요한 것이
-- 「이 조합을 만들어 봤는가」뿐이고, 그림은 조합에서 다시 그릴 수 있기 때문입니다.
-- 최근 60개만 보관합니다 — 오래 한 사용자의 행이 계속 자라지 않게 합니다.
CREATE TABLE pour_album (
  user_id    TEXT PRIMARY KEY,
  mixes_json TEXT NOT NULL DEFAULT '[]',  -- ["pink-yellow-cream", ...]
  cups       INTEGER NOT NULL DEFAULT 0,  -- 만든 잔 수
  runs       INTEGER NOT NULL DEFAULT 0,  -- 첫 주 완화 배정(목표선을 높게)의 기준
  updated_at INTEGER NOT NULL
);
