-- 🔮 오늘의 타로 2단계 — 금빛 도감 (TAROT-SPEC-03 §5-1)
--
-- 도감 78장을 다 모은 뒤의 두 번째 바퀴다. 칸은 그대로 두고 「금빛인가」만 덧붙인다.
-- 별가루는 1회차와 같은 `tarot_meta.dust` 를 쓴다 — 교환 끈(`ex_pending`)도 같이 쓴다.

ALTER TABLE tarot_coll ADD COLUMN gold INTEGER NOT NULL DEFAULT 0;
-- 금빛이 된 날 — 숨은 이야기가 열린 날이기도 하다
ALTER TABLE tarot_coll ADD COLUMN gold_day TEXT;
-- 'draw' | 'dust'
ALTER TABLE tarot_coll ADD COLUMN gold_via TEXT;
