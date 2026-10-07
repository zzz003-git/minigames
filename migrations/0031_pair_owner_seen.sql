-- 「너를 맞혀볼게」 — 보낸 사람이 결과를 봤는가 (REQ-65 묶음 1 · pair IMPL S1·S2 · F12)
--
-- 결과 도착 알림(`/today/` 맨 위 · 「전체」 한 줄)은 「답이 왔는데 아직 안 본」 링크에만 뜬다.
-- 그 판정이 owner_seen_at IS NULL 이다. 보낸 사람이 결과 화면(GET /api/mind/pair/view)을 처음
-- 열 때 기록한다.
--
-- 기존 답이 온 행은 answered_at 으로 채운다 — 비워 두면 배포 순간 지난 결과가 전부 「새 결과」로
-- 한꺼번에 켜진다.
--
-- 목록은 이제 날짜가 아니라 만든 시각 범위(72시간 + 보관 24시간)로 읽으므로
-- (owner_id, created_at) 인덱스를 더한다.
--
-- 되돌리기: DROP INDEX idx_pair_owner_created; ALTER TABLE pair_link DROP COLUMN owner_seen_at;

ALTER TABLE pair_link ADD COLUMN owner_seen_at INTEGER;
UPDATE pair_link SET owner_seen_at = answered_at WHERE status = 'answered' AND owner_seen_at IS NULL;
CREATE INDEX idx_pair_owner_created ON pair_link (owner_id, created_at);
