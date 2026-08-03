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
  // ── ⑲ 내 가게 채우기 (기획서 plans/2026-07-29/PLAN-13_내가게채우기.md) ────
  //
  // 매일 오는 상자의 상품을 선반에 채워 가게를 키웁니다. 자사 배포분에 **수집·성장형이
  // 한 종도 없었습니다** — 앞의 18종은 판이 끝나면 상태가 사라지는데, 이 게임만
  // 진열한 선반이 계정에 영구히 쌓입니다(store_state 테이블 · docs/store-game.md).
  //
  // 실패가 없는 게임입니다(lives: 0). 코너가 꽉 차 못 놓는 상품은 건너뛰어 내일로
  // 이월되고, 그것도 판을 끝내지 않습니다 — 기획서 6장 「실패: 없음」.
  // 미완의 선반이 곧 재방문 동기라, 판을 끝내는 것은 오늘 상자를 다 쓰는 것뿐입니다.
  STORE: {
    mode: "ENDLESS",
    category: "puzzle", // 반응속도 완전 비의존 (docs/store-game.md §7)
    label: "내 가게 채우기",
    icon: "🏪",
    accent: "gold",
    tagline: "오늘 온 상품을 선반에 채우세요",

    baseAttempts: 1, // 하루 1판 (기획서 6장)
    adAttemptsPerDay: 1, // 보너스 상자 1개 (기획서 8장)
    boostsPerRun: 0, // 실패가 없어 되돌릴 것이 없습니다
    lives: 0, // 실패 없음

    SLOTS: 4, // 선반 한 줄 = 4칸 (기획서 6장 「첫 선반은 4칸」)
    BOX_SIZE: 6, // 오늘 상자에 담기는 상품 수
    LIMIT_MS: 30000, // 한 수당 제한. 판단 시간이지 반응속도가 아닙니다

    PLACE_POINT: 1,
    SHELF_BONUS: 10,
    DEX_BONUS: 3, // 도감 신규 등록
    STAGE_PER_SHELF: 3, // 완성 선반 이 개수마다 가게 단계 +1

    CORNERS: [
      { key: "drink", name: "음료", icon: "🥤" },
      { key: "snack", name: "간식", icon: "🍪" },
      { key: "living", name: "생활", icon: "🧻" },
    ],

    // 1차 구성은 상품 20종입니다 (기획서 16장 위험 2 — 최소 구성으로 시작).
    // 광고주 입점은 이 배열을 DB 로 옮기면 되고 배치·판정 규칙은 그대로입니다.
    ITEMS: [
      { id: 1, corner: "drink", name: "아메리카노", icon: "☕" },
      { id: 2, corner: "drink", name: "생수", icon: "💧" },
      { id: 3, corner: "drink", name: "오렌지주스", icon: "🧃" },
      { id: 4, corner: "drink", name: "우유", icon: "🥛" },
      { id: 5, corner: "drink", name: "탄산음료", icon: "🥤" },
      { id: 6, corner: "drink", name: "이온음료", icon: "🏺" },
      { id: 7, corner: "drink", name: "녹차", icon: "🍵" },
      { id: 8, corner: "snack", name: "초코바", icon: "🍫" },
      { id: 9, corner: "snack", name: "감자칩", icon: "🍟" },
      { id: 10, corner: "snack", name: "쿠키", icon: "🍪" },
      { id: 11, corner: "snack", name: "껌", icon: "🍬" },
      { id: 12, corner: "snack", name: "샌드위치", icon: "🥪" },
      { id: 13, corner: "snack", name: "사탕", icon: "🍭" },
      { id: 14, corner: "snack", name: "견과류", icon: "🥜" },
      { id: 15, corner: "living", name: "휴지", icon: "🧻" },
      { id: 16, corner: "living", name: "치약", icon: "🦷" },
      { id: 17, corner: "living", name: "비누", icon: "🧼" },
      { id: 18, corner: "living", name: "건전지", icon: "🔋" },
      { id: 19, corner: "living", name: "양초", icon: "🕯" },
      { id: 20, corner: "living", name: "우산", icon: "☂" },
    ],
  },
  // ── ⑳ 슥슥 긁기 (기획서 plans/2026-07-30/PLAN-14_슥슥긁기.md) ──────────────
  //
  // 매일 아침 오는 은박 카드 9칸 중 5칸을 손가락으로 문질러 긁고, 같은 그림 3개를
  // 모으면 획득분이 2배가 됩니다. 자사 배포분에 **순수 F(랜덤 결과)형이 한 종도
  // 없었습니다** — 19종은 전부 실력·판단·기억이 결과를 바꾸는 게임입니다.
  //
  // 시장의 F형(상자·룰렛·사다리)과 다른 점은 네 가지입니다.
  //   ① 조작이 1터치가 아니라 문지름  ② 9칸 중 5칸의 선택권
  //   ③ 부분 공개 힌트로 관찰이 개입   ④ 꽝 없음 + 매칭 배수의 이중 보상
  //
  // 힌트는 **심볼이 아니라 색만** 비칩니다. 은박이 살짝 벗겨진 칸으로 알 수 있는 것은
  // 색이지 그림이 아니고(기획서 「노란 것이 비친다」), 색 하나에 심볼이 두 종씩
  // 걸려 있어야 관찰이 확정이 아닌 **추론**이 됩니다. 색까지 정답이면 힌트 칸만
  // 긁으면 끝나는 게임이 됩니다.
  SCRATCH: {
    mode: "ENDLESS",
    category: "puzzle", // 반응속도 완전 비의존 (docs/scratch-game.md §7)
    label: "슥슥 긁기",
    icon: "🎟",
    accent: "gold", // 은박·금박 — base.css 에 있는 값만 유효합니다 (coral · gold · mint)
    tagline: "은박을 긁어 같은 그림 3개",

    baseAttempts: 1, // 하루 카드 한 장 (기획서 6장)
    // **카드를 더 주는 광고는 없습니다.** 기획서 8장의 광고는 「한 칸 더 긁기」 하나뿐이고,
    // 하루 1장 고정이 사행성 방어의 근거이기도 합니다(기획서 16장 위험 1).
    // 0 이면 SCRATCH_ATTEMPT 트리거는 서버가 항상 거절합니다 — 화면도 그 카드를 띄우지 않습니다.
    adAttemptsPerDay: 0,
    boostsPerRun: 1, // 「광고 보고 한 칸 더 긁기」 = 구원 광고 (기획서 8장, 하루 1회)

    // 긁기를 다 쓰면 판이 닫힙니다. 실패가 아니라 **소진**인데, 엔진의 "목숨 소진 →
    // 세션 유지 → 이어하기 대기" 흐름이 기획서 8장의 구원 광고와 정확히 같은 모양이라
    // 그것을 그대로 씁니다 (docs/scratch-game.md §4).
    lives: 1,

    CELLS: 9, // 3×3
    SCRATCHES: 5, // 오늘의 긁기 5번
    MATCH_NEED: 3, // 같은 그림 3개
    MATCH_MULTIPLIER: 2, // 매칭 시 획득분 2배

    // 심볼 6종 = 광고 지면 (기획서 10장 「심볼이 곧 광고 지면이다」).
    // hue 는 은박이 벗겨진 칸으로 비치는 색입니다. **한 색에 두 종**이라야 힌트가
    // 확정이 아닌 추론이 됩니다.
    SYMBOLS: [
      { key: "coffee", name: "커피", icon: "☕", hue: "gold" },
      { key: "donut", name: "도넛", icon: "🍩", hue: "gold" },
      { key: "soda", name: "음료", icon: "🥤", hue: "blue" },
      { key: "ice", name: "아이스크림", icon: "🍦", hue: "blue" },
      { key: "burger", name: "버거", icon: "🍔", hue: "red" },
      { key: "chicken", name: "치킨", icon: "🍗", hue: "red" },
    ],
    HUES: [
      { key: "gold", name: "노란빛", hex: "#E8C65C" },
      { key: "blue", name: "푸른빛", hex: "#6FA8F5" },
      { key: "red", name: "붉은빛", hex: "#F0705C" },
    ],

    // 칸마다 붙는 기본 포인트 — **꽝이 없습니다**(기획서 4장). 이 배열에서 하나씩 뽑습니다.
    POINTS: [10, 10, 10, 20, 20, 30],

    // 카드에 심는 "매칭 대상" 심볼의 개수. 5칸을 골라 3개를 모을 확률이 여기서 나옵니다.
    //   4개 심었을 때 = C(4,3)·C(5,2)/C(9,5) = 31.7%  ·  5개 = 47.6%
    // 힌트를 읽고 고르면 이보다 확실히 올라갑니다 — 그게 이 게임의 재량입니다.
    TARGET_COPIES: 4,
    ROOKIE_TARGET_COPIES: 5, // 첫 주 카드는 매칭 확률 상향 (기획서 6장 「초보자」)

    // 매칭 대상이 아닌 심볼은 이 개수를 넘지 않습니다 — 3개에 도달할 수 있는 심볼을
    // 하나로 고정합니다. 그러지 않으면 "우연히 다른 그림 3개" 가 생겨 판정이 흐려집니다.
    MAX_OTHER_COPIES: 2,

    HINT_CELLS: 2, // 은박이 살짝 벗겨진 칸 수 (색만 비침)
    ROOKIE_HINT_CELLS: 3, // 첫 주는 3칸 (기획서 6장)
    ROOKIE_CARDS: 7, // 누적 카드 수가 이 값 미만이면 초보자 배정

    STREAK_HINT_DAY: 7, // 연속 7일째 카드는 심볼 1개를 **완전 공개** (기획서 4장 6번)
    STREAK_BONUS_DAY: 7, // 연속 7일마다
    STREAK_BONUS: 50, // 보너스 포인트 (기획서 7장)

    // 긁기 궤적 검사 (기획서 7장 「악용 방지」).
    // 한 칸을 문지르는 데 사람은 최소 이만큼 걸리고, 포인터 이동 표본도 이만큼은 생깁니다.
    // 한 번 어긋난 것으로 판을 순위에서 빼지 않고 **비율**로 판정합니다(hasImpossibleTiming 방식).
    MIN_SCRATCH_MS: 250,
    // 손가락으로 문지르면 포인터 표본이 수십 개 생깁니다. 하한을 4로 둔 것은
    // **키보드·보조기기 경로**를 위한 것입니다 — 한 칸을 긁는 데 최소 4번의 입력이
    // 필요하도록 화면을 맞췄고(public/games/scratch/game.js), 그 경로가 이상치로
    // 표시되면 마우스가 없는 사용자만 순위에서 빠지게 됩니다.
    MIN_STROKES: 4,
    ROUGH_MIN: 3, // 이 개수를 넘고
    ROUGH_PCT: 60, // 동시에 긁은 칸의 이 비율 이상이 거칠면 이상치
  },
  // ── ㉑ 퍼펙트 스택 (기획서 plans/2026-07-30/PLAN-18_퍼펙트스택.md) ────────
  //
  // 좌우로 흐르는 블록을 탭해 쌓습니다. 어긋난 부분은 잘려 떨어지고 남은 폭이
  // 다음 블록의 폭이 됩니다. 배포작 A형 4종과 조작 축(정확한 순간의 탭)은 같지만
  // **목표가 수치가 아니라 화면에 남는 구조물의 높이**라는 점이 다릅니다(기획서 11장).
  //
  // 위치·폭은 전부 **0~1 정규화 좌표**입니다. 화면 크기와 무관해야 서버가 같은 값으로
  // 판정할 수 있고, 단말 해상도에 따라 난이도가 달라지지 않습니다.
  //
  // 반응속도 게임이 되지 않게 **왕복 시간에 하한**을 둡니다(기획서 0절 반응속도 검사).
  // 난이도는 속도가 아니라 폭으로 올립니다 — 손가락 속도가 아니라 조준의 문제로 둡니다.
  STACK: {
    mode: "ENDLESS",
    category: "action", // 정답은 보이고 제때 해내는 게임
    label: "퍼펙트 스택",
    icon: "🧱",
    accent: "coral", // base.css 에 있는 값만 유효합니다 (coral · gold · mint)
    tagline: "흐르는 블록을 정확히 쌓기",

    baseAttempts: 3, // 하루 3판 (기획서 7장 「일일 상한: 3판 × 광고 3회」)
    adAttemptsPerDay: 3,
    boostsPerRun: 3, // 이어하기 총 3회 — 탑·층수를 그대로 유지합니다 (기획서 8장)
    lives: 1,

    // 폭은 화면 대비 **충분히 좁아야** 합니다. 넓으면 블록이 받침을 벗어날 수 없어
    // 실패가 원리적으로 불가능해집니다 — 폭 0.6 블록은 폭 0.6 받침에서 최대 0.4밖에
    // 못 벗어나므로 겹침이 늘 0.2 이상 남습니다(테스트가 잡아낸 값입니다).
    // 지금 값에서 첫 층의 최소 겹침은 0.09 로, MIN_WIDTH 보다 크므로
    // 「첫 블록은 어디에 얹어도 성립」(0-4)은 그대로 지켜집니다.
    BASE_WIDTH: 0.5, // 바닥판 폭
    START_WIDTH: 0.34, // 첫 블록 폭 — 바닥판보다 좁습니다
    MIN_WIDTH: 0.07, // 남은 폭이 이 아래로 줄면 종료
    FREE_LEVELS: 3, // 3층까지는 폭이 줄지 않습니다 (기획서 6장 초보자)

    SWEEP_START_MS: 2200, // 1왕복 시작 (기획서 4장)
    SWEEP_MIN_MS: 1600, // 하한 — 이 아래로는 내리지 않습니다
    SWEEP_STEP_MS: 60, // 층마다 줄어드는 왕복 시간

    PERFECT_TOL: 0.02, // 중앙 정렬로 인정하는 오차(정규화)
    COMBO_NEED: 3, // 중앙 정렬 3연속이면
    COMBO_RECOVER: 0.05, // 폭을 이만큼 회복합니다 (기획서 4장 4번)

    ROUND_MAX_MS: 20000, // 한 층에 주는 시간 — 넘기면 놓친 것으로 봅니다
    // 신고 좌표가 서버 재현값과 이만큼 넘게 어긋나면 조작 신호로 남깁니다(판정에는 영향 없음)
    X_TOLERANCE: 0.06,
  },
  // ── ㉒ 3초 탐정 (기획서 plans/2026-07-30/PLAN-21_3초탐정.md) ──────────────
  //
  // 3초간 본 장면에서 무엇이 바뀌었는지 찾습니다. DEP-006 색 다른 타일 찾기와 조작은
  // 같지만 **비교 대상이 화면이 아니라 기억 속**에 있습니다(기획서 11장).
  // 실패가 없습니다 — 못 찾은 사건은 「미해결」로 남아 다음 날 다시 옵니다.
  DETECTIVE: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "3초 탐정",
    icon: "🔍",
    accent: "mint",
    tagline: "무엇이 바뀌었을까요",
    baseAttempts: 3,
    adAttemptsPerDay: 3,
    boostsPerRun: 3, // 「그 장면 한 번 더 보기」 (기획서 4장 6번)
    lives: 0, // 실패 없음 — 틀리면 미해결로 남깁니다
    CASES: 5, // 오늘의 사건 5건
    ICONS_MIN: 8,
    ICONS_MAX: 12,
    EXPOSE_MS: 3000, // 노출 3초
    ROOKIE_EXPOSE_MS: 4500, // 첫 주는 4.5초 (기획서 4장 2번)
    ROOKIE_RUNS: 7,
    MASK_MS: 700, // 장면이 덮여 있는 시간
    LOCK_MS: 500, // 판정 직후 입력 잠금 — 잔여 탭이 오답으로 먹히지 않게 (기획서 0절)
    CASE_POINT: 3,
    REDO_BONUS: 2, // 미해결 사건을 다음 날 해결하면
    // 변화 유형 세 가지. 비율을 바꾸면 난이도가 바뀝니다
    KINDS: ["gone", "color", "move"],
    SYMBOLS: ["☕", "🍔", "🥤", "🍩", "🍗", "🍰", "🍫", "🧃", "🍪", "🥛", "🍇", "🍓"],
    COLORS: ["#E8C65C", "#6FA8F5", "#F0705C", "#6FD39A", "#B18EF0"],
  },
  // ── ㉓ 리듬 에코 (기획서 plans/2026-07-30/PLAN-19_리듬에코.md) ────────────
  //
  // 빛나는 박자를 그대로 두드려 따라 합니다. DEP-007 순서 기억과 조작은 같지만
  // **기억 대상이 위치가 아니라 간격**이라 판정이 좌표 비교가 아니라 시각차 비교입니다.
  // 시간 제한이 없습니다 — 빠른 반응이 아니라 간격의 재현이 과제입니다(기획서 0절).
  RHYTHM: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "리듬 에코",
    icon: "🥁",
    accent: "mint",
    tagline: "빛나는 박자를 그대로",
    baseAttempts: 3,
    adAttemptsPerDay: 3,
    boostsPerRun: 3, // 「이 패턴 다시 보기」 = 같은 레벨 재시도
    lives: 1,
    START_BEATS: 2, // 1레벨은 2박 — 규칙을 글 없이 알려주는 최소 단위 (기획서 0-2)
    MAX_BEATS: 9,
    GAP_MIN_MS: 320, // 박 간격
    GAP_MAX_MS: 900,
    GAP_STEP_MS: 20, // 이 단위로만 뽑습니다 (사람이 재현할 수 있는 해상도)
    TOL_START_MS: 250, // 관용도 ±250ms 에서
    TOL_STEP_MS: 20,
    TOL_MIN_MS: 100, // ±100ms 까지만 좁힙니다 (하한 고정)
    LEVEL_POINT: 2,
  },
  // ── ㉔ 밸런스 드롭 (기획서 plans/2026-07-30/PLAN-20_밸런스드롭.md) ────────
  //
  // 물건을 떨어뜨려 저울을 수평에 맞춥니다. 자사에 물리 축이 없어 첫 원형입니다.
  // **무게가 전부 보입니다** — 숨기면 기대값 게임이 되기 때문입니다(기획서 0절).
  // 조작에 좌우 밀기가 있어 아케이드 규격(탭 1종류)을 벗어납니다 → docs/balance-game.md
  BALANCE: {
    mode: "ENDLESS",
    category: "action",
    label: "밸런스 드롭",
    icon: "⚖",
    accent: "coral",
    tagline: "저울을 수평에 맞추세요",
    baseAttempts: 3,
    adAttemptsPerDay: 3,
    boostsPerRun: 3, // 「한 개 더 놓기」 — 현재 저울 상태 그대로
    lives: 1,
    // 접시 위치는 -1(왼쪽 끝) ~ +1(오른쪽 끝). 토크 = Σ(무게 × 위치)
    ARM: 1,
    WEIGHT_MIN: 1,
    WEIGHT_MAX: 9,
    PRELOAD_MIN: 1, // 처음 얹혀 있는 물건 수
    PRELOAD_MAX: 3,
    TOL_START: 1.6, // 초록 목표 구간(토크 절대값)에서
    TOL_STEP: 0.12,
    TOL_MIN: 0.45, // 이만큼까지 좁아집니다
    FIRST_LEVEL_TOL: 4.0, // 첫 판은 어디에 놓아도 들어옵니다 (기획서 0-4)
    LEVEL_POINT: 2,
    ROUND_MAX_MS: 30000,
  },
  // ── ㉕ 오늘의 한 잔 (기획서 plans/2026-07-30/PLAN-15_오늘의한잔.md) ───────
  //
  // 시럽을 부어 목표선에 맞게 세 층을 쌓습니다. 조작이 **누름 지속**이라 규격(탭)을
  // 벗어납니다 → docs/pour-game.md. 넘쳐도 잃는 것이 없습니다(기획서 4장 5번).
  POUR: {
    mode: "ENDLESS",
    category: "puzzle", // 반응속도 완전 비의존
    label: "오늘의 한 잔",
    icon: "🥤",
    accent: "gold",
    tagline: "목표선에 딱 맞게 세 층",
    baseAttempts: 1, // 하루 1잔 (기획서 6장)
    adAttemptsPerDay: 0, // 잔을 더 주지 않습니다 — 광고는 「그 층만 다시 붓기」뿐
    boostsPerRun: 1, // 넘친 직후의 구원 광고 (기획서 8장)
    lives: 0, // 실패 없음 — 세 층을 다 부으면 끝납니다
    LAYERS: 3,
    TARGET_MIN: 0.55, // 목표선 높이(잔의 비율)
    TARGET_MAX: 0.92,
    ROOKIE_TARGET_MIN: 0.78, // 첫 주는 목표선을 높게 둡니다 (여유가 넓다 · 기획서 6장)
    ROOKIE_RUNS: 7,
    POUR_RATE: 0.45, // 1초 누르면 잔의 이만큼이 찹니다
    MAX_HOLD_MS: 4000,
    GRADE: [
      // 목표선과의 차이(잔 비율) 구간별 등급. 숫자를 화면에 쓰지 않습니다(기획서 16장 4)
      { key: "perfect", name: "딱 맞음", within: 0.03, bonus: 30 },
      { key: "near", name: "근접", within: 0.08, bonus: 18 },
      { key: "loose", name: "여유", within: 1, bonus: 8 },
    ],
    LAYER_POINT: 6, // 층당 확정
    NEW_MIX_BONUS: 12, // 새 색 조합 최초 발견
    SYRUPS: [
      { key: "pink", name: "핑크", hex: "#F07AA0" },
      { key: "yellow", name: "레몬", hex: "#E8C65C" },
      { key: "mint", name: "민트", hex: "#6FD39A" },
      { key: "blue", name: "블루", hex: "#6FA8F5" },
      { key: "purple", name: "그레이프", hex: "#B18EF0" },
      { key: "cream", name: "크림", hex: "#F2E4CE" },
    ],
  },
  // ── ㉖ 세 칸 쌓기 (기획서 plans/2026-07-30/PLAN-16_세칸쌓기.md) ───────────
  //
  // 세 기둥 중 하나를 눌러 쌓고, 같은 것이 붙으면 한 등급 올라갑니다(엔진 G 첫 원형).
  // **첫 3수는 어디에 놓아도 반드시 합쳐집니다** — 규칙을 글 없이 알려줍니다(기획서 4장 5번).
  // 한 판이 1~3분이라 규격(10~60초)을 넘습니다 → docs/merge3-game.md
  MERGE3: {
    mode: "ENDLESS",
    category: "puzzle",
    label: "세 칸 쌓기",
    icon: "🪙",
    accent: "gold",
    tagline: "같은 것끼리 붙여 키우기",
    baseAttempts: 3,
    adAttemptsPerDay: 3,
    boostsPerRun: 3, // 「맨 위 하나 치우기」
    lives: 1,
    COLUMNS: 3,
    HEIGHT_START: 7, // 기둥 상한 (기획서 4장 7번)
    HEIGHT_MIN: 5,
    HEIGHT_TIGHTEN_AT: 4, // 최고 등급이 이 값을 넘을 때마다 상한 -1
    FREE_MERGES: 3, // 첫 3수 합체 보장
    TIERS: [
      { name: "동전", icon: "🪙" },
      { name: "지폐", icon: "💵" },
      { name: "카드", icon: "💳" },
      { name: "지갑", icon: "👛" },
      { name: "금고", icon: "🔐" },
      { name: "금괴", icon: "🧈" },
      { name: "왕관", icon: "👑" },
    ],
    SPAWN_TOP_TIER: 2, // 새로 나오는 물건은 이 등급까지만 (0부터)
    MERGE_POINT: 2, // 합체 1회당
    CHAIN_BONUS: 3, // 연쇄 1단계당 추가
  },
  // ── ㉗ 오늘의 전국 게이지 (기획서 plans/2026-07-30/PLAN-17_오늘의전국게이지.md)
  //
  // 게임이 아니라 **전 게임을 묶는 시즌 레이어**로 쓰려는 기획입니다. 여기서는
  // 그 게이지를 눈으로 보고 직접 기여하는 **참여 화면**으로 구현합니다 → docs/gauge-game.md
  //
  // 전역 카운터는 D1 의 단일 문장 증가로 올립니다(`total = total + ?`). SQLite 는 쓰기를
  // 직렬화하므로 그 자체는 원자적입니다. 대규모에서 걸리는 것은 정확성이 아니라 쓰기
  // 처리량이고, 그때는 캐시 계층이나 Durable Objects 로 옮겨야 합니다.
  GAUGE: {
    mode: "ENDLESS",
    category: "puzzle", // 반응속도·판단 없음 — 순발력 묶음에 두면 오해를 부릅니다
    label: "오늘의 전국 게이지",
    icon: "🇰🇷",
    accent: "mint",
    tagline: "다 같이 채우는 오늘의 목표",
    baseAttempts: 1, // 하루 1회 참여
    adAttemptsPerDay: 1,
    boostsPerRun: 1, // 「광고 보고 기여 2배」 (기획서 8장)
    lives: 0, // 실패 없음
    TOKENS: 3, // 밀어 넣을 기여 토큰 수
    TOKEN_VALUE: 1, // 토큰 1개가 게이지에 더하는 값
    DAILY_TARGET: 500, // 오늘의 전국 목표
    STAGES: [30, 60, 100], // 해금 단계(%) — 전원 일괄 지급
    STAGE_POINT: 5,
    TOKEN_POINT: 2,
  },
  // ── ㉘ 톡톡 (기획서 plans/2026-07-31/PLAN-22_톡톡.md) ──────────────────────
  //
  // 화면 가득한 뽁뽁이를 **손을 떼지 않고 훑어서** 연달아 터뜨립니다. 손을 떼는 순간
  // 판이 끝나고, 그때까지 이어 터뜨린 개수가 기록입니다.
  //
  // 기획의 근거는 2026-07-31 정성 신호 4건입니다 — 재방문 이유가 재미의 깊이가 아니라
  // **부담 없음**이라는 진술이 일치했고, 그중 하나는 「게임이라 부르기 민망할 정도로
  // 조작이 쉽고」가 **칭찬**으로 쓰였습니다. 그래서 이 게임은 의도적으로 가장 단순한
  // 쪽입니다 — 조작 1종, 규칙 한 문장, 실패 개념 없음.
  //
  // ── 라운드 = 한 번의 훑기 ────────────────────────────────────────────────
  // 터짐 하나마다 서버에 물으면 판이 성립하지 않습니다(라운드 왕복이 약 470ms 인데
  // 터짐은 초당 8~10회입니다). 그래서 **손을 뗄 때 경로 전체를 한 번에 제출**하고
  // 서버가 다시 셉니다. 라운드 하나가 곧 스트로크 하나이고, 손을 뗀 것이 곧 소진이라
  // `lives: 1` 로 두면 엔진의 「소진 → 세션 유지 → 이어하기」가 기획서 8장 그대로입니다.
  //
  // ── 「가만히 있으면 터진다」를 막는 규칙 ─────────────────────────────────
  // 뽁뽁이는 아래에서 계속 밀려 올라오므로, 한 자리에 손을 대고만 있어도 계속 터지는
  // 해석이 가능합니다. 그러면 **안 움직이는 것이 최적 전략**이 되어 게임이 죽습니다.
  // 그래서 터짐은 **칸을 새로 넘어갈 때만** 일어납니다 — 기획서의 몸의 동사(훑는다)가
  // 그대로 규칙입니다. 서버도 같은 규칙으로 검증합니다(경로의 인접성).
  TOKTOK: {
    mode: "ENDLESS",
    category: "action", // 정답이 없고 몸으로 하는 게임 — 두뇌 묶음에 두면 오해를 부릅니다
    label: "톡톡",
    icon: "🫧",
    accent: "mint",
    tagline: "손 떼지 말고 훑어서 터뜨리기",

    baseAttempts: 5, // 판이 5~15초라 횟수로 승부하는 게임입니다 (기획서 14장 재도전률)
    adAttemptsPerDay: 5,
    boostsPerRun: 2, // 「그 자리에서 이어서」 총 2회 (기획서 8장)
    lives: 1, // 손을 뗀 것 = 소진. 실패가 아닙니다 (화면 어디에도 실패 표시가 없습니다)

    COLS: 7,
    ROWS: 10,

    // **조각 하나**에서 인정하는 터짐 수 상한 (한 번의 훑기 전체가 아닙니다).
    //
    // 화면은 FLUSH_AT 개마다 조각을 보내므로 정상 경로에서는 이 값에 닿지 않습니다.
    // 여유를 크게 둔 것은 조각이 날아가는 동안에도 손이 계속 움직이기 때문입니다.
    // 훑기 전체를 한 번에 받으려던 초안에서는 이 상한이 곧 기록의 상한이 되어
    // **화면 2000개가 400개로 기록됐습니다**(PC 마우스 확인에서 나왔습니다).
    MAX_POPS: 400,
    FLUSH_AT: 150, // 화면이 이만큼 모으면 손을 떼지 않아도 한 조각을 보냅니다

    // 상품 뽁뽁이 — 열 개에 하나꼴 (기획서 4장 5번). 스트로크 안에서 **몇 번째로
    // 터지는 것이 상품인가**를 서버가 정하고, 같은 스케줄로 다시 셉니다.
    //
    // 이 순번은 라운드와 함께 화면에 내려갑니다. 알아도 이득이 없기 때문입니다 —
    // 골라 터뜨릴 수도, 거기서 멈출 수도 없고, 할 수 있는 일은 계속 끄는 것뿐입니다.
    // 반대로 숨기면 「터지는 순간 상품이 드러난다」(기획서 10장)가 성립하지 않습니다.
    PRIZE_EVERY: 10,
    PRIZE_JITTER: 3, // ±3 — 정확히 10번마다면 리듬이 읽혀 놀라움이 사라집니다

    // 상품 뽁뽁이 안에서 드러나는 것 = 광고 지면 (기획서 10장).
    // 브랜드 주간에는 이 배열만 갈아 끼웁니다.
    PRODUCTS: [
      { key: "coffee", name: "커피", icon: "☕" },
      { key: "soda", name: "음료", icon: "🥤" },
      { key: "snack", name: "과자", icon: "🍪" },
      { key: "ice", name: "아이스크림", icon: "🍦" },
      { key: "burger", name: "버거", icon: "🍔" },
      { key: "box", name: "택배 상자", icon: "📦" },
    ],

    // 「오늘의 포장」 — 뽁뽁이 무늬·색이 매일 바뀝니다 (기획서 9장).
    // 날짜로만 정해지므로 저장할 상태가 없습니다(마이그레이션 불필요).
    PACKS: [
      { key: "aqua", name: "물빛 포장", hex: "#7FD8C0" },
      { key: "sky", name: "하늘 포장", hex: "#8FB8F0" },
      { key: "peach", name: "복숭아 포장", hex: "#F0A79A" },
      { key: "lemon", name: "레몬 포장", hex: "#E6CC72" },
      { key: "lilac", name: "라일락 포장", hex: "#BFA6E8" },
      { key: "mint", name: "박하 포장", hex: "#93E0B4" },
      { key: "coral", name: "산호 포장", hex: "#F09C86" },
    ],

    // ── 궤적 검사 (기획서 7장) ──────────────────────────────────────────
    //
    // **칸 하나당 최소 시간으로는 판단할 수 없습니다.** 화면을 가로지르는 빠른 훑기는
    // 한 프레임(16ms)에 두세 칸을 지나가고, 그것이 이 게임의 정상 동작입니다.
    // 하한을 두면 손가락이 빠른 사람만 순위에서 빠집니다(브라우저 확인에서 실제로 걸렸습니다).
    //
    // 그래서 두 가지만 봅니다.
    //   ① 지속 속도  한 스트로크 내내 유지되는 속도. 순간 최고가 아니라 평균입니다.
    //   ② 간격의 균일함  사람은 방향을 꺾을 때마다 느려집니다. 매크로는 그대로입니다.
    // 둘 다 **표본이 충분히 쌓였을 때만** 봅니다 — 짧은 훑기는 우연히 균일할 수 있습니다.
    // 칸 하나가 화면에서 약 9mm 입니다. 손가락 최고 속도(1~2 m/s)면 순간적으로는
    // 초당 100칸도 지나가지만, 판 안에서 방향을 꺾어 가며 **스무 칸 넘게 유지**되는
    // 평균은 그보다 훨씬 낮습니다. 브라우저 확인에서 53칸/초짜리 훑기가 이상치로
    // 찍혀 상한을 올렸습니다 — 빠른 사람을 잡는 것이 목적이 아닙니다.
    MAX_POPS_PER_SEC: 60,
    RATE_MIN_POPS: 20,
    UNIFORM_MIN_GAPS: 24, // 간격이 이만큼 모여야 균일함을 판단합니다
    UNIFORM_CV: 0.03, // 변동계수가 이보다 작으면 등속 = 이상치

    // 판 밖으로 손이 나갔다 돌아오면 경로가 끊깁니다(화면 가장자리). 그 자리는 -1 로
    // 표시해 인접성 검사를 다시 시작하는데, 끊김을 무제한 허용하면 인접성 검사 자체가
    // 무의미해집니다. 사람은 한 판에 몇 번 가장자리에 닿습니다.
    MAX_BREAKS: 8,

    // 신고한 시각이 서버가 라운드를 발급한 뒤 흐른 시간을 넘으면 그 뒤의 터짐은
    // 세지 않습니다. 네트워크·렌더링 지연 몫만 여유로 둡니다.
    REPORT_GRACE_MS: 3000,
  },
  // ── ㉙ 소등 (기획서 plans/2026-08-03/PLAN-24_소등.md) ─────────────────────
  //
  // 캄캄한 화면의 불빛을 하나씩 **꾹 눌러** 끄고, 완전한 어둠까지 걸린 시간을 겨룹니다.
  // 조작이 누름 지속이라 규격(탭 1종류)을 벗어납니다 → docs/lightout-game.md
  //
  // ── 취침 맥락이 설계 조건입니다 ──────────────────────────────────────────
  // 자사 기획 24건이 전부 「밝은 곳·서 있음·급함」이었고 이것이 첫 취침 맥락입니다.
  // 그래서 **화면 전체가 밝아지는 연출을 어디에도 넣지 않습니다** — 결과 화면·광고
  // 진입·보상 팝업 전부(기획서 10장). 소리도 쓰지 않습니다.
  //
  // ── 방 하나가 라운드 하나입니다 ──────────────────────────────────────────
  // 불빛마다 서버에 물으면 24 × 470ms = 11초가 왕복에 들어가 30~50초짜리 판이
  // 성립하지 않습니다. 화면은 불빛별 유지 시간을 모으기만 하고 **방을 다 끄면 한 번에**
  // 보냅니다. 서버가 같은 규칙으로 다시 재므로 시간을 화면이 정하지 않습니다.
  //
  // ── 순서 최적화가 재미의 축이 되지 않게 ──────────────────────────────────
  // 불빛끼리 상호작용시키지 않습니다(하나를 끄면 옆이 밝아지는 규칙 없음). 넣는 순간
  // 「순서 최적화」가 핵심이 되고 그건 몸의 동사가 아니라 판단입니다(기획서 5장).
  LIGHTOUT: {
    mode: "ENDLESS",
    category: "puzzle", // 반응속도 역의존 — 급하게 톡톡 치면 오히려 느려집니다
    label: "소등",
    icon: "🌙",
    accent: "gold",
    tagline: "불빛을 하나씩 꾹 눌러 끄기",

    baseAttempts: 3, // 하루 방 3개 (기획서 4장 7번)
    adAttemptsPerDay: 0, // 방을 더 주지 않습니다 — 광고는 「이 방, 한 번 더」뿐
    boostsPerRun: 2, // 방당 최대 2회 (기획서 8장)
    lives: 1, // 방 완주 = 소진. **실패가 아닙니다** (⑳㉘ 과 같은 처리)

    FIRST_ROOM_LIGHTS: 16, // 첫 방은 16개로 감을 잡게 합니다 (기획서 10장)
    LIGHTS: 24,

    // 불빛 하나가 꺼지는 데 걸리는 시간. 크기에 따라 다릅니다(기획서 4장 2번).
    // 이 값의 합이 곧 **기록의 하한**이고, 그 위에 엄지 이동 시간이 얹힙니다.
    HOLD_MIN_MS: 400,
    HOLD_MAX_MS: 800,

    // 불빛 사이 최소 간격(무대 짧은 변 비율). 엄지 접촉 반경 기준 — 겹치면 의도치
    // 않은 불빛이 꺼집니다(기획서 10장).
    MIN_GAP: 0.15,
    MARGIN: 0.1, // 가장자리 여백 — 화면 끝에 붙으면 엄지가 닿지 않습니다

    LIGHT_POINT: 1, // 불빛 하나당
    CLEAR_POINT: 12, // 방 완주
    FASTER_BONUS: 10, // 어제 기록 단축 (기획서 7장)

    // 방 하나의 상한. 이 시간을 넘긴 신고는 시간으로 보지 않습니다.
    // 제한 시간이 **아닙니다** — 화면에 카운트다운이 없고 넘겨도 판이 끝나지 않습니다.
    ROOM_MAX_MS: 600000,

    // ── 검증 (기획서 7장) ────────────────────────────────────────────────
    //
    // **유지 시간 자체의 균일함은 신호가 아닙니다.** 불빛마다 필요 시간이 400~800ms 로
    // 다르므로, 필요 시간에 딱 맞춰 누르는 매크로도 유지 시간의 분산은 크게 나옵니다
    // (테스트에서 이 오판이 그대로 걸렸습니다).
    //
    // 매크로가 드러나는 곳은 **필요 시간을 얼마나 넘겨 눌렀는가**입니다. 사람은 꺼진
    // 것을 보고 떼므로 초과분이 수십 ms 씩 흔들리고, 매크로는 그 값이 늘 같습니다.
    UNIFORM_SD_MS: 12, // 초과분의 표준편차가 이보다 작으면 손이 아닙니다
    UNIFORM_MIN_LIGHTS: 8, // 표본이 이만큼 모여야 판단합니다
    // 신고 시각과 서버 관측 시간창의 허용 오차
    REPORT_GRACE_MS: 4000,
  },
  // ── ㉚ 쭉 (기획서 plans/2026-08-01/PLAN-23_쭉.md) ─────────────────────────
  //
  // 말랑한 덩어리를 **잡아당겨** 끊어지기 전까지 길게 늘립니다. 조작이 드래그라
  // 규격(탭 1종류)을 벗어납니다 → docs/stretch-game.md
  //
  // ── 끊어지는 지점은 난수가 아닙니다 ──────────────────────────────────────
  // 기획서 0절 안티패턴 검사가 「숨은 난수 아님」을 명시합니다. 그래서 아래 상수만으로
  // 결정되는 **결정론적 손상 모형**을 씁니다. 화면이 이 식으로 실시간 판정하고,
  // 서버가 **같은 식으로 다시 계산해** 끊어졌어야 할 지점까지만 인정합니다.
  //
  //   손상률 = (길이/LEN_REF)^ALPHA × (손가락속도/SPEED_REF)^BETA   ← 급하면 커집니다
  //          + FATIGUE × (길이/LEN_REF)^GAMMA                      ← 가만히 있어도 쌓입니다
  //   누적 손상이 CAPACITY 에 닿으면 끊어집니다.
  //
  // 두 항이 서로 반대 방향이라 **최적 속도가 하나 생깁니다**(약 0.22 화면/초).
  // 급하면 첫 항이, 무한히 느리면 둘째 항이 잡습니다 — 기획서 16장 위험 3의 요구
  // (「천천히 끌수록 유리」가 무한 지연이 되지 않게)를 상수 하나가 아니라 모형이 막습니다.
  //
  // ── 늘어나는 속도에 상한을 둡니다 ────────────────────────────────────────
  // 손가락이 아무리 빨라도 점성 물질은 그만큼 늘어나지 않습니다. 상한이 없으면
  // 「첫 3초 보장」이 **빠른 사람에게 유리한 장치**가 됩니다 — 3초 동안 마음껏
  // 길이를 벌 수 있기 때문입니다. 상한을 두면 급하게 끈 손가락은 길이는 못 얻고
  // 응력만 얻습니다(기획서 4장 3번 「급하게 끌면 국부 응력이 커져 빨리 끊어진다」).
  STRETCH: {
    mode: "ENDLESS",
    category: "action", // 정답이 없고 몸으로 하는 게임 — 두뇌 묶음에 두면 오해를 부릅니다
    label: "쭉",
    icon: "🫓",
    accent: "gold",
    tagline: "끊어지기 직전까지 잡아당기기",

    baseAttempts: 5, // 한 판 10~20초 (기획서 6장)
    adAttemptsPerDay: 5,
    boostsPerRun: 2, // 「끊긴 자리에서 이어 붙이기」 총 2회 (기획서 8장)
    lives: 1, // 끊어짐 = 소진. **실패가 아닙니다** (기획서 6장 「실패 개념 없음」)

    // 길이의 단위는 **무대의 짧은 변**입니다. 1.0 = 화면 하나를 가로지른 길이.
    LEN_REF: 1,
    ALPHA: 1, // 길이가 응력에 주는 영향
    BETA: 2, // 속도가 응력에 주는 영향 — 1보다 커야 「빠르면 손해」가 성립합니다
    GAMMA: 1, // 길이가 피로에 주는 영향
    SPEED_REF: 1.1, // 화면/초
    FATIGUE: 0.04, // 초당 피로 계수
    CAPACITY: 0.88, // 누적 손상이 이 값에 닿으면 끊어집니다
    // → 최적 속도 약 0.22 화면/초 · 그때 최장 길이 약 2.2 화면 · 걸리는 시간 약 10초

    MAX_STRETCH_RATE: 0.5, // 늘어나는 속도 상한 (화면/초)
    GRACE_MS: 3000, // 첫 3초 동안은 끊어지지 않습니다 (기획서 0-I 초보자 보장)

    LEN_POINT: 40, // 길이 1.0 당 확정 적립
    BEST_BONUS: 15, // 최장 길이 갱신
    PRIZE_POINT: 5, // 상품 발견 하나당

    // 상품이 드러나는 길이 (기획서 10장). 「내가 잡아당겨 꺼낸 것」이라 시선이 갑니다.
    PRIZE_EVERY: 0.55,
    PRIZE_JITTER: 0.12, // ±  — 정확히 같은 간격이면 리듬이 읽혀 놀라움이 사라집니다

    // ── 오늘의 재료 (기획서 9장) ─────────────────────────────────────────
    // 늘어나는 물체가 매일 바뀝니다. 날짜로만 정해지므로 저장할 상태가 없습니다
    // (㉘ 「오늘의 포장」과 같은 방식 — 마이그레이션 불필요).
    DOUGHS: [
      { key: "cheese", name: "치즈", hex: "#E8C25C" },
      { key: "yeot", name: "엿", hex: "#C98A4B" },
      { key: "ricecake", name: "떡", hex: "#F0E6DA" },
      { key: "gum", name: "껌", hex: "#F0A0C0" },
      { key: "noodle", name: "면", hex: "#EFD9A0" },
      { key: "caramel", name: "카라멜", hex: "#D08A50" },
      { key: "mochi", name: "찹쌀떡", hex: "#EFEFF5" },
    ],

    // 덩어리 안에서 드러나는 것 = 광고 지면 (기획서 10장).
    // 「쭉 늘어나는 것」이 상품 특성인 업종이 실재합니다 — 치즈·엿·떡·껌·면류.
    PRODUCTS: [
      { key: "pizza", name: "피자", icon: "🍕" },
      { key: "cheese", name: "치즈", icon: "🧀" },
      { key: "ricecake", name: "떡", icon: "🍡" },
      { key: "noodle", name: "면", icon: "🍜" },
      { key: "gum", name: "껌", icon: "🍬" },
      { key: "bread", name: "빵", icon: "🥐" },
    ],

    // ── 궤적 검사 (기획서 7장) ───────────────────────────────────────────
    // 매크로는 등속 직선이라 **장력 분포가 비정상적으로 균일**합니다. 사람 손가락은
    // 방향을 꺾을 때마다 느려집니다. 표본이 적으면 우연히 균일할 수 있어 하한을 둡니다.
    UNIFORM_MIN_STEPS: 20,
    UNIFORM_CV: 0.03,

    MAX_SAMPLES: 400, // 조각 하나에서 받는 표본 상한
    FLUSH_AT: 120, // 화면이 이만큼 모으면 손을 떼지 않아도 한 조각을 보냅니다
    SAMPLE_MS: 40, // 표본 간격 — 이보다 촘촘히 보내지 않습니다
    REPORT_GRACE_MS: 3000,
  },
};

/**
 * 광고 소재 세트 — 「찾아야 할 대상」 자체를 광고주 상품으로 바꾸는 자리입니다.
 *
 * 두 게임은 서버에서 돌고 있지만 광고주에게 팔 것이 없었습니다. 색 타일과 무지 카드로
 * 돌기 때문입니다. 소재가 코드에 박혀 있으면 광고주가 생겨도 코드를 고쳐야 하므로,
 * 먼저 데이터로 뺍니다 (배포게임_개선안_2026-07-30 A절 ①).
 *
 * **지면을 파는 단위는 `active` 한 줄입니다.** 세트를 추가하고 이 값을 바꾸면 교체됩니다.
 * 운영자 업로드 콘솔은 첫 광고주가 확정된 뒤에 만듭니다 — 소재 규격·게재 기간·승인
 * 흐름을 모르는 채로 만들면 두 번 만들게 됩니다.
 *
 * 난이도는 세트가 건드리지 않습니다. 소재만 갈아 끼우고 판별 난이도(색차 감쇠)는
 * 그대로 쓰므로, 상품 사진으로 바꿔도 곡선이 흔들리지 않습니다.
 */
export const AD_SETS = {
  // 같은 상품을 깔고 한 칸만 색을 미세하게 틀어 둡니다. 「신제품 vs 기존 제품」을
  // 나란히 놓는 것과 같은 자리라, 리뉴얼 패키지 인지를 게임으로 학습시킵니다.
  ODDCOLOR: {
    active: "default",
    sets: {
      default: { sponsor: null, kind: "color" },
      sample_cafe: { sponsor: "샘플 카페", kind: "glyph", glyphs: ["🥤", "🧋", "🍰", "🥐"] },
    },
  },

  // 앞면은 상품, 뒷면은 브랜드 아트입니다. 원본 12~16종 상한은 세트가 지킵니다 —
  // 상위 난이도를 새 상품으로 채우면 라인업 35종인 브랜드가 필요해져 운영이 막힙니다.
  CARDPAIR: {
    active: "default",
    sets: {
      default: {
        sponsor: null,
        back: "?",
        symbols: ["🍎", "🍋", "🍇", "🍒", "🥝", "🍉", "🍑", "🫐", "🥥", "🍍", "🍓", "🌰"],
      },
      sample_snack: {
        sponsor: "샘플 간식",
        back: "🎁",
        symbols: ["🍫", "🍪", "🥨", "🍩", "🧁", "🍬", "🍿", "🥜", "🍮", "🥧", "🍯", "🧇"],
      },
    },
  },
};

/** 지금 걸려 있는 소재 세트. `active` 가 잘못됐으면 조용히 기본 세트로 돌아갑니다. */
export const adSetOf = (game) => {
  const entry = AD_SETS[game];
  return entry.sets[entry.active] ?? entry.sets.default;
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
/**
 * 스위트 「오늘의 나」 — 타로·사주·심리가 공유하는 값 (SUITE-SPEC-01 §1)
 *
 * ── 포인트는 전부 가안이다 ──────────────────────────────────────────────
 * 기획서 1.3 이 "광고 실연동 시 Master 확정" 으로 남긴 값이다. 여기 한 곳에 모아 둔
 * 이유가 그것이다 — 확정되면 이 표만 고친다.
 *
 * **원가 레버는 이 표와 상한뿐이다.** 확률·난이도·콘텐츠에 손대지 않는다(안티패턴 4).
 * 타로는 서버가 22장을 균등 추첨하므로 원가를 조절할 확률 자체가 없다.
 */
export const SUITE = {
  SERVICES: ["tarot", "saju", "mind"],

  POINTS: {
    CORE_DONE: 5, // 각 서비스 일일 코어 완료 (서비스당 1회/일)
    COLLECT_NEW: 3, // 수집 신규 (카드/도장/지도축)
    TRIPLE_DONE: 15, // 3종 모두 완료 (하루 1회)
    PAIR_OK: 10, // 페어 성사 (하루 1회 · 3종 통합)
    MILESTONE_HALF: 20, // 도감 절반 · 순 완성
    MILESTONE_FULL: 50, // 도감 완성
    MILESTONE_GRAND: 100, // 6순 대완성
  },

  /**
   * 페어 링크 (SUITE 1.6) — 값은 전부 가안이고 오픈이슈 2 에서 승인 대기 중이다.
   *
   * 생성 상한이 **서비스 통합**인 것이 핵심이다. 서비스별로 3건씩 두면 하루 9건이
   * 되고, 그건 초대가 아니라 스팸이다.
   */
  PAIR: {
    RELATIONS: ["lover", "friend", "family", "coworker"],
    MAX_PER_DAY: 3, // 이용자당·서비스 통합
    EXPIRE_MS: 72 * 60 * 60 * 1000, // 72시간
    KEEP_MS: 30 * 24 * 60 * 60 * 1000, // 30일 뒤 행 삭제
    QUESTIONS: 3, // 추측 문항 수 (심리 M-05)
  },

  /**
   * 분포 공개 유예 (SUITE 1.5).
   *
   * 참여자가 몇십 명일 때 "4.5%" 를 보여 주면 그 값은 사람 한두 명을 뜻하고,
   * 다음 사람의 선택을 그쪽으로 끌어당긴다. 임계 미만이면 「집계 중」으로 표시한다.
   */
  DIST_MIN_SAMPLES: 1000,
};

// ── 🔮 오늘의 타로 (TAROT-SPEC-01) ────────────────────────────────────────
//
// 아케이드가 아니다 — 순위가 없고 실패가 없다. 그래서 `ARCADE` 가 아니라 따로 둔다.
// 콘텐츠(해석 22×4×3 · 조언 60 · 아이템 30)는 화면이 가진다 — 보상과 무관한 회전이라
// 서버가 알 필요가 없다(기획서 T-07).
export const TAROT = {
  CARDS: 22,
  FOCUSES: ["day", "work", "love", "money"],

  FREE_DRAWS: 1, // 무료 1회/일
  AD_MORE_PER_DAY: 2, // 「한 장 더」 광고 (T-03)
  MAX_DRAWS: 3, // 무료 1 + 광고 2

  SHUFFLES_FIRST: 3, // 첫 뽑기는 셔플 3회
  SHUFFLES_EXTRA: 1, // 「한 장 더」는 1회로 단축 (T-03)

  MILESTONE_HALF: 11, // 도감 11장
  MILESTONE_FULL: 22, // 도감 완성

  // 온보딩 보너스 1장. 기획서 9절 오픈이슈 2 에서 "가안" 으로 남긴 항목이라
  // 끄고 켤 수 있게 둔다.
  WELCOME_DRAW: true,
};

// ── 🔬 오늘의선택 (MIND-SPEC-01) ──────────────────────────────────────────
//
// 콘텐츠(실험 7 · pairQ 12 · pairPsy 180 …)는 화면이 가진다. 서버가 같은 DB 를
// 갖게 하면 실험을 추가할 때마다 두 곳을 고쳐야 하고, 기획서 5절은 **주 2~3개
// 공급**을 전제한다. 서버는 형태(문항 4 × 선택지 5)만 검증한다.
export const MIND = {
  QUESTIONS: 4,
  OPTIONS: 5,
  TYPES: 4,
  AXES: 8,
  AXIS_GOAL: 5, // 축 하나를 「또렷하다」고 보는 기준 (M-03)

  AD_ARCHIVE_PER_DAY: 2, // 「지난 실험 열기」 (M-04) — 적립은 없다
  ARCHIVE_DAYS: 6, // 직전 6일 안의 미완 실험만 대상
};

// ── 🌤️ 오늘의 기운 (SAJU-SPEC-01) ────────────────────────────────────────
//
// 만세력은 정적 표다(data/saju-jeol.json · docs/saju-calendar.md).
// 해석 문장(223조각)은 화면이 갖는다 — 보상과 무관한 회전이다.
export const SAJU = {
  MIN_AGE: 14,        // 만 14세 미만 차단 (기획서 1절)
  STAMPS_TOTAL: 60,   // 60갑자 도장판
  SOON_SIZE: 10,      // 순(旬) 한 묶음
  BIRTH_MIN: "1930-01-01",
};

export const AD_TRIGGERS = {
  STOPWATCH_ATTEMPT: { game: "STOPWATCH", type: "REWARDED", perDay: STOPWATCH.AD_VIEWS_PER_DAY },
  STOPWATCH_STATS: { game: "STOPWATCH", type: "INTERSTITIAL", perDay: null },
  BASEBALL_ATTEMPT: { game: "BASEBALL", type: "REWARDED", perDay: null }, // 게임당 제한이라 별도 처리
  BASEBALL_STATS: { game: "BASEBALL", type: "INTERSTITIAL", perDay: null },
  TYPING_SENTENCE: { game: "TYPING", type: "REWARDED", perDay: TYPING.AD_VIEWS_PER_DAY },
  TYPING_RANK: { game: "TYPING", type: "INTERSTITIAL", perDay: null },
  MEMORY_LEVEL: { game: "MEMORY", type: "REWARDED", perDay: MEMORY.AD_VIEWS_PER_DAY },
  MEMORY_RANK: { game: "MEMORY", type: "INTERSTITIAL", perDay: null },

  // ── 스위트 서비스 (게임이 아니다) ──────────────────────────────────────
  //
  // `game` 대신 `service` 를 갖는다. 게임 트리거는 보상이 「도전 기회」인데 이쪽은
  // 「뽑기 1회」·「열람 해제」처럼 서비스마다 다르므로, src/routes/ad.js 가 서비스별
  // 핸들러로 분기한다. `game` 을 넣어 두면 아케이드 경로로 잘못 들어간다.
  //
  // **순위가 없는 서비스라 보상 카드에 「'+' 리그」 줄을 붙이지 않는다**(SUITE 1.4).
  TAROT_ATTEMPT: { service: "tarot", type: "REWARDED", perDay: TAROT.AD_MORE_PER_DAY },
  TAROT_STATS: { service: "tarot", type: "INTERSTITIAL", perDay: 1 },

  SAJU_TOMORROW: { service: "saju", type: "REWARDED", perDay: 1 },
  SAJU_PERSON: { service: "saju", type: "REWARDED", perDay: 1 },
  SAJU_STATS: { service: "saju", type: "INTERSTITIAL", perDay: 1 },

  MIND_ARCHIVE: { service: "mind", type: "REWARDED", perDay: MIND.AD_ARCHIVE_PER_DAY },
  MIND_CHEMI: { service: "mind", type: "REWARDED", perDay: 1 },
  MIND_STATS: { service: "mind", type: "INTERSTITIAL", perDay: 1 },
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
