-- 🔮 오늘의 타로 — 금빛 단계 진입 안내 (TAROT-SPEC-03 §1-1)
--
-- 78장 완성 화면을 **끝까지 봤는가**(탭으로 닫았는가). 0 이면 다음 방문 첫 화면에 다시 나온다 —
-- 교환으로 완성됐거나 연출 도중에 나간 사람이 금빛 단계를 모른 채 남지 않게.
ALTER TABLE tarot_meta ADD COLUMN gold_intro_seen INTEGER NOT NULL DEFAULT 0;
