/**
 * 게임 규칙 상수 — 기획서의 수치를 한 곳에 모아 둡니다.
 * 규칙을 바꿀 때는 이 파일만 수정하면 서버·검증 로직에 일괄 반영됩니다.
 */

export const GAME_TYPES = ["STOPWATCH", "BASEBALL", "TYPING", "MEMORY"];

// ── ① 스탑워치 챌린지 ────────────────────────────────────────────
export const STOPWATCH = {
  // 목표 타임 1.00초 ~ 9.99초, 0.01초 단위 = 900가지 (기획서 3장)
  TARGET_MIN_MS: 1000,
  TARGET_MAX_MS: 9990,
  TARGET_STEP_MS: 10,

  BASE_ATTEMPTS_PER_DAY: 5, // 와이어프레임 화면① 도전 횟수 표시 5칸
  AD_ATTEMPTS_PER_VIEW: 1, // 광고 1회 시청 → 기회 +1
  AD_VIEWS_PER_DAY: 3, // Rewarded 3회/일 (기획서 11장)

  // 검증 허용 오차: 클라이언트 신고 시간이 서버 관측 시간창을 이만큼 넘으면 조작으로 간주
  DRIFT_TOLERANCE_MS: 500,
  // START 탭 시각(armed_ts)이 기록된 경우: 시간창과 신고값 차이는 네트워크 지연 수준이어야 함
  ARMED_IDLE_MS: 2500,
  // armed_ts 가 없어 세션 생성 시각을 기준으로 볼 때의 느슨한 허용치
  MAX_IDLE_MS: 20000,
  // 사람이 물리적으로 도달하기 어려운 정확도 → 이상치로 표시
  IMPOSSIBLE_GAP_MS: 2,
  ELAPSED_MIN_MS: 100,
  ELAPSED_MAX_MS: 30000,
};

// ── ② 숫자야구 ─────────────────────────────────────────────────
export const BASEBALL = {
  DIGITS: 3, // 0~9 중 중복 없는 3자리
  BASE_ATTEMPTS: 6, // 기본 6회
  AD_ATTEMPTS_PER_VIEW: 3, // 광고 1회당 +3회
  AD_VIEWS_PER_GAME: 3, // 1게임당 광고 최대 3회 (= 최대 +9회)
};

// ── ③ 타이핑 스피드 ────────────────────────────────────────────
export const TYPING = {
  LANGS: ["ko", "en", "mix"],
  DIFFICULTIES: ["easy", "normal", "hard"],

  BASE_ATTEMPTS_PER_DAY: 5,
  AD_ATTEMPTS_PER_VIEW: 1, // 새 문장 +1
  AD_VIEWS_PER_DAY: 5, // Rewarded 5회/일

  // 제한 시간 = 글자수 × 언어별 계수 (최소/최대 사이로 보정)
  MS_PER_CHAR: { ko: 900, en: 450, mix: 800 },
  TIME_LIMIT_MIN_MS: 30000,
  TIME_LIMIT_MAX_MS: 180000,

  // 순위 기준 지표: 한국어·혼합은 CPM, 영어는 WPM (기획서 7장)
  PRIMARY_METRIC: { ko: "cpm", en: "wpm", mix: "cpm" },

  MAX_PLAUSIBLE_WPM: 600, // 이 이상은 자동 차단 (기획서 12장)
  ELAPSED_MIN_MS: 1000,
};

// ── ④ 숫자 기억력 ──────────────────────────────────────────────
// 기획서 9장 레벨 설계표를 그대로 옮긴 값입니다.
export const MEMORY = {
  MAX_LEVEL: 10,
  AD_VIEWS_PER_DAY: 3, // 레벨 도전권 3회/일
  INPUT_TIME_LIMIT_MS: 60000,

  // level → { digits, exposeMs, hints }
  LEVELS: {
    1: { digits: 4, exposeMs: 5000, hints: 0 },
    2: { digits: 5, exposeMs: 5000, hints: 0 },
    3: { digits: 6, exposeMs: 4000, hints: 0 },
    4: { digits: 7, exposeMs: 4000, hints: 0 },
    5: { digits: 8, exposeMs: 4000, hints: 1 },
    6: { digits: 9, exposeMs: 4000, hints: 1 },
    7: { digits: 10, exposeMs: 3000, hints: 0 },
    8: { digits: 11, exposeMs: 3000, hints: 0 },
    9: { digits: 12, exposeMs: 3000, hints: 0 },
    10: { digits: 13, exposeMs: 3000, hints: 0 },
  },
};

// ── 공통 ──────────────────────────────────────────────────────
export const COMMON = {
  IP_AD_VIEWS_PER_DAY: 20, // 동일 IP 일일 광고 시청 최대 20회 (기획서 12장)
  AD_UNLOCK_WINDOW_MS: 30 * 60 * 1000, // Interstitial 시청 후 통계·랭킹 열람 유효 시간
  RANK_LIST_SIZE: 20,
  STATS_HISTOGRAM_BINS: 8,
  SESSION_MAX_AGE_MS: 60 * 60 * 1000, // 1시간 넘게 안 닫힌 세션은 무효
};

// 광고 트리거 식별자 (기획서 11장)
export const AD_TRIGGERS = {
  STOPWATCH_ATTEMPT: { game: "STOPWATCH", type: "REWARDED", perDay: STOPWATCH.AD_VIEWS_PER_DAY },
  STOPWATCH_STATS: { game: "STOPWATCH", type: "INTERSTITIAL", perDay: null },
  BASEBALL_ATTEMPT: { game: "BASEBALL", type: "REWARDED", perDay: null }, // 게임당 제한이라 별도 처리
  BASEBALL_STATS: { game: "BASEBALL", type: "INTERSTITIAL", perDay: null },
  TYPING_SENTENCE: { game: "TYPING", type: "REWARDED", perDay: TYPING.AD_VIEWS_PER_DAY },
  TYPING_RANK: { game: "TYPING", type: "INTERSTITIAL", perDay: null },
  MEMORY_LEVEL: { game: "MEMORY", type: "REWARDED", perDay: MEMORY.AD_VIEWS_PER_DAY },
  MEMORY_RANK: { game: "MEMORY", type: "INTERSTITIAL", perDay: null },
};

// 게임별 "통계/랭킹 열람 해제"에 필요한 Interstitial 트리거
export const STATS_UNLOCK_TRIGGER = {
  STOPWATCH: "STOPWATCH_STATS",
  BASEBALL: "BASEBALL_STATS",
  TYPING: "TYPING_RANK",
  MEMORY: "MEMORY_RANK",
};
