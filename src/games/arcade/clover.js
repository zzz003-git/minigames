/**
 * ㉛ 행운의 클로버 — ENDLESS
 *
 * 붙어 있는 클로버를 손가락으로 쓸어 담아 합을 10으로 맞춥니다. 맞는 순간 담은 것들이
 * 한 덩이로 합쳐져 네잎 클로버 한 장이 됩니다. 90초 동안 몇 장을 찾는지가 기록입니다.
 * 기획: ../reward-minigame-research/plans/2026-09-04/PLAN-38_열까지.md · docs/clover-game.md
 *
 * ── 이 spec 이 하는 일은 다른 게임과 다릅니다 ─────────────────────────────
 * 다른 아케이드 게임은 **한 수마다** 서버가 판정합니다. 이 게임은 한 판이 90초 동안
 * 끊기지 않고 이어지는 드래그 조작이라, 한 수마다 왕복하면 **판 복귀 278ms 예산 위에
 * 네트워크 왕복이 그대로 얹힙니다**(기획 28절이 640ms → 278ms 로 줄여 놓은 값입니다).
 *
 * 그래서 REQ-10 결정 ㉒ 로 갑니다 — **서버는 첫 판을 시드하고, 판정은 화면이 하고,
 * 끝에 「10을 몇 번 맞췄는가」만 신고받습니다.**
 *
 * ⚠ **이 구조가 지금 안전한 이유는 「보상이 없어서」입니다.** 점수를 위조해서 얻을 수
 *    있는 것이 순위 표시뿐입니다. 보상을 붙이는 날(SYS-05) **서버가 한 수마다 판정하거나
 *    (㉑) 뒤에서 재현 검증하는(㉓) 구조로 올리는 것**이 그 착수 조건입니다.
 *    그때까지는 아래 rateGuard 가 「사람 손으로 불가능한 값」만 걸러 냅니다.
 *
 * ── 값 분포가 이 게임의 핵입니다 ──────────────────────────────────────────
 * 1~9 를 **균등이 아니라 작은 수에 가중**해서 뽑습니다. 1~4 는 서로 더해도 10 이 안
 * 되므로, 작은 수가 많으면 **2칸으로 끝나는 판이 줄고 3~4칸 조합이 기본**이 됩니다.
 * 균등으로 되돌리면 2칸 짝이 지배적이 되어 「이어서 쓸어 담는」 재미가 사라집니다.
 * 막힘 방지도 **3칸짜리로 심습니다** — 2칸을 심으면 그 의도를 정면으로 되돌립니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";

const C = ARCADE.CLOVER;

/** 가중 추첨용 주머니 — 무게만큼 값을 넣어 두고 하나를 집습니다 */
const BAG = Object.entries(C.WEIGHTS).flatMap(([v, w]) => Array.from({ length: w }, () => Number(v)));

const pick = (rand) => BAG[rand(0, BAG.length - 1)];

const at = (c, r) => r * C.COLS + c;

/** 상하좌우만. 대각선은 잇지 않습니다 */
function neighbors(i) {
  const c = i % C.COLS;
  const r = Math.floor(i / C.COLS);
  const out = [];
  if (c > 0) out.push(i - 1);
  if (c < C.COLS - 1) out.push(i + 1);
  if (r > 0) out.push(i - C.COLS);
  if (r < C.ROWS - 1) out.push(i + C.COLS);
  return out;
}

/**
 * 합이 10 이 되는 길을 셉니다 — **2칸 짝만 세지 않습니다.**
 *
 * 작은 수 가중 판에서 2칸 짝만 세면 길이 넉넉히 있는데도 「막혔다」고 잘못 판정합니다.
 * 최대 WAY_MAX_LEN(5) 칸까지 이어 붙여 봅니다. limit 을 주면 그만큼 찾고 멈춥니다.
 */
export function waysOf(board, limit = 0) {
  const found = [];
  const seen = new Set();

  const walk = (path, sum) => {
    if (sum === C.TARGET) {
      const key = [...path].sort((a, b) => a - b).join(",");
      if (!seen.has(key)) {
        seen.add(key);
        found.push([...path]);
      }
      return;
    }
    if (path.length >= C.WAY_MAX_LEN || sum > C.TARGET) return;
    if (limit && found.length >= limit) return;

    for (const j of neighbors(path[path.length - 1])) {
      if (!board[j] || path.includes(j)) continue;
      if (sum + board[j] > C.TARGET) continue;
      path.push(j);
      walk(path, sum + board[j]);
      path.pop();
      if (limit && found.length >= limit) return;
    }
  };

  for (let i = 0; i < board.length; i++) {
    if (!board[i] || board[i] > C.TARGET) continue;
    walk([i], board[i]);
    if (limit && found.length >= limit) break;
  }
  return found;
}

/**
 * 첫 화면에 길이 최소 MIN_WAYS 개는 있게 심습니다.
 *
 * **3칸짜리로 심습니다.** 이어 붙은 세 칸을 골라 a + b + (10-a-b) 로 덮어씁니다.
 * a·b 를 1~4 에서 뽑으므로 심은 자리도 「작은 수 가중」의 성격을 유지합니다.
 */
function plantWays(board, rand) {
  for (let t = 0; t < C.PLANT_TRIES; t++) {
    if (waysOf(board, C.MIN_WAYS).length >= C.MIN_WAYS) return;

    const i = rand(0, board.length - 1);
    if (!board[i]) continue;
    const n1 = neighbors(i).filter((x) => board[x]);
    if (!n1.length) continue;
    const j = n1[rand(0, n1.length - 1)];
    const n2 = neighbors(j).filter((x) => board[x] && x !== i);
    if (!n2.length) continue;
    const k = n2[rand(0, n2.length - 1)];

    const a = rand(1, 4);
    const b = rand(1, 4);
    if (a + b >= C.TARGET) continue;
    board[i] = a;
    board[j] = b;
    board[k] = C.TARGET - a - b;
  }
}

/** 판 하나. 매 판 새로 뽑습니다 — 일일 고정 판을 두지 않습니다(정답 공유 차단) */
export function makeBoard(rand = randomInt) {
  const board = Array.from({ length: C.COLS * C.ROWS }, () => pick(rand));
  plantWays(board, rand);
  return board;
}

function initExt(meta) {
  meta.ext = {
    ...(meta.ext ?? {}),
    board: makeBoard(),
    score: 0, // 찾은 네잎 = 10을 맞춘 횟수
    segments: 0, // 90초 한 판 + 이어하기 15초들
    combo_best: 0,
    played_ms: 0,
    capped: 0, // 상한에 걸려 깎인 횟수 — 이상치 판정 근거로 남깁니다
  };
  return meta.ext;
}

const extOf = (meta) => (Array.isArray(meta.ext?.board) ? meta.ext : initExt(meta));

/** 이 구간이 몇 ms 짜리인가 — 첫 판은 90초, 이어하기는 15초 */
const segmentMs = (roundNo) => (roundNo <= 1 ? C.PLAY_MS : C.AD_MS);

/**
 * 사람 손으로 가능한 상한.
 *
 * **명목 구간이 아니라 서버가 관측한 경과 시간**으로 잽니다. 화면이 라운드를 받아 두고
 * 오래 붙들고 있다가 큰 값을 신고하는 길을 막기 위해서입니다. 다만 서버 관측이 없거나
 * 이상하면 명목값으로 돌아갑니다.
 */
function clearCap(roundNo, sinceIssuedMs) {
  const nominal = segmentMs(roundNo);
  const observed = Number.isFinite(sinceIssuedMs) && sinceIssuedMs > 0 ? sinceIssuedMs : nominal;
  const window = Math.min(observed, nominal + 5000); // 오래 붙들고 있어도 명목 + 5초까지만 인정
  return Math.ceil((window / 1000) * C.MAX_CLEARS_PER_SEC);
}

const viewOf = (ext) => ({
  score: ext.score ?? 0,
  segments: ext.segments ?? 0,
  combo_best: ext.combo_best ?? 0,
});

export const spec = {
  game: "CLOVER",
  mode: "ENDLESS",
  boostLabel: "15초 더 찾기",

  /**
   * 라운드 = **한 구간**입니다(첫 판 90초 · 이어하기 15초).
   *
   * 판은 첫 라운드에서 한 번만 만들고 이어하기에서는 **그대로 돌려줍니다** —
   * 「이어해도 지금까지 찾은 네잎은 그대로 남습니다」가 판에도 적용되어야
   * 이어하기가 새 판을 받는 것처럼 보이지 않습니다.
   */
  makeRound(roundNo, meta) {
    const ext = extOf(meta);
    const ms = segmentMs(roundNo);

    return {
      pub: {
        cols: C.COLS,
        rows: C.ROWS,
        board: ext.board,
        target: C.TARGET,
        play_ms: ms,
        resumed: roundNo > 1,
        ...viewOf(ext),
      },
      secret: null, // 숨길 것이 없습니다 — 판은 화면에 다 보입니다
      // 화면이 구간을 다 쓰고 신고하므로 여유를 둡니다. 이 값을 크게 넘겨 도착한 것은
      // clearCap 이 관측 시간으로 다시 한 번 잡습니다.
      limitMs: ms + 8000,
    };
  },

  /**
   * 한 구간이 끝났습니다. answer = `{ cleared, combo_best, played_ms }`
   *
   * **항상 fatal 입니다** — 시간이 다한 것은 실패가 아니라 소진이고, 소진이라야
   * 「광고 보고 15초 더 찾기」 자리가 열립니다(⑳ 슥슥 긁기와 같은 처리).
   */
  judgeRound({ answer, meta, roundNo, sinceIssuedMs }) {
    const ext = extOf(meta);
    const a = answer && typeof answer === "object" ? answer : {};

    const raw = Number(a.cleared);
    const reported = Number.isInteger(raw) && raw >= 0 ? raw : 0;
    const cap = clearCap(roundNo, sinceIssuedMs);
    const cleared = Math.min(reported, cap);

    // 숫자가 아니거나 사람 손으로 불가능한 값이면 그 판을 이상치로 표시합니다.
    // 판을 끊지는 않습니다 — 끊으면 통신이 튀었을 때 정상 이용자의 판이 날아갑니다.
    const suspect = !Number.isInteger(raw) || raw < 0 || reported > cap;
    if (reported > cap) ext.capped = (ext.capped ?? 0) + 1;

    ext.score = (ext.score ?? 0) + cleared;
    ext.segments = (ext.segments ?? 0) + 1;
    ext.played_ms = (ext.played_ms ?? 0) + segmentMs(roundNo);

    const combo = Number(a.combo_best);
    if (Number.isInteger(combo) && combo > (ext.combo_best ?? 0)) {
      ext.combo_best = Math.min(combo, cap);
    }

    return {
      ok: cleared > 0,
      fatal: true, // 구간이 끝나면 언제나 소진 → 이어하기 선택 화면
      suspect,
      data: {
        cleared,
        capped: reported > cap,
        ...viewOf(ext),
      },
    };
  },

  /**
   * 「광고 보고 15초 더 찾기」 — 시간만 돌려줍니다.
   *
   * 판도 점수도 건드리지 않습니다. 화면이 들고 있던 판을 그대로 이어 씁니다 —
   * 손해 없음 문구(「이어해도 지금까지 찾은 네잎은 그대로 남습니다」)가 구조로도
   * 지켜져야 하는 자리입니다.
   */
  applyBoost(meta) {
    const ext = extOf(meta);
    meta.lives += 1;
    return { data: { add_ms: C.AD_MS, lives: meta.lives, ...viewOf(ext) } };
  },

  detailOf: (meta) => ({
    score: meta.ext?.score ?? 0,
    segments: meta.ext?.segments ?? 0,
    combo_best: meta.ext?.combo_best ?? 0,
    played_ms: meta.ext?.played_ms ?? 0,
    capped: meta.ext?.capped ?? 0,
  }),

  bucketOf: () => "all",

  /** 순위는 **찾은 네잎 수**. 많을수록 위로 가야 하므로 부호를 뒤집습니다 */
  rankMetricOf: (meta) => -(meta.ext?.score ?? 0),

  scoreOf: (meta) => meta.ext?.score ?? 0,
};
