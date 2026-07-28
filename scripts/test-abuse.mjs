/**
 * 어뷰징 방어 테스트
 * ==========================================================================
 *
 *   npm run dev          (다른 터미널)
 *   npm run test:abuse
 *
 * 공격자 입장에서 실제로 뚫어 봅니다. 각 항목은 "이렇게 하면 이득을 볼 수 있는가?" 를
 * 묻고, 서버가 막아야 정상입니다.
 *
 * 통과(ok)는 "공격이 실패했다" 는 뜻입니다.
 *
 * 막을 수 없다고 이미 판단한 것(화면에 그려야 하는 값 노출, 자명한 문제의 자동화)은
 * docs/arcade-10-games.md §6 에 적어 두었고 여기서 검사하지 않습니다.
 * 대신 "그런 노출이 결과 위조로는 이어지지 않는다" 를 확인합니다.
 * ==========================================================================
 */

import { ARCADE_SPECS } from "../src/games/arcade/index.js";
import { ARCADE } from "../src/lib/config.js";

const BASE = process.env.TEST_BASE ?? "http://127.0.0.1:8787";

let pass = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 실행마다 겹치지 않는 IP 대역 (광고 한도가 IP+날짜로 누적되므로) */
const oct = () => 1 + Math.floor(Math.random() * 250);
const RUN_A = oct();
const RUN_B = oct();

function check(name, blocked, detail = "") {
  if (blocked) {
    pass++;
    console.log(`  막음 ${name}${detail ? "  " + detail : ""}`);
  } else {
    failures.push(name);
    console.log(`  뚫림 ${name}${detail ? "  " + detail : ""}`);
  }
}

/** 독립된 신원(쿠키)을 가진 클라이언트 */
function client(ip = `10.${RUN_A}.${RUN_B}.200`) {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async call(method, path, body, extraHeaders = {}) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": ip,
          ...(cookie ? { cookie } : {}),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      let data = null;
      try { data = await res.json(); } catch { data = { parseError: true }; }
      return { status: res.status, data };
    },
    post(p, b, h) { return this.call("POST", p, b, h); },
    get_(p, h) { return this.call("GET", p, undefined, h); },
  };
}

// ══════════════════════════════════════════════════════════════
// 1. 신원 · 세션 소유권
// ══════════════════════════════════════════════════════════════

async function identityAndOwnership() {
  console.log("\n[1] 신원 위조 · 세션 소유권");

  const a = client(`10.${RUN_A}.${RUN_B}.11`);
  const b = client(`10.${RUN_A}.${RUN_B}.12`);

  const sa = await a.post("/game/session/start", { game_type: "ODDCOLOR", fresh: true });
  await b.post("/user/attempts?game=ODDCOLOR"); // b 에게도 쿠키 발급

  // 남의 세션으로 라운드 진행
  const steal = await b.post("/game/round", {
    game_type: "ODDCOLOR", session_id: sa.data.session_id, answer: 0,
  });
  check("남의 세션으로 플레이", steal.status === 403 && steal.data.code === "FORBIDDEN", `(${steal.data.code})`);

  // 남의 세션을 강제 종료해 기록을 남기기
  const finishOther = await b.post("/game/finish", {
    game_type: "ODDCOLOR", session_id: sa.data.session_id,
  });
  check("남의 세션 강제 종료", finishOther.status === 403, `(${finishOther.data.code})`);

  // 남의 세션에 광고 보상 붙이기
  const boostOther = await b.post("/ad/reward", {
    trigger: "ODDCOLOR_BOOST", session_id: sa.data.session_id,
  });
  check("남의 세션에 보상 적용", boostOther.status >= 400, `(${boostOther.data.code})`);

  // 쿠키 서명 위조 — user_id 만 바꿔치기
  const forged = client(`10.${RUN_A}.${RUN_B}.13`);
  const raw = a.cookie.replace("mg_uid=", "");
  const idx = raw.lastIndexOf(".");
  const sig = raw.slice(idx + 1);
  forged.cookie = `mg_uid=00000000-0000-4000-8000-000000000000.${sig}`;
  const forgedRes = await forged.get_("/user/attempts?game=ODDCOLOR");
  // 서명이 안 맞으면 새 익명 ID 를 발급받습니다 = 남의 신원을 못 씀
  const newCookie = forged.cookie.includes("00000000-0000-4000-8000-000000000000");
  check("쿠키 user_id 위조", forgedRes.data.ok === true && !newCookie, "서명 불일치 → 새 신원 발급");

  // 서명 없는 쿠키
  const bare = client(`10.${RUN_A}.${RUN_B}.14`);
  bare.cookie = "mg_uid=11111111-1111-4111-8111-111111111111";
  await bare.get_("/user/attempts?game=ODDCOLOR");
  check("서명 없는 쿠키", !bare.cookie.includes("11111111-1111-4111-8111-111111111111"), "거부 후 재발급");

  await a.post("/game/finish", { game_type: "ODDCOLOR", session_id: sa.data.session_id });
}

// ══════════════════════════════════════════════════════════════
// 2. 정답 · 채점 위조
// ══════════════════════════════════════════════════════════════

async function scoreForgery() {
  console.log("\n[2] 점수 · 채점 위조");

  const c = client(`10.${RUN_A}.${RUN_B}.21`);

  // 클라이언트가 점수를 직접 주장
  const s = await c.post("/game/session/start", { game_type: "ODDCOLOR", fresh: true });
  const claim = await c.post("/game/round", {
    game_type: "ODDCOLOR", session_id: s.data.session_id, answer: 0,
    cleared: 9999, score: 9999, correct: true, rank_metric: -99999,
  });
  const cleared = claim.data.cleared ?? 0;
  check("응답 필드 주입으로 점수 조작", cleared <= 1, `cleared=${cleared} (서버 판정만 반영)`);
  await c.post("/game/finish", { game_type: "ODDCOLOR", session_id: s.data.session_id });

  // BATCH: 제출 본문에 점수/이상치 여부를 끼워넣기
  const s2 = await c.post("/game/session/start", { game_type: "NUMTAP", fresh: true });
  const order = [...s2.data.round.layout].sort((x, y) => x - y);
  let t = 0;
  const times = order.map(() => (t += 200));
  await sleep(t);
  const sub = await c.post("/game/submit", {
    game_type: "NUMTAP", session_id: s2.data.session_id,
    answers: order, times, elapsed_ms: t,
    score: 1, rank_metric: -999999, suspect: false, result: { score: 1 },
  });
  const finalMs = sub.data.detail?.final_ms;
  check("제출 본문으로 기록 조작", sub.data.result?.rank_metric === finalMs,
    `rank_metric=${sub.data.result?.rank_metric} = 서버 계산 ${finalMs}ms`);

  // 서버가 모르는 답을 맞다고 우기기 (스트룹: 틀린 답 + 정답 배열 주입)
  const s3 = await c.post("/game/session/start", { game_type: "STROOP", fresh: true });
  const items = s3.data.round.items.slice(0, 5);
  const wrong = items.map((it) => it.choices.find((x) => x !== it.choices[0]) ?? it.choices[0]);
  await sleep(2000);
  const sub3 = await c.post("/game/submit", {
    game_type: "STROOP", session_id: s3.data.session_id,
    answers: wrong, times: items.map(() => 400), elapsed_ms: 2000,
    answers_correct: wrong, secret: { answers: wrong },
  });
  check("정답 배열 주입", (sub3.data.result?.score ?? 99) < 5,
    `연속 ${sub3.data.result?.score} (전부 정답이면 5)`);
}

// ══════════════════════════════════════════════════════════════
// 3. 중복 제출 · 리플레이
// ══════════════════════════════════════════════════════════════

async function replay() {
  console.log("\n[3] 중복 제출 · 리플레이");

  const c = client(`10.${RUN_A}.${RUN_B}.31`);

  // 같은 세션 2회 제출
  const s = await c.post("/game/session/start", { game_type: "RPSFLASH", fresh: true });
  const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
  const LOSES = { rock: "paper", scissors: "rock", paper: "scissors" };
  const solve = (it) => (it.order === "WIN" ? LOSES[it.hand] : it.order === "LOSE" ? BEATS[it.hand] : it.hand);
  const items = s.data.round.items.slice(0, 8);
  const payload = {
    game_type: "RPSFLASH", session_id: s.data.session_id,
    answers: items.map(solve), times: items.map(() => 400), elapsed_ms: 3200,
  };
  await sleep(3200);
  const first = await c.post("/game/submit", payload);
  const second = await c.post("/game/submit", payload);
  check("같은 세션 재제출", second.status === 409, `1회차 ok=${first.data.ok}, 2회차 (${second.data.code})`);

  // 동시 제출 경합 (같은 세션으로 5개 동시)
  const s2 = await c.post("/game/session/start", { game_type: "RPSFLASH", fresh: true });
  const items2 = s2.data.round.items.slice(0, 8);
  const p2 = {
    game_type: "RPSFLASH", session_id: s2.data.session_id,
    answers: items2.map(solve), times: items2.map(() => 400), elapsed_ms: 3200,
  };
  await sleep(3200);
  const race = await Promise.all(Array.from({ length: 5 }, () => c.post("/game/submit", p2)));
  const accepted = race.filter((r) => r.data.ok === true).length;
  check("동시 제출 경합", accepted === 1, `${race.length}건 중 ${accepted}건만 수용`);

  // 종료된 세션으로 라운드 진행
  const closed = await c.post("/game/round", { game_type: "RPSFLASH", session_id: s2.data.session_id, answer: 0 });
  check("종료된 세션 재사용", closed.status >= 400, `(${closed.data.code})`);
}

// ══════════════════════════════════════════════════════════════
// 4. 시간 조작
// ══════════════════════════════════════════════════════════════

async function timeTampering() {
  console.log("\n[4] 시간 조작");

  const c = client(`10.${RUN_A}.${RUN_B}.41`);

  // 플레이 시간을 부풀려 점수 늘리기 (암산: 시간이 길수록 많이 풀 수 있음)
  const s = await c.post("/game/session/start", { game_type: "MATHRUSH", fresh: true });
  const solve = (q) => (q.op === "+" ? q.a + q.b : q.op === "-" ? q.a - q.b : q.a * q.b);
  const qs = s.data.round.questions.slice(0, 60);
  const inflate = await c.post("/game/submit", {
    game_type: "MATHRUSH", session_id: s.data.session_id,
    answers: qs.map(solve), times: qs.map(() => 900), elapsed_ms: 54000,
  });
  check("플레이 시간 부풀리기", inflate.data.code === "TIME_TAMPERED", `(${inflate.data.code})`);

  // 시간을 0 에 가깝게 신고 (기록 게임: 짧을수록 상위)
  const s2 = await c.post("/game/session/start", { game_type: "NUMTAP", fresh: true });
  const order = [...s2.data.round.layout].sort((x, y) => x - y);
  const instant = await c.post("/game/submit", {
    game_type: "NUMTAP", session_id: s2.data.session_id,
    answers: order, times: order.map((_, i) => i * 5), elapsed_ms: 120,
  });
  const susp = instant.data.result?.suspect;
  check("완주 시간 0에 가깝게 신고", susp === true, `기록 ${instant.data.detail?.final_ms}ms → suspect=${susp}`);

  // 음수 시간 — 전부 음수
  const s3 = await c.post("/game/session/start", { game_type: "NUMTAP", fresh: true });
  const order3 = [...s3.data.round.layout].sort((x, y) => x - y);
  const neg = await c.post("/game/submit", {
    game_type: "NUMTAP", session_id: s3.data.session_id,
    answers: order3, times: order3.map(() => -1000), elapsed_ms: -99999,
  });
  const negMetric = neg.data.result?.rank_metric;
  check("음수 시간 신고", neg.data.ok === false || (negMetric != null && negMetric >= 0),
    `code=${neg.data.code ?? "-"} rank_metric=${negMetric}`);

  /**
   * 실제로 뚫렸던 경로 (회귀 검사)
   *
   * 마지막 탭 시각만 음수로 신고하면 탭 간격은 정상이라 자동입력 탐지를 피하고,
   * `완주시간 > 경과시간` 검사도 음수라서 통과합니다. 그 결과 suspect=false 인 채
   * rank_metric = −5000 으로 저장되어 순위표 1위를 영구 점유했습니다.
   */
  const s6 = await c.post("/game/session/start", { game_type: "NUMTAP", fresh: true });
  const order6 = [...s6.data.round.layout].sort((x, y) => x - y);
  let acc = 0;
  const sneaky = order6.map((_, i) => (i === order6.length - 1 ? -5000 : (acc += 250)));
  await sleep(6500);
  const lastNeg = await c.post("/game/submit", {
    game_type: "NUMTAP", session_id: s6.data.session_id,
    answers: order6, times: sneaky, elapsed_ms: 6500,
  });
  const m = lastNeg.data.result?.rank_metric;
  check("마지막 탭만 음수로 신고 (순위표 1위 점유)",
    lastNeg.data.ok === false || (m != null && m >= 0),
    `code=${lastNeg.data.code ?? "-"} rank_metric=${m}`);

  // 시간을 거꾸로 신고 (음수는 아니지만 앞 탭보다 이른 시각)
  const s7 = await c.post("/game/session/start", { game_type: "NUMTAP", fresh: true });
  const order7 = [...s7.data.round.layout].sort((x, y) => x - y);
  let acc7 = 0;
  const backwards = order7.map((_, i) => (i === order7.length - 1 ? 50 : (acc7 += 250)));
  await sleep(6500);
  const back = await c.post("/game/submit", {
    game_type: "NUMTAP", session_id: s7.data.session_id,
    answers: order7, times: backwards, elapsed_ms: 6500,
  });
  const bm = back.data.result?.rank_metric;
  check("탭 시각을 거꾸로 신고", back.data.ok === false || (bm != null && bm >= acc7),
    `code=${back.data.code ?? "-"} rank_metric=${bm}`);

  const s4 = await c.post("/game/session/start", { game_type: "NUMTAP", fresh: true });
  const bad = await c.post(
    "/game/submit",
    `{"game_type":"NUMTAP","session_id":"${s4.data.session_id}","answers":[1],"times":[1],"elapsed_ms":1e999}`,
  );
  check("Infinity 시간 신고", bad.data.ok === false || bad.data.result?.rank_metric >= 0,
    `code=${bad.data.code ?? "-"}`);

  // 링 스톱: 실제로 기다리지 않고 유리한 각도 시각을 신고
  const s5 = await c.post("/game/session/start", { game_type: "RINGSTOP", fresh: true });
  const r = s5.data.round;
  const toCenter = Math.round((((r.target_start_deg + r.arc_deg / 2) - r.start_deg + 360) % 360) / r.speed_dps * 1000);
  const cheat = await c.post("/game/round", {
    game_type: "RINGSTOP", session_id: s5.data.session_id,
    answer: { angle_deg: (r.target_start_deg + r.arc_deg / 2) % 360 },
    elapsed_ms: toCenter, // 기다리지 않고 "그때였다" 고 주장
  });
  const flagged = cheat.data.data?.drift_deg > 0 || cheat.data.correct === false;
  check("링스톱 시간 앞당겨 신고", flagged,
    `correct=${cheat.data.correct} drift=${cheat.data.data?.drift_deg}°`);
  await c.post("/game/finish", { game_type: "RINGSTOP", session_id: s5.data.session_id });
}

// ══════════════════════════════════════════════════════════════
// 5. 기회 · 광고 한도 우회
// ══════════════════════════════════════════════════════════════

async function limitBypass() {
  console.log("\n[5] 기회 · 광고 한도 우회");

  const c = client(`10.${RUN_A}.${RUN_B}.51`);
  const game = "COUNTDOT";
  const cfg = ARCADE[game];

  // fresh 세션을 반복 생성해 기회를 무한히 쓰기
  let started = 0;
  for (let i = 0; i < cfg.baseAttempts + 5; i++) {
    const r = await c.post("/game/session/start", { game_type: game, fresh: true });
    if (r.data.code === "NO_ATTEMPTS") break;
    started++;
    await c.post("/game/finish", { game_type: game, session_id: r.data.session_id });
  }
  check("fresh 반복으로 기회 무한 사용", started === cfg.baseAttempts,
    `${started}판 시작 (기본 ${cfg.baseAttempts})`);

  // 광고 보상 요청을 세션 없이 반복 (기회 무한 충전)
  let granted = 0;
  for (let i = 0; i < cfg.adAttemptsPerDay + 5; i++) {
    const r = await c.post("/ad/reward", { trigger: `${game}_ATTEMPT` });
    if (r.status === 429) break;
    granted++;
  }
  check("기회 충전 광고 무한 반복", granted === cfg.adAttemptsPerDay,
    `${granted}회 지급 (한도 ${cfg.adAttemptsPerDay})`);

  // 런당 보상 한도 우회: 같은 세션에 반복 요청
  const s = await c.post("/game/session/start", { game_type: "SEQUENCE", fresh: true });
  let boosts = 0;
  for (let i = 0; i < ARCADE.SEQUENCE.boostsPerRun + 4; i++) {
    const r = await c.post("/ad/reward", { trigger: "SEQUENCE_BOOST", session_id: s.data.session_id });
    if (r.status === 429) break;
    boosts++;
  }
  check("런당 이어하기 한도 우회", boosts === ARCADE.SEQUENCE.boostsPerRun,
    `${boosts}회 (한도 ${ARCADE.SEQUENCE.boostsPerRun})`);
  await c.post("/game/finish", { game_type: "SEQUENCE", session_id: s.data.session_id });

  // 보상이 없는 게임에 보상 요청
  const noBoost = await c.post("/ad/reward", { trigger: "NUMTAP_BOOST" });
  check("보상 없는 게임에 보상 요청", noBoost.status >= 400, `(${noBoost.data.code})`);

  // 없는 트리거 / 다른 게임 트리거로 교차 지급
  const fake = await c.post("/ad/reward", { trigger: "COUNTDOT_JACKPOT" });
  check("존재하지 않는 트리거", fake.status >= 400, `(${fake.data.code})`);

  // 동시 요청으로 한도 넘기기 (경합)
  const c2 = client(`10.${RUN_A}.${RUN_B}.52`);
  await c2.get_("/user/attempts?game=STROOP");
  const s2 = await c2.post("/game/session/start", { game_type: "STROOP", fresh: true });
  const burst = await Promise.all(
    Array.from({ length: 6 }, () => c2.post("/ad/reward", { trigger: "STROOP_BOOST", session_id: s2.data.session_id })),
  );
  const okCount = burst.filter((r) => r.data.ok === true).length;
  check("동시 보상 요청으로 한도 초과", okCount <= ARCADE.STROOP.boostsPerRun,
    `동시 6건 중 ${okCount}건 수용 (한도 ${ARCADE.STROOP.boostsPerRun})`);
}

// ══════════════════════════════════════════════════════════════
// 6. 통계 · 랭킹 게이팅 우회
// ══════════════════════════════════════════════════════════════

async function statsGateBypass() {
  console.log("\n[6] 통계 · 랭킹 게이팅 우회");

  const c = client(`10.${RUN_A}.${RUN_B}.61`);

  const locked = await c.get_("/game/stats?game=CARDPAIR");
  check("광고 없이 통계 열람", locked.status === 403, `(${locked.data.code})`);

  const lockedRank = await c.get_("/game/rank?game=CARDPAIR");
  check("광고 없이 순위 열람", lockedRank.status === 403, `(${lockedRank.data.code})`);

  // 다른 게임 광고로 교차 해제
  await c.post("/ad/reward", { trigger: "ODDCOLOR_STATS" });
  const cross = await c.get_("/game/stats?game=CARDPAIR");
  check("다른 게임 광고로 교차 해제", cross.status === 403, `(${cross.data.code})`);

  // 보상형 광고(기회 충전)로 열람 해제
  await c.post("/ad/reward", { trigger: "CARDPAIR_ATTEMPT" });
  const wrongType = await c.get_("/game/stats?game=CARDPAIR");
  check("보상형 광고로 열람 해제", wrongType.status === 403, `(${wrongType.data.code})`);

  // 정상 경로는 열려야 합니다
  await c.post("/ad/reward", { trigger: "CARDPAIR_STATS" });
  const opened = await c.get_("/game/stats?game=CARDPAIR");
  check("정상 경로 열람 (열려야 정상)", opened.data.ok === true, `ok=${opened.data.ok}`);
}

// ══════════════════════════════════════════════════════════════
// 7. 입력 검증 · 주입
// ══════════════════════════════════════════════════════════════

async function inputValidation() {
  console.log("\n[7] 입력 검증 · 주입");

  const c = client(`10.${RUN_A}.${RUN_B}.71`);

  // SQL 주입 시도 (bucket / game 파라미터)
  await c.post("/ad/reward", { trigger: "ODDCOLOR_STATS" });
  const inj = await c.get_(`/game/stats?game=ODDCOLOR&bucket=${encodeURIComponent("all' OR '1'='1")}`);
  check("bucket SQL 주입", inj.data.ok === true && (inj.data.distribution?.count ?? 0) === 0,
    `분포 ${inj.data.distribution?.count ?? 0}건 (바인딩 처리)`);

  const dropTry = await c.get_(`/game/rank?game=${encodeURIComponent("ODDCOLOR'; DROP TABLE results;--")}`);
  check("game 파라미터 주입", dropTry.data.code === "BAD_PARAM", `(${dropTry.data.code})`);

  // 테이블이 살아있는지
  const alive = await c.get_("/game/stats?game=ODDCOLOR");
  check("주입 후 테이블 정상", alive.data.ok === true);

  // 프로토타입 오염
  const proto = await c.post("/game/session/start", `{"game_type":"ODDCOLOR","fresh":true,"__proto__":{"polluted":true}}`);
  check("프로토타입 오염", proto.data.ok === true && ({}).polluted === undefined, "무해");
  if (proto.data.session_id) await c.post("/game/finish", { game_type: "ODDCOLOR", session_id: proto.data.session_id });

  // 거대한 본문
  const huge = await c.post("/game/submit", { game_type: "STROOP", session_id: "x", answers: "A".repeat(200000) });
  check("거대한 본문", huge.status >= 400, `(${huge.data.code})`);

  // 답안 배열 길이 폭탄
  const s = await c.post("/game/session/start", { game_type: "STROOP", fresh: true });
  const bomb = await c.post("/game/submit", {
    game_type: "STROOP", session_id: s.data.session_id,
    answers: Array(5000).fill("red"), times: Array(5000).fill(200), elapsed_ms: 1000,
  });
  check("답안 5000개 제출", bomb.status >= 400, `(${bomb.data.code})`);

  // 타입 혼란: answer 에 객체/배열/null
  const s2 = await c.post("/game/session/start", { game_type: "COUNTDOT", fresh: true });
  const weird = [];
  for (const answer of [{ a: 1 }, [1, 2, 3], null, "9", true, 1e20, -5]) {
    const r = await c.post("/game/round", { game_type: "COUNTDOT", session_id: s2.data.session_id, answer });
    weird.push(`${JSON.stringify(answer)}→${r.status}`);
    if (r.data.exhausted || r.data.game_over) break;
  }
  const noCrash = weird.every((w) => !w.endsWith("500"));
  check("이상한 타입의 답", noCrash, weird.join(" "));

  // 잘못된 JSON
  const badJson = await c.post("/game/session/start", "{not json");
  check("깨진 JSON", badJson.data.code === "BAD_JSON", `(${badJson.data.code})`);

  // 세션 ID 형식 공격
  for (const sid of ["", "../../etc/passwd", "%00", "a".repeat(500)]) {
    const r = await c.post("/game/round", { game_type: "ODDCOLOR", session_id: sid, answer: 0 });
    if (r.status === 500) { check("세션 ID 형식 공격", false, `sid=${sid.slice(0, 20)} → 500`); return; }
  }
  check("세션 ID 형식 공격", true, "전부 400대로 거부");
}

// ══════════════════════════════════════════════════════════════
// 8. 게임별 규칙 악용
// ══════════════════════════════════════════════════════════════

async function gameSpecificAbuse() {
  console.log("\n[8] 게임별 규칙 악용");

  const c = client(`10.${RUN_A}.${RUN_B}.81`);

  // 카드: 같은 카드를 반복 눌러 뒤집기 수를 안 늘리고 정보만 얻기
  const s = await c.post("/game/session/start", { game_type: "CARDPAIR", fresh: true });
  const sid = s.data.session_id;
  const r1 = await c.post("/game/round", { game_type: "CARDPAIR", session_id: sid, answer: 0 });
  const r2 = await c.post("/game/round", { game_type: "CARDPAIR", session_id: sid, answer: 0 });
  check("카드 같은 장 반복으로 정보 수집",
    r2.data.data?.phase === "ignored" && r2.data.data?.symbol === undefined,
    `2회차 phase=${r2.data.data?.phase} 그림=${r2.data.data?.symbol ?? "없음"}`);

  await c.post("/game/finish", { game_type: "CARDPAIR", session_id: sid });

  // 카드: 이미 맞춘 카드를 다시 뒤집어 뒤집기 수를 조작
  // 앞선 검사에서 pending 이 남지 않도록 새 런에서 확인합니다.
  const s1b = await c.post("/game/session/start", { game_type: "CARDPAIR", fresh: true });
  const sid1b = s1b.data.session_id;
  const hint = await c.post("/ad/reward", { trigger: "CARDPAIR_BOOST", session_id: sid1b });
  const pair = hint.data.reward?.data?.pair;
  if (pair) {
    await c.post("/game/round", { game_type: "CARDPAIR", session_id: sid1b, answer: pair[0] });
    const m = await c.post("/game/round", { game_type: "CARDPAIR", session_id: sid1b, answer: pair[1] });
    const matched = m.data.data?.phase === "match";
    const flipsAfterMatch = m.data.data?.flips;
    const again = await c.post("/game/round", { game_type: "CARDPAIR", session_id: sid1b, answer: pair[0] });
    check("맞춘 카드 재뒤집기로 횟수 조작",
      matched && again.data.data?.phase === "ignored" && again.data.data?.flips === undefined,
      `짝맞춤=${matched} 재시도 phase=${again.data.data?.phase} (뒤집기 ${flipsAfterMatch}회 유지)`);
  } else {
    check("맞춘 카드 재뒤집기로 횟수 조작", false, "힌트를 받지 못해 검사 불가");
  }
  await c.post("/game/finish", { game_type: "CARDPAIR", session_id: sid1b });

  // 순서 기억: 서버가 준 시퀀스를 그대로 되돌려주는 것 자체는 정상 플레이와 구분 불가.
  // 다만 "더 긴 답" 을 보내 라운드를 건너뛸 수 있는지 확인합니다.
  const s2 = await c.post("/game/session/start", { game_type: "SEQUENCE", fresh: true });
  const long = await c.post("/game/round", {
    game_type: "SEQUENCE", session_id: s2.data.session_id,
    answer: [...s2.data.round.sequence, 1, 2, 3, 4, 5],
  });
  check("시퀀스 초과 입력으로 통과", long.data.correct === false, `correct=${long.data.correct}`);
  await c.post("/game/finish", { game_type: "SEQUENCE", session_id: s2.data.session_id });

  // 반응속도: 사람이 불가능한 반응
  const s3 = await c.post("/game/session/start", { game_type: "REACTION", fresh: true });
  const waits = s3.data.round.waits;
  const times = waits.map((w) => w + 5);
  await sleep(times.reduce((a, b) => a + b, 0));
  const superhuman = await c.post("/game/submit", {
    game_type: "REACTION", session_id: s3.data.session_id,
    answers: waits.map(() => 5), times, elapsed_ms: times.reduce((a, b) => a + b, 0),
  });
  check("5ms 반응속도 신고", superhuman.data.result?.suspect === true,
    `평균 ${superhuman.data.detail?.avg_ms}ms → suspect=${superhuman.data.result?.suspect}`);

  // 다들 뭐 골랐을까: 이 게임의 정답은 "집계 비율" 이라, 문항과 함께 내려가면
  // 게임이 성립하지 않습니다. 판정 전에는 어떤 경로로도 비율이 보이면 안 됩니다.
  const mj = await c.post("/game/session/start", { game_type: "MAJORITY", fresh: true });
  const mjSid = mj.data.session_id;
  const beforeJudge = JSON.stringify(mj.data);
  const cfg = await c.get_("/game/config");
  const leakedRatio = /"(pct|snap_[ab]|live_[ab]|major)"/.test(beforeJudge);
  check("판정 전 다수 비율 노출", !leakedRatio && !/"pct"/.test(JSON.stringify(cfg.data)),
    leakedRatio ? "문항과 함께 비율이 내려옴" : "문항만 노출 · 비율은 판정 후에만");

  // 같은 판을 두 번 끝내 표를 두 번 넣을 수 있는지 (결과·집계 중복)
  await c.post("/game/finish", { game_type: "MAJORITY", session_id: mjSid });
  const twice = await c.post("/game/finish", { game_type: "MAJORITY", session_id: mjSid });
  check("같은 판을 두 번 확정", twice.status >= 400, `(${twice.data.code})`);

  // 숫자야구: 정답을 응답에서 캐낼 수 있는지 (오리지널 게임 회귀)
  const bb = await c.post("/game/session/start", { game_type: "BASEBALL", fresh: true });
  const guess = await c.post("/game/guess", { session_id: bb.data.session_id, guess: "012" });
  const leaked = JSON.stringify(guess.data).match(/"answer"/);
  check("숫자야구 진행 중 정답 노출", !leaked || guess.data.game_over === true,
    leaked ? "answer 필드 있음" : "정답 감춤");
  await c.post("/game/giveup", { session_id: bb.data.session_id });
}

// ══════════════════════════════════════════════════════════════
// 9. 크로스 게임 혼동
// ══════════════════════════════════════════════════════════════

async function crossGame() {
  console.log("\n[9] 크로스 게임 혼동");

  const c = client(`10.${RUN_A}.${RUN_B}.91`);

  // A 게임 세션을 B 게임으로 사용
  const s = await c.post("/game/session/start", { game_type: "ODDCOLOR", fresh: true });
  const wrongGame = await c.post("/game/round", {
    game_type: "COUNTDOT", session_id: s.data.session_id, answer: 5,
  });
  check("다른 게임 세션 사용", wrongGame.status >= 400, `(${wrongGame.data.code})`);

  // 쉬운 게임 세션으로 어려운 게임 리그에 기록 남기기
  const wrongSubmit = await c.post("/game/submit", {
    game_type: "NUMTAP", session_id: s.data.session_id, answers: [1], times: [1], elapsed_ms: 1,
  });
  check("다른 게임으로 제출", wrongSubmit.status >= 400, `(${wrongSubmit.data.code})`);

  // ENDLESS 세션을 /game/submit 으로, BATCH 세션을 /game/round 로
  const s2 = await c.post("/game/session/start", { game_type: "MATHRUSH", fresh: true });
  const wrongRoute = await c.post("/game/round", {
    game_type: "MATHRUSH", session_id: s2.data.session_id, answer: 1,
  });
  check("BATCH 게임을 라운드 방식으로", wrongRoute.status >= 400, `(${wrongRoute.data.code})`);

  await c.post("/game/finish", { game_type: "ODDCOLOR", session_id: s.data.session_id });
}

// ══════════════════════════════════════════════════════════════
// 10. 리그(bucket) 조작
// ══════════════════════════════════════════════════════════════

async function leagueManipulation() {
  console.log("\n[10] 리그 조작");

  const c = client(`10.${RUN_A}.${RUN_B}.101`);

  // 보상을 쓰고도 무보상 리그에 기록하려는 시도
  const s = await c.post("/game/session/start", { game_type: "ODDCOLOR", fresh: true });
  await c.post("/ad/reward", { trigger: "ODDCOLOR_BOOST", session_id: s.data.session_id });
  const fin = await c.post("/game/finish", {
    game_type: "ODDCOLOR", session_id: s.data.session_id, bucket: "all", boosts: 0,
  });
  check("보상 사용 후 무보상 리그로 기록", fin.data.result?.bucket === "all+",
    `bucket=${fin.data.result?.bucket}`);

  // 암산: 시간 연장 없이 90s 리그를 주장
  const s2 = await c.post("/game/session/start", { game_type: "MATHRUSH", fresh: true });
  const solve = (q) => (q.op === "+" ? q.a + q.b : q.op === "-" ? q.a - q.b : q.a * q.b);
  const qs = s2.data.round.questions.slice(0, 5);
  const times = qs.map(() => 400);
  await sleep(2000);
  const claim = await c.post("/game/submit", {
    game_type: "MATHRUSH", session_id: s2.data.session_id,
    answers: qs.map(solve), times, elapsed_ms: 2000, bucket: "90s", limit_ms: 90000,
  });
  check("연장 없이 90s 리그 주장", claim.data.result?.bucket === "60s", `bucket=${claim.data.result?.bucket}`);
}

// ══════════════════════════════════════════════════════════════

console.log(`대상: ${BASE}`);
console.log(`아케이드 ${Object.keys(ARCADE_SPECS).length}종 + 오리지널 4종`);

try {
  await fetch(BASE + "/game/config");
} catch {
  console.error(`\n서버에 연결할 수 없습니다: ${BASE}`);
  process.exit(1);
}

const suites = [
  identityAndOwnership, scoreForgery, replay, timeTampering, limitBypass,
  statsGateBypass, inputValidation, gameSpecificAbuse, crossGame, leagueManipulation,
];

for (const suite of suites) {
  try {
    await suite();
  } catch (err) {
    failures.push(`${suite.name} 예외`);
    console.log(`  뚫림 ${suite.name} 예외: ${err.message}`);
  }
}

console.log("\n" + "=".repeat(60));
if (failures.length === 0) {
  console.log(`방어 성공 ${pass} · 뚫린 항목 0`);
} else {
  console.log(`방어 성공 ${pass} · 뚫린 항목 ${failures.length}`);
  console.log("\n확인 필요:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length > 0 ? 1 : 0);
