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
