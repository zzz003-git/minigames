-- 순위표(TOP 20) 동점자 정렬까지 인덱스로 처리
--
-- topList 는 `ORDER BY rank_metric ASC, created_at ASC LIMIT 20` 입니다.
-- 기존 인덱스는 (game_type, bucket, suspect, rank_metric) 까지만 정렬을 담당해서,
-- rank_metric 이 같은 행들 사이 순서를 정하려면 그 동점자 전부를 읽어 정렬해야 했습니다.
--
-- 지표가 정수인 게임(도달 라운드·연속 성공)은 값의 종류가 수십 개뿐이라 기록이 쌓이면
-- 한 값에 동점자가 수만 명씩 몰립니다. 실측(로컬, ODDCOLOR):
--   100만 행 55ms → 300만 행 161ms (동점자 수에 비례해 증가)
--
-- created_at 을 인덱스 끝에 붙이면 ORDER BY 전체가 인덱스 순서와 같아져
-- 앞에서 20건만 읽고 끝납니다.
--
-- 새 인덱스는 기존 인덱스의 상위집합(prefix 가 동일)이므로 기존 것은 지웁니다 —
-- 남겨 두면 같은 일을 하는 인덱스를 두 벌 유지하며 쓰기 비용만 늘어납니다.

CREATE INDEX IF NOT EXISTS idx_results_top
  ON results (game_type, bucket, suspect, rank_metric, created_at);

DROP INDEX IF EXISTS idx_results_bucket;
