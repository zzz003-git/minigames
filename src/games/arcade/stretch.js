/**
 * ㉚ 쭉 — ENDLESS
 *
 * 말랑한 덩어리를 잡아당겨 끊어지기 전까지 길게 늘립니다.
 * 기획: plans/2026-08-01/PLAN-23_쭉.md (IDEA-2026-0023) · docs/stretch-game.md
 *
 * ── 끊어지는 지점은 난수가 아닙니다 ──────────────────────────────────────
 * 기획서 0절 안티패턴 검사가 「끊어지는 지점은 끄는 속도와 각도의 물리 결과다
 * (숨은 난수 아님)」를 명시합니다. 그래서 아래 `damageRate` 하나로 전부 결정됩니다.
 * 화면이 같은 식으로 실시간 판정하고, 서버가 **같은 식으로 다시 계산해** 끊어졌어야
 * 할 지점까지만 인정합니다 — 화면이 기록을 정하지 못합니다.
 *
 * ── 왜 두 항인가 ────────────────────────────────────────────────────────
 *   응력항  (길이)^ALPHA × (속도)^BETA   BETA>1 이라 **급하면 손해**입니다
 *   피로항  FATIGUE × (길이)^GAMMA       가만히 있어도 쌓여 **무한 지연을 막습니다**
 * 두 항이 반대 방향이라 최적 속도가 하나 생깁니다(약 0.22 화면/초 · 약 10초 · 약 2.2 화면).
 * 기획서 16장 위험 3 「천천히 끌수록 유리가 지루함이 될 위험」을 상수 하나가 아니라
 * 모형 자체가 막습니다.
 *
 * ── 서버가 실제로 막을 수 있는 것 ────────────────────────────────────────
 * 화면은 표본 (시각, 길이) 열을 보냅니다. 손가락 속도는 신고받지 않고 **서버가
 * Δ길이/Δ시각으로 직접 구합니다** — 늘어나는 속도에 상한이 있어 이 값은 실제 손가락
 * 속도의 하한이고, 하한을 쓰면 손상이 과소평가되어 언제나 사용자에게 유리한 쪽으로
 * 판정됩니다. 그런데도 피로항 때문에 이 모형이 인정하는 최장 길이는 약 2.2 화면에서
 * 막힙니다 — 길이를 부풀린 신고는 서버가 앞에서 끊습니다.
 *
 * ── 실패가 없습니다 ──────────────────────────────────────────────────────
 * 끊어짐이 곧 소진이고 그때까지의 길이가 전액 기록입니다. `lives: 1` 이며 정상
 * 판정은 늘 `ok: true, fatal: true` 입니다 — fatal 은 실패가 아니라 소진의 표시입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { dayKey } from "../../lib/time.js";
import { personalBest } from "../../lib/db.js";

const C = ARCADE.STRETCH;

const round3 = (v) => Number(v.toFixed(3));

// ══════════════════════════════════════════════════════════════
// 손상 모형 — 이 게임의 전부입니다
// ══════════════════════════════════════════════════════════════

/**
 * 지금 이 순간 쌓이는 손상의 속도.
 *
 * **화면(public/games/stretch/game.js)이 같은 식을 갖고 있습니다.** 한쪽만 고치면
 * 화면이 보여 준 끊어짐과 서버가 인정한 끊어짐이 어긋나 기록이 조용히 깎입니다
 * (㉑ 퍼펙트 스택의 blockX 와 같은 성질의 이중 구현입니다).
 *
 * @param {number} len 지금 길이 (무대 짧은 변 = 1)
 * @param {number} speed 손가락 속도 (화면/초)
 */
export function damageRate(len, speed) {
  const L = Math.max(0, len) / C.LEN_REF;
  const v = Math.max(0, speed) / C.SPEED_REF;
  return L ** C.ALPHA * v ** C.BETA + C.FATIGUE * L ** C.GAMMA;
}

/**
 * 표본 열을 처음부터 다시 밟아 **끊어졌어야 할 지점**을 찾습니다.
 *
 * @param {{samples:Array<{t:number,len:number}>, dmg0:number, len0:number,
 *          elapsed0:number}} input
 *   dmg0/len0/elapsed0 은 앞 조각까지의 누적입니다 (한 번의 끌기가 여러 조각으로 옵니다).
 * @returns {{dmg:number, len:number, elapsed:number, broke:boolean,
 *            steps:Array<number>, bad:string|null}}
 */
export function simulate({ samples, dmg0 = 0, len0 = 0, elapsed0 = 0 }) {
  let dmg = dmg0;
  let len = len0;
  let elapsed = elapsed0;
  let prevT = 0;
  let prevLen = len0;
  const steps = []; // 구간별 속도 — 균일함(매크로) 검사에 씁니다

  for (const s of samples) {
    const t = Number(s?.t);
    const L = Number(s?.len);

    if (!Number.isFinite(t) || !Number.isFinite(L)) return { dmg, len, elapsed, broke: false, steps, bad: "shape" };
    if (t < prevT) return { dmg, len, elapsed, broke: false, steps, bad: "time" };
    if (L < prevLen - 0.001) return { dmg, len, elapsed, broke: false, steps, bad: "shrink" };

    const dt = (t - prevT) / 1000;
    if (dt <= 0) {
      prevT = t;
      continue;
    }

    const dL = Math.max(0, L - prevLen);
    // 늘어나는 속도 상한 — 넘겨서 신고한 것은 상한까지만 인정합니다.
    const grow = Math.min(dL, C.MAX_STRETCH_RATE * dt);
    // 손가락 속도는 신고받지 않고 여기서 구합니다 (파일 상단 주석)
    const speed = grow / dt;
    steps.push(speed);

    len += grow;
    elapsed += dt * 1000;
    dmg += damageRate(len, speed) * dt;

    prevT = t;
    prevLen = L;

    // 첫 GRACE_MS 동안은 끊어지지 않습니다 (기획서 0-I 초보자 보장).
    // 손상은 그동안에도 쌓이므로, 급하게 끈 손가락은 보장이 풀리는 순간 끊어집니다.
    if (elapsed >= C.GRACE_MS && dmg >= C.CAPACITY) {
      return { dmg, len: round3(len), elapsed, broke: true, steps, bad: null };
    }
  }

  return { dmg, len: round3(len), elapsed, broke: false, steps, bad: null };
}

/** 표본의 변동계수 — 0 에 가까울수록 등속(매크로) */
function variation(xs) {
  if (xs.length === 0) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (m <= 0) return 0;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v) / m;
}

// ══════════════════════════════════════════════════════════════
// 오늘의 재료 · 상품 (기획서 9·10장)
// ══════════════════════════════════════════════════════════════

/** 날짜만으로 정해지는 재료. 저장할 상태가 없습니다 (㉘ 「오늘의 포장」과 같은 방식) */
export function doughOf(day = dayKey()) {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) % 100003;
  return C.DOUGHS[h % C.DOUGHS.length];
}

/**
 * **어느 길이에서 상품이 드러나는가**.
 *
 * 공개해도 되는 값입니다 — 알아도 골라 뽑을 수도, 거기서 멈출 수도 없고 할 수 있는
 * 일은 계속 끄는 것뿐입니다. 반대로 숨기면 「늘리는 도중 상품이 드러난다」를 화면이
 * 그릴 수 없습니다 (㉘ 톡톡의 상품 순번과 같은 판단).
 */
export function makePrizes(pickInt = randomInt) {
  const out = [];
  let at = 0;
  // 이 모형이 인정하는 최장 길이(약 2.2)보다 넉넉히 만들어 둡니다 — 이어 붙이기로
  // 더 갈 수 있으므로 그 몫까지 미리 깔아 둡니다.
  const ceiling = 6;
  while (at < ceiling) {
    const jitter = (pickInt(-1000, 1000) / 1000) * C.PRIZE_JITTER;
    at += C.PRIZE_EVERY + jitter;
    if (at <= 0 || at > ceiling) break;
    out.push({ at: round3(at), key: C.PRODUCTS[pickInt(0, C.PRODUCTS.length - 1)].key });
  }
  return out;
}

const productOf = (key) => C.PRODUCTS.find((p) => p.key === key) ?? null;

// ══════════════════════════════════════════════════════════════
// 진행 상태
// ══════════════════════════════════════════════════════════════

/**
 * 판정·라운드 응답마다 붙이는 "지금까지" 요약.
 * ENDLESS 는 result.detail 이 비어 있어(엔진 구조상) 결과 화면이 쓸 값을 여기서 넘깁니다.
 */
const progressOf = (ext) => ({
  len: round3(ext.len ?? 0),
  best_len: round3(ext.best ?? 0),
  prize_hits: ext.prizeHits ?? 0,
  dough: ext.dough ?? null,
  score: ext.score ?? 0,
});

/** 화면이 판을 그리고 **같은 식으로 실시간 판정**하는 데 필요한 것 전부 */
const pubOf = (meta, prizes) => {
  const ext = meta.ext ?? {};
  return {
    model: {
      len_ref: C.LEN_REF,
      alpha: C.ALPHA,
      beta: C.BETA,
      gamma: C.GAMMA,
      speed_ref: C.SPEED_REF,
      fatigue: C.FATIGUE,
      capacity: C.CAPACITY,
      max_rate: C.MAX_STRETCH_RATE,
      grace_ms: C.GRACE_MS,
      sample_ms: C.SAMPLE_MS,
      flush_at: C.FLUSH_AT,
    },
    prizes: prizes.map((p) => ({ at: p.at, ...(productOf(p.key) ?? { name: "", icon: "" }) })),
    // 이어 붙인 뒤에는 길이·손상을 이어받아 시작합니다
    start_len: round3(ext.len ?? 0),
    start_dmg: round3(ext.dmg ?? 0),
    start_elapsed: Math.round(ext.elapsed ?? 0),
    // 새로고침으로 소진된 런을 이어받았을 때 이어하기를 다시 제안해야 합니다
    boosts_used: meta.boosts ?? 0,
    ...progressOf(ext),
  };
};

export const spec = {
  game: "STRETCH",
  mode: "ENDLESS",
  boostLabel: "끊긴 자리에서 이어 붙이기",

  /**
   * 런 시작 — 오늘의 재료와 내 최장 길이를 읽습니다.
   *
   * 최장 길이를 여기서 읽는 이유는 기획서 7장의 **최장 길이 갱신 보너스** 때문입니다.
   * 판정 시점에는 개인 기록을 볼 자리가 없어(엔진이 결과 저장 후 계산합니다) 런
   * 시작에 한 번 읽어 둡니다.
   */
  async initSecret(meta, { env, userId }) {
    const day = dayKey();
    const dough = doughOf(day);
    const pb = await personalBest(env, userId, "STRETCH", "all");

    meta.ext = {
      ...(meta.ext ?? {}),
      day,
      dough: { key: dough.key, name: dough.name, hex: dough.hex },
      len: 0,
      dmg: 0,
      elapsed: 0,
      best: 0,
      prizeHits: 0,
      score: 0,
      rough: 0,
      segs: 0,
      // rank_metric = -(길이 × 1000). 개인 최고를 길이로 되돌립니다.
      prevBestLen: pb.best == null ? null : Math.max(0, -pb.best) / 1000,
    };

    return { day };
  },

  /**
   * 라운드 = 한 번의 끌기.
   *
   * `limitMs` 가 null 인 것은 의도입니다 — 기획서 4장 3번이 「시간 제한이 없다」이고,
   * 제한을 두면 「천천히 끌수록 유리」가 그 자리에서 깨집니다. 대신 신고한 시각은
   * 서버가 관측한 시간창 안이어야 합니다.
   */
  makeRound(roundNo, meta) {
    const prizes = makePrizes();
    return { pub: pubOf(meta, prizes), secret: { prizes }, limitMs: null };
  },

  /**
   * answer = { samples: [{ t, len }, …], ongoing: boolean }
   *
   * `t` 는 조각이 시작된 뒤 흐른 ms, `len` 은 그 순간의 길이(무대 짧은 변 = 1)입니다.
   *
   * ── 한 번의 끌기가 여러 조각으로 옵니다 ──────────────────────────────
   * 손을 대고 있는 동안 판이 끝나지 않는 것이 이 게임의 규칙이라, 잘 끄는 사람은
   * 20초 넘게 이어집니다. 한 번에 보내면 요청이 커지고 상한에서 잘려 화면이 본
   * 길이와 기록이 어긋납니다(㉘ 톡톡에서 실제로 겪은 일입니다). 그래서 화면은
   * 표본이 FLUSH_AT 개 모일 때마다 조각을 보냅니다 — 조각은 판을 끝내지 않습니다.
   */
  judgeRound({ answer, roundSecret, meta, sinceIssuedMs }) {
    const ext = (meta.ext ??= {});
    const prizes = roundSecret?.prizes ?? [];
    const ongoing = answer?.ongoing === true;

    const raw = Array.isArray(answer?.samples) ? answer.samples.slice(0, C.MAX_SAMPLES) : [];
    const deadline = sinceIssuedMs + C.REPORT_GRACE_MS;
    // 조각 안의 시각은 조각 시작 기준이라 서버가 관측한 전체 시간을 넘을 수 없습니다
    const samples = raw.filter((s) => Number(s?.t) <= deadline);

    const sim = simulate({
      samples,
      dmg0: ext.dmg ?? 0,
      len0: ext.len ?? 0,
      elapsed0: ext.elapsed ?? 0,
    });

    if (samples.length === 0 && !ongoing && (ext.len ?? 0) <= 0.01) {
      // 살짝 스치기만 하고 뗀 것으로 판을 끝내지 않습니다 — 도전 기회가 날아갑니다
      return { ok: false, fatal: false, data: { invalid: "덩어리에 손을 대고 끌어 주세요" } };
    }

    const before = ext.prizeHits ?? 0;
    ext.dmg = sim.dmg;
    ext.len = sim.len;
    ext.elapsed = sim.elapsed;
    ext.best = Math.max(ext.best ?? 0, sim.len);
    ext.prizeHits = prizes.filter((p) => p.at <= sim.len).length;
    ext.segs = (ext.segs ?? 0) + 1;

    // 등속 = 매크로 (기획서 7장). 표본이 적으면 우연히 균일할 수 있어 하한을 둡니다.
    if (sim.steps.length >= C.UNIFORM_MIN_STEPS && (variation(sim.steps) ?? 1) < C.UNIFORM_CV) {
      ext.rough = (ext.rough ?? 0) + 1;
    }
    if (sim.bad) ext.rough = (ext.rough ?? 0) + 1;

    // 조각 하나가 어긋난 것으로 판을 빼지 않습니다 — 긴 끌기는 조각이 열 개를 넘으므로
    // 하나만 걸려도 이상치로 보면 오래 끈 사람이 걸립니다 (㉘ 과 같은 판단).
    const suspect = (ext.rough ?? 0) >= 1 && (ext.rough ?? 0) / ext.segs > 0.5;

    const newPrizes = prizes
      .filter((p) => p.at <= sim.len)
      .slice(before)
      .map((p) => ({ at: p.at, ...(productOf(p.key) ?? { name: "", icon: "" }) }));

    const data = { ongoing, broke: sim.broke, prizes: newPrizes, ...progressOf(ext) };

    // 아직 끊어지지도, 손을 떼지도 않았습니다 — 누적만 합니다.
    if (ongoing && !sim.broke) return { ok: true, fatal: false, suspect, data };

    // 판이 끝납니다. 길이만큼 전액 확정입니다 (기획서 6장 「실패 개념 없음」).
    ext.score =
      Math.round(C.LEN_POINT * sim.len) +
      C.PRIZE_POINT * (ext.prizeHits ?? 0) +
      (ext.prevBestLen != null && sim.len > ext.prevBestLen ? C.BEST_BONUS : 0);

    // 소진된 판에는 엔진이 다음 라운드를 내지 않습니다. 그대로 두면 이어받기가
    // 직전 라운드를 그리므로 여기서 갱신합니다 (⑳㉘ 과 같은 처리).
    meta.pub = pubOf(meta, prizes);

    return {
      ok: true,
      fatal: true, // 끊어졌다 / 손을 뗐다 = 소진. **실패가 아닙니다**
      suspect,
      data: { ...data, score: ext.score },
    };
  },

  /**
   * 「끊긴 자리에서 이어 붙이기」 — 길이와 기록을 그대로 두고 손상만 0 으로 되돌립니다.
   *
   * 첫 3초 보장(GRACE_MS)은 **되살리지 않습니다.** 되살리면 이어 붙일 때마다 3초씩
   * 마음껏 당길 수 있어 광고를 본 사람이 실력이 아니라 보장으로 이기게 됩니다.
   * (그래도 길이가 길수록 손상이 빨리 쌓이므로 이어 붙인 판의 증가분은 유한합니다)
   */
  applyBoost(meta) {
    const ext = (meta.ext ??= {});
    meta.lives = 1;
    ext.dmg = 0;
    return { data: progressOf(ext) };
  },

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    return {
      len: round3(ext.len ?? 0),
      prize_hits: ext.prizeHits ?? 0,
      dough: ext.dough?.key ?? null,
      score: ext.score ?? 0,
    };
  },

  bucketOf: () => "all",

  /**
   * 순위 지표는 **늘린 길이**뿐입니다 (길수록 상위).
   *
   * 걸린 시간으로 동점자를 가르지 않습니다 — 그러면 빨리 끄는 쪽이 유리해져
   * 「천천히 끌수록 유리」(기획서 4장 3번)가 뒤집히고, 15장의 우선 검증 가설
   * (천천히 끄는 이용자가 기록이 높다)을 잴 수 없게 됩니다.
   */
  rankMetricOf: (meta) => -Math.round((meta.ext?.len ?? 0) * 1000),

  scoreOf: (meta) => meta.ext?.score ?? 0,
};
