-- 너의스토리 — 한도 소진 시 「오늘은 그만 받는다」를 서버가 알게 한다.
--
-- PC 워커가 API 일일 한도(RPD)를 다 쓰면 남은 주문은 오늘 안에 끝나지 않는다.
-- 그런데 서버는 그 사실을 모르므로 접수를 계속 받고, 받은 주문은 전부 실패한다.
-- 워커가 `defer` 로 알려 주면 이 시각까지 신규 접수를 막고, 이미 받은 주문은
-- 실패가 아니라 **대기로 되돌린다**(티켓은 그대로 둔다).
ALTER TABLE ys_worker ADD COLUMN paused_until INTEGER;
ALTER TABLE ys_worker ADD COLUMN pause_reason TEXT;
