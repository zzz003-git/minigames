/**
 * 게임 규칙 상수 — 기획서의 수치를 한 곳에 모아 둡니다.
 * 규칙을 바꿀 때는 이 파일만 수정하면 서버·검증 로직에 일괄 반영됩니다.
 */

/** 오리지널 4종 (기획서 v2) */
export const CLASSIC_GAME_TYPES = ["STOPWATCH", "BASEBALL", "TYPING", "MEMORY"];

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

// ══════════════════════════════════════════════════════════════
// 광고 리워드용 아케이드 미니게임 10종 (docs/arcade-10-games.md)
// ══════════════════════════════════════════════════════════════
//
// 밸런싱은 전부 이 표에서만 바꿉니다. 서버 규칙 · 클라이언트 화면 · 광고 한도가
// 모두 여기서 파생되므로, 난이도 곡선을 조정할 때 다른 파일을 열 필요가 없습니다.
//
// 공통 필드
//   mode              ENDLESS = 라운드마다 서버 왕복 / BATCH = 문제 묶음 발급 후 일괄 채점
//   label icon accent 허브 카드와 헤더 표시용
//   baseAttempts      하루 기본 도전 기회
//   adAttemptsPerDay  광고로 추가할 수 있는 기회 (하루 한도)
//   boostsPerRun      1런당 사용할 수 있는 _BOOST 광고 횟수 (0 = 보상 없음)
//   lives             ENDLESS 게임의 시작 목숨

export const ARCADE = {
  // ⑤ 반응속도 테스트 — 초록으로 바뀌는 순간 탭. 5시행 평균.
  REACTION: {
    mode: "BATCH",
    category: "action",
    label: "반응속도 테스트",
    icon: "⚡",
    accent: "mint",
    tagline: "초록으로 바뀌면 바로 탭",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,

    TRIALS: 5, // 채택 시행 수 (보상으로 시행이 늘어도 좋은 5개만 채택)
    MAX_TRIALS: 7, // TRIALS + boostsPerRun
    WAIT_MIN_MS: 1200,
    WAIT_MAX_MS: 4500,
    HUMAN_FLOOR_MS: 100, // 이보다 빠른 반응은 사람이 낼 수 없음 → 이상치
    REACTION_MAX_MS: 3000, // 이보다 느리면 놓친 것으로 간주
  },

  // ⑥ 색 다른 타일 찾기 — 격자에서 하나만 다른 색을 탭.
  ODDCOLOR: {
    mode: "ENDLESS",
    category: "action",
    label: "색 다른 타일 찾기",
    icon: "🎨",
    accent: "coral",
    tagline: "하나만 색이 다릅니다",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,
    lives: 1,

    GRID_MIN: 2,
    GRID_MAX: 6,
    ROUNDS_PER_GRID: 3, // 3라운드마다 격자 한 단계 확대
    DELTA_START: 26, // HSL 명도차(%)
    DELTA_STEP: 1.2,
    DELTA_MIN: 2.5,
    LIMIT_START_MS: 6000,
    LIMIT_STEP_MS: 120,
    LIMIT_MIN_MS: 2500,
  },

  // ⑦ 순서 기억 — 반짝인 순서대로 패드를 누름.
  SEQUENCE: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "순서 기억",
    icon: "🔔",
    accent: "mint",
    tagline: "반짝인 순서 그대로",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,
    lives: 1,

    PADS: 9, // 3×3
    START_LENGTH: 3, // 라운드 1의 시퀀스 길이
    FLASH_START_MS: 620,
    FLASH_STEP_MS: 25,
    FLASH_MIN_MS: 280,
    INPUT_MS_PER_STEP: 2500,
  },

  // ⑧ 숫자 순서 터치 (슐테 테이블) — 1~25를 순서대로.
  NUMTAP: {
    mode: "BATCH",
    category: "action",
    label: "숫자 순서 터치",
    icon: "🔢",
    accent: "gold",
    tagline: "1부터 25까지 순서대로",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 0, // 순수 기록 경신 게임 — 런 중 보상 없음

    SIZE: 5, // 5×5 = 1~25
    MISS_PENALTY_MS: 500,
    MIN_TAP_GAP_MS: 90, // 이보다 촘촘한 연속 탭은 자동 입력으로 간주
    MAX_MS: 300000,
  },

  // ⑨ 60초 암산 — 제한 시간 안에 최대한 많이.
  MATHRUSH: {
    mode: "BATCH",
    category: "puzzle",
    label: "60초 암산",
    icon: "➗",
    accent: "gold",
    tagline: "60초 동안 몇 문제?",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,

    BASE_LIMIT_MS: 60000,
    BOOST_MS: 15000, // 광고 1회당 +15초 (최대 90초)
    WRONG_PENALTY_MS: 3000,
    BATCH_SIZE: 80,
    MIN_ANSWER_MS: 250,
  },

  // ⑩ 색깔 말하기(스트룹) — 글자의 뜻이 아니라 색을 고름.
  STROOP: {
    mode: "BATCH",
    category: "action",
    label: "색깔 말하기",
    icon: "🌈",
    accent: "coral",
    tagline: "뜻 말고 글자 색을 고르세요",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,

    LIMIT_MS: 30000,
    BATCH_SIZE: 120,
    PER_START_MS: 2500,
    PER_STEP_MS: 40,
    PER_MIN_MS: 1200,
    MIN_ANSWER_MS: 150,
    COLORS: [
      { key: "red", name: "빨강", hex: "#f0705c" },
      { key: "blue", name: "파랑", hex: "#6fa8f5" },
      { key: "green", name: "초록", hex: "#6fd39a" },
      { key: "yellow", name: "노랑", hex: "#e8c65c" },
      { key: "purple", name: "보라", hex: "#b18ef0" },
    ],
    CHOICES: 4,
  },

  // ⑪ 링 스톱 — 원을 도는 점을 타겟 구간에서 멈춤.
  RINGSTOP: {
    mode: "ENDLESS",
    category: "action",
    label: "링 스톱",
    icon: "🎯",
    accent: "mint",
    tagline: "밝은 구간에서 탭",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,
    lives: 1,

    SPEED_START: 120, // deg/s
    SPEED_STEP: 14,
    SPEED_MAX: 420,
    ARC_START: 46, // deg
    ARC_STEP: 2,
    ARC_MIN: 14,
    ANGLE_TOLERANCE_DEG: 8, // 서버 재현값과 이 이상 어긋나면 조작
    ROUND_MAX_MS: 20000,
  },

  // ⑫ 순간 개수 세기 — 잠깐 보인 점의 개수를 입력.
  COUNTDOT: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "순간 개수 세기",
    icon: "👁",
    accent: "coral",
    tagline: "점이 몇 개였나요?",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,
    lives: 3,

    MIN_DOTS: 3,
    MAX_DOTS_START: 6,
    MAX_DOTS_STEP: 2,
    MAX_DOTS_CAP: 24,
    EXPOSE_START_MS: 420,
    EXPOSE_STEP_MS: 18,
    EXPOSE_MIN_MS: 160,
    INPUT_LIMIT_MS: 12000,
  },

  // ⑬ 카드 짝 맞추기 — 배치는 서버에만 존재.
  CARDPAIR: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "카드 짝 맞추기",
    icon: "🃏",
    accent: "gold",
    tagline: "적게 뒤집을수록 상위",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,

    PAIRS: 8, // 4×4
    SYMBOLS: ["🍎", "🍋", "🍇", "🍒", "🥝", "🍉", "🍑", "🫐", "🥥", "🍍", "🍓", "🌰"],
  },

  // ⑭ 이겨라 / 져라 — 지시대로 손을 고름.
  RPSFLASH: {
    mode: "BATCH",
    category: "action",
    label: "이겨라 / 져라",
    icon: "✌",
    accent: "mint",
    tagline: "지시대로 1초 안에",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,

    BATCH_SIZE: 120,
    PER_START_MS: 1400,
    PER_STEP_MS: 30,
    PER_MIN_MS: 600,
    MIN_ANSWER_MS: 150,
    HANDS: ["rock", "scissors", "paper"],
    ORDERS: ["WIN", "LOSE", "DRAW"],
  },

  // ⑮ 다들 뭐 골랐을까 — 사람들이 더 많이 고른 쪽을 3연속 맞히기.
  // 다른 14종과 달리 정답이 서버 난수가 아니라 **다른 사용자들의 선택 집계** 입니다.
  // 기획: docs/majority-game.md
  MAJORITY: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "다들 뭐 골랐을까",
    icon: "🗳",
    accent: "gold",
    tagline: "다수가 고른 쪽을 3연속",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2, // 되돌리기 2회 (기획서 8장 「방문당 광고 최대 2회」)
    lives: 1,

    ROUNDS: 3, // 3문항 연속 적중이 성공 조건
    LIMIT_MS: 10000, // 문항 제한 시간 (기획서 7초 → 10초, 이유는 docs §5)
    MIN_ANSWER_MS: 1500, // 이보다 빠른 응답은 판정은 하되 **표로 세지 않습니다**

    /**
     * 한 판에 미리 배정해 두는 문항 수.
     *
     * 목숨 1 + 되돌리기 2 = 최대 3번까지 빗나갈 수 있고 적중은 3번이 필요하므로,
     * 한 판에서 실제로 나갈 수 있는 문항은 최대 6개입니다. 시작할 때 6개를 한 번에
     * 뽑아 두면 라운드마다 DB 를 다시 읽지 않아도 됩니다(라운드 왕복이 늘지 않습니다).
     */
    QUEUE: 6,
    POOL: 18, // 배정 후보를 뽑는 표본 크기 (이 중에서 쏠린 문항을 걸러 QUEUE 개를 고릅니다)

    /**
     * 이 표 수를 넘겨야 그 문항의 비율을 "결과" 로 씁니다.
     * 미달이면 비율을 지어내지 않고 「집계 중」으로 통과 처리합니다(점수 0).
     */
    MIN_SAMPLE: 12,

    /**
     * 다수 비율이 이 값 이상이면 배정에서 뺍니다.
     * 한쪽이 90% 로 쏠린 문항은 찍어도 맞으므로 게임이 성립하지 않습니다
     * (기획서 16장 위험 2). 운영 중 조정하는 값입니다.
     */
    SKEW_EXCLUDE_PCT: 85,

    /**
     * 점수 = Σ(적중 문항 난이도) + 완주 보너스.
     * 난이도 = 100 − 2 × (다수 비율 − 50) → 50:50 이면 100점, 75:25 면 50점, 90:10 이면 20점.
     *
     * "아슬아슬한 문항을 맞힐수록 고득점" 이라, 쏠린 문항을 외워 오는 것의 실익이 가장 작습니다.
     * 동시에 기획서 16장 위험 3(「찍기 인식」)에 대한 답이기도 합니다 —
     * 찍기로는 50:50 문항에서 기대 점수가 절반이 되므로 판단력이 점수 차로 나타납니다.
     */
    CLEAR_BONUS: 50,
  },
  // ── ⑯ 딱 맞게 담기 (기획서 plans/2026-07-28/PLAN-09_딱맞게담기.md) ──────
  //
  // 목표 금액에 딱 맞게 상품을 담습니다. **시간 제한이 없고 시도 횟수가 제한**입니다.
  // 이미 서비스 중인 ⑨ 60초 암산과 계산 소재가 겹치므로, 압박의 원천을 시간에서
  // 시도 횟수로 옮겨 갈라놓았습니다 — 빠른 연산이 아니라 조합 탐색을 묻습니다.
  //
  // 목표 금액은 반드시 **실제 상품 조합의 합**에서 뽑습니다. 임의의 숫자를 던지면
  // 해가 없는 판이 나오고, 그 순간 이 게임은 실력이 아니라 운이 됩니다.
  BASKET: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "딱 맞게 담기",
    icon: "🧺",
    accent: "mint",
    tagline: "세 번 안에 금액을 딱 맞추세요",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,
    lives: 1,

    TRIES: 3, // 한 라운드에 담기 완료를 누를 수 있는 횟수

    // 라운드가 오를수록 상품이 늘고 허용 오차가 좁아집니다.
    ROUNDS: [
      { items: 6, pick: [2, 3], tol: 500, reward: 2 },
      { items: 7, pick: [3, 4], tol: 200, reward: 3 },
      { items: 8, pick: [3, 4], tol: 100, reward: 4 },
      { items: 9, pick: [4, 5], tol: 0, reward: 6 },
      { items: 9, pick: [4, 5], tol: 0, reward: 8 }, // 5라운드부터 반복
    ],

    PRICE_MIN: 700,
    PRICE_MAX: 4900,
    PRICE_STEP: 100,
    PRICE_LIFT: 100, // 라운드마다 가격대 상승폭
    LIFT_MAX_ROUND: 6,

    PERFECT_BONUS: 2, // 오차 0원
    FIRST_TRY_BONUS: 2, // 첫 시도 적중
  },
  // ── ⑰ 한 줄로 이어요 (기획서 plans/2026-07-28/PLAN-11_한줄로이어요.md) ──
  //
  // 번호를 순서대로 지나가는 한 줄을 긋습니다. 지나간 칸은 다시 밟을 수 없습니다.
  // 자사 배포분에 **경로·공간 퍼즐이 한 종도 없습니다** — 지나온 자리가 다음 수를
  // 제약하는 구조는 이 게임이 처음입니다.
  //
  // 초안은 1~2분 완주형이었으나 아케이드 규격(1판 10~60초)을 넘어, 한 라운드를
  // 40~50초로 줄이고 무한 진행으로 바꿨습니다. 체류는 판 길이가 아니라 라운드 수로 만듭니다.
  PATHLINE: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "한 줄로 이어요",
    icon: "🧵",
    accent: "mint",
    tagline: "번호 순서대로 한 붓 그리기",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,
    lives: 1,

    // w×h 격자에 번호 nums 개. 라운드가 오를수록 판이 커집니다.
    ROUNDS: [
      { w: 4, h: 4, nums: 3, sec: 40, reward: 3 },
      { w: 4, h: 4, nums: 4, sec: 40, reward: 4 },
      { w: 5, h: 5, nums: 4, sec: 45, reward: 5 },
      { w: 5, h: 5, nums: 5, sec: 45, reward: 6 },
      { w: 6, h: 6, nums: 5, sec: 50, reward: 8 }, // 5라운드부터 반복
    ],

    GEN_TRIES: 400, // 정답 경로 생성 시도 횟수
    MIN_LEN_FACTOR: 3, // 정답 경로 최소 길이 = 번호 수 × 이 값
    SHORTEST_BONUS: 2, // 이론상 최소 길이로 완성
    HINT_CELLS: 3, // 광고 1회당 공개하는 정답 경로 칸 수
  },
  // ── ⑱ 와르르 받기 (기획서 plans/2026-07-29/PLAN-12_와르르받기.md) ────────
  //
  // 떨어지는 상품을 바구니로 받고 폭탄만 피합니다. 자사 배포분에 **낙하·받기형이
  // 한 종도 없어서** 넣었습니다 — 지금까지는 전부 "멈춰 있는 것을 고르는" 게임입니다.
  //
  // BATCH 인 이유: 실시간 낙하 게임에서 물체마다 서버 왕복을 하면 왕복 지연이 그대로
  // 조작감을 망칩니다. 그래서 ⑤ 반응속도와 같은 구조를 씁니다 —
  // **낙하 일정을 서버가 미리 확정**해 내려주고, 클라이언트는 그 일정을 재생만 하며,
  // 끝나고 결과 전체를 제출하면 서버가 일정과 대조해 다시 채점합니다.
  // 클라이언트가 점수를 정할 수 없고, 받은 시각이 물리적으로 가능한 창을 벗어나면
  // 이상치로 걸립니다.
  DROPCATCH: {
    mode: "BATCH",
    category: "action",
    label: "와르르 받기",
    icon: "🛒",
    accent: "coral", // base.css 에 있는 값만 유효합니다 (coral · gold · mint)
    tagline: "떨어지는 상품을 받으세요",
    baseAttempts: 5,
    adAttemptsPerDay: 5,
    boostsPerRun: 2,

    LANES: 5, // 낙하 칸 수. 바구니는 칸 사이도 갈 수 있습니다(연속 이동)
    LIVES: 3, // 폭탄 3개를 받으면 종료 (기획서 4장)

    BASE_LIMIT_MS: 45000,
    BOOST_MS: 35000, // 이어받기 1회당 연장. 45 + 35 + 35 = 최대 115초 ≈ 2분 (기획서 6장)

    // 첫 10초는 폭탄이 나오지 않습니다 — 첫 판을 반드시 성공시킵니다(기획서 0-4·6장).
    SAFE_MS: 10000,
    // 첫 낙하물은 바구니 시작 위치(가운데 칸) 바로 위로 떨어집니다.
    FIRST_LANE: 2,

    // 낙하 간격 — 시간이 갈수록 촘촘해집니다.
    SPAWN_START_MS: 900,
    SPAWN_MIN_MS: 380,
    SPAWN_DECAY_PER_SEC: 12, // 1초당 줄어드는 간격(ms)

    // 낙하 시간(위 → 바구니 선) — 시간이 갈수록 빨라집니다.
    FALL_START_MS: 2600,
    FALL_MIN_MS: 1150,
    FALL_DECAY_PER_SEC: 26,

    // 폭탄 비율 — SAFE_MS 이후부터 서서히 오릅니다.
    BOMB_START_PCT: 12,
    BOMB_MAX_PCT: 30,
    BOMB_RISE_PER_SEC: 0.45,
    BONUS_PCT: 8, // 보너스 상품(신제품 자리 — 기획서 10장)

    GOOD_POINT: 1,
    BONUS_POINT: 3,
    COMBO_STEP: 5, // 이 개수만큼 연속으로 받을 때마다
    COMBO_BONUS: 2, // 보너스 점수

    MAX_ITEMS: 400, // 엔진의 제출 상한(500)보다 낮게 둡니다

    // 받았다고 신고한 시각이 그 물건이 실제로 바구니 선에 닿는 시각과 이만큼 넘게
    // 어긋나면 그 신고는 물리적으로 불가능합니다.
    LAND_TOLERANCE_MS: 700,
    // 어긋난 신고가 이 비율을 넘을 때만 이상치로 봅니다.
    // (한 번 어긋났다고 판 전체를 순위에서 빼면 손이 미끄러진 사람이 손해입니다)
    BAD_TIMING_PCT: 20,
  },
};

export const ARCADE_GAME_TYPES = Object.keys(ARCADE);

/** 서비스 중인 전체 게임 목록 — 모든 입력 검증(requireOneOf)의 단일 출처 */
export const GAME_TYPES = [...CLASSIC_GAME_TYPES, ...ARCADE_GAME_TYPES];

// ── 공통 ──────────────────────────────────────────────────────
export const COMMON = {
  IP_AD_VIEWS_PER_DAY: 20, // 동일 IP 일일 광고 시청 최대 20회 (기획서 12장)
  AD_UNLOCK_WINDOW_MS: 30 * 60 * 1000, // Interstitial 시청 후 통계·랭킹 열람 유효 시간
  RANK_LIST_SIZE: 20,
  STATS_HISTOGRAM_BINS: 8,

  /**
   * 통계 집계에 쓰는 최근 기록 수 (리그별).
   *
   * 백분위·분포는 "지금 사람들과 비교해서 내가 어디쯤인가" 를 보여 주는 값이라 전체 역사가
   * 필요하지 않습니다. 반면 리그당 기록이 수백만 건이 되면 집계 쿼리가 그 수에 비례해
   * 느려집니다 (로컬 측정: 20만 건 129ms → 100만 건 605ms, 선형).
   * 그래서 최근 N건으로 창을 고정해 기록이 아무리 쌓여도 비용이 일정하게 유지되도록 합니다.
   * 순위표(TOP 20)와 개인 최고 기록은 창과 무관하게 전체 기준입니다.
   */
  STATS_WINDOW: 50000,
  SESSION_MAX_AGE_MS: 60 * 60 * 1000, // 1시간 넘게 안 닫힌 세션은 무효

  /**
   * 세션 행을 보관하는 기간. 이 시간이 지난 세션은 Cron 정리가 삭제합니다.
   * 게임 기록은 results 에 남으므로 통계·순위에는 영향이 없습니다.
   * 세션은 문제 풀이 중에만 필요한 임시 상태인데, 지우지 않으면 10만 DAU 기준
   * 하루 420만 행이 쌓여 D1 상한(10GB)을 며칠 만에 넘깁니다.
   */
  SESSION_KEEP_MS: 6 * 60 * 60 * 1000, // 6시간
  SESSION_CLEANUP_LIMIT: 5000, // Cron 1회 실행당 삭제 상한

  /**
   * 결과의 상세 기록(detail_json)을 온전히 보관하는 기간.
   *
   * 이 기간이 지나면 "아직 읽히는 키" 만 남기고 나머지를 버립니다(RESULT_DETAIL_KEEP).
   * 상세 기록은 게임별로 73~640 bytes 인데(반응속도는 시행 배열, 기억력은 자리별 채점
   * 배열을 담습니다) 결과 행은 세션과 달리 지울 수 없는 기록이라 계속 쌓입니다.
   * 10만 DAU 기준 하루 420만 건 × 평균 175 bytes = 하루 약 0.7GB 가 상세 기록입니다.
   *
   * 결과 행 자체와 순위·통계에 쓰이는 값(rank_metric, score, bucket)은 건드리지 않습니다.
   */
  RESULT_DETAIL_KEEP_MS: 30 * 24 * 60 * 60 * 1000, // 30일
  RESULT_COMPACT_LIMIT: 2000, // Cron 1회 실행당 정리 상한
};

/**
 * 오래된 결과에서 **남겨야 하는** detail_json 키.
 *
 * 상세 기록 대부분은 그 판이 끝난 직후 결과 화면에만 쓰이고 다시 읽히지 않습니다.
 * 하지만 일부는 시간이 지난 뒤에도 서버가 읽습니다 — 여기 적힌 것이 그것들입니다.
 * 적히지 않은 게임은 상세 기록 전체를 버립니다.
 *
 * 게임을 추가할 때, 그 게임의 상세 기록을 **나중에** 읽는 코드를 쓴다면 여기에 키를
 * 적어야 합니다. 적지 않으면 30일 뒤 그 값이 사라져 화면이 조용히 비어 보입니다.
 */
export const RESULT_DETAIL_KEEP = {
  // 순위표에 "클리어 · 8/9" 로 표시하고, 레벨별 클리어율을 집계합니다
  // (public/games/memory/game.js 의 renderRank, routes/stats.js 의 MEMORY 분기)
  MEMORY: ["cleared", "correct_count", "digit_count"],

  // 자리별 정답 분포를 집계합니다 (routes/stats.js 의 BASEBALL 분기)
  BASEBALL: ["answer"],
};

// 광고 트리거 식별자 (기획서 11장 + 아케이드 10종)
//
// 아케이드 10종은 게임마다 트리거 3종을 같은 규칙으로 갖습니다.
//   {GAME}_ATTEMPT  Rewarded      도전 기회 +1        하루 N회
//   {GAME}_BOOST    Rewarded      런 진행 중 보상     1런당 N회 (게임별 효과는 spec.applyBoost)
//   {GAME}_STATS    Interstitial  전체 통계·랭킹 열람
// 목록을 손으로 적으면 게임을 추가할 때 빠뜨리기 쉬우므로 ARCADE 에서 파생시킵니다.
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

for (const [game, cfg] of Object.entries(ARCADE)) {
  AD_TRIGGERS[`${game}_ATTEMPT`] = { game, type: "REWARDED", perDay: cfg.adAttemptsPerDay };
  AD_TRIGGERS[`${game}_STATS`] = { game, type: "INTERSTITIAL", perDay: null };
  if (cfg.boostsPerRun > 0) {
    // 런 단위 한도라 perDay 로 세지 않고 세션의 ad_views 로 셉니다 (숫자야구와 같은 방식).
    AD_TRIGGERS[`${game}_BOOST`] = { game, type: "REWARDED", perDay: null, perRun: cfg.boostsPerRun };
  }
  STATS_UNLOCK_TRIGGER[game] = `${game}_STATS`;
}
