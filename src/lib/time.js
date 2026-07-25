/**
 * 시각 유틸
 *
 * 모든 타임스탬프는 서버(Worker) 기준 Unix epoch 밀리초입니다.
 * "일일 N회" 한도는 한국 사용자 기준이므로 KST(UTC+9) 자정에 리셋합니다.
 * UTC 자정을 쓰면 한국에서 오전 9시에 리셋되어 어색합니다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const now = () => Date.now();

/** 'YYYY-MM-DD' (KST 기준) — attempts/ad_views 의 day 컬럼 값 */
export function dayKey(ts = Date.now()) {
  return new Date(ts + KST_OFFSET_MS).toISOString().slice(0, 10);
}
