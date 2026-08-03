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
// ㉘ 톡톡 — 궤적 판정은 속도·균일함의 경계값이 핵심이라 서버 왕복 없이 직접 부릅니다
import { gradeStroke } from "../src/games/arcade/toktok.js";
// ㉚ 쭉 — 「어떤 속도가 유리한가」는 요청을 실제 속도로 보내야 재현되므로 직접 부릅니다
import { simulate as simulateStretch } from "../src/games/arcade/stretch.js";
// ㉙ 소등 — 방 채점은 시간이 실제로 흘러야 재현되므로 경계값만 직접 부릅니다
import { gradeRoom, makeRoom } from "../src/games/arcade/lightout.js";

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
    // 광고 소재 세트가 걸리면 색 배열 대신 밝기 배열이 옵니다(AD_SETS). 어느 쪽이든
    // 「빈도가 1인 값」이 정답이라는 규칙은 같으므로 같은 눈으로 봅니다.
    answer: (round, correct) => {
      const cells = round.colors ?? round.tints;
      const i = oddIndex(cells);
      return { answer: correct ? i : (i + 1) % cells.length };
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

  DETECTIVE: {
    // 실패가 없고(lives 0) 사건 5건으로 끝나며 미해결이 다음 날로 넘어갑니다 → 전용 시나리오
    custom: detectiveFlow,
    // 바뀌기 전·후 장면을 둘 다 그려야 하므로 공개가 불가피합니다 (⑦ 과 같은 제약)
    publicFields: ["icons", "after"],
  },

  RHYTHM: {
    // 패턴(간격 배열)은 빛으로 재생해야 하므로 공개가 불가피합니다
    publicFields: ["gaps"],
    answer: (round, correct) => {
      // 첫 탭을 0 으로 두고 간격을 누적합니다 — 판정은 상대 간격만 봅니다
      const taps = [0];
      round.gaps.forEach((g, i) => {
        const err = correct ? 0 : i === 0 ? round.tol_ms + 200 : 0;
        taps.push(taps[taps.length - 1] + g + err);
      });
      return { answer: { taps } };
    },
  },

  BALANCE: {
    answer: (round, correct) => {
      // 토크 = Σ(무게 × 위치). 상쇄하는 위치가 정답이고, 같은 쪽으로 놓으면 더 기웁니다
      const cancel = Math.max(-round.arm, Math.min(round.arm, -round.torque / round.drop_w));
      const worse = round.torque < 0 ? -round.arm : round.arm;
      return { answer: { pos: Number((correct ? cancel : worse).toFixed(2)) } };
    },
  },

  POUR: {
    // 하루 1잔 · 실패 없음 · 조작이 누름 지속이라 전용 시나리오를 씁니다
    custom: pourFlow,
  },

  MERGE3: {
    // 합체하지 못한 것은 실패가 아니고 기둥 초과만 판을 끝내므로 전용 시나리오를 씁니다
    custom: merge3Flow,
  },

  GAUGE: {
    // 사용자 간 공용 전역 카운터를 쓰는 게임이라 전용 시나리오를 씁니다
    custom: gaugeFlow,
  },

  TOKTOK: {
    // 라운드 = 한 번의 훑기라 "정답/오답" 이 없습니다 — 정상 훑기는 늘 성공이고 늘 소진입니다.
    // 경로 인접성 검사와 균일함(매크로) 검사가 이 게임의 전부라 전용 시나리오를 씁니다
    custom: toktokFlow,
  },

  LIGHTOUT: {
    // 라운드 = 방 하나. 실패가 없고 「어제보다 느렸을 때만 광고」라 전용 시나리오를 씁니다
    custom: lightoutFlow,
  },

  STRETCH: {
    // 라운드 = 한 번의 끌기. 끊어짐이 손상 모형의 결과라 전용 시나리오를 씁니다
    custom: stretchFlow,
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
 * ㉘ 톡톡 — 전용 시나리오
 *
 * 이 게임에는 오답이 없습니다. 정상적인 훑기는 늘 성공이고, 손을 뗀 것이 곧 소진이라
 * 라운드 하나가 판 하나입니다. 그래서 공통 endlessFlow(정답 3연속 → 오답)를 쓸 수 없습니다.
 *
 * 확인하는 것
 *   ① 살짝 닿았다 뗀 것(0개)으로 판이 끝나지 않는다
 *   ② 이웃하지 않은 칸으로 건너뛴 경로는 **그 자리에서 잘린다**
 *   ③ 판 밖으로 나갔다 돌아온 이음매(-1)는 터짐이 아니지만 경로를 잇는다
 *   ④ 이어하기가 연속 수를 그대로 유지한다 (기획서 8장)
 *   ⑤ 상품 뽁뽁이는 서버 스케줄대로만 나온다
 *   ⑥ 간격이 완벽히 균일하면(매크로) 이상치로 표시된다
 */

/** 격자를 지그재그로 훑는 경로 — 이웃 칸끼리만 이어집니다 */
function toktokPath(cols, rows, n, gapOf) {
  const cells = [];
  const times = [];
  let t = 0;
  for (let r = 0; r < rows && cells.length < n; r++) {
    for (let k = 0; k < cols && cells.length < n; k++) {
      cells.push(r * cols + (r % 2 === 0 ? k : cols - 1 - k));
      times.push(t);
      t += gapOf(cells.length);
    }
  }
  return { cells, times };
}

/** 사람 손가락처럼 흔들리는 간격 (등속 검사에 걸리지 않아야 합니다) */
const humanGap = (i) => 70 + ((i * 37) % 60);

async function toktokFlow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;

  const stroke = (cells, times) =>
    post("/game/round", {
      game_type: game,
      session_id: sid,
      answer: { cells, times },
      elapsed_ms: times[times.length - 1] ?? 0,
    });

  check(`${game} 판 ${C.COLS}×${C.ROWS}`,
    s.data.round?.cols === C.COLS && s.data.round?.rows === C.ROWS,
    `${s.data.round?.cols}×${s.data.round?.rows}`);
  check(`${game} 제한 시간 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 이어하기 ${C.boostsPerRun}회`, s.data.max_boosts === C.boostsPerRun,
    `max_boosts=${s.data.max_boosts}`);
  check(`${game} 오늘의 포장이 붙는다`, s.data.round?.pack?.hex != null,
    `${s.data.round?.pack?.name}`);
  check(`${game} 상품 순번을 미리 준다`, (s.data.round?.prizes ?? []).length > 0,
    `첫 상품 ${s.data.round?.prizes?.[0]?.at}번째`);

  // ── ① 0개 스트로크는 판을 끝내지 않는다 ────────────────────
  const empty = await stroke([], []);
  check(`${game} 닿기만 한 것은 판정하지 않는다`,
    empty.data.correct === false && empty.data.game_over !== true && empty.data.exhausted !== true,
    `사유=${empty.data.data?.invalid}`);

  // ── ② 이웃하지 않은 칸으로 건너뛰면 거기서 잘린다 ──────────
  const jump = await stroke([0, 1, 2, 5 * C.COLS, 5 * C.COLS + 1], [0, 90, 180, 270, 360]);
  check(`${game} 끊긴 경로는 그 자리에서 잘린다`, jump.data.data?.stroke_pops === 3,
    `인정 ${jump.data.data?.stroke_pops}개 / 신고 5개`);
  check(`${game} 손을 떼면 세션 유지 + 이어하기 대기`,
    jump.data.exhausted === true && jump.data.game_over === false,
    `can_boost=${jump.data.can_boost}`);

  const extra = await stroke([0, 1], [0, 90]);
  check(`${game} 소진 후 추가 응답 거부`, extra.data.code === "RUN_EXHAUSTED", `(${extra.data.code})`);

  // ── ④ 이어하기는 연속 수를 그대로 유지한다 ─────────────────
  const boost1 = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  const r1 = boost1.data.reward;
  check(`${game} 이어하기 보상이 유효`, r1?.lives === 1 && r1?.round != null, `목숨=${r1?.lives}`);
  check(`${game} 이어해도 기록은 그대로`, r1?.round?.pops === 3, `pops=${r1?.round?.pops}`);

  // ── ⑤ 상품은 서버 스케줄대로만 ─────────────────────────────
  // 간격 표본이 균일함 검사의 하한을 넘도록 충분히 길게 훑습니다 — 사람처럼 흔들리는
  // 간격이라 이상치로 찍히지 않아야 합니다(이 검사의 반대편이 아래 ⑥ 입니다).
  const N = C.UNIFORM_MIN_GAPS + 2;
  const long = toktokPath(C.COLS, C.ROWS, N, humanGap);
  const wantPrizes = (r1?.round?.prizes ?? []).filter((p) => p.at <= N).length;
  const second = await stroke(long.cells, long.times);
  check(`${game} ${N}칸을 이어 터뜨린다`, second.data.data?.stroke_pops === N,
    `${second.data.data?.stroke_pops}개`);
  check(`${game} 연속이 이어진다`, second.data.data?.pops === 3 + N, `pops=${second.data.data?.pops}`);
  check(`${game} 상품은 서버 스케줄과 일치`,
    (second.data.data?.prizes ?? []).length === wantPrizes,
    `${second.data.data?.prizes?.length}개 (예상 ${wantPrizes}개)`);

  // ── ③ 판 밖으로 나갔다 돌아온 이음매 ───────────────────────
  const boost2 = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 이어하기 2회차`, boost2.data.reward?.boosts === 2, `${boost2.data.reward?.boosts}회`);

  const seam = await stroke([0, 1, -1, 5 * C.COLS, 5 * C.COLS + 1], [0, 90, 200, 300, 390]);
  check(`${game} 이음매는 터짐이 아니지만 경로를 잇는다`, seam.data.data?.stroke_pops === 4,
    `인정 ${seam.data.data?.stroke_pops}개`);
  check(`${game} 이어하기를 다 쓰면 종료`, seam.data.game_over === true,
    `boosts=${boost2.data.reward?.boosts}/${C.boostsPerRun}`);

  const res = seam.data.result;
  check(`${game} 결과 확정`, res?.rank_metric != null, `점수=${res?.score} 리그=${res?.bucket}`);
  if (!res) return;

  check(`${game} 점수는 이어 터뜨린 개수`, res.score === 3 + N + 4, `score=${res.score} (3+${N}+4)`);
  check(`${game} 순위 지표에 속도 보정이 없다`, res.rank_metric === -(3 + N + 4),
    `metric=${res.rank_metric}`);
  check(`${game} 정상 훑기는 이상치 아님`, res.suspect === false, `suspect=${res.suspect}`);
  check(`${game} 보상 사용 런은 별도 리그`, res.bucket?.endsWith("+") === true, `bucket=${res.bucket}`);

  // ── ⑥ 등속은 매크로 ────────────────────────────────────────
  const macro = await post("/game/session/start", { game_type: game, fresh: true });
  const flat = toktokPath(C.COLS, C.ROWS, C.UNIFORM_MIN_GAPS + 1, () => 80);
  await post("/game/round", {
    game_type: game,
    session_id: macro.data.session_id,
    answer: { cells: flat.cells, times: flat.times },
    elapsed_ms: flat.times[flat.times.length - 1],
  });
  const macroEnd = await post("/game/finish", { game_type: game, session_id: macro.data.session_id });
  check(`${game} 등속으로 훑으면 이상치`, macroEnd.data.result?.suspect === true,
    `간격 ${C.UNIFORM_MIN_GAPS}개가 전부 80ms`);

  await toktokLongStroke(game);
  toktokStrokeRules(game);
  return res;
}

/**
 * 손을 떼지 않는 긴 훑기 — 조각으로 나눠 보낸다.
 *
 * **PC 마우스 확인에서 나온 결함의 회귀 검사입니다.** 마우스에는 손목 제약이 없어
 * 훑기가 몇 분이고 이어지는데, 초안은 그 훑기를 한 번에 받으려다 조각 상한(MAX_POPS)
 * 에서 잘랐습니다 — **화면 2000개가 400개로 기록됐습니다.**
 * 이제 손을 떼지 않아도 조각(`ongoing: true`)을 보내고, 조각은 판을 끝내지 않습니다.
 */
async function toktokLongStroke(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  if (!s.data.ok) {
    check(`${game} 긴 훑기 시작`, false, `(${s.data.code})`);
    return;
  }
  const sid = s.data.session_id;

  /** 판 안에서 튕겨 다니는 훑기 — 격자를 다 돌아도 멈추지 않습니다(대각선이라 늘 이웃 칸) */
  const walk = (n) => {
    const cells = [];
    const times = [];
    let c = 0, r = 0, dc = 1, dr = 1, t = 0;
    for (let i = 0; i < n; i++) {
      cells.push(r * C.COLS + c);
      times.push(t);
      t += 20 + ((i * 7) % 9); // 사람처럼 흔들리는 간격 · 초당 약 42칸
      let nc = c + dc;
      if (nc < 0 || nc >= C.COLS) { dc = -dc; nc = c + dc; }
      let nr = r + dr;
      if (nr < 0 || nr >= C.ROWS) { dr = -dr; nr = r + dr; }
      c = nc; r = nr;
    }
    return { cells, times };
  };

  const seg = async (n, ongoing) => {
    const { cells, times } = walk(n);
    // 신고한 시각이 서버가 관측한 시간창 안이어야 합니다 — 화면은 실시간으로
    // 보내지만 테스트는 즉시 보내므로 그만큼 기다립니다.
    await sleep(1200);
    return post("/game/round", {
      game_type: game,
      session_id: sid,
      answer: { cells, times, ongoing },
      elapsed_ms: times[times.length - 1],
    });
  };

  // 화면이 FLUSH_AT 개마다 보내는 조각 세 개 — 손은 아직 붙어 있습니다
  let last = null;
  for (let i = 0; i < 3; i++) last = await seg(C.FLUSH_AT, true);
  const total = C.FLUSH_AT * 3;

  check(`${game} 조각은 판을 끝내지 않는다`,
    last.data.game_over === false && last.data.exhausted !== true,
    `lives=${last.data.lives}`);
  check(`${game} 조각이 누적된다`, last.data.data?.pops === total,
    `${last.data.data?.pops}개 (조각 3 × ${C.FLUSH_AT})`);
  check(`${game} 조각 상한(${C.MAX_POPS})보다 많이 이어 터뜨릴 수 있다`,
    (last.data.data?.pops ?? 0) > C.MAX_POPS, `${last.data.data?.pops}개`);

  // 손을 뗍니다 — 마지막 조각이 비어 있어도 판이 끝나야 합니다
  const done = await post("/game/round", {
    game_type: game, session_id: sid, answer: { cells: [], times: [], ongoing: false }, elapsed_ms: 0,
  });
  check(`${game} 손을 떼면 빈 조각이어도 판이 끝난다`,
    done.data.exhausted === true || done.data.game_over === true,
    `exhausted=${done.data.exhausted}`);
  check(`${game} 조각을 가로질러 한 번의 훑기로 센다`,
    done.data.data?.best_stroke === total && done.data.data?.strokes === 1,
    `한 번에 최다=${done.data.data?.best_stroke} 훑은 횟수=${done.data.data?.strokes}`);

  const fin = await post("/game/finish", { game_type: game, session_id: sid });
  const r = fin.data.result;
  check(`${game} 화면이 센 개수가 그대로 기록된다`, r?.score === total,
    `기록=${r?.score} 화면=${total}`);
  check(`${game} 긴 훑기는 이상치가 아니다`, r?.suspect === false, `suspect=${r?.suspect}`);
}

/**
 * 궤적 판정의 경계값 — 서버 왕복으로는 재현이 어려워 gradeStroke 를 직접 부릅니다.
 *
 * 여기 있는 첫 항목이 **브라우저 확인에서 잡힌 오탐의 회귀 검사**입니다.
 * 한 번의 pointermove 로 두세 칸이 터지는 것은 이 게임의 정상 동작인데, 칸당 최소
 * 시간으로 판단하던 초안이 그것을 전부 이상치로 찍었습니다 — 손가락이 빠른 사용자만
 * 순위에서 빠지는 판정이었습니다.
 */
function toktokStrokeRules(game) {
  const C = ARCADE[game];
  const line = (n, gapMs) => {
    const { cells, times } = toktokPath(C.COLS, C.ROWS, n, () => gapMs);
    return gradeStroke({ cells, times, prizes: [], sinceIssuedMs: n * gapMs + 1000 });
  };

  // 칸당 20ms = 초당 50칸. 빠르지만 손가락으로 낼 수 있는 속도입니다.
  const fast = line(30, 20);
  check(`${game} 빠른 훑기는 이상치가 아니다`, fast.pops === 30 && fast.tooFast === false,
    `${Math.round((fast.pops / fast.spanMs) * 1000)}칸/초`);

  // 칸당 8ms = 초당 125칸. 스무 칸 넘게 유지되면 손이 아닙니다.
  const bot = line(40, 8);
  check(`${game} 사람이 못 내는 지속 속도는 이상치`, bot.tooFast === true,
    `${Math.round((bot.pops / bot.spanMs) * 1000)}칸/초`);

  // 표본이 적으면 우연히 균일할 수 있어 균일함을 판단하지 않습니다
  const few = line(6, 90);
  check(`${game} 짧은 훑기는 균일해도 이상치가 아니다`, few.uniform === false,
    `간격 ${few.pops - 1}개`);

  // 이음매(-1)를 무제한 허용하면 경로 검사 자체가 무의미해집니다
  const seams = [];
  const seamT = [];
  for (let i = 0; i <= C.MAX_BREAKS + 1; i++) {
    seams.push(0, -1);
    seamT.push(i * 200, i * 200 + 100);
  }
  const broken = gradeStroke({ cells: seams, times: seamT, prizes: [], sinceIssuedMs: 60000 });
  check(`${game} 이음매 남용은 그 자리에서 잘린다`,
    broken.cut === "breaks" && broken.breaks === C.MAX_BREAKS + 1,
    `이음매 ${broken.breaks}개에서 중단`);
}

/**
 * ㉙ 소등 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 방을 다 꺼야 판이 끝난다 — 하나라도 남기면 판정하지 않고 방이 살아 있다
 *   ② 기록은 **누른 시간의 합보다 짧을 수 없다** (화면이 시간을 정하지 못한다)
 *   ③ 어제 기록이 없으면(= 이긴 판) 이어하기 자리를 열지 않는다 (기획서 8장)
 *   ④ 방을 더 주는 광고가 없다
 *   ⑤ 유지 시간이 완벽히 균일하면(매크로) 이상치로 표시된다
 *   ⑥ 첫 방은 16개, 다음 방부터 24개 — 그리고 불빛이 겹치지 않는다
 */

/** 사람처럼 조금씩 다른 유지 시간으로 방 하나를 끕니다 */
function lightoutHolds(lights, jitter = (i) => 40 + ((i * 53) % 90)) {
  return lights.map((l, i) => ({ i: l.i, ms: l.hold_ms + jitter(i) }));
}

const holdsTotal = (holds, movePerLight = 180) =>
  holds.reduce((a, h) => a + h.ms, 0) + holds.length * movePerLight;

async function lightoutFlow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  const round = s.data.round;
  const lights = round?.lights ?? [];

  check(`${game} 제한 시간 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 첫 방은 ${C.FIRST_ROOM_LIGHTS}개`, lights.length === C.FIRST_ROOM_LIGHTS,
    `${lights.length}개 (${round?.room_no}번째 방)`);

  // ── ⑥ 불빛이 겹치지 않는다 (겹치면 엄지 하나가 두 개를 건드립니다) ──
  let minGap = Infinity;
  for (let i = 0; i < lights.length; i++) {
    for (let k = i + 1; k < lights.length; k++) {
      minGap = Math.min(minGap, Math.hypot(lights[i].x - lights[k].x, lights[i].y - lights[k].y));
    }
  }
  check(`${game} 불빛이 겹치지 않는다`, minGap >= C.MIN_GAP * 0.9,
    `최소 간격 ${minGap.toFixed(3)} (기준 ${C.MIN_GAP})`);
  check(`${game} 꺼지는 시간이 불빛마다 다르다`,
    new Set(lights.map((l) => l.hold_ms)).size > 1,
    `${C.HOLD_MIN_MS}~${C.HOLD_MAX_MS}ms`);

  const submit = (holds, totalMs) =>
    post("/game/round", {
      game_type: game, session_id: sid,
      answer: { holds, total_ms: totalMs }, elapsed_ms: totalMs,
    });

  // ── ① 하나를 남기면 판정하지 않는다 ────────────────────────
  const full = lightoutHolds(lights);
  const partial = await submit(full.slice(0, -1), holdsTotal(full.slice(0, -1)));
  check(`${game} 불빛이 남으면 판을 끝내지 않는다`,
    partial.data.correct === false && partial.data.game_over !== true && partial.data.exhausted !== true,
    `사유=${partial.data.data?.invalid}`);
  // 반려된 신고로 방이 바뀌면 화면이 옛 방을 보여 주는 채로 새 방이 채점됩니다
  check(`${game} 반려된 신고가 방을 바꾸지 않는다`, partial.data.round == null,
    `round=${partial.data.round == null ? "그대로" : "새 방"}`);

  // 방을 실제로 끄는 데 걸리는 시간만큼 기다립니다.
  //
  // **누른 시간의 합은 방이 열린 뒤 흐른 시간을 넘을 수 없습니다**(gradeRoom).
  // 즉시 제출하면 그 검사에 정당하게 걸리므로, 여기서만 실제 시간을 씁니다.
  // 나머지 시간 규칙은 아래 lightoutRoomRules 가 gradeRoom 을 직접 불러 검사합니다.
  const floor = full.reduce((a, h) => a + h.ms, 0);
  await sleep(floor + 300);

  const done = await submit(full, holdsTotal(full));
  check(`${game} 기록은 누른 시간의 합보다 짧을 수 없다`,
    done.data.data?.room_ms >= floor,
    `인정 ${done.data.data?.room_ms}ms (누른 시간 합 ${floor}ms)`);

  // ── ③ 어제 기록이 없으면 이긴 판이라 이어하기를 열지 않는다 ──
  check(`${game} 방을 다 끄면 판이 끝난다`, done.data.game_over === true,
    `faster=${done.data.data?.faster}`);
  check(`${game} 이긴 판에는 이어하기를 열지 않는다`, done.data.exhausted !== true,
    `어제 기록 ${done.data.data?.yesterday_ms ?? "없음"}`);

  const res = done.data.result;
  check(`${game} 순위 지표는 소등 시간`, res?.rank_metric === done.data.data?.room_ms,
    `metric=${res?.rank_metric}`);
  check(`${game} 불빛 수만큼 확정 적립`, res?.score >= C.LIGHT_POINT * lights.length + C.CLEAR_POINT,
    `score=${res?.score}`);
  check(`${game} 사람처럼 흔들리는 유지는 이상치 아님`, res?.suspect === false,
    `suspect=${res?.suspect} bucket=${res?.bucket} 초과분 40~130ms 로 흔들림`);

  // ── ④ 방을 더 주는 광고는 없다 ─────────────────────────────
  const noAd = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check(`${game} 방을 더 주는 광고는 없다`, noAd.status === 429, `(${noAd.data.code})`);

  lightoutRoomRules(game);
  lightoutBoostRule(game);
  return res;
}

/**
 * 방 채점 규칙 — 서버 왕복으로는 **시간이 실제로 흘러야** 재현되므로 직접 부릅니다.
 *
 * 위 흐름에서 한 방을 끄는 데만 10초 넘게 기다립니다. 경계값을 전부 그렇게 검사하면
 * 테스트가 분 단위로 늘어나므로, 시간이 얽힌 규칙은 여기서 결정적으로 봅니다
 * (⑳ 의 카드 생성 · ㉕ 의 다시 붓기와 같은 이유).
 */
function lightoutRoomRules(game) {
  const C = ARCADE[game];
  const lights = makeRoom(2, (a, b) => Math.floor((a + b) / 2)); // 결정적 난수
  const need = lights.map((l) => l.hold_ms);
  const floor = need.reduce((a, b) => a + b, 0);

  check(`${game} 두 번째 방부터 ${C.LIGHTS}개`, lights.length === C.LIGHTS, `${lights.length}개`);
  check(`${game} 첫 방은 ${C.FIRST_ROOM_LIGHTS}개`,
    makeRoom(1, (a, b) => Math.floor((a + b) / 2)).length === C.FIRST_ROOM_LIGHTS);

  const grade = (holds, totalMs, since) =>
    gradeRoom({ holds, totalMs, lights, sinceIssuedMs: since });

  // 사람 — 초과분이 흔들립니다
  const human = lights.map((l, i) => ({ i: l.i, ms: l.hold_ms + 40 + ((i * 53) % 90) }));
  const okRoom = grade(human, floor + 4000, 60000);
  check(`${game} 정상 소등은 이상치 아님`, okRoom.ok && !okRoom.uniform && okRoom.short === 0,
    `기록 ${okRoom.totalMs}ms`);

  // 매크로 — 초과분이 늘 같습니다
  const macro = lights.map((l) => ({ i: l.i, ms: l.hold_ms + 30 }));
  check(`${game} 초과분이 늘 같으면 이상치`, grade(macro, floor + 800, 60000).uniform === true,
    `초과분 ${lights.length}개가 전부 30ms — 사람은 꺼진 것을 보고 뗍니다`);

  // 필요 시간보다 짧게 눌렀다면 그 불빛은 꺼지지 않았어야 합니다
  const shortRoom = grade(lights.map((l) => ({ i: l.i, ms: l.hold_ms - 200 })), floor, 60000);
  check(`${game} 덜 누르고 껐다는 신고는 이상치`, shortRoom.short === lights.length,
    `${shortRoom.short}개가 필요 시간 미만`);

  // 줄여 신고해도 누른 시간의 합이 하한입니다
  check(`${game} 화면이 시간을 정하지 못한다`, grade(human, 1000, 60000).totalMs >= floor,
    `신고 1000ms → 인정 ${grade(human, 1000, 60000).totalMs}ms (합 ${floor}ms)`);

  // 방이 열린 시간보다 오래 눌렀다는 신고는 물리적으로 불가능합니다
  check(`${game} 방이 열린 시간보다 오래 누를 수 없다`,
    grade(human, floor, 500).ok === false,
    `누른 합 ${floor}ms > 방이 열린 지 500ms`);

  // 하나라도 남기면 판정하지 않습니다
  check(`${game} 하나를 남기면 미완주`, grade(human.slice(0, -1), floor, 60000).reason === "incomplete");
}

/**
 * 「어제보다 느렸을 때만 이어하기를 연다」는 서버 왕복으로 재현할 수 없습니다 —
 * 어제 행이 있어야 하는데 그건 어제 플레이한 사람에게만 있습니다. 그래서 이 규칙만
 * spec 을 직접 불러 결정적으로 검사합니다 (㉕ 의 pourRedoRule 과 같은 이유).
 */
function lightoutBoostRule(game) {
  const spec = ARCADE_SPECS[game];
  const C = ARCADE[game];
  const lights = [
    { i: 0, x: 0.3, y: 0.3, hold_ms: 500 },
    { i: 1, x: 0.7, y: 0.7, hold_ms: 600 },
  ];
  const holds = [{ i: 0, ms: 520 }, { i: 1, ms: 640 }];

  const judge = (yesterdayBest, totalMs) => {
    const meta = { boosts: 0, lives: 1, ext: { roomNo: 2, yesterdayBest, score: 0 } };
    const v = spec.judgeRound({
      answer: { holds, total_ms: totalMs },
      roundSecret: { lights }, meta, sinceIssuedMs: 60000,
    });
    return { meta, v };
  };

  // 느린 판은 목숨을 써서(fatal) 「이어하기 아니면 종료」로 갑니다
  const slow = judge(20000, 30000); // 어제 20초 · 오늘 30초
  check(`${game} 어제보다 느리면 이어하기가 열린다`, slow.v.fatal === true && slow.v.done !== true,
    `fatal=${slow.v.fatal} done=${slow.v.done}`);

  // 빠른 판은 완주로 끝냅니다 — 이어하기 화면 자체가 오지 않습니다
  const fast = judge(40000, 30000); // 어제 40초 · 오늘 30초
  check(`${game} 어제보다 빠르면 이어하기가 없다`, fast.v.done === true && fast.v.fatal === false,
    `done=${fast.v.done} (이미 이긴 사람에게 팔 것이 없다)`);

  // **광고를 보지 않은 판이 '+' 리그로 가면 안 됩니다** (브라우저 확인에서 걸린 회귀)
  check(`${game} 이긴 판은 보상 리그로 가지 않는다`,
    fast.meta.boosts === 0 && slow.meta.boosts === 0,
    `boosts=${fast.meta.boosts} — 광고를 본 판만 '+' 리그입니다`);

  check(`${game} 어제를 넘기면 단축 보너스`, fast.meta.ext.score > slow.meta.ext.score,
    `${fast.meta.ext.score} vs ${slow.meta.ext.score}`);

  // 이어하기는 **이번 시도의 시간만** 지웁니다 — 오늘 기록과 점수는 그대로입니다
  const before = slow.meta.ext.score;
  spec.applyBoost(slow.meta);
  check(`${game} 이어해도 점수는 그대로`,
    slow.meta.ext.score === before && slow.meta.ext.roomMs == null && slow.meta.lives === 1,
    `score=${slow.meta.ext.score} lives=${slow.meta.lives}`);
}

/**
 * ㉚ 쭉 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 조각(ongoing)은 판을 끝내지 않고 길이를 누적한다
 *   ② 서버가 **끊어졌어야 할 지점까지만** 인정한다 (길이를 부풀린 신고를 앞에서 자른다)
 *   ③ 첫 GRACE_MS 동안은 끊어지지 않는다 (초보자 보장)
 *   ④ 천천히 끈 쪽이 급하게 끈 쪽보다 길다 (설계의 전부 · 기획서 15장 가설 2)
 *   ⑤ 이어 붙이기가 길이를 그대로 유지한다 (기획서 8장)
 *   ⑥ 등속은 매크로로 표시된다
 */

/**
 * 일정한 속도로 끄는 표본 열. jitter 를 주면 사람 손가락처럼 흔들립니다.
 *
 * `startLen` 은 **앞 조각의 마지막 길이**입니다. 길이는 조각을 가로질러 절대값으로
 * 이어지고(화면이 그렇게 보냅니다), 줄어드는 신고는 서버가 거부합니다.
 */
function stretchSamples(speed, seconds, stepMs, jitter = 0, startLen = 0) {
  const out = [];
  let len = startLen;
  for (let t = 0; t <= seconds * 1000; t += stepMs) {
    if (t > 0) len += Math.min(speed, ARCADE.STRETCH.MAX_STRETCH_RATE) * (stepMs / 1000);
    const wob = jitter ? Math.abs(Math.sin(t / 37)) * jitter : 0;
    out.push({ t, len: Number(Math.max(startLen, len + wob).toFixed(4)) });
  }
  return out;
}

async function stretchFlow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  assertNoSecretLeak(game, s.data);
  const sid = s.data.session_id;
  const round = s.data.round;

  check(`${game} 제한 시간 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 손상 모형 상수를 화면에 내려준다`,
    round?.model?.capacity === C.CAPACITY && round?.model?.grace_ms === C.GRACE_MS,
    `capacity=${round?.model?.capacity} grace=${round?.model?.grace_ms}ms`);
  check(`${game} 오늘의 재료가 붙는다`, round?.dough?.hex != null, `${round?.dough?.name}`);
  check(`${game} 상품 길이를 미리 준다`, (round?.prizes ?? []).length > 0,
    `첫 상품 ${round?.prizes?.[0]?.at} 화면`);

  const pull = (samples, ongoing) =>
    post("/game/round", {
      game_type: game, session_id: sid,
      answer: { samples, ongoing },
      elapsed_ms: samples[samples.length - 1]?.t ?? 0,
    });

  // ── ③ 첫 3초 동안은 끊어지지 않는다 ────────────────────────
  // 상한 속도로 당겨 손상이 임계를 한참 넘게 만든 뒤에도 보장 안이면 살아 있어야 합니다.
  const yank = stretchSamples(C.MAX_STRETCH_RATE, (C.GRACE_MS - 400) / 1000, 40);
  const g = await pull(yank, true);
  check(`${game} 첫 ${C.GRACE_MS / 1000}초는 끊어지지 않는다`,
    g.data.data?.broke === false && g.data.exhausted !== true,
    `길이 ${g.data.data?.len} 화면`);

  // ── ① 조각은 판을 끝내지 않고 누적한다 ──────────────────────
  check(`${game} 조각은 길이를 누적한다`, g.data.data?.len > 0 && g.data.game_over !== true,
    `len=${g.data.data?.len}`);

  // ── ② 보장이 풀리면 그 자리에서 끊어진다 (급하게 끈 대가) ───
  const after = stretchSamples(C.MAX_STRETCH_RATE, 4, 40, 0, g.data.data?.len ?? 0);
  const snap = await pull(after, true);
  check(`${game} 보장이 풀리면 끊어진다`, snap.data.data?.broke === true,
    `길이 ${snap.data.data?.len} 화면`);
  const fastLen = snap.data.data?.len ?? 0;
  check(`${game} 끊어지면 세션 유지 + 이어하기 대기`,
    snap.data.exhausted === true && snap.data.game_over === false,
    `can_boost=${snap.data.can_boost}`);

  // ── ⑤ 이어 붙이기는 길이를 그대로 유지한다 ─────────────────
  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  const r1 = boost.data.reward;
  check(`${game} 이어 붙여도 지금 길이는 그대로`, r1?.round?.start_len === fastLen,
    `${r1?.round?.start_len} = ${fastLen}`);
  check(`${game} 이어 붙이면 손상만 0 으로`, r1?.round?.start_dmg === 0 && r1?.lives === 1,
    `dmg=${r1?.round?.start_dmg} lives=${r1?.lives}`);

  // ── ② 길이를 부풀린 신고는 앞에서 잘린다 ────────────────────
  // 상한 속도로 60초를 당겼다고 신고하면 신고 길이는 30 화면입니다. 피로항 때문에
  // 이 모형이 인정하는 길이는 그보다 훨씬 앞에서 막힙니다.
  const huge = stretchSamples(C.MAX_STRETCH_RATE, 60, 200, 0, r1?.round?.start_len ?? 0);
  const claimed = huge[huge.length - 1].len;
  const cut = await pull(huge, false);
  check(`${game} 끊어졌어야 할 지점까지만 인정한다`,
    cut.data.data?.len < claimed / 4,
    `신고 ${claimed} 화면 → 인정 ${cut.data.data?.len} 화면`);
  check(`${game} 이어 붙이기를 다 쓰면 종료`, cut.data.game_over === true || cut.data.exhausted === true,
    `game_over=${cut.data.game_over}`);

  stretchModelRules(game);

  const res = cut.data.result ?? (await post("/game/finish", { game_type: game, session_id: sid })).data.result;
  check(`${game} 결과 확정`, res?.rank_metric != null, `점수=${res?.score} 리그=${res?.bucket}`);
  check(`${game} 보상 사용 런은 별도 리그`, res?.bucket?.endsWith("+") === true, `bucket=${res?.bucket}`);
  return res;
}

/**
 * 손상 모형은 이 게임의 전부입니다. 서버 왕복으로는 「어떤 속도가 유리한가」를
 * 재현할 수 없으므로(요청을 실제 속도로 보내야 합니다) simulate 를 직접 부릅니다.
 *
 * ④ 가 무너지면 기획이 통째로 무너집니다 — 「천천히 끌수록 유리」가 이 게임의
 * 존재 이유이고(기획서 3·4장), 15장의 우선 검증 가설 2 가 그것입니다.
 */
function stretchModelRules(game) {
  const C = ARCADE[game];
  const runAt = (speed) => {
    const sim = simulateStretch({ samples: stretchSamples(speed, 90, 40) });
    return sim.len;
  };

  const slow = runAt(0.2); // 천천히
  const rush = runAt(1.5); // 급하게 (상한에 걸려 길이는 못 얻고 응력만 얻습니다)
  const crawl = runAt(0.03); // 너무 느림 (피로가 잡습니다)

  check(`${game} 천천히 끈 쪽이 급하게 끈 쪽보다 길다`, slow > rush,
    `0.2 화면/초 → ${slow} · 1.5 화면/초 → ${rush}`);
  check(`${game} 무한히 느린 것은 유리하지 않다`, slow > crawl,
    `0.2 화면/초 → ${slow} · 0.03 화면/초 → ${crawl}`);
  check(`${game} 길이에 하드 상한이 없다`, slow > 1.5 && slow < 4,
    `최적 속도에서 ${slow} 화면 (모형이 정하는 값)`);

  // 등속 = 매크로. 사람 손가락은 방향을 꺾을 때마다 느려집니다.
  const flat = simulateStretch({ samples: stretchSamples(0.2, 3, 40) });
  const human = simulateStretch({ samples: stretchSamples(0.2, 3, 40, 0.01) });
  const cv = (xs) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m;
  };
  check(`${game} 등속은 균일함 검사에 걸린다`,
    flat.steps.length >= C.UNIFORM_MIN_STEPS && cv(flat.steps) < C.UNIFORM_CV,
    `변동계수 ${cv(flat.steps).toFixed(4)} (기준 ${C.UNIFORM_CV})`);
  check(`${game} 흔들리는 손가락은 걸리지 않는다`, cv(human.steps) >= C.UNIFORM_CV,
    `변동계수 ${cv(human.steps).toFixed(4)}`);
}

/**
 * ㉒ 3초 탐정 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 사건 5건으로 끝나고, 틀려도 판이 끝나지 않는다(실패 없음)
 *   ② 정답 위치는 응답에 미리 내려가지 않는다 — 장면 두 개는 그려야 하니 공개다
 *   ③ 못 푼 사건은 **다음 판에 그 장면 그대로** 다시 온다(미해결 이월)
 */
async function detectiveFlow(game) {
  const C = ARCADE[game];

  /** 두 장면을 비교해 바뀐 자리를 찾습니다 — 사람이 눈으로 하는 것과 같은 정보입니다 */
  const diffIndex = (round) => {
    const a = round.icons ?? [];
    const b = round.after ?? [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i] ?? {};
      if (y.gone || x.color !== y.color || x.col !== y.col || x.row !== y.row) return i;
    }
    return 0;
  };

  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;
  assertNoSecretLeak(game, s.data);

  const sid = s.data.session_id;
  let round = s.data.round;
  check(`${game} 목숨 없는 게임`, s.data.lives === 0, `lives=${s.data.lives}`);
  check(`${game} 찾는 시간 제한 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 첫 사건은 사라짐 유형`, (round.after ?? []).some((i) => i.gone), "규칙을 몸으로 알려주는 배정");
  check(`${game} 정답 위치 비노출`, JSON.stringify(s.data).includes('"changed"') === false);

  // 첫 사건은 일부러 틀립니다 — 미해결 이월을 확인하려면 남겨야 합니다
  let last = await post("/game/round", {
    game_type: game, session_id: sid, answer: (diffIndex(round) + 1) % (round.icons ?? []).length,
  });
  check(`${game} 틀려도 판이 끝나지 않음`, last.data.correct === false && last.data.game_over !== true,
    `미해결=${last.data.data?.unsolved_today}`);
  check(`${game} 틀리면 정답을 알려 준다`, Number.isInteger(last.data.data?.answer_index));
  const missedKind = last.data.data?.kind;

  // 나머지는 전부 맞힙니다
  let solved = 0;
  for (let i = 1; i < C.CASES && !last.data.game_over; i++) {
    round = last.data.round;
    if (!round) break;
    last = await post("/game/round", { game_type: game, session_id: sid, answer: diffIndex(round) });
    if (last.data.correct) solved += 1;
  }

  check(`${game} 사건 ${C.CASES}건으로 종료`, last.data.game_over === true, `해결 ${solved}건`);
  const res = last.data.result;
  check(`${game} 결과 확정`, res?.rank_metric === -solved, `metric=${res?.rank_metric} 해결=${solved}`);
  check(`${game} 점수는 해결한 사건의 누적`, res?.score > 0, `score=${res?.score}`);

  // ── ③ 미해결 이월 ──────────────────────────────────────────
  const s2 = await post("/game/session/start", { game_type: game, fresh: true });
  if (s2.data.ok) {
    check(`${game} 미해결 사건이 다음 판에 다시 온다`, s2.data.round?.redo === true,
      `redo=${s2.data.round?.redo} (직전 미해결 유형=${missedKind})`);
    const r2 = await post("/game/round", {
      game_type: game, session_id: s2.data.session_id, answer: diffIndex(s2.data.round),
    });
    check(`${game} 재해결에 보너스가 붙는다`, r2.data.data?.redone_today === 1,
      `재해결=${r2.data.data?.redone_today}`);
    await post("/game/finish", { game_type: game, session_id: s2.data.session_id });
  }

  return res;
}

/**
 * ㉕ 오늘의 한 잔 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 세 층을 다 부으면 끝나고 실패가 없다 · 시간 제한이 없다
 *   ② 목표선 등급은 마지막 층에서만 나오고, 넘쳐도 층당 확정은 전액이다
 *   ③ 「그 층만 다시 붓기」가 마지막 층만 걷어낸다 (앞 층은 그대로)
 *   ④ 하루 1잔 — 광고로 잔을 더 주지 않는다
 */
async function pourFlow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  const sid = s.data.session_id;
  let round = s.data.round;
  check(`${game} 목숨 없는 게임`, s.data.lives === 0, `lives=${s.data.lives}`);
  check(`${game} 시간 제한 없음`, s.data.limit_ms == null, `limit_ms=${s.data.limit_ms}`);
  check(`${game} 병 ${C.LAYERS}개 배정`, (round?.bottles ?? []).length === C.LAYERS);
  check(`${game} 목표선이 배정된다`, round?.target > 0, `target=${round?.target}`);

  /** 누른 시간과 양이 비례해야 합니다 — 서버가 그 비례를 검사합니다 */
  const pourOnce = (amount) =>
    post("/game/round", {
      game_type: game, session_id: sid,
      answer: { amount: Number(amount.toFixed(3)) },
      elapsed_ms: Math.round((amount / C.POUR_RATE) * 1000),
    });

  // 목표선을 **넘기도록** 부어 구원 광고 자리를 만듭니다
  const target = round.target;
  let last = await pourOnce(target * 0.5);
  check(`${game} 붓기는 늘 성립한다 (꽝 없음)`, last.data.correct === true, `층=${last.data.data?.poured}`);
  check(`${game} 등급은 마지막 층에서만`, last.data.data?.grade == null, `grade=${last.data.data?.grade}`);
  last = await pourOnce(target * 0.5);
  last = await pourOnce(0.4); // 마지막 층 — 넘칩니다

  check(`${game} 세 층을 다 부으면 종료`, last.data.game_over === true, `층=${last.data.data?.poured}`);
  check(`${game} 넘침 판정`, last.data.data?.over === true, `등급=${last.data.data?.grade_name}`);
  const res = last.data.result;
  check(`${game} 넘쳐도 층당 확정은 받는다`, res?.score >= C.LAYER_POINT * C.LAYERS,
    `score=${res?.score} (층당 ${C.LAYER_POINT}×${C.LAYERS})`);
  check(`${game} 순위 지표는 목표선과의 차이`, res?.rank_metric > 0, `metric=${res?.rank_metric}`);

  // ── ④ 하루 1잔 · 잔 추가 광고 없음 ─────────────────────────
  const over = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 하루 한 잔을 넘으면 시작 불가`, over.data.ok === false, `(${over.data.code})`);
  const noAd = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check(`${game} 잔을 더 주는 광고는 없다`, noAd.status === 429, `(${noAd.data.code})`);

  pourRedoRule(game);
  return res;
}

/**
 * 「그 층만 다시 붓기」는 서버 왕복으로 확인하기 어렵습니다 — 하루 1잔이라 광고 자리를
 * 만들려면 판을 또 열어야 합니다. 그래서 이 규칙만 spec 을 직접 불러 검사합니다.
 */
function pourRedoRule(game) {
  const spec = ARCADE_SPECS[game];
  const C = ARCADE[game];
  const meta = {
    ext: {
      target: 0.8, bottles: C.SYRUPS.slice(0, 3).map((s) => ({ key: s.key, name: s.name, hex: s.hex })),
      layers: [
        { key: C.SYRUPS[0].key, hex: C.SYRUPS[0].hex, amount: 0.3 },
        { key: C.SYRUPS[1].key, hex: C.SYRUPS[1].hex, amount: 0.6 },
      ],
      level: 0.9, cursor: 2, score: 0, over: true, album: [], cups: 0, runs: 0,
    },
  };
  spec.applyBoost(meta);
  check(`${game} 다시 붓기는 마지막 층만 걷어낸다`,
    meta.ext.layers.length === 1 && Math.abs(meta.ext.level - 0.3) < 1e-6 && meta.ext.cursor === 1,
    `남은 층 ${meta.ext.layers.length} · 액면 ${meta.ext.level.toFixed(2)}`);
  check(`${game} 앞 층은 그대로 남는다`, meta.ext.layers[0].amount === 0.3);
}

/**
 * ㉖ 세 칸 쌓기 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 첫 3수는 어디에 놓아도 합쳐진다 (규칙을 글 없이 알려주는 배정)
 *   ② 합체하지 못한 것은 실패가 아니고, 기둥 초과만 판을 끝낸다
 *   ③ 「맨 위 하나 치우기」가 가장 높은 기둥을 줄이고 판을 다시 연다
 */
async function merge3Flow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  const sid = s.data.session_id;
  let round = s.data.round;
  check(`${game} 기둥 ${C.COLUMNS}개`, (round?.cols ?? []).length === C.COLUMNS);
  check(`${game} 시간 제한 없음`, s.data.limit_ms == null);

  // ── ① 첫 3수는 아무 기둥에 놓아도 합쳐진다 ─────────────────
  let merged = 0;
  let last = null;
  for (let i = 0; i < C.FREE_MERGES; i++) {
    last = await post("/game/round", { game_type: game, session_id: sid, answer: i % C.COLUMNS });
    if (last.data.data?.merged) merged += 1;
    round = last.data.round;
  }
  check(`${game} 첫 ${C.FREE_MERGES}수 안에 합체가 일어난다`, merged >= 1, `합체 ${merged}회`);

  // ── ② 기둥을 채워 초과를 만든다 ────────────────────────────
  let exhausted = null;
  for (let i = 0; i < 60; i++) {
    // 합체가 안 되는 자리를 일부러 골라 기둥을 높입니다
    const cols = round?.cols ?? [];
    const heights = cols.map((c) => c.length);
    const target = heights.indexOf(Math.max(...heights));
    last = await post("/game/round", { game_type: game, session_id: sid, answer: target });
    if (last.data.code) break;
    if (last.data.exhausted || last.data.game_over) { exhausted = last; break; }
    round = last.data.round;
  }

  check(`${game} 기둥 초과로 소진`, exhausted != null, `상한=${round?.height}`);
  if (!exhausted) return;
  check(`${game} 소진 시 세션 유지`, exhausted.data.exhausted === true && exhausted.data.game_over === false,
    `can_boost=${exhausted.data.can_boost}`);

  // ── ③ 맨 위 하나 치우기 ────────────────────────────────────
  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  const before = (round?.cols ?? []).reduce((n, c) => n + c.length, 0);
  const after = (boost.data.reward?.data?.cols ?? []).reduce((n, c) => n + c.length, 0);
  check(`${game} 치우기 보상이 기둥을 줄인다`, boost.data.reward?.lives === 1 && after < before,
    `${before}개 → ${after}개`);

  const fin = await post("/game/finish", { game_type: game, session_id: sid });
  const res = fin.data.result;
  check(`${game} 결과 확정`, res?.rank_metric != null, `등급=${res?.detail?.best_name ?? "-"} 점수=${res?.score}`);
  check(`${game} 보상 사용 런은 별도 리그`, res?.bucket?.endsWith("+") === true, `bucket=${res?.bucket}`);
  return res;
}

/**
 * ㉗ 오늘의 전국 게이지 — 전용 시나리오
 *
 * 확인하는 것
 *   ① 토큰을 다 밀어 넣으면 끝난다 (실패 없음)
 *   ② 기여가 **전역 게이지에 실제로 누적**된다 — 다음 판의 시작값이 올라가 있어야 한다
 *   ③ 「기여 2배」 보상이 남은 토큰의 반영량을 두 배로 만든다
 */
async function gaugeFlow(game) {
  const C = ARCADE[game];
  const s = await post("/game/session/start", { game_type: game, fresh: true });
  check(`${game} 시작`, s.data.ok === true, `(${s.data.code ?? "정상"})`);
  if (!s.data.ok) return;

  const sid = s.data.session_id;
  const start = s.data.round;
  check(`${game} 목숨 없는 게임`, s.data.lives === 0, `lives=${s.data.lives}`);
  check(`${game} 토큰 ${C.TOKENS}개`, start?.tokens_left === C.TOKENS, `left=${start?.tokens_left}`);
  check(`${game} 오늘 목표와 단계를 알려 준다`,
    start?.target === C.DAILY_TARGET && (start?.stages ?? []).length === C.STAGES.length,
    `목표=${start?.target} 단계=${start?.stages}`);

  const totalBefore = start.total;

  // ③ 첫 토큰 뒤에 2배 보상을 받습니다
  let last = await post("/game/round", { game_type: game, session_id: sid, answer: 0 });
  check(`${game} 토큰 하나가 게이지를 올린다`, last.data.data?.added === C.TOKEN_VALUE,
    `+${last.data.data?.added}`);

  const boost = await post("/ad/reward", { trigger: `${game}_BOOST`, session_id: sid });
  check(`${game} 기여 2배 보상`, boost.data.reward?.data?.multiplier === 2,
    `배수=${boost.data.reward?.data?.multiplier}`);

  for (let i = 0; i < C.TOKENS && !last.data.game_over; i++) {
    last = await post("/game/round", { game_type: game, session_id: sid, answer: 0 });
    if (last.data.code) break;
  }
  check(`${game} 토큰을 다 쓰면 종료`, last.data.game_over === true,
    `총 기여=${last.data.data?.added_total}`);
  // added 는 그 토큰 하나의 증가분, added_total 은 판 전체 — 이름을 나눠 두었습니다
  check(`${game} 2배가 적용된다`, (last.data.data?.added_total ?? 0) > C.TOKENS * C.TOKEN_VALUE,
    `총 기여=${last.data.data?.added_total} (기본 ${C.TOKENS * C.TOKEN_VALUE})`);

  const res = last.data.result;

  // ── ② 전역 누적 확인 (광고로 한 번 더 참여) ────────────────
  const ad = await post("/ad/reward", { trigger: `${game}_ATTEMPT` });
  check(`${game} 참여 기회 충전 광고`, ad.data.ok === true, `(${ad.data.code ?? "-"})`);

  const s2 = await post("/game/session/start", { game_type: game, fresh: true });
  if (s2.data.ok) {
    check(`${game} 기여가 전역 게이지에 누적된다`, s2.data.round.total > totalBefore,
      `${totalBefore} → ${s2.data.round.total}`);
    check(`${game} 내 기여량이 이어진다`, s2.data.round.my_tokens > 0, `내 기여=${s2.data.round.my_tokens}`);
    await post("/game/finish", { game_type: game, session_id: s2.data.session_id });
  }
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
