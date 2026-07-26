-- 오래된 결과의 상세 기록(detail_json)을 정리하는 Cron 용 인덱스
--
-- compactResultDetails 는 "오래된 것부터" 처리합니다:
--   WHERE created_at < ? AND json_extract(detail_json,'$.c') IS NULL ORDER BY created_at ASC LIMIT ?
--
-- 기존 인덱스는 모두 game_type 이 선두라 게임 구분 없이 오래된 순으로 훑을 수 없었습니다.
-- created_at 단독 인덱스가 있으면 앞에서 LIMIT 만큼만 읽고 멈춥니다.
-- (sessions 정리에 idx_sessions_cleanup 을 둔 것과 같은 이유)

CREATE INDEX IF NOT EXISTS idx_results_cleanup ON results (created_at);
