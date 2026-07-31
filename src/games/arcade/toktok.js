/**
 * ㉘ 톡톡 — ENDLESS
 *
 * 화면 가득한 뽁뽁이를 손을 떼지 않고 훑어서 연달아 터뜨립니다.
 * 기획: docs/toktok-game.md (기획서 IDEA-2026-0022)
 *
 * ── 라운드 = 한 번의 훑기 ────────────────────────────────────────────────
 * 터짐 하나마다 서버에 물으면 판이 성립하지 않습니다(라운드 왕복 약 470ms, 터짐은
 * 초당 8~10회). 그래서 라운드 하나가 **스트로크 하나**입니다 — 손을 대고 뗄 때까지의
 * 경로 전체(지나간 칸 열 + 시각 열)를 한 번에 받아 서버가 다시 셉니다.
 *
 * 손을 뗀 것이 곧 소진이므로 `lives: 1` 이고, 정상적인 훑기의 판정은 늘
 * `ok: true, fatal: true` 입니다. **fatal 은 실패가 아니라 소진의 표시**입니다
 * (⑳ 슥슥 긁기와 같은 처리). 화면 어디에도 실패로 표시되는 곳이 없습니다.
 *
 * ── 서버가 실제로 막을 수 있는 것 ────────────────────────────────────────
 * 뽁뽁이는 전부 같아서 **판에는 비밀이 없습니다.** 배치를 숨겨 봐야 지킬 것이 없고,
 * 화면에 그려야 하므로 숨길 수도 없습니다. 그래서 검증은 두 가지로 합니다.
 *
 *   ① 경로의 인접성  손가락은 연속이므로 연달아 터진 두 칸은 반드시 이웃입니다.
 *                    (클라이언트가 선분 보간으로 중간 칸을 빠짐없이 채워야 성립하며,
 *                     기획서 16장 위험 2 「빠른 드래그에서 히트가 새는 문제」의
 *                     구현 요구를 서버가 그대로 강제하는 셈입니다)
 *   ② 간격의 균일함  사람 손가락은 흔들리고 매크로는 등속입니다. 이 게임에서 가장
 *                    잡기 쉬운 신호이고, 기획서 7장이 든 것도 그것입니다.
 *
 * 비밀은 **상품 뽁뽁이 스케줄** 하나뿐인데, 그마저 화면에 내려보냅니다 — 알아도
 * 이득이 없기 때문입니다(골라 터뜨릴 수도, 거기서 멈출 수도 없습니다). 대신 서버가
 * 자기 스케줄로 다시 세므로 개수를 부풀릴 수는 없습니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { dayKey } from "../../lib/time.js";

const C = ARCADE.TOKTOK;
const CELLS = C.COLS * C.ROWS;

// ══════════════════════════════════════════════════════════════
// 오늘의 포장 (기획서 9장)
// ══════════════════════════════════════════════════════════════

/**
 * 날짜만으로 정해지는 무늬·색.
 *
 * 저장할 상태가 없어 마이그레이션이 필요 없고, 같은 날 접속한 모든 사용자가 같은
 * 포장을 봅니다 — 「오늘의 포장」이 대화 소재가 되려면 그래야 합니다.
 */
export function packOf(day = dayKey()) {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) % 100003;
  return C.PACKS[h % C.PACKS.length];
}

// ══════════════════════════════════════════════════════════════
// 상품 뽁뽁이 스케줄
// ══════════════════════════════════════════════════════════════

/**
 * 이 스트로크에서 **몇 번째로 터지는 것이 상품인가**.
 *
 * 정확히 10번마다면 리듬이 읽혀 놀라움이 사라지므로 ±JITTER 로 흔듭니다.
 * MAX_POPS 까지 미리 만들어 두면 판정할 때 세기만 하면 됩니다.
 */
export function makePrizes(pickInt = randomInt) {
  const out = [];
  let at = 0;
  while (at < C.MAX_POPS) {
    at += C.PRIZE_EVERY + pickInt(-C.PRIZE_JITTER, C.PRIZE_JITTER);
    if (at <= 0 || at > C.MAX_POPS) break;
    out.push({ at, key: C.PRODUCTS[pickInt(0, C.PRODUCTS.length - 1)].key });
  }
  return out;
}

const productOf = (key) => C.PRODUCTS.find((p) => p.key === key) ?? null;

// ══════════════════════════════════════════════════════════════
// 경로 채점
// ══════════════════════════════════════════════════════════════

/** 두 칸이 이웃인가 (대각선 포함 — 모서리를 가로지르는 훑기가 있습니다) */
const adjacent = (a, b) => {
  if (a === b) return false; // 같은 칸에 머무는 것은 터짐이 아닙니다 (「훑는다」)
  const dc = Math.abs((a % C.COLS) - (b % C.COLS));
  const dr = Math.abs(Math.floor(a / C.COLS) - Math.floor(b / C.COLS));
  return dc <= 1 && dr <= 1;
};

/** 표본의 변동계수 — 0 에 가까울수록 등속(매크로) */
function variation(xs) {
  if (xs.length === 0) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (m <= 0) return 0;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v) / m;
}

/**
 * 스트로크 하나를 채점합니다.
 *
 * 어긋난 지점이 나오면 **거기서 자릅니다.** 판 전체를 버리지 않는 이유는, 어긋남의
 * 대부분이 조작이 아니라 통신·렌더링 사고이기 때문입니다 — 그때까지 사용자가 실제로
 * 터뜨린 만큼은 남겨 주는 편이 맞습니다(기획서 6장 「터뜨린 개수는 전액 확정」).
 *
 * @param {{cells:any, times:any, prizes:Array, sinceIssuedMs:number}} input
 * @returns {{pops:number, prizeHits:Array, breaks:number, cut:string|null,
 *            uniform:boolean, tooFast:boolean, spanMs:number}}
 */
export function gradeStroke({ cells, times, prizes = [], sinceIssuedMs = Infinity }) {
  const path = Array.isArray(cells) ? cells : [];
  const at = Array.isArray(times) ? times : [];
  const deadline = sinceIssuedMs + C.REPORT_GRACE_MS;

  let pops = 0;
  let breaks = 0;
  let prev = null; // 직전에 터진 칸 (null = 경로가 끊긴 직후)
  let prevMs = null;
  let cut = null;
  let spanMs = 0;
  const gaps = [];

  for (let i = 0; i < path.length && i < at.length; i++) {
    const cell = Number(path[i]);
    const t = Number(at[i]);

    if (!Number.isFinite(t) || t < 0 || t > deadline) { cut = "time"; break; }
    if (prevMs != null && t < prevMs) { cut = "time"; break; }

    // -1 = 손이 판 밖으로 나갔다 돌아온 자리. 터짐이 아니라 경로의 이음매입니다.
    if (cell === -1) {
      if (++breaks > C.MAX_BREAKS) { cut = "breaks"; break; }
      prev = null;
      prevMs = t;
      spanMs = t;
      continue;
    }

    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) { cut = "cell"; break; }
    if (prev != null && !adjacent(prev, cell)) { cut = "path"; break; }

    if (prev != null && prevMs != null) gaps.push(t - prevMs);
    pops += 1;
    prev = cell;
    prevMs = t;
    spanMs = t;

    if (pops >= C.MAX_POPS) { cut = "max"; break; }
  }

  return {
    pops,
    breaks,
    cut,
    spanMs,
    prizeHits: prizes
      .filter((p) => p.at <= pops)
      .map((p) => ({ at: p.at, ...(productOf(p.key) ?? { name: "", icon: "" }) })),
    // 지속 속도. 순간 최고가 아니라 스트로크 전체의 평균을 봅니다 — 빠른 훑기 한 번을
    // 이상치로 잡으면 손가락이 빠른 사람만 순위에서 빠집니다.
    tooFast:
      pops >= C.RATE_MIN_POPS && spanMs > 0 && (pops / spanMs) * 1000 > C.MAX_POPS_PER_SEC,
    // 등속 = 매크로. 표본이 적으면 우연히 균일할 수 있어 하한을 둡니다.
    uniform: gaps.length >= C.UNIFORM_MIN_GAPS && (variation(gaps) ?? 1) < C.UNIFORM_CV,
  };
}

// ══════════════════════════════════════════════════════════════
// 진행 상태
// ══════════════════════════════════════════════════════════════

/**
 * 판정·라운드 응답마다 붙이는 "지금까지" 요약.
 *
 * ENDLESS 는 finalize 에 detail 을 넘길 자리가 없어 result.detail 이 비어 있습니다.
 * 결과 화면이 쓸 값을 마지막 응답에서 가져가야 하므로 모든 응답에 같은 요약을 붙입니다
 * (⑲⑳ 과 같은 처리).
 */
function progressOf(ext) {
  return {
    pops: ext.pops ?? 0,
    strokes: ext.strokes ?? 0,
    best_stroke: ext.best ?? 0,
    prize_hits: ext.prizeHits ?? 0,
    pack: ext.pack ?? null,
  };
}

/** 화면이 판을 그리는 데 필요한 것 전부 */
const pubOf = (meta, prizes) => ({
  cols: C.COLS,
  rows: C.ROWS,
  // 상품 순번은 공개입니다 — 알아도 할 수 있는 일이 없고(파일 상단 주석),
  // 숨기면 「터지는 순간 상품이 드러난다」가 성립하지 않습니다.
  prizes: prizes.map((p) => ({ at: p.at, ...(productOf(p.key) ?? { name: "", icon: "" }) })),
  // 새로고침으로 **소진된 런을 이어받았을 때** 이어하기를 다시 제안해야 하는데,
  // 엔진의 이어받기 응답은 보상 사용량을 0 으로 되돌려 주므로 라운드에 실어 보냅니다.
  boosts_used: meta.boosts ?? 0,
  ...progressOf(meta.ext ?? {}),
});

// ══════════════════════════════════════════════════════════════
// spec
// ══════════════════════════════════════════════════════════════

export const spec = {
  game: "TOKTOK",
  mode: "ENDLESS",

  /**
   * 라운드 = 한 번 손을 대고 뗄 때까지.
   *
   * `limitMs` 가 null 인 것은 의도입니다 — 반응속도 비의존이 이 기획의 전제이고
   * (기획서 0절 반응속도 검사), 제한 시간을 두면 「천천히 끌어도 불리하지 않다」가
   * 깨집니다. 대신 신고한 시각은 서버가 관측한 시간창 안이어야 합니다(gradeStroke).
   */
  makeRound(roundNo, meta) {
    const ext = (meta.ext ??= {});
    if (ext.day == null) {
      const pack = packOf();
      Object.assign(ext, {
        day: dayKey(),
        pack: { key: pack.key, name: pack.name, hex: pack.hex },
        pops: 0,
        strokes: 0,
        best: 0,
        prizeHits: 0,
        rough: 0,
      });
    }

    const prizes = makePrizes();
    return { pub: pubOf(meta, prizes), secret: { prizes }, limitMs: null };
  },

  /**
   * answer = { cells: [칸 번호 …], times: [스트로크 시작 이후 ms …] }
   *
   * 두 배열은 길이가 같고, `cells` 에 섞인 -1 은 손이 판 밖으로 나갔다 돌아온 자리입니다.
   */
  judgeRound({ answer, roundSecret, meta, sinceIssuedMs }) {
    const ext = (meta.ext ??= {});
    const prizes = roundSecret?.prizes ?? [];
    const graded = gradeStroke({
      cells: answer?.cells,
      times: answer?.times,
      prizes,
      sinceIssuedMs,
    });

    // 살짝 닿았다 뗀 것으로 판을 끝내지 않습니다 — 실수로 화면에 손이 스치기만 해도
    // 도전 기회가 날아가는 것을 막습니다. 아무것도 소모하지 않고 다시 훑게 둡니다.
    if (graded.pops === 0) {
      return { ok: false, fatal: false, data: { invalid: "손가락을 대고 끌어 주세요" } };
    }

    ext.pops = (ext.pops ?? 0) + graded.pops;
    ext.strokes = (ext.strokes ?? 0) + 1;
    ext.best = Math.max(ext.best ?? 0, graded.pops);
    ext.prizeHits = (ext.prizeHits ?? 0) + graded.prizeHits.length;
    if (graded.tooFast || graded.uniform) ext.rough = (ext.rough ?? 0) + 1;

    // 소진된 판에는 엔진이 다음 라운드를 내지 않습니다. 그대로 두면 이어받기가 직전
    // 라운드를 그리므로 여기서 갱신합니다 (⑳ 과 같은 처리).
    meta.pub = pubOf(meta, prizes);

    return {
      ok: true,
      fatal: true, // 손을 뗐다 = 소진. **실패가 아닙니다**
      suspect: (ext.rough ?? 0) > 0,
      data: {
        stroke_pops: graded.pops,
        prizes: graded.prizeHits,
        ...progressOf(ext),
      },
    };
  },

  /** 「광고 보고 그 자리에서 이어서」 — 연속 수·기록을 그대로 유지합니다 (기획서 8장) */
  applyBoost(meta) {
    meta.lives = 1; // 다시 훑을 수 있게 판을 엽니다
    return { data: progressOf(meta.ext ?? {}) };
  },
  boostLabel: "이어서 터뜨리기",

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    return {
      pops: ext.pops ?? 0,
      strokes: ext.strokes ?? 0,
      best_stroke: ext.best ?? 0,
      prize_hits: ext.prizeHits ?? 0,
      pack: ext.pack?.key ?? null,
    };
  },

  bucketOf: () => "all",

  /**
   * 순위 지표는 이어 터뜨린 개수뿐입니다.
   *
   * 동점자를 평균 간격으로 가르지 않습니다 — 그러면 **빨리 끄는 쪽이 유리**해져
   * 「빠르게 끄는 것이 아니라 끊지 않는 것이 과제」(기획서 0절)가 뒤집히고,
   * 15장 가설 4(빠른 이용자와 느린 이용자의 기록 차이가 작다)를 잴 수 없게 됩니다.
   */
  rankMetricOf: (meta) => -(meta.ext?.pops ?? 0),

  scoreOf: (meta) => meta.ext?.pops ?? 0,
};
