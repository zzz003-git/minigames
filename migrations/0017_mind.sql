-- 🔬 마음연구소 (MIND-SPEC-01 §3)
--
-- ── 저장하지 않는 것 (명시) ──────────────────────────────────────────────
-- 문항별 응답 원문 · 전국 추측 응답 · 상대 이름·연락처.
-- 남기는 것은 **유형과 축 증가분**뿐이다. 어떤 선택지를 골랐는지는 유형을 계산한 뒤
-- 버린다 — 심리검사가 아니라 오락이고, 원문을 쥐고 있을 이유가 없다.

-- 오늘의 실험 진행.
CREATE TABLE mind_daily (
  user_id          TEXT NOT NULL,
  day              TEXT NOT NULL,
  done             INTEGER NOT NULL DEFAULT 0,
  exp_id           TEXT,                       -- 그날 배정된 실험
  type_idx         INTEGER,                    -- 판정된 유형 (0~3)
  ad_archive_used  INTEGER NOT NULL DEFAULT 0, -- 지난 실험 열기 (≤2)
  ad_stats         INTEGER NOT NULL DEFAULT 0, -- 분포 열람 해제
  pair_reward_paid INTEGER NOT NULL DEFAULT 0, -- 페어 성사 보상 (S-4)
  PRIMARY KEY (user_id, day)
);

-- 마음 지도 — 축 8개.
--
-- **월 단위로 리셋한다**(기획서 M-03). 지도가 영구히 쌓이면 한 번 채운 뒤로는
-- 아무 일도 일어나지 않아 재방문 이유가 사라진다. 지난 달 지도는 행이 남으므로
-- 이력 조회가 가능하다.
CREATE TABLE mind_axes (
  user_id       TEXT NOT NULL,
  month         TEXT NOT NULL,   -- 'YYYY-MM'
  ax            TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0]',
  portrait_paid INTEGER NOT NULL DEFAULT 0,    -- 「마음 초상」 발급 (중복 방지)
  PRIMARY KEY (user_id, month)
);

-- 도감 — 실험별로 어떤 유형이 나왔는지. 같은 실험에서 다른 유형이 나오면 새 칸이다.
CREATE TABLE mind_coll (
  user_id   TEXT NOT NULL,
  exp_id    TEXT NOT NULL,
  type_idx  INTEGER NOT NULL,
  first_day TEXT NOT NULL,
  PRIMARY KEY (user_id, exp_id, type_idx)
);
