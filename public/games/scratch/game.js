/**
 * ⑳ 슥슥 긁기
 *
 * 칸 하나를 다 긁을 때마다 서버가 판정합니다(ENDLESS). 판이 끝나도 연속 일수는 남습니다.
 *
 * ── 조작이 탭이 아닙니다 ─────────────────────────────────────────────────
 * 아케이드 규격은 「조작은 탭 1종류」인데 이 게임은 **문지르기**입니다. 기획의 핵심이
 * 원리 2 손맛(은박 가루가 밀려나는 촉감)이라 탭으로 바꾸면 게임이 남지 않습니다.
 * 규격을 벗어난 이유와 대체 경로는 docs/scratch-game.md §5 에 적어 두었습니다.
 *
 * ── 지연을 제스처로 흡수합니다 ───────────────────────────────────────────
 * 카드 그림은 서버에만 있어 긁는 순간에는 무엇이 나올지 모릅니다. 그래서 은박이
 * COMMIT_AT 만큼 벗겨진 순간 서버에 신고하고, 응답이 오면 남은 은박을 걷어내며
 * 그림을 확정합니다 — 기획서 0-3 「그림이 반쯤 드러나다 마지막 문지름에 반짝하며
 * 확정」이 그대로 왕복 지연을 덮습니다. (⑬ 카드 짝 맞추기와 같은 처리)
 *
 * ── 키보드·보조기기 ──────────────────────────────────────────────────────
 * 칸마다 Enter/Space 를 4번 누르면 한 칸이 긁힙니다. 한 번에 긁히게 하면 서버의
 * 궤적 검사(MIN_STROKES)에 걸려 마우스가 없는 사용자만 순위에서 빠집니다.
 */

import { ApiFail } from "../../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge, comma } from "../../shared/ui.js";
import {
  runApi, renderReady, renderRunOver, renderStatsScreen, openStats, loadRankList,
  clearRewards, statsReward, boostReward, createEndlessRun,
} from "../../shared/run.js";

const GAME = "SCRATCH";

/** 은박이 이만큼 벗겨지면 그 칸을 긁은 것으로 보고 서버에 신고합니다 */
const COMMIT_AT = 0.45;
/** 캔버스 논리 크기 — CSS 로 늘려 쓰므로 실제 픽셀 수와 무관합니다 */
const N = 140;
/** 지우개 반지름(논리 px) */
const BRUSH = 21;
/** 진행률을 재는 격자 — getImageData 재조회 없이 벗겨진 면적을 셉니다 */
const OCC = 8;
/** 키보드 한 번 누름당 벗겨지는 비율 (4번 = COMMIT_AT) */
const KEY_STEP = 0.14;

/** rank_metric = -(연속 일수) */
const formatBest = (metric) => `${Math.max(1, -metric)}일 연속`;

const HUE_HEX = { gold: "#E8C65C", blue: "#6FA8F5", red: "#F0705C" };
const HUE_NAME = { gold: "노란빛", blue: "푸른빛", red: "붉은빛" };

const state = { cells: [], busy: false, left: 0 };
let lastResult = null;
let lastData = null;

renderHeader($("#header"), { icon: "🎟", title: "슥슥 긁기", badge: "1" });

const run = createEndlessRun({
  game: GAME,
  // 하루 카드 한 장이라 새로고침으로 진행분이 날아가면 그날 다시 못 긁습니다.
  fresh: false,
  boost: { label: "한 칸 더 긁기", desc: "은박 카드에 한 칸을 더 긁습니다" },
  hooks: {
    onRound: renderRound,
    onJudged: showVerdict,
    onOver: onOver,
    pauseText: pauseText,
  },
});

$("#startBtn").addEventListener("click", startRun);
$("#pauseEndBtn").addEventListener("click", () => run.end());
$("#retryBtn").addEventListener("click", () => loadReady());
$("#statsBackBtn").addEventListener("click", () => {
  showScreen("over");
  renderOverRewards();
});

loadReady();

// ══════════════════════════════════════════════════════════════
// 시작 화면
// ══════════════════════════════════════════════════════════════

async function loadReady() {
  showScreen("ready");
  clearRewards();

  try {
    const st = await runApi.status(GAME);
    renderReady({
      attempts: st.attempts,
      base: st.base_attempts,
      best: st.my_best,
      plays: st.my_plays,
      formatBest,
    });

    // 공통 문구를 이 게임의 말로 바꿉니다
    $("#playsValue").textContent = st.my_plays > 0 ? `${comma(st.my_plays)}장` : "첫 카드";
    const btn = $("#startBtn");
    btn.textContent = btn.disabled ? "내일 카드를 기다려 주세요" : "▶ 카드 긁기";

    // 하루 한 장이라 새로고침 한 번에 그날을 잃으면 안 됩니다.
    // 기회가 0이면 **새 런이 생길 수 없으므로** 이어받기를 시도해도 안전합니다.
    if ((st.attempts?.remaining ?? 0) <= 0) {
      try {
        await run.begin();
        toast("이어서 긁기", "good", 1400);
        return;
      } catch {
        /* 진행 중인 런이 없습니다 — 시작 화면 그대로 둡니다 */
      }
    }
  } catch (err) {
    toast(err.message ?? "정보를 불러올 수 없습니다.", "error");
  }

  // 카드를 더 주는 광고는 없습니다(기획서 8장) — 시작 화면에 보상 카드를 두지 않습니다.
}

async function startRun() {
  $("#startBtn").disabled = true;
  try {
    await run.begin();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 카드는 다 긁었어요. 내일 밤 12시에 새 카드가 도착합니다.", "error");
      loadReady();
      return;
    }
    toast(err.message ?? "카드를 열 수 없습니다.", "error");
    $("#startBtn").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// 은박 카드
// ══════════════════════════════════════════════════════════════

function renderRound(round) {
  if (!round) return;

  state.left = round.scratches_left ?? 0;
  state.busy = false;
  lastData = round; // 결과·[pause] 화면이 쓰는 값 (이어받기로 들어온 경우 포함)

  // 다 긁은 카드를 새로고침으로 이어받은 경우. 그냥 플레이 화면을 그리면 긁을 칸이
  // 없는 화면에 갇힙니다 — 소진 시점의 [pause] 화면(구원 광고)으로 보냅니다.
  if (state.left <= 0) {
    showResumedPause(round);
    return;
  }

  $("#hudScore").textContent = comma(round.score ?? 0);
  $("#hudStreak").textContent = `${round.streak ?? 1}일`;
  $("#hudLeft").textContent = String(state.left);
  setHeaderBadge(`${round.streak ?? 1}일 연속`);

  $("#cardLabel").textContent =
    round.matched
      ? `${round.match_icon ?? ""} ${round.match_name ?? ""} 3개 — 획득 ${round.multiplier ?? 2}배!`
      : `같은 그림 ${round.need ?? 3}개를 모으세요`;

  const match = clear($("#cardMatch"));
  if (round.near && !round.matched) {
    match.append(el("span", { class: "chip chip--accent" }, `${round.near.icon} ${round.near.have}개`));
  }

  $("#playHint").textContent =
    state.left > 0
      ? "손가락으로 칸을 슥슥 문질러 주세요 (키보드는 Enter 4번)"
      : "긁기를 다 썼어요";

  buildGrid(round.cells ?? []);
}

/** 9칸을 그립니다. 이미 긁은 칸은 은박 없이, 나머지는 은박을 덮어 둡니다. */
function buildGrid(cells) {
  const host = clear($("#grid"));
  state.cells = [];

  for (const c of cells) {
    const face = el(
      "div",
      { class: "scell__face" },
      el("span", { class: "scell__icon" }, c.open ? c.icon : c.sure ? c.icon : ""),
      el("span", { class: "scell__pt" }, c.open ? `+${c.points}` : ""),
    );

    const node = el("div", { class: `scell ${c.open ? "is-open" : ""}` }, face);
    const cell = {
      i: c.i,
      open: Boolean(c.open),
      occ: new Set(), // 벗겨진 자리 (8×8 격자)
      sent: false, // 서버에 신고했는가
      strokes: 0, // 궤적 표본 수 — 서버의 긁기 검사에 함께 보냅니다
      t0: 0, // 이 칸을 처음 문지른 시각
      lastKey: 0, // 키보드로 마지막에 긁은 시각 (자동 반복 완화)
      cv: null,
    };

    if (!c.open) {
      const cv = el("canvas", {
        class: "scell__foil",
        width: N,
        height: N,
        role: "button",
        tabindex: "0",
        "aria-label": labelOf(c),
      });
      cell.cv = cv;
      node.append(cv);

      // 완전 공개 힌트(연속 7일째) — 은박 위에 그림을 흐리게 얹어 둡니다
      if (c.sure) node.append(el("span", { class: "scell__sure", "aria-hidden": "true" }, c.icon));

      paintFoil(cv, c.peek ? HUE_HEX[c.peek] : null, c.i);
      attachScratch(cell, node);
    }

    state.cells.push(cell);
    host.append(node);
  }
}

const labelOf = (c) =>
  c.sure
    ? `${c.i + 1}번 칸 · ${c.name} 미리 공개 — 문질러 긁기`
    : c.peek
      ? `${c.i + 1}번 칸 · ${HUE_NAME[c.peek] ?? "색"}이 비침 — 문질러 긁기`
      : `${c.i + 1}번 칸 — 문질러 긁기`;

/**
 * 은박을 그립니다.
 *
 * 힌트 칸은 **색만** 비칩니다 — 은박이 살짝 벗겨진 자리로 알 수 있는 것은 색이지
 * 그림이 아니고, 그래서 힌트가 확정이 아닌 추론이 됩니다(기획서 「노란 것이 비친다」).
 * 벗겨진 자리는 칸 번호로 정해 새로고침해도 같은 곳에 있습니다.
 */
function paintFoil(cv, peekHex, seed = 0) {
  const g = cv.getContext("2d");
  g.clearRect(0, 0, N, N);

  const grad = g.createLinearGradient(0, 0, N, N);
  grad.addColorStop(0, "#8f97a6");
  grad.addColorStop(0.32, "#d3dae5");
  grad.addColorStop(0.5, "#eff3f9");
  grad.addColorStop(0.68, "#bcc4d2");
  grad.addColorStop(1, "#848d9d");
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);

  // 은박 결
  g.strokeStyle = "rgba(255,255,255,.16)";
  g.lineWidth = 1;
  for (let i = -N; i < N; i += 8) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + N, N);
    g.stroke();
  }

  if (peekHex) {
    // 모서리가 벗겨져 색이 비치는 자리 (네 모서리 중 하나)
    const corners = [
      [10, 10], [N - 10, 10], [10, N - 10], [N - 10, N - 10],
    ];
    const [cx, cy] = corners[seed % corners.length];
    const blob = g.createRadialGradient(cx, cy, 2, cx, cy, 34);
    blob.addColorStop(0, peekHex);
    blob.addColorStop(0.55, `${peekHex}bb`);
    blob.addColorStop(1, `${peekHex}00`);
    g.fillStyle = blob;
    g.beginPath();
    g.arc(cx, cy, 34, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * 문지르기.
 *
 * 포인터를 캡처해 칸 밖으로 나가도 그 칸을 계속 긁습니다. 손을 떼도 벗겨진 만큼은
 * 남습니다 — 한 번에 다 긁지 못해서 처음부터 다시 하는 일이 없어야 합니다.
 */
function attachScratch(cell, node) {
  const cv = cell.cv;
  const g = cv.getContext("2d");
  g.globalCompositeOperation = "destination-out";

  let drawing = false;
  let last = null;

  /**
   * 화면 좌표 → 캔버스 논리 좌표.
   *
   * **크기가 0인 순간이 실제로 있습니다.** 마지막 칸을 긁으면 곧바로 [pause] 화면으로
   * 넘어가는데, 그때도 손가락은 아직 화면에 닿아 있어 pointermove 가 몇 개 더 들어옵니다.
   * 숨은 화면의 캔버스는 rect 가 0×0 이라 나누면 Infinity 가 나오고, 그 좌표로 선을
   * 이으면 보간 횟수가 무한이 되어 **탭이 그대로 멈춥니다**(브라우저 확인에서 실제로 걸렸습니다).
   * 그래서 좌표를 만들 수 없는 순간에는 null 을 돌려주고 긁기를 멈춥니다.
   */
  const toLocal = (e) => {
    const r = cv.getBoundingClientRect();
    if (!cv.isConnected || r.width <= 0 || r.height <= 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * N,
      y: ((e.clientY - r.top) / r.height) * N,
    };
  };

  /** 한 점을 지우고 진행률 격자를 채웁니다 */
  const rub = (x, y) => {
    g.beginPath();
    g.arc(x, y, BRUSH, 0, Math.PI * 2);
    g.fill();

    const step = N / OCC;
    const gx = Math.floor(x / step);
    const gy = Math.floor(y / step);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = gx + dx;
        const py = gy + dy;
        if (px < 0 || py < 0 || px >= OCC || py >= OCC) continue;
        // 격자 칸 중심이 붓 안에 들어오면 벗겨진 것으로 셉니다
        const cxx = (px + 0.5) * step;
        const cyy = (py + 0.5) * step;
        if ((cxx - x) ** 2 + (cyy - y) ** 2 <= BRUSH ** 2) cell.occ.add(py * OCC + px);
      }
    }
  };

  /**
   * 두 점 사이를 이어 지웁니다 — 빠르게 그으면 점이 띄엄띄엄 오기 때문입니다.
   * 보간 횟수에 상한을 둡니다. 한 칸을 가로지르는 데 필요한 것은 열 번 남짓이라
   * 상한이 손맛을 깎지 않고, 좌표가 이상해도 루프가 끝나는 것이 보장됩니다.
   */
  const rubLine = (a, b) => {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.min(64, Math.max(1, Math.ceil(dist / (BRUSH * 0.6)) || 1));
    for (let i = 1; i <= steps; i++) {
      rub(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    }
  };

  const progress = () => cell.occ.size / (OCC * OCC);

  const canScratch = () => !cell.open && !cell.sent && !state.busy && state.left > 0;

  const maybeCommit = () => {
    if (cell.sent || progress() < COMMIT_AT) return;
    cell.sent = true;
    drawing = false;
    node.classList.add("is-waiting");
    navigator.vibrate?.(18);
    submit(cell);
  };

  cv.addEventListener("pointerdown", (e) => {
    if (!canScratch()) return;
    const p0 = toLocal(e);
    if (!p0) return;

    e.preventDefault();
    drawing = true;
    if (!cell.t0) cell.t0 = performance.now();
    // 캡처하면 칸 밖으로 손이 나가도 그 칸을 계속 긁습니다.
    // 합성 이벤트·일부 브라우저에서는 던질 수 있어 실패해도 진행합니다.
    try {
      cv.setPointerCapture?.(e.pointerId);
    } catch { /* 캡처 없이도 긁힙니다 */ }
    last = p0;
    rub(last.x, last.y);
    cell.strokes += 1;
    node.classList.add("is-rubbing");
  });

  cv.addEventListener("pointermove", (e) => {
    if (!drawing || !canScratch()) return;

    // 버튼(손가락)이 떨어진 뒤의 이동으로는 긁히지 않아야 합니다.
    // 캡처가 걸린 채 pointerup 을 놓치면 drawing 이 남는데, 그러면 마우스를 그냥
    // 올려놓기만 해도 은박이 벗겨지고 긁을 뜻이 없던 칸이 확정될 수 있습니다.
    if (e.buttons === 0) {
      stop();
      return;
    }

    // 화면이 바뀌어 칸이 숨었으면(마지막 칸을 긁은 직후) 여기서 멈춥니다 — toLocal 참조
    const p = toLocal(e);
    if (!p || !last) {
      stop();
      return;
    }

    rubLine(last, p);
    last = p;
    cell.strokes += 1;
    maybeCommit();
  });

  const stop = () => {
    drawing = false;
    node.classList.remove("is-rubbing");
  };
  cv.addEventListener("pointerup", stop);
  cv.addEventListener("pointercancel", stop);
  cv.addEventListener("pointerleave", stop);

  // 키보드·보조기기 — Enter/Space 를 4번 누르면 한 칸이 긁힙니다.
  cv.addEventListener("keydown", (e) => {
    const isKey = ["Enter", " ", "Spacebar"].includes(e.key) || ["Enter", "Space"].includes(e.code);
    if (!isKey) return;
    e.preventDefault();
    if (!canScratch()) return;

    // 눌린 것을 받아들이는 최소 간격.
    // Enter 를 **누른 채로 두면** 자동 반복이 30ms 간격으로 들어와 한 칸이 0.15초에
    // 긁힙니다. 그러면 서버의 궤적 검사(MIN_SCRATCH_MS)에 걸려 키보드 사용자만
    // 이상치로 표시됩니다. 간격을 두면 눌러도 끌어도 사람 속도로 긁힙니다.
    const t = performance.now();
    if (cell.lastKey && t - cell.lastKey < 100) return;
    cell.lastKey = t;

    if (!cell.t0) cell.t0 = t;
    cell.strokes += 1;

    // 눌린 횟수만큼 격자를 채웁니다 (실제 은박도 함께 지웁니다)
    const want = Math.min(OCC * OCC, Math.round((progress() + KEY_STEP) * OCC * OCC));
    const step = N / OCC;
    for (let k = 0; cell.occ.size < want && k < OCC * OCC; k++) {
      if (cell.occ.has(k)) continue;
      rub(((k % OCC) + 0.5) * step, (Math.floor(k / OCC) + 0.5) * step);
    }
    maybeCommit();
  });
}

async function submit(cell) {
  if (state.busy) return;
  state.busy = true;
  const elapsed = Math.max(0, Math.round(performance.now() - (cell.t0 || performance.now())));
  await run.answer({ cell: cell.i, strokes: cell.strokes }, { elapsed_ms: elapsed });
  state.busy = false;
}

// ══════════════════════════════════════════════════════════════
// 판정 연출
// ══════════════════════════════════════════════════════════════

/** 서버가 준 값만 씁니다 — 그림·포인트·매칭은 클라이언트가 정하지 않습니다 */
async function showVerdict(res) {
  const d = res.data ?? {};

  if (d.invalid) {
    const cell = state.cells.find((c) => c.sent && !c.open);
    if (cell) {
      cell.sent = false;
      cell.cv?.parentElement?.classList.remove("is-waiting");
    }
    toast(d.invalid, "error", 1400);
    return;
  }

  // ENDLESS 는 result.detail 이 비어 있어(엔진 구조상) 결과 화면이 쓸 값을 여기서 챕깁니다.
  lastData = d;

  revealCell(d);

  state.left = d.scratches_left ?? 0;
  $("#hudScore").textContent = comma(d.score ?? 0);
  $("#hudLeft").textContent = String(state.left);

  if (d.match) {
    $("#cardBox").classList.add("is-hit");
    setTimeout(() => $("#cardBox").classList.remove("is-hit"), 900);
    toast(`${d.match_icon ?? ""} ${d.match_name ?? ""} 3개! 획득 ${d.multiplier ?? 2}배`, "good", 2200);
    navigator.vibrate?.([20, 40, 30]);
  } else if (d.near && d.near.have >= (d.need ?? 3) - 1) {
    toast(`${d.near.icon} ${d.near.have}개 — 하나만 더!`, "good", 1600);
  }
}

/** 남은 은박을 걷어내고 그림을 확정합니다 */
function revealCell(d) {
  const cell = state.cells.find((c) => c.i === d.cell);
  if (!cell) return;

  cell.open = true;
  const node = cell.cv?.parentElement;
  if (!node) return;

  node.querySelector(".scell__icon").textContent = d.icon ?? "";
  node.querySelector(".scell__pt").textContent = `+${d.points ?? 0}`;
  node.querySelector(".scell__sure")?.remove();

  node.classList.remove("is-waiting", "is-rubbing");
  node.classList.add("is-open");
  cell.cv.remove();
  cell.cv = null;
}

// ══════════════════════════════════════════════════════════════
// 긁기 소진 — 구원 광고
// ══════════════════════════════════════════════════════════════

/**
 * 기획서 8장 — 아깝게 멈춘 순간에만 다른 문구를 씁니다.
 * (문구를 나누는 것이 목적이고, 광고는 매칭 여부와 무관하게 늘 선택할 수 있습니다.
 *  둘 다 제시해야 기획서 15장 가설 1「매칭 2개 판의 선택률이 더 높다」를 잴 수 있습니다)
 */
/**
 * 소진된 런을 새로고침으로 이어받았을 때의 [pause] 화면.
 *
 * 런 컨트롤러의 pause 는 "판정 응답이 exhausted 일 때" 만 나오므로, 이어받기로 들어온
 * 경우에는 같은 화면을 여기서 한 번 더 그립니다. 보상 사용량은 라운드가 실어 준
 * `boosts_used` 를 씁니다 — 이어받기 응답은 그 값을 0 으로 되돌려 주기 때문입니다.
 */
function showResumedPause(round) {
  const t = pauseText();
  $("#pauseSub").textContent = t.sub;
  $("#pauseFigure").textContent = t.figure;

  showScreen("pause");
  clearRewards();

  boostReward(GAME, {
    sessionId: run.state.sessionId,
    label: "한 칸 더 긁기",
    desc: "은박 카드에 한 칸을 더 긁습니다",
    used: round.boosts_used ?? 0,
    max: run.state.maxBoosts,
    onBoosted: (reward) => {
      run.state.paused = false;
      clearRewards();
      showScreen("play");
      renderRound(reward.round);
    },
  });
}

function pauseText() {
  const d = lastData ?? {};
  const near = d.near;
  const nearMiss = !d.matched && (near?.have ?? 0) >= (d.need ?? 3) - 1;

  $("#pauseHeadline").textContent = d.matched
    ? "매칭 성공!"
    : nearMiss
      ? "아, 하나만 더!"
      : "카드를 다 긁었어요";

  return {
    sub: d.matched
      ? `${d.match_icon ?? ""} ${d.match_name ?? ""} 3개로 획득이 2배가 됐어요`
      : nearMiss
        ? `${near.icon} ${near.name} ${near.have}개 — 한 칸만 더 긁으면 두 배였는데`
        : "한 칸을 더 긁어 볼 수 있어요",
    figure: `${comma(d.score ?? 0)}P`,
  };
}

// ══════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════

function onOver(result) {
  lastResult = result;
  showOver(result);
}

function showOver(result) {
  const d = lastData ?? {};
  const near = d.near;
  const nearMiss = !d.matched && (near?.have ?? 0) >= (d.need ?? 3) - 1;

  renderRunOver(result, {
    figure: comma(result.score ?? 0),
    unit: "P",
    sub: d.matched
      ? `${d.match_name ?? ""} 3개 매칭 — 획득 ${d.multiplier ?? 2}배!`
      : nearMiss
        ? `${near.name} ${near.have}개에서 멈췄어요`
        : "오늘도 한 장 긁었어요",
    tiles: [
      { label: "연속 긁기", value: `${d.streak ?? 1}일`, accent: true },
      { label: "매칭", value: d.matched ? "성공" : "다음에" },
      { label: "누적 매칭", value: `${d.matches_total ?? 0}번` },
    ],
    formatBest,
  });

  // 종료 화면 (기획서 8장) — 재방문 동기는 광고가 아니라 내일의 카드입니다.
  const streak = d.streak ?? 1;
  const toHint = 7 - (streak % 7);
  $("#tomorrowText").textContent =
    d.day_bonus > 0
      ? `연속 ${streak}일 보너스 +${d.day_bonus}P! 내일 카드도 밤 12시에 도착해요.`
      : `내일 카드가 밤 12시에 도착해요 — 연속 ${streak}일째. ${toHint}일 더 긁으면 그림 하나가 미리 공개됩니다.`;

  renderOverRewards();
}

function renderOverRewards() {
  clearRewards();
  statsReward(GAME, { desc: "연속 긁기 일수 분포와 TOP 20", onOpen: showStats });
}

async function showStats() {
  await openStats(GAME, {
    bucket: lastResult?.bucket,
    render: (stats) => {
      renderStatsScreen(stats, {
        mine: lastResult?.rank_metric ?? null,
        caption: "연속 긁기 일수 분포 · 왼쪽이 길게 이어옴",
        formatBest,
      });
      loadRankList(GAME, lastResult?.bucket, formatBest);
      clearRewards();
    },
  });
}
