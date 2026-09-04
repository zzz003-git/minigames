-- ✍✍ 너의스토리2 — 배우 선택과 캐스팅 결과
-- (프런트 설계서 §3·§5 · 지시요청 `yourstory2_devrequest_20260828.md` §1)
--
-- ── 프런트가 쓰는 칸은 하나뿐이다 ────────────────────────────────────────
-- 고객이 화면에서 정하는 것은 **화자 배우 하나**(`actor_choice`)다. 캐스팅 결과는
-- 전부 워커가 쓰고 화면은 읽기만 한다(설계서 §3 마지막 줄). 그래서 쓰기 칸과
-- 읽기 표를 나눈다 — 한 표에 섞으면 「누가 쓴 값인가」가 흐려진다.
--
-- ── 왜 `ys_order` 확장이 아니라 새 표인가 ────────────────────────────────
-- 캐스팅은 **주문 하나에 여러 행**이다(배역 수만큼). 주문 표에 담으려면 JSON 한
-- 칸으로 뭉쳐야 하는데, 그러면 「이 배우로 만든 작품 모으기」(나의 기록들)가
-- JSON 파싱 없이는 불가능해진다. 선반이 이 서비스의 재이용 회로라(설계서 §1-[7])
-- 그 질의만은 인덱스로 서야 한다.
--
-- 대신 **선반 그룹핑 키 하나만** 주문 표에 되풀이해 둔다(`narrator_actor_id`) —
-- 목록 화면이 주문 20건마다 캐스팅 표를 훑지 않게 하는 것이 목적이고, 이 값의
-- 진실은 언제나 `ys_cast` 의 `is_narrator` 행이다.

-- 고객이 고른 화자 배우 (설계서 §3 정본)
--   'auto'          AI 추천 · 기본값 (track ys2)
--   'C01'~'C10'     배우 지정        (track ys2)
--   'custom'        이야기 맞춤 인물  (track ys1 — 기존 방식)
-- YS1 주문(기존 45건)은 NULL 이다. 「고른 적 없음」과 「맞춤을 골랐음」은 다르다
ALTER TABLE ys_order ADD COLUMN actor_choice TEXT;

-- 선반 그룹핑 키 — 배정된 **화자** 배우. 폴백(새 얼굴)이면 NULL 이고,
-- 그런 작품은 「나의 다른 기록」 선반 하나로 모인다 (설계서 §1-[7])
ALTER TABLE ys_order ADD COLUMN narrator_actor_id TEXT;

-- 캐스팅 보드가 읽는 표. **한 배역이 한 행**이다.
--
-- `gate_original_actor_id` 는 고객이 골랐지만 게이트가 대체한 경우에만 찬다.
-- 「조용히 무시하지 않는다」가 이 칸의 존재 이유다(설계서 §1-[5] 게이트 고지 ·
-- F1 원칙 6) — 값이 없으면 화면은 아무 말도 하지 않고, 값이 있으면 정본 문안
-- 한 줄이 보드 하단에 선다.
CREATE TABLE ys_cast (
  order_id               TEXT NOT NULL,
  seq                    INTEGER NOT NULL,  -- 보드에 찍히는 순서 (화자가 0)
  role_label             TEXT NOT NULL,     -- 이야기 속 호칭 («나(화자)» · «아버지»)
  actor_id               TEXT,              -- C01~C10 · NULL = 새 얼굴(폴백)
  actor_name             TEXT,              -- 표시용 사본 (배우 표가 바뀌어도 그때의 이름이 남는다)
  is_narrator            INTEGER NOT NULL DEFAULT 0,
  is_customer_pick       INTEGER NOT NULL DEFAULT 0,
  is_fallback            INTEGER NOT NULL DEFAULT 0,
  gate_original_actor_id TEXT,              -- 게이트가 대체했을 때만
  PRIMARY KEY (order_id, seq)
);

-- 선반 — 「이 배우가 화자였던 내 작품」. 설계서 §1-[7] 의 유일한 질의다
CREATE INDEX idx_ys_order_shelf ON ys_order (user_id, narrator_actor_id, created_at DESC);
