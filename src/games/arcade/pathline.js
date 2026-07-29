/**
 * ⑰ 한 줄로 이어요 — ENDLESS
 *
 * 기획: ../../../../reward-minigame-research/plans/2026-07-28/PLAN-11_한줄로이어요.md
 *
 * 번호를 순서대로 지나가는 한 줄을 긋습니다. 지나간 칸은 다시 밟을 수 없습니다.
 * 자사 배포분에 경로·공간 퍼즐이 없었습니다 — **지나온 자리가 다음 수를 제약하는**
 * 구조는 이 게임이 처음입니다.
 *
 * ── 해가 반드시 존재해야 한다 ────────────────────────────────────────────
 * 번호를 먼저 뿌리고 경로를 찾게 하면 풀 수 없는 판이 나옵니다. 반대로 만듭니다 —
 * **자기회피 랜덤 워크로 정답 경로를 먼저 만들고 그 위에 번호를 균등 간격으로 얹습니다.**
 *
 * ── '최단' 의 정의 ───────────────────────────────────────────────────────
 * 생성된 정답 경로는 랜덤 워크라 대개 최단이 아니라 한참 돌아가는 경로입니다.
 * 그것을 최단이라 부르면 실제로 최단으로 푼 사람이 보너스를 못 받습니다(프로토타입에서
 * 실측: 8칸으로 풀었는데 "최단 16칸" 표시). 최단은 **인접 번호 사이 맨해튼 거리의 합**
 * 으로 정의합니다 — 경로가 그보다 짧을 수 없는 하한입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";

const C = ARCADE.PATHLINE;

const STORY = ["원두", "로스팅", "분쇄", "추출", "얼음", "완성"];

const cfgOf = (stage) => C.ROUNDS[Math.min(stage, C.ROUNDS.length - 1)];

function neighbors(i, w, h) {
  const r = Math.floor(i / w), c = i % w, out = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
}

const manhattan = (a, b, w) =>
  Math.abs(Math.floor(a / w) - Math.floor(b / w)) + Math.abs((a % w) - (b % w));

/** 자기회피 랜덤 워크 — 최소 길이를 채울 때까지 다시 시도합니다. */
function walk(w, h, minLen) {
  let best = null;
  for (let t = 0; t < C.GEN_TRIES; t++) {
    const seen = new Set();
    const path = [randomInt(0, w * h - 1)];
    seen.add(path[0]);
    for (;;) {
      const open = shuffled(neighbors(path[path.length - 1], w, h), randomInt)
        .filter((n) => !seen.has(n));
      if (!open.length) break;
      path.push(open[0]);
      seen.add(open[0]);
    }
    if (!best || path.length > best.length) best = path;
    if (path.length >= minLen) return path;
  }
  return best;
}

function makePuzzle(stage) {
  const cfg = cfgOf(stage);
  const solution = walk(cfg.w, cfg.h, cfg.nums * C.MIN_LEN_FACTOR);

  // 번호를 경로 위에 균등 간격으로 얹습니다.
  const marks = {};
  const order = [];
  for (let i = 0; i < cfg.nums; i++) {
    const at = Math.round((i * (solution.length - 1)) / (cfg.nums - 1));
    marks[solution[at]] = i + 1;
    order.push(solution[at]);
  }

  // 이론상 최소 길이 = 인접 번호 사이 맨해튼 거리의 합 + 1
  let minLen = 1;
  for (let i = 1; i < order.length; i++) minLen += manhattan(order[i - 1], order[i], cfg.w);

  return { stage, w: cfg.w, h: cfg.h, nums: cfg.nums, marks, order, solution, minLen };
}

const pubOf = (p, meta) => ({
  round: (p.stage ?? 0) + 1,
  w: p.w,
  h: p.h,
  nums: p.nums,
  marks: p.marks, // 어느 칸에 몇 번이 있는지는 보여 줘야 풀 수 있습니다
  labels: STORY.slice(0, p.nums),
  min_len: p.minLen,
  hint: p.solution.slice(0, meta.hint ?? 0), // 광고로 열어 준 앞부분만
  points: meta.points ?? 0,
});

export const spec = {
  game: "PATHLINE",
  mode: "ENDLESS",
  boostLabel: `정답 경로 ${C.HINT_CELLS}칸 공개`,

  makeRound(roundNo, meta, secret) {
    meta.points = meta.points ?? 0;

    // 광고로 힌트를 받았거나 무효한 경로를 냈으면 **같은 판**을 다시 냅니다.
    if (meta.keep && secret?.round?.puzzle) {
      meta.keep = false;
      const p = secret.round.puzzle;
      return { pub: pubOf(p, meta), secret: { puzzle: p }, limitMs: cfgOf(p.stage).sec * 1000 };
    }

    meta.stage = meta.stage ?? 0;
    meta.hint = 0;
    const puzzle = makePuzzle(meta.stage);
    return {
      pub: pubOf(puzzle, meta),
      secret: { puzzle },
      limitMs: cfgOf(meta.stage).sec * 1000,
    };
  },

  /**
   * answer 는 지나간 칸을 순서대로 담은 배열입니다.
   * 판정은 전부 서버가 합니다 — 클라이언트가 "완성했다" 고 주장하는 것을 믿지 않습니다.
   */
  judgeRound({ answer, roundSecret, timedOut, meta }) {
    const p = roundSecret?.puzzle;
    if (!p) return { ok: false, fatal: false, data: { error: "라운드가 없습니다" } };

    if (timedOut) {
      return { ok: false, fatal: true, data: { timed_out: true, solution: p.solution, min_len: p.minLen } };
    }

    const cells = Array.isArray(answer) ? answer.map(Number) : [];

    // 무효한 경로는 판을 빼앗지 않습니다. meta.keep 을 세워 두면 makeRound 가
    // 같은 판을 다시 냅니다 — 이걸 빠뜨리면 잘못 제출한 순간 문제가 통째로 바뀝니다.
    const fail = (why) => {
      meta.keep = true;
      return { ok: false, fatal: false, data: { invalid: why } };
    };

    if (!cells.length) return fail("경로가 비어 있습니다");
    if (new Set(cells).size !== cells.length) return fail("같은 칸을 두 번 지났습니다");
    if (cells.some((i) => !Number.isInteger(i) || i < 0 || i >= p.w * p.h)) return fail("격자 밖 칸입니다");
    if (p.marks[cells[0]] !== 1) return fail("1번에서 시작해야 합니다");

    for (let i = 1; i < cells.length; i++) {
      if (!neighbors(cells[i - 1], p.w, p.h).includes(cells[i])) return fail("붙어 있지 않은 칸입니다");
    }

    // 번호는 순서대로만 밟을 수 있습니다.
    let expect = 1;
    for (const cell of cells) {
      const n = p.marks[cell];
      if (n == null) continue;
      if (n !== expect) return fail(`${expect}번을 먼저 지나야 합니다`);
      expect += 1;
    }
    if (expect <= p.nums) return fail(`${expect}번까지 가지 못했습니다`);

    const cfg = cfgOf(p.stage);
    const shortest = cells.length <= p.minLen;
    const gained = cfg.reward + (shortest ? C.SHORTEST_BONUS : 0);
    meta.points = (meta.points ?? 0) + gained;
    meta.stage = (meta.stage ?? 0) + 1;
    meta.hint = 0;

    return {
      ok: true,
      data: { len: cells.length, min_len: p.minLen, shortest, gained, points: meta.points },
    };
  },

  /** 광고 보상 — 정답 경로 앞부분을 누적으로 열어 주고 같은 판을 다시 냅니다. */
  applyBoost(meta) {
    meta.lives += 1;
    meta.hint = (meta.hint ?? 0) + C.HINT_CELLS;
    meta.keep = true; // 다음 makeRound 가 같은 판을 다시 내도록
    return { data: { lives: meta.lives, hint: meta.hint } };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => -(meta.points ?? 0),
  scoreOf: (meta) => meta.points ?? 0,
  detailOf: (meta) => ({ stage: meta.stage ?? 0, points: meta.points ?? 0 }),
};
