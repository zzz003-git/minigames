/**
 * ⑳ 어디에 놓을까 — ENDLESS
 *
 * 기획: ../../../../reward-minigame-research/plans/2026-07-28/PLAN-08_어디에놓을까.md
 *
 * 타일 12개를 5×5 판에 놓아 줄을 만듭니다. 조작은 **어디에 놓을 것인가** 하나뿐입니다.
 * 두 목표가 일부러 부딪힙니다 — 같은 브랜드를 붙이면 인접 보너스, 줄을 채우려면
 * 브랜드를 포기하고 자리를 메워야 합니다. 이 상충이 없으면 배치는 판단이 아니라 절차입니다.
 *
 * ── 초안(시즌 14일)에서 바뀐 이유 ───────────────────────────────────────
 * 기획 초안은 하루 1칸 × 시즌 14일이었습니다. 이 서비스의 세션은 문제를 푸는 동안만
 * 유지되고 10분마다 크론이 정리하므로, 14일짜리 개인 판을 두려면 계정 단위 영속
 * 테이블과 D1 마이그레이션이 새로 필요합니다. 한 판 안에서 끝내고 성장은 하루 누적이
 * 맡도록 바꾼 덕분에 **마이그레이션 없이** 올라갑니다.
 *
 * ── 판 상태를 meta 에 두는 이유 (엔진 제약) ─────────────────────────────
 * 공통 엔진은 목숨이 떨어졌지만 이어하기가 남은 경로에서 `persistRound(..., false)` 로
 * **meta 만 저장하고 secret 은 버립니다.** 라운드 secret 은 "새 라운드를 만들 때만
 * 바뀐다" 는 전제이기 때문입니다. 그래서 판 상태를 secret 에 두면 **마지막 배치가
 * 저장되지 않습니다**(실제로 타일 12장을 다 놓았는데 11장으로 되돌아갔습니다).
 * meta 는 모든 경로에서 저장되므로 여기에 둡니다 — 판·타일 큐는 응답에 실리지 않습니다.
 *
 * ── 라운드 = 타일 한 장 ──────────────────────────────────────────────────
 * 12장을 다 놓으면 끝납니다. 다만 줄 완성까지 한 칸 남았고 광고 보상이 남아 있으면
 * 바로 끝내지 않고 이어하기를 제안합니다(엔진의 exhausted 경로를 씁니다).
 * 아깝지 않은 판에는 제안하지 않습니다 — 구원이 필요 없는 순간의 광고는 피로만 만듭니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";

const C = ARCADE.TILELINE;
const N = C.N;
const CELLS = N * N;

/** 가로 5 · 세로 5 · 대각 2 = 12줄 */
function allLines() {
  const out = [];
  for (let r = 0; r < N; r++) out.push({ id: `${r + 1}행`, cells: Array.from({ length: N }, (_, j) => r * N + j) });
  for (let c = 0; c < N; c++) out.push({ id: `${c + 1}열`, cells: Array.from({ length: N }, (_, j) => j * N + c) });
  out.push({ id: "대각↘", cells: Array.from({ length: N }, (_, j) => j * N + j) });
  out.push({ id: "대각↙", cells: Array.from({ length: N }, (_, j) => j * N + (N - 1 - j)) });
  return out;
}
const LINES = allLines();

function adjacentSame(board, idx, brand) {
  const r = Math.floor(idx / N), c = idx % N;
  let n = 0;
  for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
    if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
    if (board[rr * N + cc] === brand) n += 1;
  }
  return n;
}

/** 한 칸만 채우면 완성되는 줄 → { 칸번호: 줄이름 } */
function nearlyDone(board, done) {
  const out = {};
  for (const ln of LINES) {
    if (done.includes(ln.id)) continue;
    const empty = ln.cells.filter((i) => board[i] == null);
    if (empty.length === 1) out[empty[0]] = ln.id;
  }
  return out;
}

function makeBoard() {
  const board = new Array(CELLS).fill(null);
  // 첫 배치 성공 보장 — 같은 브랜드 두 칸을 미리 깔아 둡니다.
  for (const cell of C.SEED_CELLS) board[cell] = C.BRANDS[0];

  const queue = [];
  for (let i = 0; i < C.TILES; i++) queue.push(C.BRANDS[randomInt(0, C.BRANDS.length - 1)]);
  queue[0] = C.BRANDS[0]; // 첫 타일은 인접 보너스가 확실히 가능하게

  return { board, queue, at: 0, done: [], extra: 0, unlockOnly: false };
}

const pubOf = (g, meta) => {
  const near = nearlyDone(g.board, g.done);
  return {
    round: g.at + 1,
    n: N,
    board: g.board,
    tile: g.queue[g.at] ?? null,
    next_tile: g.queue[g.at + 1] ?? null,
    tiles_left: C.TILES + g.extra - g.at,
    lines_done: g.done,
    near_cells: Object.keys(near).map(Number), // 한 칸 남은 자리 — 화면에 점선으로
    unlock_only: g.unlockOnly, // 광고로 열린 상태에서는 그 칸에만 놓을 수 있습니다
    points: meta.points ?? 0,
  };
};

export const spec = {
  game: "TILELINE",
  mode: "ENDLESS",
  boostLabel: "타일 1개 추가",

  makeRound(roundNo, meta) {
    meta.points = meta.points ?? 0;
    if (!meta.g) meta.g = makeBoard();
    return { pub: pubOf(meta.g, meta), secret: null, limitMs: C.LIMIT_MS };
  },

  /** answer 는 타일을 놓을 칸 번호입니다. */
  judgeRound({ answer, timedOut, meta }) {
    const g = meta.g;
    if (!g) return { ok: false, fatal: false, data: { error: "라운드가 없습니다" } };

    const near = nearlyDone(g.board, g.done);
    const nearCells = Object.keys(near).map(Number);

    // 시간이 끝나면 이 판을 마칩니다. 이미 쌓은 점수는 그대로입니다.
    if (timedOut) return finish(g, meta, near, { timed_out: true });

    const cell = Number(answer);
    const placeable =
      Number.isInteger(cell) && cell >= 0 && cell < CELLS && g.board[cell] == null &&
      (!g.unlockOnly || nearCells.includes(cell));

    if (!placeable) {
      // 잘못된 자리는 판을 빼앗지 않습니다.
      return { ok: false, fatal: false, data: { invalid: g.unlockOnly ? "줄이 완성되는 칸에만 놓을 수 있습니다" : "빈 칸이 아닙니다" } };
    }

    const brand = g.queue[g.at];
    const adj = adjacentSame(g.board, cell, brand);
    g.board[cell] = brand;
    g.at += 1;
    g.unlockOnly = false;

    let gained = C.PLACE_POINT + adj * C.ADJACENT_POINT;
    const opened = [];
    for (const ln of LINES) {
      if (g.done.includes(ln.id)) continue;
      if (ln.cells.every((i) => g.board[i] != null)) {
        g.done.push(ln.id);
        gained += C.LINE_POINT;
        opened.push(ln.id);
      }
    }
    meta.points = (meta.points ?? 0) + gained;

    // 타일이 남아 있으면 계속 놓습니다.
    if (g.at < C.TILES + g.extra) {
      return { ok: true, data: { cell, brand, adjacent: adj, opened, gained, points: meta.points } };
    }

    return finish(g, meta, nearlyDone(g.board, g.done), { cell, brand, adjacent: adj, opened, gained });

    function finish(gg, m, nearNow, data) {
      const nearLeft = Object.keys(nearNow).map(Number);
      const boostsLeft = (C.boostsPerRun ?? 0) - (m.boosts ?? 0);

      // 아까운 판(줄 완성까지 한 칸)에만 이어하기를 제안합니다.
      // fatal:true 를 주면 엔진이 목숨을 깎고 exhausted 경로로 보내 광고 카드를 띄웁니다.
      if (nearLeft.length > 0 && boostsLeft > 0) {
        return {
          ok: true,
          fatal: true,
          data: { ...data, finished: true, near_cells: nearLeft, near_line: nearNow[nearLeft[0]], points: m.points },
        };
      }

      return {
        ok: true,
        done: true, // 아깝지 않으면 그대로 완주 처리합니다
        data: { ...data, finished: true, near_cells: nearLeft, points: m.points },
      };
    }
  },

  /** 광고 보상 — 타일 한 장을 더 주고, 줄이 완성되는 칸에만 놓게 합니다. */
  applyBoost(meta) {
    meta.lives += 1;
    const g = meta.g;
    if (g) {
      g.extra += 1;
      g.queue.push(C.BRANDS[randomInt(0, C.BRANDS.length - 1)]);
      g.unlockOnly = true;
    }
    return {
      data: { lives: meta.lives, tiles_left: g ? C.TILES + g.extra - g.at : 0, unlock_only: true },
    };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => -(meta.points ?? 0),
  scoreOf: (meta) => meta.points ?? 0,
  detailOf: (meta) => ({ points: meta.points ?? 0, lines: meta.g?.done?.length ?? 0 }),
};
