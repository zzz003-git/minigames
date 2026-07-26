-- 규모 확장 대비 인덱스
--
-- 10만 DAU 를 가정하고 측정한 결과 두 가지 문제가 나왔습니다 (로컬 D1, 100만 행).
--
-- ① 통계 집계가 기록 수에 비례해 느려짐
--      histogram      20만 건 129ms → 100만 건 605ms
--      리그별 집계     20만 건 399ms → 100만 건 1,886ms
--    게다가 histogram 은 해당 리그의 모든 rank_metric 을 Worker 로 가져와 세고 있었습니다.
--    100만 건이면 100만 개짜리 배열이 Worker 메모리(128MB)로 들어옵니다.
--    → 집계를 SQL 안에서 하고, 대상을 "최근 COMMON.STATS_WINDOW 건" 으로 고정했습니다.
--      그 쿼리가 created_at 역순으로 리그를 훑으므로 그에 맞는 인덱스가 필요합니다.
--
-- ② 세션 행이 무한히 쌓임
--    10만 DAU × 14게임 × 3판 = 하루 420만 세션. 세션 1건이 평균 2KB(정답·문항 배열)라
--    하루 5.7GB 로 D1 상한(10GB)을 이틀도 못 버팁니다.
--    → closeSession 이 정답을 즉시 비우고, Cron 이 오래된 행을 지웁니다(10분마다).
--      정리 쿼리가 created_at 과 status 로 대상을 찾으므로 그에 맞는 인덱스가 필요합니다.

-- ① 통계 집계용: 리그 안에서 최신 기록부터 N건
CREATE INDEX IF NOT EXISTS idx_results_recent
  ON results (game_type, bucket, suspect, created_at DESC);

-- ① 게임 전체(리그 무관) 최신 기록부터 N건 — 리그별 집계·숫자야구·기억력 통계
CREATE INDEX IF NOT EXISTS idx_results_game_recent
  ON results (game_type, suspect, created_at DESC);

-- ② 세션 정리용: 오래된 것부터 찾기
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON sessions (created_at);
