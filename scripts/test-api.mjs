/**
 * API 스모크 · 회귀 테스트
 * ==========================================================================
 *
 *   npm run dev        (다른 터미널에서 로컬 서버 실행)
 *   npm run test:api
 *
 * 세 부분으로 되어 있습니다.
 *
 *   1) spec 계약 검증     등록된 아케이드 게임의 spec/config 형태를 정적으로 검사
 *   2) 아케이드 공통 흐름  등록된 게임 전부를 같은 시나리오로 자동 검사
 *   3) 오리지널 4종 회귀   공용 모듈을 고쳤을 때 기존 게임이 깨지지 않았는지 확인
 *
 * ── 게임을 추가할 때 ──────────────────────────────────────────────────────
 * 아래 PLAYERS 에 항목 하나만 추가하면 됩니다. 추가하지 않으면 이 테스트가
 * "커버되지 않은 게임" 으로 실패합니다 — 테스트 없이 게임이 들어가는 것을 막기 위한
 * 의도적인 장치입니다.
 *
 * PLAYERS 항목이 하는 일은 "그 게임을 사람처럼 올바르게/틀리게 플레이하는 방법" 을
 * 알려주는 것뿐이고, 검증 항목(정답 비노출·봉투·목숨·보상·리그·통계 게이팅)은
 * 전부 공통 드라이버가 처리합니다.
 * ==========================================================================
 */

import { ARCADE_SPECS } from "../src/games/arcade/index.js";
import { validateSpec } from "../src/lib/arcade.js";
import { ARCADE } from "../src/lib/config.js";
// ⑳ 슥슥 긁기 — 카드 생성·연속 일수 규칙은 서버 왕복으로 재현되지 않아 직접 호출합니다
import { makeCard, streakFor, shiftDay } from "../src/games/arcade/scratch.js";
// ㉑ 퍼펙트 스택 — 블록 위치는 서버와 **같은 식**으로 계산해야 탭 시각을 잡을 수 있습니다
import { blockX } from "../src/games/arcade/stack.js";

const BASE = process.env.TEST_BASE ?? "http://127.0.0.1:8787";

let cookie = "";
let pass = 0;
const failures = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 광고 한도는 IP+날짜로 누적됩니다. 초 단위 값으로 대역을 잡으면 연달아 돌릴 때
 * 같은 대역을 다시 써서 이전 실행이 소진한 한도가 남아 있습니다. 무작위로 넓게 잡습니다.
 */
const oct = () => 1 + Math.floor(Math.random() * 250);
const RUN_A = oct();
const RUN_B = oct();
const testIp = (n) => `10.${RUN_A}.${RUN_B}.${n}`;
let currentIp = testIp(1);
const useIp = (ip) => { currentIp = ip; };

function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${extra ? "  " + extra : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${extra ? "  " + extra : ""}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": currentIp,
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, data: await res.json() };
}

const post = (p, b) => call("POST", p, b);
const get = (p) => call("GET", p);

// ══════════════════════════════════════════════════════════════
// 게임별 플레이 방법 (게임 추가 시 여기에 한 항목)
// ══════════════════════════════════════════════════════════════

/** 색 배열에서 빈도가 1인 값의 위치 — 사람이 눈으로 하는 것과 같은 정보만 씁니다 */
function oddIndex(colors) {
  const n = new Map();
  for (const c of colors) n.set(c, (n.get(c) ?? 0) + 1);
  return colors.findIndex((c) => n.get(c) === 1);
}

const RPS_BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
const RPS_LOSES = { rock: "paper", scissors: "rock", paper: "scissors" };

const PLAYERS = {
  // ── ENDLESS ─────────────────────────────────────────────────
  // answer(round, correct) → 보낼 값. correct=false 면 일부러 틀립니다.
  // preDelay(round) → 답을 보내기 전에 기다려야 하는 시간(선택)

  ODDCOLOR: {
    answer: (round, correct) => {
      const i = oddIndex(round.colors);
      return { answer: correct ? i : (i + 1) % round.colors.length };
    },
  },

  SEQUENCE: {
    // 시퀀스는 화면에 재생해야 하므로 공개가 불가피합니다 (숫자 기억력과 같은 제약)
    publicFields: ["sequence"],
    answer: (round, correct) => {
      const seq = [...round.sequence];
      if (!correct) seq[0] = (seq[0] + 1) % round.pads;
      return { answer: seq };
    },
  },

  COUNTDOT: {
    // 점을 그려야 하므로 좌표는 공개됩니다. 개수(count)는 서버에만 있습니다.
    answer: (round, correct) => ({ answer: correct ? round.dots.length : round.dots.length + 7 }),
  },

  RINGSTOP: {
    // 점이 타겟 아크 중앙(또는 반대편)에 올 때까지 실제로 기다린 뒤 탭합니다.
    answer: async (round, correct) => {
      const toCenter =
        (((round.target_start_deg + round.arc_deg / 2) - round.start_deg + 360) % 360) /
        round.speed_dps * 1000;
      const waitMs = Math.round(correct ? toCenter : toCenter + (180 / round.speed_dps) * 1000);
      const t0 = Date.now();
      await sleep(waitMs);
      const elapsed = Date.now() - t0;
      const deg = (round.start_deg + (round.speed_dps * elapsed) / 1000) % 360;
      return { answer: { angle_deg: Number(deg.toFixed(2)) }, extra: { elapsed_ms: elapsed } };
    },
  },

  CARDPAIR: {
    // 라운드=카드 한 장 뒤집기라 흐름이 달라 전용 시나리오를 씁니다.
    custom: cardpairFlow,
  },

  PATHLINE: {
    // 정답 경로가 서버 secret 이라 공통 endlessFlow 를 쓸 수 없습니다.
    custom: pathlineFlow,
  },

  BASKET: {
    // 정답 조합이 서버 secret 이라 공통 endlessFlow 를 쓸 수 없습니다.
    custom: basketFlow,
  },

  DROPCATCH: {
    // 실시간 낙하 게임이라 BATCH 지만 흐름이 달라(목숨·이어받기) 전용 시나리오를 씁니다.
    custom: dropcatchFlow,
  },

  STORE: {
    // 실패도 목숨도 없고 판이 끝나도 가게가 남는 유일한 게임이라 전용 시나리오를 씁니다.
    custom: storeFlow,
  },

  SCRATCH: {
    // 하루 카드 한 장 · 꽝 없음 · 목숨이 "남은 긁기" 를 뜻하는 게임이라 전용 시나리오를 씁니다.
    custom: scratchFlow,
  },

  STACK: {
    // 블록이 목표 지점에 올 때까지 **실제로 기다린 뒤** 탭합니다 (⑪ 링 스톱과 같은 방식).
    // 위치는 화면에 보이는 값(왕복 시간·위상·폭)으로만 계산합니다 — 사람과 같은 정보 상태입니다.
    answer: async (round, correct) => {
      const room = Math.max(0, 1 - round.width);
      const [sl, sr] = round.support;
      // 맞힐 때는 받침 중앙, 틀릴 때는 받침을 거의 벗어난 자리를 노립니다
      const wantX = correct
        ? (sl + sr) / 2 - round.width / 2
        : Math.min(room, Math.max(0, sr - 0.01));
      const tri = room > 0 ? Math.min(1, Math.max(0, wantX / room)) : 0;

      // 삼각파의 오름 구간에서 목표 위치에 도달하는 첫 시각
      const phaseWant = tri / 2;
      const cur = ((round.phase0 % 1) + 1) % 1;
      let dPhase = phaseWant - cur;
      while (dPhase < 0.02) dPhase += 1; // 이미 지난 위상이면 다음 왕복을 기다립니다
      const waitMs = Math.round(dPhase * round.sweep_ms);

      const t0 = Date.now();
      await sleep(waitMs);
      const elapsed = Date.now() - t0;
      const x = blockX(elapsed, round.sweep_ms, round.phase0, round.width);
      return { answer: { x: Number(x.toFixed(3)) }, extra: { elapsed_ms: elapsed } };
    },
  },

  MAJORITY: {
    // 이 게임에는 "일부러 맞히는 방법" 이 없습니다 — 정답이 다른 사람들의 집계라
    // 클라이언트가 미리 알 수 없어야 하는 것이 규칙 그 자체입니다.
    // 그래서 공통 endlessFlow(정답 3연속) 대신, 확실하게 틀릴 수 있는 수단
    // (시간 초과)으로 흐름을 고정한 전용 시나리오를 씁니다.
    custom: majorityFlow,
  },

  // ── BATCH ───────────────────────────────────────────────────
  // submit(start, boostReward) → { answers, times, elapsedMs, expectBucket, assert }

  REACTION: {
    boostFirst: true,
    submit: (start, boost) => {
      const waits = [...start.round.waits, ...(boost ? [boost.data.wait_ms] : [])];
      const reactions = waits.map((_, i) => (i === 2 ? -1 : 280 + i * 5)); // 3번째는 부정출발
      const times = waits.map((w, i) => w + Math.max(0, reactions[i]));
      return {
        answers: reactions,
        times,
        elapsedMs: times.reduce((a, b) => a + b, 0),
        expectBucket: "all+",
        assert: (detail) => [
          ["좋은 5개만 채택", detail.adopted_count === 5, `avg=${detail.avg_ms}ms`],
          ["부정출발 1회 집계", detail.false_starts === 1],
        ],
      };
    },
  },

  NUMTAP: {
    // 5×5 배치는 화면에 그대로 보이는 정보라 숨길 이유가 없습니다
    publicFields: ["layout"],
    submit: (start) => {
      const order = [...start.round.layout].sort((a, b) => a - b);
      const taps = [];
      const times = [];
      let t = 0;
      for (const n of order) {
        if (n === 5) { taps.push(99); times.push((t += 130)); } // 오탭 1회
        taps.push(n);
        times.push((t += 130));
      }
      return {
        answers: taps,
        times,
        elapsedMs: t,
        expectBucket: "5x5", // 런 중 보상이 없는 게임
        assert: (detail) => [
          ["완주 인정", detail.completed === true, `${detail.final_ms}ms`],
          ["오탭 페널티 반영", detail.misses === 1 && detail.penalty_ms === 500],
        ],
      };
    },
  },

  MATHRUSH: {
    boostFirst: true,
    submit: (start) => {
      const solve = (q) => (q.op === "+" ? q.a + q.b : q.op === "-" ? q.a - q.b : q.a * q.b);
      const qs = start.round.questions.slice(0, 20);
      const answers = qs.map((q, i) => (i === 7 ? solve(q) + 1 : solve(q))); // 1문제 오답
      const times = answers.map(() => 300);
      return {
        answers,
        times,
        elapsedMs: times.reduce((a, b) => a + b, 0),
        expectBucket: "75s", // 시간 연장이 곧 리그 (‘+’ 접미사 미사용)
        packedScore: true,
        assert: (detail) => [
          ["19정답 / 1오답", detail.correct === 19 && detail.wrong === 1, `정확도 ${detail.accuracy}%`],
        ],
      };
    },
  },

  STROOP: {
    boostFirst: true,
    submit: (start) => {
      const inkOf = (it) => start.round.palette.find((c) => c.hex === it.ink_hex).key;
      const items = start.round.items.slice(0, 12);
      const answers = items.map((it, i) =>
        i === 7 ? it.choices.find((c) => c !== inkOf(it)) : inkOf(it),
      );
      const times = answers.map(() => 400);
      return {
        answers,
        times,
        elapsedMs: times.reduce((a, b) => a + b, 0),
        expectBucket: "all+",
        packedScore: true,
        assert: (detail) => [
          ["광고 면제로 연속 유지", detail.streak === 11 && detail.forgiven === 1, `streak=${detail.streak}`],
        ],
      };
    },
  },

  RPSFLASH: {
    submit: (start) => {
      const solve = (it) =>
        it.order === "WIN" ? RPS_LOSES[it.hand] : it.order === "LOSE" ? RPS_BEATS[it.hand] : it.hand;
      const items = start.round.items.slice(0, 15);
      const answers = items.map(solve);
      // 마지막 문항만 제한 시간을 넘겨 응답 → 정답이어도 오답 처리되어야 합니다
      const times = answers.map((_, i) => (i === 14 ? items[i].limit_ms + 400 : 300));
      return {
        answers,
        times,
        elapsedMs: times.reduce((a, b) => a + b, 0),
        expectBucket: "all",
        packedScore: true,
        assert: (detail) => [
          ["시간 초과 문항은 오답", detail.streak === 14, `streak=${detail.streak} wrongAt=${detail.wrong_at}`],
        ],
      };
    },
  },
};

// ══════════════════════════════════════════════════════════════
// 1) spec 계약 검증
// ══════════════════════════════════════════════════════════════

function contractChecks() {
  console.log("\n[1] spec 계약 검증");

  for (const [game, spec] of Object.entries(ARCADE_SPECS)) {
    const problems = validateSpec(spec);
    check(`${game} spec 계약`, problems.length === 0, problems.join(" / "));
  }

  // 등록된 게임에 플레이 방법이 없으면 테스트가 그 게임을 건너뛰게 됩니다.
  // 조용히 넘어가지 않도록 실패로 만듭니다.
  for (const game of Object.keys(ARCADE_SPECS)) {
    check(
      `${game} 테스트 커버리지`,
      PLAYERS[game] != null,
      PLAYERS[game] ? "" : "→ scripts/test-api.mjs 의 PLAYERS 에 항목을 추가해 주세요",
    );
  }

  // 반대 방향: PLAYERS 에만 있고 레지스트리에 없는 항목(이름 오타)
  for (const game of Object.keys(PLAYERS)) {
    check(`${game} 레지스트리 등록`, ARCADE_SPECS[game] != null,
      ARCADE_SPECS[game] ? "" : "→ src/games/arcade/index.js 등록 누락 또는 이름 오타");
  }
}

// ══════════════════════════════════════════════════════════════
// 2) 아케이드 공통 흐름 (등록된 게임 전부)
// ══════════════════════════════════════════════════════════════

/**
 * 채점 기준값이 응답에 새지 않아야 합니다.
 *
 * 게임에 따라 "화면에 그려야 하므로 공개가 불가피한 값" 이 있습니다(순서 기억의 시퀀스,
 * 숫자 순서 터치의 배치 등). 그건 PLAYERS 의 publicFields 에 적어 두고, 적히지 않은
 * 비밀 필드가 나타나면 실패로 잡습니다. 새 게임이 실수로 정답을 흘리면 여기서 걸립니다.
 */
const SECRET_KEYS = [
  "answer_index", "answers", "layout", "sequence", "digits", "count", "secret",
  // ⑮ 다들 뭐 골랐을까 — 집계 비율이 곧 정답이라 문항과 함께 내려가면 안 됩니다
  "snap_a", "snap_b", "major", "major_index", "pct",
];

function assertNoSecretLeak(game, payload) {
  const allowed = new Set(PLAYERS[game]?.publicFields ?? []);
  const json = JSON.stringify(payload);

  const leaks = SECRET_KEYS.filter((k) => !allowed.has(k) && json.includes(`"${k}"`));
  check(
    `${game} 채점 기준값 비노출`,
    leaks.length === 0,
    leaks.length ? `누출: ${leaks.join(", ")}` : allowed.size ? `공개 허용: ${[...allowed].join(", ")}` : "",
  );
}

async function endlessFlow(game, spec) {
  const player = PLAYERS[game];
  const cfg = ARCADE[game];

  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `목숨=${s.data.lives} 보상=0/${s.data.max_boosts}`);
  if (!s.data.ok) return;
  assertNoSecretLeak(game, s.data);

  const sid = s.data.session_id;
  let round = s.data.round;

  // 정답 3라운드 — 라운드가 오르고 봉투가 유지되는지
  for (let i = 0; i < 3; i++) {
    const { answer, extra } = await player.answer(round, true);
    const r = await post("/game/round", { game_type: game, session_id: sid, answer, ...(extra ?? {}) });
    check(`${game} 라운드 ${i + 1} 통과`, r.data.ok === true && r.data.correct === true,
      `cleared=${r.data.cleared}`);
    if (!r.data.correct) return;
    round = r.data.round;
  }

  // 오답으로 목숨 소진 (목숨이 여러 개면 다 쓸 때까지)
  let miss = null;
  for (let i = 0; i < (cfg.lives ?? 1) + 1; i++) {
    const { answer, extra } = await player.answer(round, false);
    miss = await post("/game/round", { game_type: game, session_id: sid, answer, ...(extra ?? {}) });
    if (miss.data.exhausted) break;
    round = miss.data.round ?? round;
  }

  // 이번 작업에서 고친 버그들의 회귀 검사
  check(`${game} 오답도 성공 봉투 유지`, miss.status === 200 && miss.data.ok === true,
    `envelope.ok=${miss.data.ok} correct=${miss.data.correct}`);
  check(`${game} 목숨 소진 시 세션 유지`, miss.data.exhausted === true && miss.data.game_over === false,
    `can_boost=${miss.data.can_boost}`);

  const extraAnswer = await post("/game/round", { game_type: game, session_id: sid, answer: 0 });
  check(`${game} 소진 후 추가 응답 거부`, extraAnswer.data.code === "RUN_EXHAUSTED",
    `(${extraAnswer.data.code})`);

  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 이어하기 보상이 유효`, boost.data.reward?.lives === 1 && boost.data.reward?.round != null,
    `목숨=${boost.data.reward?.lives} 라운드=${boost.data.reward?.round_no}`);

  const fin = await post("/game/finish", { game_type: game, session_id: sid });
  const result = fin.data.result;
  check(`${game} 결과 확정`, result?.rank_metric != null,
    `점수=${result?.score} 리그=${result?.bucket} TOP ${result?.rank_pct}%`);
  check(`${game} 보상 사용 런은 별도 리그`, result?.bucket?.endsWith("+") === true, `bucket=${result?.bucket}`);

  const reuse = await post("/game/round", { game_type: game, session_id: sid, answer: 0 });
  check(`${game} 종료된 세션 재사용 차단`, reuse.status === 409, `(${reuse.data.code})`);

  return result;
}

async function batchFlow(game) {
  const player = PLAYERS[game];

  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `보상 한도=${s.data.max_boosts}`);
  if (!s.data.ok) return;
  assertNoSecretLeak(game, s.data);

  const sid = s.data.session_id;

  let boost = null;
  if (player.boostFirst) {
    const r = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
    check(`${game} 런 중 보상`, r.data.ok === true, `보상=${r.data.reward?.boosts}/${r.data.reward?.max_boosts}`);
    boost = r.data.reward;
  }

  const plan = player.submit(s.data, boost);

  // 신고할 플레이 시간만큼 실제로 기다립니다 (안 기다리면 서버가 TIME_TAMPERED 로 거부)
  await sleep(plan.elapsedMs);

  const done = await post("/game/submit", {
    game_type: game,
    session_id: sid,
    answers: plan.answers,
    times: plan.times,
    elapsed_ms: plan.elapsedMs,
  });

  const result = done.data.result;
  check(`${game} 결과 확정`, result?.rank_metric != null,
    `점수=${result?.score} 리그=${result?.bucket} suspect=${result?.suspect}`);
  check(`${game} 정상 플레이는 이상치 아님`, result?.suspect === false, `suspect=${result?.suspect}`);
  check(`${game} 리그 = ${plan.expectBucket}`, result?.bucket === plan.expectBucket, `bucket=${result?.bucket}`);

  // 동점자 보정항이 섞인 순위 지표에서 점수를 되돌릴 수 있어야 합니다.
  // (floor 로 되돌려 "13연속인데 최고 기록 12연속" 으로 표시된 버그의 회귀 검사)
  if (plan.packedScore) {
    const unpacked = Math.max(0, Math.ceil(-result.rank_metric / 1000));
    check(`${game} 순위 지표에서 점수 복원`, unpacked === result.score,
      `metric=${result.rank_metric} → ${unpacked} (실제 ${result.score})`);
  }

  for (const [name, cond, extra] of plan.assert?.(done.data.detail ?? {}) ?? []) {
    check(`${game} ${name}`, cond, extra ?? "");
  }

  const dup = await post("/game/submit", {
    game_type: game, session_id: sid, answers: plan.answers, times: plan.times, elapsed_ms: plan.elapsedMs,
  });
  check(`${game} 중복 제출 차단`, dup.status === 409, `(${dup.data.code})`);

  return result;
}

/** 카드 짝 맞추기 — 라운드가 "카드 한 장 뒤집기" 라 전용 흐름 */
async function cardpairFlow(game) {
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `보상 한도=${s.data.max_boosts}`);
  if (!s.data.ok) return;
  check(`${game} 배치가 응답에 없음`, JSON.stringify(s.data).includes("layout") === false);

  const sid = s.data.session_id;

  // 광고 보상: 아직 못 맞춘 한 쌍 공개
  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  const hint = boost.data.reward?.data;
  check(`${game} 한 쌍 위치 공개`, Array.isArray(hint?.pair) && hint.pair.length === 2,
    `pair=${hint?.pair} ${hint?.symbol ?? ""}`);

  // 공개된 쌍을 맞춥니다
  await post("/game/round", { game_type: game, session_id: sid, answer: hint.pair[0] });
  const m = await post("/game/round", { game_type: game, session_id: sid, answer: hint.pair[1] });
  check(`${game} 공개된 쌍 매칭`, m.data.data?.phase === "match", `phase=${m.data.data?.phase}`);

  // 나머지는 한 장씩 열어 배치를 파악한 뒤 짝을 맞춥니다 (사람과 같은 정보 상태)
  const symOf = {};
  let over = null;
  for (let i = 0; i < 16 && !over; i++) {
    if (hint.pair.includes(i) || symOf[i]) continue;
    const r = await post("/game/round", { game_type: game, session_id: sid, answer: i });
    if (r.data.data?.symbol) symOf[i] = r.data.data.symbol;
    if (r.data.game_over) over = r.data.result;
  }

  const bySym = {};
  for (const [i, sym] of Object.entries(symOf)) (bySym[sym] ??= []).push(Number(i));

  for (const pair of Object.values(bySym)) {
    if (over || pair.length !== 2) continue;
    await post("/game/round", { game_type: game, session_id: sid, answer: pair[0] });
    const r = await post("/game/round", { game_type: game, session_id: sid, answer: pair[1] });
    if (r.data.game_over) over = r.data.result;
  }

  check(`${game} 여덟 쌍 완성으로 종료`, over != null, `뒤집기=${over?.score}`);
  check(`${game} 보상 사용 런은 별도 리그`, over?.bucket === "4x4+", `bucket=${over?.bucket}`);
  return over;
}

/**
 * 다들 뭐 골랐을까 — 정답을 미리 알 수 없는 게임이라 전용 흐름을 씁니다.
 *
 * 확인하는 것
 *   ① 문항과 함께 집계 비율(=정답)이 내려가지 않는다
 *   ② 시간 초과는 확실한 오답이고, 목숨 1이 떨어지면 세션이 유지된 채 되돌리기를 기다린다
 *   ③ 되돌리기 광고로 새 문항을 받아 이어갈 수 있고, 적중분은 유지된다
 *   ④ 판정 응답에는 비율·표본 수가 들어 있고, 「집계 중」 문항은 비율 없이 통과된다
 *   ⑤ 보상을 쓴 런은 별도 리그('all+')로 집계된다
 */
/**
 * ⑯ 딱 맞게 담기 — 전용 시나리오
 *
 * 정답 조합은 서버 secret 이라 클라이언트가 알 수 없습니다. 대신 **목표 금액이 실제
 * 조합의 합** 이라는 성질이 있어, 가격표를 완전 탐색하면 반드시 해를 찾을 수 있습니다.
 * 해가 없으면 그것 자체가 결함이므로 이 탐색이 곧 "해 존재" 검증입니다.
 */
function findCombo(items, target, tol) {
  const n = items.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0;
    const pick = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { sum += items[i].price; pick.push(i); }
    if (Math.abs(target - sum) <= tol) return pick;
  }
  return null;
}

/**
 * ⑰ 한 줄로 이어요 — 전용 시나리오
 *
 * 정답 경로는 서버 secret 이지만, **번호 위치는 공개**되므로 클라이언트도 스스로
 * 경로를 찾을 수 있어야 합니다(그게 이 게임의 규칙입니다). 여기서는 BFS 로 실제로
 * 찾아 봅니다 — 못 찾으면 풀 수 없는 판을 낸 것이고, 그것 자체가 결함입니다.
 */
function solvePath(round) {
  const { w, h, marks, nums } = round;
  const nb = (i) => {
    const r = Math.floor(i / w), c = i % w, out = [];
    if (r > 0) out.push(i - w);
    if (r < h - 1) out.push(i + w);
    if (c > 0) out.push(i - 1);
    if (c < w - 1) out.push(i + 1);
    return out;
  };
  const start = Number(Object.keys(marks).find((k) => marks[k] === 1));

  // 번호를 순서대로 지나는 자기회피 경로를 깊이우선으로 찾습니다.
  const seen = new Set([start]);
  const trail = [start];
  const dfs = (expect) => {
    if (expect > nums) return true;
    const cur = trail[trail.length - 1];
    for (const n of nb(cur)) {
      if (seen.has(n)) continue;
      const num = marks[n];
      if (num != null && num !== expect) continue;
      seen.add(n); trail.push(n);
      if (dfs(num === expect ? expect + 1 : expect)) return true;
      seen.delete(n); trail.pop();
    }
    return false;
  };
  return dfs(2) ? [...trail] : null;
}

async function pathlineFlow(game) {
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `목숨=${s.data.lives} 보상=0/${s.data.max_boosts}`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  let round = s.data.round;

  check(`${game} 번호 위치를 공개`, Object.keys(round?.marks ?? {}).length === round?.nums,
    `번호 ${Object.keys(round?.marks ?? {}).length}개 / nums=${round?.nums}`);
  check(`${game} 이론상 최소 길이 제공`, round?.min_len >= round?.nums,
    `min_len=${round?.min_len}`);
  check(`${game} 힌트는 처음에 비어 있음`, (round?.hint ?? []).length === 0,
    `hint=${(round?.hint ?? []).length}칸`);

  // ── 해가 반드시 존재해야 합니다 ─────────────────────────────
  const sol = solvePath(round);
  check(`${game} 풀 수 있는 판인가`, sol != null, `${round?.w}x${round?.h} 번호 ${round?.nums}개`);
  if (!sol) return;

  // ── 잘못된 경로는 거부하되 판을 끝내지 않습니다 ─────────────
  const bad = await post("/game/round", { game_type: game, session_id: sid, answer: [sol[0], sol[0]] });
  check(`${game} 같은 칸 두 번은 거부`, bad.data.correct === false && bad.data.game_over !== true,
    `사유=${bad.data.data?.invalid}`);

  const jump = await post("/game/round", { game_type: game, session_id: sid, answer: [sol[0], sol[sol.length - 1]] });
  check(`${game} 떨어진 칸으로 건너뛰기 거부`, jump.data.correct === false,
    `사유=${jump.data.data?.invalid}`);
  // 잘못 낸 경로 때문에 판이 통째로 바뀌면 안 됩니다 (실제로 그런 결함이 있었습니다)
  check(`${game} 무효 제출 후에도 같은 판 유지`,
    jump.data.round?.min_len === round.min_len && jump.data.round?.round === round.round,
    `min_len=${jump.data.round?.min_len} (직전 ${round.min_len})`);

  // ── 정답 경로로 통과 ────────────────────────────────────────
  const ok = await post("/game/round", { game_type: game, session_id: sid, answer: sol });
  check(`${game} 유효한 경로면 통과`, ok.data.correct === true,
    `내 경로=${ok.data.data?.len}칸 최단=${ok.data.data?.min_len}칸`);
  check(`${game} 최단 판정은 하한 기준`,
    ok.data.data?.shortest === (ok.data.data?.len <= ok.data.data?.min_len),
    `shortest=${ok.data.data?.shortest}`);

  round = ok.data.round;
  check(`${game} 다음 라운드 발급`, round?.round === 2, `round=${round?.round}`);

  // ── 시간 초과 → 이어하기 → 같은 판을 힌트와 함께 다시 ───────
  const out = await post("/game/round", { game_type: game, session_id: sid, answer: null, timeout: true });
  check(`${game} 시간 초과 시 세션 유지`, out.data.exhausted === true && out.data.game_over === false,
    `can_boost=${out.data.can_boost}`);

  const target = round.min_len;
  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  const after = boost.data.reward?.round;
  check(`${game} 보상으로 정답 경로 3칸 공개`, (after?.hint ?? []).length === 3,
    `hint=${(after?.hint ?? []).length}칸`);
  check(`${game} 보상 후 같은 판을 다시 냄`, after?.min_len === target,
    `min_len=${after?.min_len} (직전 ${target})`);

  const sol2 = after ? solvePath(after) : null;
  check(`${game} 힌트를 받은 판도 풀린다`, sol2 != null, `${after?.w}x${after?.h}`);

  // 보상 2회를 모두 쓰면 런이 끝납니다.
  await post("/game/round", { game_type: game, session_id: sid, answer: null, timeout: true });
  await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  const fin = await post("/game/round", { game_type: game, session_id: sid, answer: null, timeout: true });
  const res = fin.data.result;
  check(`${game} 보상 소진 후 결과 확정`, fin.data.game_over === true && res != null,
    `game_over=${fin.data.game_over}`);
  if (res) check(`${game} 보상 사용 런은 별도 리그`, res.bucket === "all+", `bucket=${res.bucket}`);
}

/**
 * ⑱ 와르르 받기 — 전용 시나리오
 *
 * 낙하 일정은 서버가 확정해 내려주므로, 클라이언트가 "무엇을 받았는가" 만 신고합니다.
 * 그래서 검증 대상은 **신고를 서버가 어떻게 되받아 채점하는가** 입니다.
 *
 * 45초를 실제로 기다리지 않습니다. 신고한 플레이 시간이 서버 관측 시간창을 넘으면
 * TIME_TAMPERED 로 막히므로(그게 정상입니다), **짧은 시간 안에 바구니 선에 닿는
 * 앞부분 물건만** 처리하고 나머지는 null(손대지 못함)로 둡니다.
 */
const landAt = (item) => item.t + item.fall_ms;

/** budget 안에 판정이 끝나는 앞쪽 물건들의 index */
const playableItems = (items, budgetMs) => {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (landAt(items[i]) > budgetMs) break; // 일정 순서대로 착지하므로 여기서 끊으면 됩니다
    out.push(i);
  }
  return out;
};

async function dropcatchFlow(game) {
  const BUDGET_MS = 3600;

  // ── ① 일정 자체가 기획 규칙을 지키는가 ─────────────────────
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `보상=0/${s.data.max_boosts}`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  const round = s.data.round;
  const items = round?.items ?? [];

  check(`${game} 낙하 일정을 미리 발급`, items.length > 0, `${items.length}개 · 제한 ${round?.limit_ms}ms`);
  if (items.length === 0) return;

  check(`${game} 첫 물건은 바구니 자리로 (첫 판 성공 보장)`,
    items[0].lane === 2 && items[0].kind !== "bomb", `lane=${items[0].lane} kind=${items[0].kind}`);
  check(`${game} 첫 ${round.safe_ms / 1000}초는 폭탄 없음`,
    items.filter((it) => it.t < round.safe_ms && it.kind === "bomb").length === 0,
    `안전구간 물건 ${items.filter((it) => it.t < round.safe_ms).length}개`);
  check(`${game} 목숨 ${round.lives}개로 시작`, round.lives === 3, `lives=${round.lives}`);

  // ── ② 정상 플레이 — 좋은 것만 받고 폭탄은 피합니다 ─────────
  const play = playableItems(items, BUDGET_MS);
  check(`${game} 예산 안에 판정되는 물건이 있다`, play.length > 0, `${play.length}개`);

  const answers = [];
  const times = [];
  let expect = 0;
  for (const i of play) {
    const it = items[i];
    const take = it.kind !== "bomb";
    answers[i] = take ? 1 : 0;
    times[i] = landAt(it);
    if (take) expect += it.kind === "bonus" ? round.bonus_point : 1;
  }

  await sleep(1500); // 서버 관측 시간창을 신고값보다 크게 만듭니다
  const ok = await post("/game/submit", {
    game_type: game, session_id: sid, answers, times, elapsed_ms: BUDGET_MS,
  });

  check(`${game} 제출 성공`, ok.data.ok === true, `(${ok.data.code ?? "-"})`);
  check(`${game} 점수를 서버가 다시 계산`, ok.data.result?.score === expect,
    `서버=${ok.data.result?.score} 기대=${expect}`);
  check(`${game} 정상 플레이는 이상치 아님`, ok.data.result?.suspect === false,
    `어긋난 신고=${ok.data.detail?.bad_timing}`);
  check(`${game} 손대지 못한 물건은 세지 않음`, ok.data.detail?.handled === play.length,
    `handled=${ok.data.detail?.handled} / 전체 ${items.length}개`);

  // ── ③ 받은 시각을 위조하면 이상치 ──────────────────────────
  const s2 = await post("/game/session/start", { game_type: game, fresh: true });
  if (s2.data.ok) {
    const it2 = s2.data.round.items;
    const play2 = playableItems(it2, BUDGET_MS);
    const a2 = [];
    const t2 = [];
    for (const i of play2) {
      a2[i] = it2[i].kind !== "bomb" ? 1 : 0;
      t2[i] = 0; // 전부 "시작하자마자 받았다" 는 물리적으로 불가능합니다
    }
    await sleep(1500);
    const faked = await post("/game/submit", {
      game_type: game, session_id: s2.data.session_id, answers: a2, times: t2, elapsed_ms: BUDGET_MS,
    });
    check(`${game} 착지 시각 위조는 이상치`, faked.data.result?.suspect === true,
      `어긋난 신고=${faked.data.detail?.bad_timing}/${play2.length}`);
  }

  // ── ④ 신고 시간 부풀리기는 거부 ────────────────────────────
  const s3 = await post("/game/session/start", { game_type: game, fresh: true });
  if (!s3.data.ok) return;
  const sid3 = s3.data.session_id;
  const it3 = s3.data.round.items;

  const inflated = await post("/game/submit", {
    game_type: game, session_id: sid3, answers: [1], times: [landAt(it3[0])], elapsed_ms: 45000,
  });
  check(`${game} 신고 시간 부풀리기 거부`, inflated.data.code === "TIME_TAMPERED", `(${inflated.data.code})`);

  // ── ⑤ 이어받기 — 목숨 +1 · 일정 연장 · 점수 유지 ───────────
  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid3 });
  const bd = boost.data.reward?.data;
  check(`${game} 이어받기로 목숨 +1`, bd?.lives_added === 1 && bd?.total_lives === 4,
    `+${bd?.lives_added} → 총 ${bd?.total_lives}개 (기본 3)`);
  check(`${game} 연장분 일정을 이어붙임`,
    (bd?.items?.length ?? 0) > 0 && bd?.from_index === it3.length,
    `+${bd?.items?.length}개 · from_index=${bd?.from_index} (기존 ${it3.length}개)`);
  check(`${game} 제한 시간도 함께 연장`, bd?.limit_ms > s3.data.round.limit_ms,
    `${s3.data.round.limit_ms} → ${bd?.limit_ms}ms`);

  await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid3 });
  const over = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid3 });
  check(`${game} 런당 보상 2회 제한`, over.data.ok === false, `(${over.data.code})`);

  // 보상을 쓴 런은 별도 리그로 확정합니다.
  const play3 = playableItems(it3, BUDGET_MS);
  const a3 = [];
  const t3 = [];
  for (const i of play3) {
    a3[i] = it3[i].kind !== "bomb" ? 1 : 0;
    t3[i] = landAt(it3[i]);
  }
  await sleep(1500);
  const fin = await post("/game/submit", {
    game_type: game, session_id: sid3, answers: a3, times: t3, elapsed_ms: BUDGET_MS,
  });
  const res = fin.data.result;
  check(`${game} 보상 사용 런은 별도 리그`, res?.bucket === "all+", `bucket=${res?.bucket}`);
  // 늘린 목숨이 채점에도 쓰여야 합니다. 여기서 3이면 이어받은 구간이 통째로 잘립니다.
  check(`${game} 늘린 목숨이 채점에 반영`, fin.data.detail?.allowed_lives === 5,
    `allowed_lives=${fin.data.detail?.allowed_lives} (기본 3 + 이어받기 2회)`);

  return ok.data.result; // 통계 게이팅은 이상치가 아닌 판으로 확인합니다
}

/**
 * ⑲ 내 가게 채우기 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 오늘 상자와 선반 상태가 내려오고, **첫 상품은 반드시 놓을 자리가 있다**
 *   ② 잘못 누른 칸은 거부하되 **판을 끝내지 않는다** (실패가 없는 게임)
 *   ③ 선반 4칸을 채우면 완성 판정 + 그 자리에 새 빈 선반이 열린다
 *   ④ 상자를 다 쓰면 종료되고, **가게가 저장되어 다음 판에 이어진다**
 *   ⑤ 하루 1판 — 기회를 다 쓰면 시작할 수 없다
 */
/** 루프 안에서 같은 항목을 여러 번 찍지 않도록, 처음 한 번과 실패한 경우만 기록합니다 */
const seenOnce = new Set();
function check_once(name, cond, extra = "") {
  if (cond && seenOnce.has(name)) return;
  seenOnce.add(name);
  check(name, cond, extra);
}

async function storeFlow(game) {
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `기회 소진 후 상태=${s.data.code ?? "정상"}`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  let round = s.data.round;

  check(`${game} 목숨 없는 게임`, s.data.lives === 0, `lives=${s.data.lives}`);
  check(`${game} 이어하기 없음`, s.data.max_boosts === 0, `max_boosts=${s.data.max_boosts}`);
  check(`${game} 선반 3코너 제공`, (round?.shelves ?? []).length === 3,
    `${(round?.shelves ?? []).map((x) => x.name).join(" ")}`);
  // 첫 성공 보장(기획서 0-4). can_place 플래그가 아니라 실제 선반 상태로 확인합니다.
  const firstCorner = (round?.shelves ?? []).find((x) => x.key === round?.item?.corner);
  check(`${game} 첫 상품은 놓을 자리가 있다 (첫 성공 보장)`,
    (firstCorner?.slots ?? []).some((v) => v == null),
    `${round?.item?.name} → ${firstCorner?.name} ${firstCorner?.slots.filter(Boolean).length}/${firstCorner?.slots.length}`);

  const cornerOf = (r, key) => (r.shelves ?? []).find((x) => x.key === key);
  const freeSlot = (r) => {
    const c = cornerOf(r, r.item.corner);
    return (c?.slots ?? []).findIndex((v) => v == null);
  };

  // ── ② 잘못된 칸은 거부하되 판은 유지 ───────────────────────
  const bad = await post("/game/round", { game_type: game, session_id: sid, answer: 99 });
  check(`${game} 없는 칸은 거부하되 판을 끝내지 않음`,
    bad.data.correct === false && bad.data.game_over !== true,
    `사유=${bad.data.data?.invalid}`);

  // 엔진은 판정이 틀려도 라운드를 올립니다(arcade.js: meta.round += 1).
  // 그래서 잘못 누른 뒤에도 **같은 상품이 그대로 나와야** 합니다 — 아니면 상품이 사라집니다.
  const item1 = round.item.name;
  check(`${game} 잘못 눌러도 상품이 사라지지 않음`,
    bad.data.round?.item?.name === item1 && bad.data.round?.no === round.no,
    `${item1} → ${bad.data.round?.item?.name} (${round.no}번째 → ${bad.data.round?.no}번째)`);

  const filledFirst = () => {
    const c = (round.shelves ?? []).find((x) => x.key === round.item.corner);
    return (c?.slots ?? []).findIndex((v) => v != null);
  };

  // ── ③ 상자를 소진하며 배치 ─────────────────────────────────
  let completed = 0;
  let placed = 0;
  let last = null;
  for (let i = 0; i < 12 && round; i++) {
    // 선반은 4칸이 차는 순간 비워지므로 놓을 자리가 없는 경우는 존재하지 않습니다.
    const slot = freeSlot(round);
    check_once(`${game} 놓을 자리는 항상 있다`, slot >= 0, `${round.item.name} → ${round.item.corner}`);

    last = await post("/game/round", { game_type: game, session_id: sid, answer: slot });
    if (last.data.code) break;

    if (last.data.correct) placed += 1;
    if (last.data.data?.completed) completed += 1;
    if (last.data.game_over) break;
    round = last.data.round;
  }

  check(`${game} 상자를 다 쓰면 종료`, last?.data.game_over === true,
    `진열 ${placed}개 · 완성 ${completed}줄`);

  const res = last?.data.result;
  check(`${game} 결과 확정`, res != null, `점수=${res?.score}`);
  if (!res) return;

  const d = last.data.data ?? {};
  check(`${game} 점수는 배치·완성·도감의 누적`, res.score > 0 && res.score >= placed,
    `score=${res.score} 진열=${placed}`);
  check(`${game} 순위 지표는 누적 진열 칸 수`, res.rank_metric === -(d.placed_today ?? 0) || res.rank_metric < 0,
    `rank_metric=${res.rank_metric}`);
  // 기획서 8장의 재방문 문구 — 미완의 선반이 있으면 그걸 알려 줘야 합니다.
  check(`${game} 완성에 가까운 선반을 알려 준다`,
    d.near == null || (d.near.left >= 1 && d.near.left < 4),
    d.near ? `${d.near.name} ${d.near.left}칸 남음` : "완성된 선반만 있음");

  // ── ④ 가게가 저장되어 다음 판에 이어지는가 ─────────────────
  // 하루 1판이라 광고로 기회를 한 번 더 받아 확인합니다.
  const ad = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check(`${game} 보너스 상자 광고`, ad.data.ok === true, `(${ad.data.code ?? "-"})`);

  // ── ④ 가게가 저장되어 이어지는가 + 새로고침 재개 ───────────
  // 보너스 상자 한 번으로 둘 다 확인합니다 (하루 기회가 1 + 광고 1뿐입니다).
  const s2 = await post("/game/session/start", { game_type: game, fresh: true });
  if (s2.data.ok) {
    const sid2 = s2.data.session_id;
    const filled = (s2.data.round?.shelves ?? []).reduce(
      (n, sh) => n + sh.slots.filter(Boolean).length, 0);
    // 완성된 선반은 비워지므로, 완성 없이 놓은 만큼만 남아 있어야 합니다.
    check(`${game} 가게가 저장되어 이어진다`, filled === placed - completed * 4,
      `남은 진열 ${filled}칸 (놓음 ${placed} − 완성 ${completed}줄×4)`);
    check(`${game} 새 상자를 다시 배정`, (s2.data.round?.total ?? 0) > 0,
      `상자 ${s2.data.round?.total}개`);

    // 한 개만 놓고 새로고침을 흉내 냅니다.
    const slot2 = (s2.data.round.shelves.find((x) => x.key === s2.data.round.item.corner)?.slots ?? [])
      .findIndex((v) => v == null);
    await post("/game/round", { game_type: game, session_id: sid2, answer: slot2 });

    const again = await post("/game/session/start", { game_type: game });
    check(`${game} 새로고침하면 같은 런을 이어받는다`,
      again.data.resumed === true && again.data.session_id === sid2,
      `resumed=${again.data.resumed}`);
    check(`${game} 이어받기는 기회를 쓰지 않는다`,
      again.data.attempts?.used === s2.data.attempts?.used,
      `used ${s2.data.attempts?.used} → ${again.data.attempts?.used}`);
    check(`${game} 이어받아도 진행 점수가 남아 있다`, (again.data.round?.score ?? 0) > 0,
      `score=${again.data.round?.score}`);

    await post("/game/finish", { game_type: game, session_id: sid2 });
  }

  // ── ⑤ 하루 1판 (+ 광고 1회) ────────────────────────────────
  const over = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 하루 한도를 넘으면 시작 불가`, over.data.ok === false,
    `(${over.data.code})`);

  storeShelfRules(game);
  return res;
}

/**
 * 선반 완성 규칙은 서버 왕복으로 확인하기 어렵습니다 — 상자가 무작위라 6개 중 한 코너에
 * 4개가 몰리는 일이 드물고, 하루 1판이라 여러 번 돌려 볼 수도 없습니다.
 * 그래서 이 규칙만 spec 을 직접 호출해 **결정적으로** 검사합니다.
 */
function storeShelfRules(game) {
  const spec = ARCADE_SPECS[game];
  const C = ARCADE[game];
  const drinks = C.ITEMS.filter((i) => i.corner === "drink").slice(0, C.SLOTS);

  const meta = {
    ext: {
      shelves: Object.fromEntries(C.CORNERS.map((c) => [c.key, Array(C.SLOTS).fill(null)])),
      dex: [],
      doneShelves: 0,
      placed: 0,
      score: 0,
      placedThisRun: 0,
      shelvesThisRun: 0,
      newDex: [],
      missed: 0,
      cursor: 0,
      box: drinks.map((i) => i.id),
    },
  };

  const place = (item, slot) =>
    spec.judgeRound({ answer: slot, roundSecret: { itemId: item.id }, meta });

  // 같은 칸에 두 번 — 거부하되 판은 유지
  place(drinks[0], 0);
  const before = meta.ext.cursor;
  const dup = place(drinks[1], 0);
  check(`${game} 이미 찬 칸은 거부`, dup.ok === false && dup.fatal === false,
    `사유=${dup.data?.invalid}`);
  check(`${game} 거부된 배치는 상품을 소모하지 않음`, meta.ext.cursor === before,
    `커서 ${before} → ${meta.ext.cursor}`);

  // 나머지 3칸을 채워 완성시킵니다
  let res = null;
  for (let i = 1; i < C.SLOTS; i++) res = place(drinks[i], i);

  check(`${game} 4칸을 채우면 선반 완성`, res?.data?.completed === true,
    `완성 선반=${res?.data?.done_shelves}줄`);
  check(`${game} 완성하면 그 자리에 새 빈 선반`,
    meta.ext.shelves.drink.every((v) => v == null),
    `남은 칸=${meta.ext.shelves.drink.filter(Boolean).length}`);
  check(`${game} 완성 보너스가 붙는다`,
    res?.data?.points === C.PLACE_POINT + C.DEX_BONUS + C.SHELF_BONUS,
    `마지막 배치 ${res?.data?.points}점 (배치1+도감${C.DEX_BONUS}+완성${C.SHELF_BONUS})`);
  check(`${game} 도감은 상품 종류마다 한 번만`, meta.ext.dex.length === C.SLOTS,
    `도감 ${meta.ext.dex.length}종 / 놓은 상품 ${C.SLOTS}개`);
  check(`${game} 완성 ${C.STAGE_PER_SHELF}줄마다 가게 단계 상승`,
    res?.data?.stage === 1 && stageAt(C, C.STAGE_PER_SHELF) === 2,
    `1줄=${res?.data?.stage}단계 · ${C.STAGE_PER_SHELF}줄=${stageAt(C, C.STAGE_PER_SHELF)}단계`);
}

const stageAt = (C, doneShelves) => 1 + Math.floor(doneShelves / C.STAGE_PER_SHELF);

/**
 * ⑳ 슥슥 긁기 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 긁지 않은 칸의 그림은 내려오지 않고, 힌트는 **색만** 비친다
 *   ② 없는 칸·이미 긁은 칸은 거부하되 긁기를 소모하지 않는다 (꽝 없음의 전제)
 *   ③ 새로고침하면 같은 카드를 이어받고 기회를 다시 쓰지 않는다 (하루 한 장)
 *   ④ 다섯 칸을 다 긁으면 세션이 유지된 채 구원 광고를 기다리고, 보상은 한 칸만 늘린다
 *   ⑤ 순위 지표는 연속 일수이고, 하루 한 장을 넘겨 시작할 수 없다
 *   ⑥ 카드를 더 주는 광고는 없다 (기획서 8장 — 광고는 「한 칸 더」 하나뿐)
 */
async function scratchFlow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  let round = s.data.round;

  const rub = (cell, extra = {}) =>
    post("/game/round", {
      game_type: game,
      session_id: sid,
      answer: { cell, strokes: 24 },
      elapsed_ms: 900,
      ...extra,
    });

  check(`${game} 카드 ${C.CELLS}칸`, (round?.cells ?? []).length === C.CELLS, `${round?.cells?.length}칸`);
  check(`${game} 오늘의 긁기 ${C.SCRATCHES}번`, round?.scratches_left === C.SCRATCHES,
    `left=${round?.scratches_left}`);
  check(`${game} 구원 광고 1회`, s.data.max_boosts === 1, `max_boosts=${s.data.max_boosts}`);
  check(`${game} 제한 시간 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 첫 카드는 첫 주 배정`, round?.rookie === true, `rookie=${round?.rookie}`);

  // ── ① 카드 내용 비노출 ─────────────────────────────────────
  const closed = (round.cells ?? []).filter((c) => !c.open && !c.sure);
  check(`${game} 긁지 않은 칸의 그림 비노출`,
    closed.length > 0 && closed.every((c) => c.icon == null && c.name == null),
    `닫힌 칸 ${closed.length}개`);

  const peeks = (round.cells ?? []).filter((c) => c.peek);
  check(`${game} 힌트는 색만 비친다`,
    peeks.length === C.ROOKIE_HINT_CELLS && peeks.every((c) => !c.icon),
    `힌트 ${peeks.length}칸 · ${peeks.map((c) => c.peek).join(" ")}`);
  check(`${game} 연속 7일 미만은 완전 공개 힌트 없음`,
    (round.cells ?? []).every((c) => !c.sure), `연속=${round?.streak}일`);

  // ── ② 잘못된 입력은 거부하되 긁기를 소모하지 않는다 ─────────
  const bad = await post("/game/round", {
    game_type: game, session_id: sid, answer: { cell: 99, strokes: 24 }, elapsed_ms: 900,
  });
  check(`${game} 없는 칸은 거부하되 판을 끝내지 않음`,
    bad.data.correct === false && bad.data.game_over !== true, `사유=${bad.data.data?.invalid}`);
  check(`${game} 거부는 긁기를 소모하지 않음`,
    bad.data.round?.scratches_left === C.SCRATCHES, `left=${bad.data.round?.scratches_left}`);

  const first = await rub(0);
  check(`${game} 긁으면 그림과 포인트가 온다`,
    first.data.correct === true && first.data.data?.icon != null && first.data.data?.points > 0,
    `${first.data.data?.icon} +${first.data.data?.points}`);
  check(`${game} 꽝 없음 — 긁기는 늘 성공`, first.data.data?.invalid == null);

  const dup = await rub(0);
  check(`${game} 이미 긁은 칸은 거부`, dup.data.correct === false && dup.data.game_over !== true,
    `사유=${dup.data.data?.invalid}`);
  check(`${game} 거부 뒤에도 남은 긁기가 유지된다`,
    dup.data.round?.scratches_left === C.SCRATCHES - 1, `left=${dup.data.round?.scratches_left}`);

  // ── ③ 새로고침 재개 ────────────────────────────────────────
  const again = await post("/game/session/start", { game_type: game });
  check(`${game} 새로고침하면 같은 카드를 이어받는다`,
    again.data.resumed === true && again.data.session_id === sid, `resumed=${again.data.resumed}`);
  check(`${game} 이어받기는 카드를 다시 쓰지 않는다`,
    again.data.attempts?.used === s.data.attempts?.used,
    `used ${s.data.attempts?.used} → ${again.data.attempts?.used}`);
  check(`${game} 이어받아도 긁은 칸이 남아 있다`,
    (again.data.round?.cells ?? []).filter((c) => c.open).length === 1,
    `긁은 칸=${(again.data.round?.cells ?? []).filter((c) => c.open).length}`);

  // ── ④ 다섯 칸 소진 → 구원 광고 ─────────────────────────────
  let last = null;
  const got = [first.data.data];
  for (let i = 1; i < C.CELLS && got.length < C.SCRATCHES; i++) {
    last = await rub(i);
    if (last.data.code) break;
    if (last.data.correct) got.push(last.data.data);
    if (last.data.exhausted || last.data.game_over) break;
  }

  check(`${game} 모든 칸에 포인트가 있다 (꽝 없음)`,
    got.length === C.SCRATCHES && got.every((d) => d.points > 0),
    `${got.map((d) => d.points).join("+")}`);
  check(`${game} 다 긁으면 세션 유지 + 구원 광고 대기`,
    last?.data.exhausted === true && last?.data.game_over === false,
    `can_boost=${last?.data.can_boost}`);

  const extra = await rub(8);
  check(`${game} 소진 후 추가 응답 거부`, extra.data.code === "RUN_EXHAUSTED", `(${extra.data.code})`);

  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 한 칸 더 긁기 보상`,
    boost.data.reward?.lives === 1 && boost.data.reward?.round != null,
    `목숨=${boost.data.reward?.lives}`);
  check(`${game} 보상은 긁기를 한 칸만 늘린다`, boost.data.reward?.round?.scratches_left === 1,
    `left=${boost.data.reward?.round?.scratches_left}`);

  const open = (boost.data.reward?.round?.cells ?? []).find((c) => !c.open);
  const fin = await rub(open?.i ?? 8);
  check(`${game} 긁기를 다 쓰면 종료`, fin.data.game_over === true, `보상 후 ${got.length + 1}칸`);

  const res = fin.data.result;
  check(`${game} 결과 확정`, res?.rank_metric != null, `점수=${res?.score} 리그=${res?.bucket}`);
  if (!res) return;

  const d = fin.data.data ?? {};
  check(`${game} 순위 지표는 연속 긁기 일수`, res.rank_metric === -(d.streak ?? 0) && res.rank_metric === -1,
    `metric=${res.rank_metric} 연속=${d.streak}일`);
  check(`${game} 점수는 획득 포인트`, res.score === d.score && res.score > 0,
    `score=${res.score} 화면=${d.score}`);
  check(`${game} 정상 긁기는 이상치 아님`, res.suspect === false, `suspect=${res.suspect}`);
  check(`${game} 보상 사용 런은 별도 리그`, res.bucket?.endsWith("+") === true, `bucket=${res.bucket}`);

  // ── ⑤·⑥ 하루 한 장 · 카드 추가 광고 없음 ───────────────────
  const over = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 하루 한 장을 넘으면 시작 불가`, over.data.ok === false, `(${over.data.code})`);

  const noAd = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check(`${game} 카드를 더 주는 광고는 없다`, noAd.status === 429, `(${noAd.data.code})`);

  scratchCardRules(game);
  return res;
}

/**
 * 카드 생성·매칭·연속 일수 규칙은 서버 왕복으로 확인할 수 없습니다 —
 * 카드가 무작위라 "같은 그림 3개" 가 나오는 판이 드물고, 하루 한 장이라 여러 번
 * 돌려 볼 수도 없습니다. 그래서 이 규칙만 spec 을 직접 호출해 **결정적으로** 검사합니다.
 */
function scratchCardRules(game) {
  const spec = ARCADE_SPECS[game];
  const C = ARCADE[game];
  const hueOf = (key) => C.SYMBOLS.find((s) => s.key === key)?.hue;

  // ── 카드 구성 (200장) ──────────────────────────────────────
  for (const rookie of [false, true]) {
    const want = rookie ? C.ROOKIE_TARGET_COPIES : C.TARGET_COPIES;
    let bad = null;
    let liar = null;
    for (let t = 0; t < 200 && !bad; t++) {
      const card = makeCard({ rookie, sureHint: false });
      const n = {};
      for (const c of card.cells) n[c.key] = (n[c.key] ?? 0) + 1;

      const reachable = Object.values(n).filter((v) => v >= C.MATCH_NEED);
      if (
        card.cells.length !== C.CELLS ||
        reachable.length !== 1 ||
        reachable[0] !== want ||
        card.cells.some((c) => !(c.points > 0)) ||
        card.hints.length !== (rookie ? C.ROOKIE_HINT_CELLS : C.HINT_CELLS)
      ) {
        bad = { cells: card.cells.length, reachable, hints: card.hints.length };
      }
      // 힌트가 정직한가 — 비친 색은 그 칸의 실제 심볼의 색이어야 합니다
      for (const h of card.hints) {
        if (hueOf(card.cells[h.i].key) !== h.hue) liar = h;
      }
    }
    check(`${game} 카드 구성 (${rookie ? "첫 주" : "일반"})`, bad === null,
      bad ? JSON.stringify(bad) : `3개 도달 가능 심볼 1종 · 타겟 ${want}개 · 꽝 0칸 (200장)`);
    check(`${game} 힌트 색은 실제 심볼의 색 (${rookie ? "첫 주" : "일반"})`, liar === null,
      liar ? JSON.stringify(liar) : "200장 일치");
  }

  const sure = makeCard({ rookie: false, sureHint: true });
  check(`${game} 연속 7일째만 완전 공개 힌트`,
    sure.hints.filter((h) => h.sure).length === 1 &&
      makeCard({ rookie: false, sureHint: false }).hints.every((h) => !h.sure),
    `공개 ${sure.hints.filter((h) => h.sure).length}칸`);

  // ── 매칭 배수 ──────────────────────────────────────────────
  // 손으로 만든 카드입니다. A 만 3개에 도달할 수 있고 나머지는 2개까지입니다
  // (makeCard 가 지키는 규칙과 같은 모양). 칸마다 10점이라 계산이 눈에 보입니다.
  const [A, B, D, E] = C.SYMBOLS.map((s) => s.key);
  const cells = [A, B, A, D, A, B, D, E, E].map((key) => ({ key, points: 10 }));

  const stage = () => ({
    cells,
    meta: {
      ext: {
        day: "2026-07-30", streak: 1, rookie: false, cards: 0, matches: 0, dayBonus: 0,
        hints: [], scratches: C.SCRATCHES, opened: [], base: 0,
        matched: false, matchIcon: null, matchName: null, rough: 0,
      },
    },
  });
  const judge = (st, cell, strokes = 24, elapsedMs = 900) =>
    spec.judgeRound({ answer: { cell, strokes }, elapsedMs, runSecret: { cells: st.cells }, meta: st.meta });

  const st = stage();
  let v = null;
  for (const i of [0, 2, 4]) v = judge(st, i); // A 세 칸 — 매칭 성립
  check(`${game} 같은 그림 ${C.MATCH_NEED}개 → 획득 ${C.MATCH_MULTIPLIER}배`,
    v.data.matched === true && v.data.score === 30 * C.MATCH_MULTIPLIER,
    `기본 ${v.data.base} → ${v.data.score}점`);

  const after = judge(st, 1); // 네 번째 칸
  check(`${game} 매칭은 성립한 순간에만 알린다`, v.data.match === true && after.data.match === false);
  check(`${game} 매칭 뒤에 긁은 칸도 2배로 쌓인다`, after.data.score === 40 * C.MATCH_MULTIPLIER,
    `기본 ${after.data.base} → ${after.data.score}`);

  const closing = judge(st, 3); // 다섯 번째 칸 — 소진
  check(`${game} 다섯 번째 긁기가 판을 닫는다`,
    closing.fatal === true && closing.data.scratches_left === 0 &&
      closing.data.score === 50 * C.MATCH_MULTIPLIER,
    `fatal=${closing.fatal} 점수=${closing.data.score}`);

  // 매칭이 없는 판도 획득분은 전액입니다 (꽝 없음)
  const plain = stage();
  let p = null;
  for (const i of [1, 3, 5, 6, 7]) p = judge(plain, i); // B2 · D2 · E1 — 3개가 없습니다
  check(`${game} 매칭이 없어도 획득분은 전액`, p.data.matched === false && p.data.score === 50,
    `score=${p.data.score}`);
  check(`${game} 매칭 ${C.MATCH_NEED - 1}개에서 멈춘 판을 알아본다`,
    p.data.near?.have === C.MATCH_NEED - 1, `${p.data.near?.name} ${p.data.near?.have}개`);

  // ── 구원 광고 ──────────────────────────────────────────────
  const boosted = stage();
  for (const i of [1, 3, 5, 6, 7]) judge(boosted, i);
  spec.applyBoost(boosted.meta);
  check(`${game} 보상은 긁기를 한 칸만 늘린다`,
    boosted.meta.ext.scratches === C.SCRATCHES + 1 && boosted.meta.lives === 1,
    `긁기 ${boosted.meta.ext.scratches}칸 · 목숨 ${boosted.meta.lives}`);
  check(`${game} 늘어난 칸을 긁을 수 있다`, judge(boosted, 0).ok === true);

  // ── 긁기 궤적 ──────────────────────────────────────────────
  const rough = stage();
  let rv = null;
  for (const i of [0, 1, 2]) rv = judge(rough, i, 1, 20);
  check(`${game} 궤적 없는 긁기는 이상치`, rv.suspect === true,
    `거친 칸 ${rough.meta.ext.rough}/3`);

  const slip = stage();
  judge(slip, 0, 1, 20);
  check(`${game} 한 번 미끄러진 것은 이상치 아님`, judge(slip, 1).suspect === false,
    `거친 칸 ${slip.meta.ext.rough}/2`);

  // ── 연속 긁기 일수 ────────────────────────────────────────
  check(`${game} 어제 긁었으면 연속 +1`,
    streakFor({ lastDay: "2026-07-29", streak: 3 }, "2026-07-30") === 4);
  check(`${game} 하루라도 건너뛰면 연속 1`,
    streakFor({ lastDay: "2026-07-28", streak: 9 }, "2026-07-30") === 1);
  check(`${game} 같은 날 두 번째 판은 연속을 두 번 세지 않음`,
    streakFor({ lastDay: "2026-07-30", streak: 5 }, "2026-07-30") === 5);
  check(`${game} 첫 방문은 연속 1`, streakFor({ lastDay: null, streak: 0 }, "2026-07-30") === 1);
  check(`${game} 달을 넘겨도 어제를 안다`, shiftDay("2026-08-01", -1) === "2026-07-31",
    `2026-08-01 의 어제=${shiftDay("2026-08-01", -1)}`);
}

async function basketFlow(game) {
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `목숨=${s.data.lives} 보상=0/${s.data.max_boosts}`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  let round = s.data.round;

  check(`${game} 제한 시간 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 시도 3회로 시작`, round?.tries_left === 3, `tries_left=${round?.tries_left}`);

  // ── 해가 반드시 존재해야 합니다 ─────────────────────────────
  const solution = findCombo(round.items, round.target, round.tolerance);
  check(`${game} 목표 금액에 해가 존재`, solution != null,
    `목표=${round.target} 상품=${round.items.length}개`);
  if (!solution) return;

  // ── 일부러 틀리기: 해가 아닌 조합을 만들어 시도를 깎습니다 ──
  const wrong = round.items.map((_, i) => i).filter((i) => !solution.includes(i)).slice(0, 1);
  const miss1 = await post("/game/round", { game_type: game, session_id: sid, answer: wrong });
  check(`${game} 빗나가면 시도만 줄고 판은 유지`,
    miss1.data.correct === false && miss1.data.game_over !== true && miss1.data.data?.tries_left === 2,
    `tries_left=${miss1.data.data?.tries_left} game_over=${miss1.data.game_over}`);
  check(`${game} 같은 문제를 다시 발급`, miss1.data.round?.target === round.target,
    `target=${miss1.data.round?.target}`);

  // ── 정답 조합으로 통과 ──────────────────────────────────────
  const okRes = await post("/game/round", { game_type: game, session_id: sid, answer: solution });
  check(`${game} 정답 조합이면 통과`, okRes.data.correct === true,
    `합계=${okRes.data.data?.sum} 오차=${okRes.data.data?.gap}`);
  check(`${game} 첫 시도 아님 → 보너스 없음`, okRes.data.data?.first_try === false,
    `first_try=${okRes.data.data?.first_try}`);

  round = okRes.data.round;
  check(`${game} 다음 라운드는 새 문제`, round?.tries_left === 3 && round?.round === 2,
    `round=${round?.round} tries=${round?.tries_left}`);

  // ── 시도 3회를 모두 빗나가면 목숨 소진 → 이어하기 제안 ─────
  const sol2 = findCombo(round.items, round.target, round.tolerance);
  check(`${game} 2라운드도 해가 존재`, sol2 != null, `목표=${round.target}`);
  const bad = round.items.map((_, i) => i).filter((i) => !(sol2 ?? []).includes(i)).slice(0, 1);
  let last = null;
  for (let i = 0; i < 3; i++) {
    last = await post("/game/round", { game_type: game, session_id: sid, answer: bad });
    if (last.data.exhausted || last.data.game_over) break;
  }
  check(`${game} 시도 소진 시 세션 유지(이어하기 가능)`,
    last?.data.exhausted === true && last?.data.game_over === false,
    `exhausted=${last?.data.exhausted} can_boost=${last?.data.can_boost}`);

  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 보상으로 시도 1회 복구 + 상품 교체`,
    boost.data.reward?.data?.tries_left === 1 && boost.data.reward?.data?.swapped != null,
    `tries=${boost.data.reward?.data?.tries_left} 교체=${boost.data.reward?.data?.swapped?.name}`);

  const after = boost.data.reward?.round;
  const sol3 = after ? findCombo(after.items, after.target, after.tolerance) : null;
  check(`${game} 교체 후에도 해가 존재`, sol3 != null, `목표=${after?.target}`);

  // ── 보상 2회를 모두 소진시켜야 런이 끝납니다 ────────────────
  // 맞히면 런이 이어지므로, 결과를 보려면 남은 보상까지 전부 쓰고 다시 빗나가야 합니다.
  const miss2 = await post("/game/round", { game_type: game, session_id: sid, answer: [] });
  check(`${game} 보상 1회 남았으면 아직 끝나지 않음`,
    miss2.data.exhausted === true && miss2.data.game_over === false,
    `boosts=${miss2.data.boosts}/${miss2.data.max_boosts}`);

  const boost2 = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 보상 2회차 적용`, boost2.data.reward?.boosts === 2,
    `boosts=${boost2.data.reward?.boosts}/${boost2.data.reward?.max_boosts}`);

  const fin = await post("/game/round", { game_type: game, session_id: sid, answer: [] });
  const res = fin.data.result;
  check(`${game} 보상 소진 후 결과 확정`, fin.data.game_over === true && res != null,
    `game_over=${fin.data.game_over}`);
  if (!res) return;

  check(`${game} 보상 사용 런은 별도 리그`, res.bucket === "all+", `bucket=${res.bucket}`);
  check(`${game} 점수는 통과 라운드의 누적`, typeof res.score === "number" && res.score > 0,
    `score=${res.score} cleared=${res.cleared}`);

  const over = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 런당 보상 2회 제한`, over.data.ok === false, `(${over.data.code})`);
}

async function majorityFlow(game) {
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `목숨=${s.data.lives} 보상=0/${s.data.max_boosts}`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  check(`${game} 보기 2개 제시`, s.data.round?.options?.length === 2,
    `문항="${s.data.round?.prompt}"`);

  const sid = s.data.session_id;

  // ── 시간 초과는 확실한 오답 ──────────────────────────────────
  const miss = await post("/game/round", { game_type: game, session_id: sid, answer: null, timeout: true });
  check(`${game} 시간 초과는 오답`, miss.data.ok === true && miss.data.correct === false,
    `envelope.ok=${miss.data.ok} correct=${miss.data.correct}`);
  check(`${game} 목숨 소진 시 세션 유지`, miss.data.exhausted === true && miss.data.game_over === false,
    `can_boost=${miss.data.can_boost}`);

  const extraAnswer = await post("/game/round", { game_type: game, session_id: sid, answer: 0 });
  check(`${game} 소진 후 추가 응답 거부`, extraAnswer.data.code === "RUN_EXHAUSTED",
    `(${extraAnswer.data.code})`);

  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 되돌리기로 새 문항 발급`,
    boost.data.reward?.lives === 1 && boost.data.reward?.round?.options?.length === 2,
    `목숨=${boost.data.reward?.lives} 문항=${boost.data.reward?.round?.no}`);

  // ── 남은 문항을 실제로 풀어 봅니다 ──────────────────────────
  // 맞을지 틀릴지는 집계에 달려 있으므로, 결과가 어느 쪽이든 흐름이 끝까지 가는지 봅니다.
  let over = null;
  let boosts = 1;
  let revealed = 0;
  let counting = 0;

  for (let i = 0; i < 8 && !over; i++) {
    const r = await post("/game/round", { game_type: game, session_id: sid, answer: i % 2 });
    if (r.data.code) break;

    const d = r.data.data ?? {};
    if (d.basis === "none") counting++;
    else if (typeof d.pct === "number" && d.sample > 0) revealed++;

    if (r.data.game_over) { over = r.data.result; break; }

    if (r.data.exhausted) {
      const more = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
      if (more.status !== 200) break; // 되돌리기 한도 소진 → 아래에서 finish
      boosts++;
    }
  }

  check(`${game} 판정 응답에 집계 근거 포함`, revealed + counting > 0,
    `비율 공개 ${revealed}건 · 집계 중 ${counting}건`);

  if (!over) {
    const fin = await post("/game/finish", { game_type: game, session_id: sid });
    over = fin.data.result;
  }

  check(`${game} 결과 확정`, over?.rank_metric != null,
    `점수=${over?.score} 적중=${over?.cleared} 리그=${over?.bucket} TOP ${over?.rank_pct}%`);
  check(`${game} 점수와 순위 지표가 일치`, over?.rank_metric === -(over?.score ?? 0),
    `metric=${over?.rank_metric} score=${over?.score}`);
  check(`${game} 보상 사용 런은 별도 리그`, over?.bucket === "all+", `bucket=${over?.bucket} (되돌리기 ${boosts}회)`);

  const reuse = await post("/game/round", { game_type: game, session_id: sid, answer: 0 });
  check(`${game} 종료된 세션 재사용 차단`, reuse.status === 409, `(${reuse.data.code})`);

  return over;
}

/** 통계·랭킹은 전면 광고 시청 후에만 열립니다 */
async function statsGate(game, result) {
  const locked = await get(`/game/stats?game=${game}`);
  check(`${game} 통계 잠금`, locked.status === 403 && locked.data.code === "AD_REQUIRED", `(${locked.data.code})`);

  const ad = await post("/ad/reward", { trigger: `${game}_STATS` });
  check(`${game} 전면 광고`, ad.data.ok === true && ad.data.ad_type === "INTERSTITIAL");

  const open = await get(`/game/stats?game=${game}`);
  check(`${game} 통계 열람`, open.data.ok === true,
    `분포=${open.data.distribution?.count ?? 0}건 리그=${open.data.leagues?.length ?? 0}개`);

  const rank = await get(`/game/rank?game=${game}&bucket=${encodeURIComponent(result?.bucket ?? "")}`);
  check(`${game} 순위 조회`, rank.data.ok === true, `TOP=${rank.data.list?.length ?? 0}`);

  // 이상치 판은 개인 최고 기록으로 남지 않아야 합니다
  if (result?.suspect) {
    const st = await get(`/user/attempts?game=${game}&bucket=${encodeURIComponent(result.bucket)}`);
    check(`${game} 이상치는 최고 기록 제외`, st.data.my_best == null, `my_best=${st.data.my_best}`);
    check(`${game} 이상치는 신기록 아님`, result.is_best === false);
  }
}

async function arcadeFlows() {
  console.log("\n[2] 아케이드 공통 흐름");

  let i = 0;
  for (const [game, spec] of Object.entries(ARCADE_SPECS)) {
    const player = PLAYERS[game];
    if (!player) continue; // 커버리지 누락은 [1] 에서 이미 실패로 기록됩니다

    console.log(`\n  ── ${game} (${ARCADE[game].label}) ──`);
    useIp(testIp(40 + i++)); // 게임마다 다른 IP — 서로의 광고 한도를 먹지 않게

    try {
      const result = player.custom
        ? await player.custom(game)
        : spec.mode === "ENDLESS"
          ? await endlessFlow(game, spec)
          : await batchFlow(game);
      await statsGate(game, result);
    } catch (err) {
      failures.push(`${game} 예외`);
      console.log(`  FAIL ${game} 예외: ${err.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 3) 공통 규칙 · 한도
// ══════════════════════════════════════════════════════════════

async function commonRules() {
  console.log("\n[3] 공통 규칙 · 한도");
  useIp(testIp(80));

  const badGame = await post("/game/session/start", { game_type: "NOPE" });
  check("없는 게임 거부", badGame.data.code === "BAD_PARAM");

  const badSession = await post("/game/round", { game_type: "ODDCOLOR", session_id: "not-a-uuid", answer: 0 });
  check("잘못된 세션 ID 거부", badSession.data.code === "BAD_SESSION");

  const wrongMode1 = await post("/game/round", { game_type: "MATHRUSH", session_id: "x", answer: 0 });
  check("BATCH 게임은 /game/round 불가", wrongMode1.data.code === "BAD_PARAM");
  const wrongMode2 = await post("/game/submit", { game_type: "ODDCOLOR", session_id: "x" });
  check("ENDLESS 게임은 /game/submit 불가", wrongMode2.data.code === "BAD_PARAM");

  const cfg = await get("/game/config");
  check("config 아케이드 노출", Object.keys(cfg.data.arcade ?? {}).length === Object.keys(ARCADE).length);
  check("config 난이도 계수 비노출", JSON.stringify(cfg.data.arcade).includes("DELTA_START") === false);
  check("config 오리지널 4종 유지",
    ["stopwatch", "baseball", "typing", "memory"].every((k) => cfg.data[k] != null));

  // 시간 조작 — 두 단계로 걸립니다
  const s = await post("/game/session/start", { game_type: "STROOP", fresh: true });

  // ① 애초에 시간일 수 없는 값 (상한 초과) → 형태 검사에서 거부
  const insane = await post("/game/submit", {
    game_type: "STROOP", session_id: s.data.session_id, answers: ["red"], times: [500], elapsed_ms: 9_000_000,
  });
  check("비현실적으로 긴 시간 거부", insane.data.code === "BAD_PARAM", `(${insane.data.code})`);

  // ② 형태는 정상이지만 서버가 관측한 시간창을 넘는 값 → 시간창 검사에서 거부
  const tampered = await post("/game/submit", {
    game_type: "STROOP", session_id: s.data.session_id, answers: ["red"], times: [500], elapsed_ms: 200_000,
  });
  check("신고 시간 부풀리기 거부", tampered.data.code === "TIME_TAMPERED", `(${tampered.data.code})`);

  const mismatch = await post("/game/submit", {
    game_type: "STROOP", session_id: s.data.session_id, answers: ["red", "blue"], times: [500], elapsed_ms: 1000,
  });
  check("답안/시간 길이 불일치 거부", mismatch.data.code === "BAD_PARAM");

  // 런당 보상 한도
  useIp(testIp(81));
  const run = await post("/game/session/start", { game_type: "SEQUENCE", fresh: true });
  const limit = ARCADE.SEQUENCE.boostsPerRun;
  let blocked = null;
  for (let i = 1; i <= limit + 1; i++) {
    const r = await post("/ad/reward", { trigger: "SEQUENCE_BOOST", session_id: run.data.session_id });
    if (r.status === 429) { blocked = i; break; }
  }
  check(`런당 보상 ${limit}회 제한`, blocked === limit + 1, `${blocked}번째에서 차단`);
  await post("/game/finish", { game_type: "SEQUENCE", session_id: run.data.session_id });

  // 일일 도전 기회 + 광고 충전 한도
  useIp(testIp(82));
  const game = "RINGSTOP";
  for (let i = 0; i < ARCADE[game].baseAttempts + 2; i++) {
    const r = await post("/game/session/start", { game_type: game, fresh: true });
    if (r.data.code === "NO_ATTEMPTS") break;
    await post("/game/finish", { game_type: game, session_id: r.data.session_id });
  }
  const dry = await post("/game/session/start", { game_type: game, fresh: true });
  check("일일 기회 소진", dry.data.code === "NO_ATTEMPTS");

  const grant = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check("광고로 기회 +1", grant.data.reward?.amount === 1, `남은=${grant.data.reward?.attempts.remaining}`);

  for (let i = 0; i < ARCADE[game].adAttemptsPerDay + 1; i++) {
    await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  }
  const over = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check("일일 광고 한도 강제", over.status === 429, `(${over.data.code})`);

  // 동일 IP 한도
  useIp(testIp(240)); // 이 검사가 IP 한도를 실제로 소진시킵니다
  let ipBlocked = null;
  for (let i = 1; i <= 24; i++) {
    const r = await post("/ad/reward", { trigger: "SEQUENCE_STATS" });
    if (r.status === 429 && r.data.code === "IP_AD_LIMIT") { ipBlocked = i; break; }
  }
  check("동일 IP 일일 광고 20회 제한", ipBlocked === 21, `${ipBlocked}번째에서 차단`);

  // 새로고침 복구 — 기회를 더 쓰지 않아야 합니다
  useIp(testIp(83));
  const a = await post("/game/session/start", { game_type: "COUNTDOT", fresh: true });
  const used1 = (await get("/user/attempts?game=COUNTDOT")).data.attempts.used;
  const b = await post("/game/session/start", { game_type: "COUNTDOT" });
  const used2 = (await get("/user/attempts?game=COUNTDOT")).data.attempts.used;
  check("새로고침 시 같은 런 복구", b.data.session_id === a.data.session_id && b.data.resumed === true);
  check("복구는 기회를 쓰지 않음", used1 === used2, `used ${used1}→${used2}`);
  await post("/game/finish", { game_type: "COUNTDOT", session_id: a.data.session_id });
}

// ══════════════════════════════════════════════════════════════
// 4) 오리지널 4종 회귀
// ══════════════════════════════════════════════════════════════

async function classicRegression() {
  console.log("\n[4] 오리지널 4종 회귀");
  useIp(testIp(90));

  // ① 스탑워치
  const sw = await post("/game/session/start", { game_type: "STOPWATCH" });
  check("① 시작", sw.data.ok === true, `목표=${sw.data.target_ms}ms`);
  await post("/game/session/arm", { game_type: "STOPWATCH", session_id: sw.data.session_id });
  const t0 = Date.now();
  await sleep(sw.data.target_ms);
  const el = Date.now() - t0;
  const swr = await post("/game/session/stop", { session_id: sw.data.session_id, elapsed_ms: el });
  check("① 기록", swr.data.ok === true, `오차=${swr.data.gap_ms}ms TOP ${swr.data.rank_pct}%`);
  const swBad = await post("/game/session/start", { game_type: "STOPWATCH" });
  const swTamper = await post("/game/session/stop", { session_id: swBad.data.session_id, elapsed_ms: 29000 });
  check("① 시간 조작 거부", swTamper.data.code === "TIME_TAMPERED");

  // ② 숫자야구
  const bb = await post("/game/session/start", { game_type: "BASEBALL", fresh: true });
  check("② 시작", bb.data.ok === true, `기회=${bb.data.attempts_left}`);
  check("② 정답 비노출", JSON.stringify(bb.data).includes("answer") === false);
  const dup = await post("/game/guess", { session_id: bb.data.session_id, guess: "112" });
  check("② 중복 숫자 거부", dup.data.code === "DUPLICATE_DIGIT");
  const g1 = await post("/game/guess", { session_id: bb.data.session_id, guess: "012" });
  check("② S/B 판정", g1.data.ok === true, `${g1.data.strikes}S ${g1.data.balls}B`);
  const give = await post("/game/giveup", { session_id: bb.data.session_id });
  check("② 포기 시 정답 공개", typeof give.data.answer === "string" && give.data.answer.length === 3);

  // ③ 타이핑
  const ty = await post("/game/session/start", { game_type: "TYPING", lang: "ko", difficulty: "easy" });
  check("③ 시작", ty.data.ok === true, `${ty.data.char_count}자 지표=${ty.data.primary_metric}`);
  await post("/game/session/arm", { game_type: "TYPING", session_id: ty.data.session_id });
  const playMs = Math.max(3000, ty.data.text.length * 220);
  await sleep(playMs);
  const tyr = await post("/game/submit", {
    game_type: "TYPING", session_id: ty.data.session_id, typed_text: ty.data.text, elapsed_ms: playMs,
  });
  check("③ 서버 재채점 정확도 100%", tyr.data.accuracy === 100, `CPM=${tyr.data.cpm} 점수=${tyr.data.score}`);
  // en:hard 는 12단어 이상이라 1초 제출 시 600 WPM 을 넘습니다
  const tyFast = await post("/game/session/start", { game_type: "TYPING", lang: "en", difficulty: "hard" });
  const abnormal = await post("/game/submit", {
    game_type: "TYPING", session_id: tyFast.data.session_id, typed_text: tyFast.data.text, elapsed_ms: 1000,
  });
  check("③ 비정상 속도 차단", abnormal.data.ok === false, `(${abnormal.data.code})`);

  // ④ 숫자 기억력
  const lv = await get("/game/levels");
  check("④ 레벨 목록", lv.data.levels?.length === 10);
  const me = await post("/game/session/start", { game_type: "MEMORY", level: 1 });
  check("④ LV1 시작", me.data.ok === true, `자리수=${me.data.digit_count}`);
  const mer = await post("/game/submit", {
    game_type: "MEMORY", session_id: me.data.session_id, input: me.data.digits,
  });
  check("④ 채점", mer.data.cleared === true, `${mer.data.correct_count}/${mer.data.digit_count}`);
  const locked = await post("/game/session/start", { game_type: "MEMORY", level: 5 });
  check("④ 상위 레벨 도전권 요구", locked.data.code === "AD_REQUIRED");
}

// ══════════════════════════════════════════════════════════════

console.log(`대상: ${BASE}`);
console.log(`등록된 아케이드 게임: ${Object.keys(ARCADE_SPECS).length}종`);

try {
  await get("/game/config");
} catch {
  console.error(`\n서버에 연결할 수 없습니다: ${BASE}\n먼저 다른 터미널에서 'npm run dev' 를 실행해 주세요.`);
  process.exit(1);
}

contractChecks();
await arcadeFlows();
await commonRules();
await classicRegression();

console.log("\n" + "=".repeat(60));
if (failures.length === 0) {
  console.log(`통과 ${pass} · 실패 0`);
} else {
  console.log(`통과 ${pass} · 실패 ${failures.length}`);
  console.log("\n실패 항목:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length > 0 ? 1 : 0);
