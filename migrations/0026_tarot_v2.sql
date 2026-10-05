-- 🔮 오늘의 타로 78장 개편 (TAROT-SPEC-02 §3)
--
-- SPEC 은 `CREATE TABLE IF NOT EXISTS tarot_meta` 로 적었지만 그 표는 0016 에 이미 있다
-- (웰컴 뽑기 플래그). IF NOT EXISTS 는 아무것도 하지 않고 넘어가므로 열을 덧붙인다.

-- 별가루. 0~3 을 유지한다 — 4가 되는 순간 같은 트랜잭션에서 교환하고 4를 뺀다.
ALTER TABLE tarot_meta ADD COLUMN dust INTEGER NOT NULL DEFAULT 0;
-- 누적(분석용) — 교환으로 빠져도 줄지 않는다
ALTER TABLE tarot_meta ADD COLUMN dust_total INTEGER NOT NULL DEFAULT 0;
-- 교환으로 받은 카드 수
ALTER TABLE tarot_meta ADD COLUMN exchanged INTEGER NOT NULL DEFAULT 0;
-- 교환 진행 표식. **한 batch 안에서만** 1 이고 batch 끝에서 0 으로 돌아온다.
-- 「차감했으면 지급한다」를 한 트랜잭션 안에서 잇는 끈이다(services/tarot.js exchangeDust).
ALTER TABLE tarot_meta ADD COLUMN ex_pending INTEGER NOT NULL DEFAULT 0;

-- 카드를 어떻게 얻었는가 — 'draw' | 'dust'
ALTER TABLE tarot_coll ADD COLUMN via TEXT NOT NULL DEFAULT 'draw';
