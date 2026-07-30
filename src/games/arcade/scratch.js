/**
 * ⑳ 슥슥 긁기 — ENDLESS
 *
 * 매일 아침 오는 은박 카드 9칸 중 5칸을 문질러 긁고, 같은 그림 3개를 모으면 획득분이
 * 2배가 됩니다. 기획: docs/scratch-game.md (기획서 IDEA-2026-0014)
 *
 * ── 앞의 19종과 다른 점 ──────────────────────────────────────────────────
 * 19종은 전부 실력·판단·기억이 결과를 바꿉니다. 이 게임은 **결과가 순수 난수**이고
 * 사용자가 정하는 것은 "9칸 중 어디를 긁는가" 뿐입니다. 그래도 게임인 이유는 셋입니다.
 *   ① 조작이 1터치가 아니라 문지름(손맛)  ② 5/9칸의 선택권
 *   ③ 은박이 살짝 벗겨진 칸으로 **색**이 비쳐 관찰이 개입
 *
 * 힌트가 심볼이 아니라 색인 것이 이 게임의 설계 중심입니다. 색 하나에 심볼이 두 종씩
 * 걸려 있어서, 노란빛 두 칸을 보고 "커피 두 개일까 커피와 도넛일까" 를 재는 것이
 * 유일한 판단 지점입니다. 색까지 정답이면 힌트 칸만 긁으면 끝나는 게임이 됩니다.
 *
 * ── 실패가 없는 게임 ─────────────────────────────────────────────────────
 * 모든 칸에 기본 포인트가 있어 **꽝이 없습니다**(기획서 4장). 그래서 판정이 틀리는
 * 경우가 없고, 판이 끝나는 유일한 길은 긁기를 다 쓰는 것입니다.
 * 그 소진을 `lives` 로 표현합니다 — 목숨이 떨어지면 세션을 유지한 채 이어하기를
 * 기다리는 엔진의 흐름이, 기획서 8장의 「아깝게 멈춘 순간의 구원 광고」와 같은
 * 모양이기 때문입니다. 실패로 표시되는 곳은 화면 어디에도 없습니다(§4).
 *
 * ── 판이 끝나도 남는 것 ──────────────────────────────────────────────────
 * 연속 긁기 일수(scratch_state). ⑲ 내 가게 채우기와 같은 훅 두 개를 씁니다.
 *   initSecret  런 시작에 연속 일수를 읽고 오늘 카드를 배정합니다
 *   onRunEnd    결과가 저장된 뒤 연속 일수를 한 번 씁니다
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";
import { dayKey, now } from "../../lib/time.js";

const C = ARCADE.SCRATCH;

const symbolOf = (key) => C.SYMBOLS.find((s) => s.key === key) ?? null;

// ══════════════════════════════════════════════════════════════
// 연속 긁기 일수
// ══════════════════════════════════════════════════════════════

/** 'YYYY-MM-DD' 에서 며칠 옮긴 날짜. 연속 판정에만 쓰므로 KST 보정은 이미 끝난 값입니다. */
export const shiftDay = (day, deltaDays) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + deltaDays * 86400000).toISOString().slice(0, 10);

/**
 * 오늘 판까지 반영한 연속 일수.
 *
 *   어제 긁었다  → +1
 *   오늘 이미 긁었다 → 그대로 (같은 날 두 번째 판은 연속을 두 번 세지 않습니다)
 *   그 밖 · 첫 방문 → 1
 */
export function streakFor(state, today) {
  if (state?.lastDay === today) return Math.max(1, state.streak ?? 1);
  if (state?.lastDay === shiftDay(today, -1)) return (state.streak ?? 0) + 1;
  return 1;
}

async function loadState(env, userId) {
  const row = await env.DB.prepare(
    `SELECT streak, last_day, cards, matches FROM scratch_state WHERE user_id = ?`,
  )
    .bind(userId)
    .first();

  if (!row) return { streak: 0, lastDay: null, cards: 0, matches: 0 };
  return {
    streak: row.streak ?? 0,
    lastDay: row.last_day ?? null,
    cards: row.cards ?? 0,
    matches: row.matches ?? 0,
  };
}

async function saveState(env, userId, st) {
  await env.DB.prepare(
    `INSERT INTO scratch_state (user_id, streak, last_day, cards, matches, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       streak     = excluded.streak,
       last_day   = excluded.last_day,
       cards      = excluded.cards,
       matches    = excluded.matches,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, st.streak, st.lastDay, st.cards, st.matches, now())
    .run();
}

// ══════════════════════════════════════════════════════════════
// 오늘 카드
// ══════════════════════════════════════════════════════════════

/**
 * 카드 한 장을 만듭니다.
 *
 * 매칭 대상 심볼 하나를 TARGET_COPIES 개 심고, 나머지 칸은 다른 심볼로 채우되
 * 어느 것도 MAX_OTHER_COPIES 개를 넘지 않게 둡니다 — **3개에 도달할 수 있는 심볼을
 * 하나로 고정**하는 것이 목적입니다. 우연히 다른 그림도 3개가 되면 "무엇을 노려야
 * 하는가" 가 흐려지고, 힌트를 읽는 재량이 뜻을 잃습니다.
 *
 * 힌트 칸은 **무작위로** 고릅니다. 타겟을 일부러 비추지 않습니다 — 타겟이 9칸 중
 * 4~5칸이라 무작위 힌트만으로도 같은 색 두 칸이 자주 걸리고, 그 두 칸을 먼저 긁는
 * 판단이 곧 이 게임의 재량입니다(기획서 15장 가설 2의 측정 대상).
 */
export function makeCard({ rookie = false, sureHint = false } = {}, pickInt = randomInt) {
  const order = shuffled(C.SYMBOLS, pickInt);
  const target = order[0];
  const others = order.slice(1);

  const bag = Array(rookie ? C.ROOKIE_TARGET_COPIES : C.TARGET_COPIES).fill(target.key);
  // 다른 심볼 5종 × 2개 = 10칸이라 남은 4~5칸은 반드시 채워집니다. guard 는 안전장치입니다.
  for (let i = 0, guard = 0; bag.length < C.CELLS && guard < 100; i++, guard++) {
    const sym = others[i % others.length];
    if (bag.filter((k) => k === sym.key).length < C.MAX_OTHER_COPIES) bag.push(sym.key);
  }

  const cells = shuffled(bag, pickInt).map((key) => ({
    key,
    points: C.POINTS[pickInt(0, C.POINTS.length - 1)], // 꽝 없음 — 모든 칸에 포인트
  }));

  const idx = shuffled(
    cells.map((_, i) => i),
    pickInt,
  );
  const peekCount = rookie ? C.ROOKIE_HINT_CELLS : C.HINT_CELLS;

  // 색만 비치는 힌트
  const hints = idx.slice(0, peekCount).map((i) => ({
    i,
    hue: symbolOf(cells[i].key).hue,
    sure: false,
  }));

  // 연속 7일째의 힌트 강화 — 심볼 하나를 완전 공개 (기획서 4장 6번)
  if (sureHint && idx.length > peekCount) {
    const i = idx[peekCount];
    hints.push({ i, hue: symbolOf(cells[i].key).hue, sure: true });
  }

  return { cells, hints, targetKey: target.key };
}

// ══════════════════════════════════════════════════════════════
// 진행 상태
// ══════════════════════════════════════════════════════════════

/** 긁은 칸의 심볼별 개수 */
function tally(opened) {
  const n = new Map();
  for (const o of opened) n.set(o.key, (n.get(o.key) ?? 0) + 1);
  return n;
}

/**
 * 매칭에 가장 가까운 심볼.
 *
 * 기획서 8장의 구원 광고 문구(「커피 두 개! 하나만 더 나오면 두 배」)와
 * 15장 가설 1(매칭 2개에서 멈춘 판의 광고 선택률)이 이 값입니다.
 */
export function nearOf(ext) {
  let best = null;
  for (const [key, have] of tally(ext.opened ?? [])) {
    if (!best || have > best.have) {
      const s = symbolOf(key);
      best = { key, have, icon: s?.icon ?? "", name: s?.name ?? "" };
    }
  }
  return best;
}

/** 지금까지의 획득 포인트 — 매칭이 성립하면 획득분 전체가 2배가 됩니다 */
export const scoreNow = (ext) =>
  (ext.base ?? 0) * (ext.matched ? C.MATCH_MULTIPLIER : 1) + (ext.dayBonus ?? 0);

/**
 * 판정·라운드 응답마다 붙이는 "지금까지" 요약.
 *
 * ENDLESS 는 finalize 에 detail 을 넘길 자리가 없어 result.detail 이 비어 있습니다
 * (detailOf 는 DB 기록용입니다). 결과 화면이 필요한 값은 마지막 응답에서 가져가야
 * 하므로 모든 응답에 같은 요약을 붙여 둡니다 — ⑲ 내 가게 채우기와 같은 처리입니다.
 */
function progressOf(ext) {
  const opened = ext.opened ?? [];
  const near = nearOf(ext);
  return {
    score: scoreNow(ext),
    base: ext.base ?? 0,
    matched: Boolean(ext.matched),
    match_icon: ext.matchIcon ?? null,
    match_name: ext.matchName ?? null,
    need: C.MATCH_NEED,
    multiplier: C.MATCH_MULTIPLIER,
    opened: opened.length,
    scratches: ext.scratches ?? C.SCRATCHES,
    scratches_left: Math.max(0, (ext.scratches ?? C.SCRATCHES) - opened.length),
    near: near ? { icon: near.icon, name: near.name, have: near.have } : null,
    streak: ext.streak ?? 1,
    day_bonus: ext.dayBonus ?? 0,
    card_no: (ext.cards ?? 0) + 1,
    matches_total: (ext.matches ?? 0) + (ext.matched ? 1 : 0),
  };
}

/**
 * 화면에 내려보내는 9칸.
 *
 * 긁지 않은 칸은 **심볼을 넣지 않습니다.** 힌트 칸은 색(hue)만 붙고, 연속 7일째의
 * 완전 공개 칸만 예외로 심볼이 함께 갑니다. 카드 전체는 세션 secret 에만 있습니다.
 */
function viewCells(ext, cells) {
  const hintAt = new Map((ext.hints ?? []).map((h) => [h.i, h]));
  const openAt = new Map((ext.opened ?? []).map((o) => [o.i, o]));

  return cells.map((c, i) => {
    if (openAt.has(i)) {
      const s = symbolOf(c.key);
      return { i, open: true, icon: s.icon, name: s.name, hue: s.hue, points: c.points };
    }

    const out = { i, open: false };
    const hint = hintAt.get(i);
    if (hint) {
      out.peek = hint.hue;
      if (hint.sure) {
        const s = symbolOf(c.key);
        out.sure = true;
        out.icon = s.icon;
        out.name = s.name;
      }
    }
    return out;
  });
}

// ══════════════════════════════════════════════════════════════
// spec
// ══════════════════════════════════════════════════════════════

/**
 * 화면이 카드를 그리는 데 필요한 것 전부.
 *
 * `makeRound` 뿐 아니라 **마지막 긁기의 판정에서도** 만듭니다. 엔진은 긁기가 소진되면
 * 다음 라운드를 내지 않으므로(이어하기를 기다리는 상태) `meta.pub` 이 직전 라운드에
 * 머무는데, 그 상태로 새로고침하면 이미 긁은 칸이 은박으로 덮인 카드가 나옵니다.
 */
const pubOf = (meta, cells) => ({
  cells: viewCells(meta.ext ?? {}, cells),
  hues: C.HUES, // 힌트 색의 이름·색값 (화면 문구용)
  rookie: Boolean(meta.ext?.rookie),
  // 새로고침으로 **소진된 런을 이어받았을 때** 구원 광고를 다시 제안해야 하는데,
  // 그 카드에는 "이 판에서 몇 번 썼는지" 가 필요합니다. 엔진의 이어받기 응답은
  // 보상 사용량을 0 으로 되돌려 주므로(run.js 의 begin) 라운드에 실어 보냅니다.
  boosts_used: meta.boosts ?? 0,
  ...progressOf(meta.ext ?? {}),
});

export const spec = {
  game: "SCRATCH",
  mode: "ENDLESS",

  /** 런 시작 — 연속 일수를 읽고 오늘 카드를 배정합니다 */
  async initSecret(meta, { env, userId }) {
    const st = await loadState(env, userId);
    const day = dayKey();
    const streak = streakFor(st, day);
    const rookie = (st.cards ?? 0) < C.ROOKIE_CARDS;
    const card = makeCard({ rookie, sureHint: streak >= C.STREAK_HINT_DAY });

    meta.ext = {
      ...(meta.ext ?? {}),
      day,
      streak,
      rookie,
      cards: st.cards ?? 0,
      matches: st.matches ?? 0,
      // 연속 7일마다 붙는 보너스. 판이 시작될 때 이미 확정된 값이라 화면에 바로 띄웁니다.
      dayBonus: streak % C.STREAK_BONUS_DAY === 0 ? C.STREAK_BONUS : 0,
      hints: card.hints,
      scratches: C.SCRATCHES,
      opened: [],
      base: 0,
      matched: false,
      matchIcon: null,
      matchName: null,
      rough: 0, // 긁기 궤적이 사람 범위를 벗어난 칸 수
    };

    // 카드 내용은 이 판의 정답입니다 — 세션에 암호화되는 secret 에만 둡니다.
    return { cells: card.cells };
  },

  /**
   * 라운드 = 긁을 차례 한 번.
   *
   * 카드 그림은 라운드마다 다시 그려야 하므로(긁은 칸이 늘어납니다) 매번 pub 을 냅니다.
   * limitMs 가 null 인 것은 의도입니다 — 반응속도·순발력 완전 비의존이 이 기획의
   * 전제이고(기획서 3장), 제한 시간을 두면 시간 초과로 긁지 못한 칸이 생겨
   * 「꽝 없음」이 깨집니다.
   */
  makeRound(roundNo, meta, secret) {
    const ext = meta.ext ?? {};
    const cells = secret?.ext?.cells ?? [];
    if (cells.length === 0) return null;

    return {
      pub: pubOf(meta, cells),
      secret: null, // 라운드 단위 정답이 없습니다 — 카드 전체가 런 비밀값입니다
      limitMs: null,
    };
  },

  /**
   * answer = { cell: 0~8, strokes: 문지른 포인터 표본 수 }
   *
   * 꽝이 없으므로 **정상적인 긁기는 늘 성공**입니다. ok:false 는 없는 칸·이미 긁은
   * 칸처럼 애초에 처리할 수 없는 입력뿐이고, 그 경우 긁기를 소모하지 않습니다.
   *
   * fatal 은 실패가 아니라 **소진**의 표시입니다 — 마지막 긁기가 끝나면 목숨이 0이 되고,
   * 엔진이 세션을 유지한 채 이어하기(구원 광고)를 기다립니다.
   */
  judgeRound({ answer, elapsedMs, timedOut, runSecret, meta }) {
    const ext = meta.ext ?? (meta.ext = {});
    const cells = runSecret?.cells ?? [];
    const opened = (ext.opened ??= []);
    const left = () => Math.max(0, (ext.scratches ?? C.SCRATCHES) - opened.length);

    // 시간 제한이 없는 게임이라 여기 올 일이 없지만, 왔다면 아무것도 소모하지 않습니다.
    if (timedOut) return { ok: false, fatal: false, data: { invalid: "다시 문질러 주세요" } };

    const cell = Number(answer?.cell ?? answer);
    const strokes = Number(answer?.strokes);

    if (!Number.isInteger(cell) || cell < 0 || cell >= cells.length) {
      return { ok: false, fatal: false, data: { invalid: "그 칸은 없어요" } };
    }
    if (opened.some((o) => o.i === cell)) {
      return { ok: false, fatal: false, data: { invalid: "이미 긁은 칸이에요" } };
    }
    if (left() <= 0) {
      // 엔진이 목숨으로 막고 있어 도달하지 않는 경로입니다. 방어적으로 판을 닫습니다.
      return { ok: false, fatal: true, data: { invalid: "오늘의 긁기를 다 썼어요" } };
    }

    const c = cells[cell];
    const s = symbolOf(c.key);

    // 긁기 궤적 검사 (기획서 7장) — 문지른 시간과 포인터 표본이 사람 범위인가.
    // 한 칸이 어긋난 것으로 판을 빼지 않고, 아래에서 비율로 판정합니다.
    const tooFast = Number.isFinite(elapsedMs) && elapsedMs < C.MIN_SCRATCH_MS;
    const tooThin = !(Number.isFinite(strokes) && strokes >= C.MIN_STROKES);
    if (tooFast || tooThin) ext.rough = (ext.rough ?? 0) + 1;

    opened.push({ i: cell, key: c.key, points: c.points });
    ext.base = (ext.base ?? 0) + c.points;

    // 같은 그림 3개 — 카드 생성 규칙상 3개에 도달할 수 있는 심볼은 하나뿐입니다.
    const justMatched = !ext.matched && (tally(opened).get(c.key) ?? 0) >= C.MATCH_NEED;
    if (justMatched) {
      ext.matched = true;
      ext.matchIcon = s.icon;
      ext.matchName = s.name;
    }

    const suspect =
      (ext.rough ?? 0) >= C.ROUGH_MIN && ((ext.rough ?? 0) / opened.length) * 100 >= C.ROUGH_PCT;

    // 소진된 판은 엔진이 다음 라운드를 내지 않습니다. 그대로 두면 이어받기가 직전
    // 라운드의 카드(방금 긁은 칸이 아직 은박인 카드)를 그리므로 여기서 갱신합니다.
    if (left() <= 0) meta.pub = pubOf(meta, cells);

    return {
      ok: true,
      fatal: left() <= 0, // 마지막 긁기 → 소진 (실패가 아닙니다)
      suspect,
      data: {
        cell,
        icon: s.icon,
        name: s.name,
        hue: s.hue,
        points: c.points,
        match: justMatched,
        ...progressOf(ext),
      },
    };
  },

  /** 「광고 보고 한 칸 더 긁기」 — 아깝게 멈춘 순간의 구원 광고 (기획서 8장) */
  applyBoost(meta) {
    const ext = meta.ext ?? (meta.ext = {});
    ext.scratches = (ext.scratches ?? C.SCRATCHES) + 1;
    meta.lives = 1; // 긁을 것이 생겼으니 판을 다시 엽니다
    return { data: progressOf(ext) };
  },
  boostLabel: "한 칸 더 긁기",

  /** 결과가 저장된 뒤 연속 일수를 한 번 씁니다 */
  async onRunEnd(env, meta, ctx) {
    const ext = meta.ext ?? {};
    if (!ext.day) return;

    await saveState(env, ctx.userId, {
      streak: ext.streak ?? 1,
      lastDay: ext.day,
      cards: (ext.cards ?? 0) + 1,
      matches: (ext.matches ?? 0) + (ext.matched ? 1 : 0),
    });
  },

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    const near = nearOf(ext);
    return {
      score: scoreNow(ext),
      base: ext.base ?? 0,
      matched: Boolean(ext.matched),
      match_name: ext.matchName ?? null,
      opened: (ext.opened ?? []).length,
      streak: ext.streak ?? 1,
      day_bonus: ext.dayBonus ?? 0,
      rookie: Boolean(ext.rookie),
      // 기획서 15장 가설 1(구원 광고 원칙의 반증 대상)을 재려면 그 판이 「아깝게 멈춘
      // 판」이었는지가 기록에 남아야 합니다. 광고 선택 여부는 boosts 로 이미 남습니다.
      near_miss: !ext.matched && (near?.have ?? 0) >= C.MATCH_NEED - 1,
      cards: (ext.cards ?? 0) + 1,
      matches_total: (ext.matches ?? 0) + (ext.matched ? 1 : 0),
    };
  },

  bucketOf: () => "all",

  /**
   * 순위 지표는 한 판의 포인트가 아니라 **연속 긁기 일수**입니다.
   *
   * 결과가 순수 난수인 게임에서 획득 포인트로 순위를 세우면 운 순위표가 됩니다.
   * 이 게임에서 사용자가 실제로 쌓는 것은 리추얼이고, 기획서 9장·14장이 재방문
   * 장치와 핵심 KPI로 든 것도 연속 일수입니다.
   */
  rankMetricOf: (meta) => -(meta.ext?.streak ?? 1),

  scoreOf: (meta) => scoreNow(meta.ext ?? {}),
};
