/**
 * ③ 타이핑 챌린지
 *
 * 실시간 CPM/WPM·정확도는 화면 표시용으로 클라이언트가 계산하고,
 * 순위에 들어가는 최종 수치는 서버가 원본 문장과 제출 문자열을 비교해 다시 계산합니다.
 * 즉 화면 숫자를 조작해도 기록은 바뀌지 않습니다.
 */

import { apiGet, apiPost, ApiFail } from "../../shared/api.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../../shared/ad.js";
import {
  $, el, clear, showScreen, toast, renderPips, renderStats, renderHeader,
  celebrate, mmss, comma, currentScreen,
} from "../../shared/ui.js";

const DIFFICULTY_LABEL = { easy: "쉬움", normal: "보통", hard: "어려움" };
const LANG_LABEL = { ko: "한국어", en: "English", mix: "한·영 혼합" };
const METRIC_LABEL = { wpm: "WPM", cpm: "타수 CPM" };

const state = {
  lang: "ko",
  difficulty: "easy",
  session: null,
  targetChars: [],
  t0: 0,
  raf: 0,
  finished: false,
  lastResult: null,
  previewChars: 0,
};

// ── 초기화 ───────────────────────────────────────────────────

renderHeader($("#header"), { icon: "⌨", title: "타이핑 챌린지" });

buildSegments();
$("#startBtn").addEventListener("click", beginChallenge);
$("#finishBtn").addEventListener("click", () => finish("manual"));
$("#retryBtn").addEventListener("click", () => showSetup());
$("#viewRankBtn").addEventListener("click", openRank);
$("#rankBackBtn").addEventListener("click", () => {
  showScreen("result");
  renderRewards("result");
});

$("#typingInput").addEventListener("input", onInput);

loadAttempts();
loadPreview();
showSetup();

// ── 설정 화면 ────────────────────────────────────────────────

function buildSegments() {
  const seg = (host, options, current, onPick, labels) => {
    clear(host);
    for (const key of options) {
      host.append(
        el(
          "button",
          { class: "seg__item", type: "button", "aria-pressed": key === current, onclick: () => onPick(key) },
          labels[key],
        ),
      );
    }
  };

  seg($("#difficultySeg"), ["easy", "normal", "hard"], state.difficulty, (d) => {
    state.difficulty = d;
    buildSegments();
    loadPreview();
  }, DIFFICULTY_LABEL);

  seg($("#langSeg"), ["ko", "en", "mix"], state.lang, (l) => {
    state.lang = l;
    buildSegments();
    loadPreview();
  }, LANG_LABEL);

  updateMetricHint();
  updateSummary();
}

function updateMetricHint() {
  const metric = state.lang === "en" ? "WPM / 분당 단어 수" : "CPM / 분당 글자 수";
  $("#metricHint").textContent = `순위 기준: ${metric}`;
}

/** 시작 버튼 바로 위에 현재 선택값을 짧게 요약 */
function updateSummary() {
  clear($("#selectionSummary")).append(
    el("span", { class: "chip chip--accent" }, LANG_LABEL[state.lang]),
    el("span", { class: "chip chip--accent" }, DIFFICULTY_LABEL[state.difficulty]),
    state.previewChars > 0 ? el("span", { class: "chip" }, `약 ${state.previewChars}자`) : null,
  );
}

function showSetup() {
  showScreen("setup");
  renderRewards("setup");
  loadAttempts();
}

async function loadAttempts() {
  try {
    const res = await apiGet("/user/attempts", { game: "TYPING" });
    const { total, used, remaining } = res.attempts;
    renderPips($("#attemptDots"), { total, used, base: 5 });
    clear($("#attemptText")).append(
      document.createTextNode(String(remaining)),
      el("span", { class: "figure__sub" }, ` / ${total}회`),
    );
  } catch {
    $("#attemptText").textContent = "—";
  }
}

async function loadPreview() {
  try {
    const res = await apiGet("/game/preview", { lang: state.lang });
    const match = (res.previews ?? []).find((p) => p.difficulty === state.difficulty);
    $("#preview").textContent = match ? match.text : "문장을 불러올 수 없습니다.";
    state.previewChars = match?.char_count ?? 0;
    updateSummary();
  } catch {
    $("#preview").textContent = "문장을 불러올 수 없습니다.";
  }
}

// ── 도전 시작 ────────────────────────────────────────────────

async function beginChallenge() {
  $("#startBtn").disabled = true;
  try {
    const res = await apiPost("/game/session/start", {
      game_type: "TYPING",
      lang: state.lang,
      difficulty: state.difficulty,
    });
    state.session = res;
    state.targetChars = [...res.text];
    runCountdown();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "NO_ATTEMPTS") {
      toast("오늘 도전 기회를 모두 사용했습니다. 광고를 보면 추가됩니다.", "error");
    } else {
      toast(err.message ?? "도전을 시작할 수 없습니다.", "error");
    }
  } finally {
    $("#startBtn").disabled = false;
  }
}

/** 화면① → ② 사이의 3초 카운트다운 */
function runCountdown() {
  $("#countdownText").textContent = state.session.text;
  showScreen("countdown");
  clearAllRewards();

  let n = 3;
  $("#countdownNum").textContent = n;
  const iv = setInterval(() => {
    n -= 1;
    if (n > 0) {
      $("#countdownNum").textContent = n;
      return;
    }
    clearInterval(iv);
    startPlaying();
  }, 1000);
}

function startPlaying() {
  state.finished = false;
  state.t0 = performance.now();

  // 카운트다운이 끝난 시각을 서버에 알립니다(응답은 기다리지 않음).
  apiPost("/game/session/arm", { game_type: "TYPING", session_id: state.session.session_id }).catch(() => {});

  $("#typingInput").value = "";
  $("#typingInput").disabled = false;
  renderTarget("");
  showScreen("play");
  $("#typingInput").focus();

  $("#liveSpeedLabel").textContent = METRIC_LABEL[state.session.primary_metric];
  state.raf = requestAnimationFrame(liveTick);
}

// ── 진행 중 ──────────────────────────────────────────────────

function onInput() {
  if (state.finished) return;
  const typed = $("#typingInput").value;
  renderTarget(typed);

  // 문장을 끝까지 정확히 입력하면 자동 종료
  if (typed.length >= state.targetChars.length) finish("complete");
}

/** 원본 문장을 글자 단위로 색칠합니다 (입력 완료분/오타/커서) */
function renderTarget(typed) {
  const host = clear($("#targetText"));
  const u = [...typed];

  state.targetChars.forEach((ch, i) => {
    let cls = "";
    if (i < u.length) cls = u[i] === ch ? "ch--ok" : "ch--bad";
    else if (i === u.length) cls = "ch--cursor";
    host.append(el("span", { class: cls }, ch === " " ? " " : ch));
  });

  if (u.length > state.targetChars.length) {
    host.append(el("span", { class: "ch--bad" }, u.slice(state.targetChars.length).join("")));
  }
}

function liveTick() {
  if (state.finished) return;

  const elapsed = performance.now() - state.t0;
  const typed = $("#typingInput").value;
  const minutes = elapsed / 60000;
  const u = [...typed];

  const words = typed.trim().split(/\s+/).filter(Boolean).length;
  const wpm = minutes > 0 ? words / minutes : 0;
  const cpm = minutes > 0 ? u.length / minutes : 0;
  const speed = state.session.primary_metric === "wpm" ? wpm : cpm;

  let correct = 0;
  for (let i = 0; i < Math.min(u.length, state.targetChars.length); i++) {
    if (u[i] === state.targetChars[i]) correct++;
  }
  const typos = u.length - correct;
  const acc = u.length > 0 ? (correct / u.length) * 100 : 100;

  const limit = state.session.time_limit_ms;
  const left = Math.max(0, limit - elapsed);
  const progress = Math.min(100, (u.length / state.targetChars.length) * 100);

  $("#liveSpeed").textContent = Math.round(speed);
  $("#liveAcc").textContent = `${Math.round(acc)}%`;
  $("#liveTypos").textContent = typos;
  $("#liveLeft").textContent = mmss(left);
  $("#progressText").textContent = `진행률 ${Math.round(progress)}%`;
  $("#progressFill").style.width = `${progress}%`;

  if (left <= 0) {
    finish("timeout");
    return;
  }
  state.raf = requestAnimationFrame(liveTick);
}

// ── 종료 / 제출 ──────────────────────────────────────────────

async function finish(reason) {
  if (state.finished) return;
  state.finished = true;
  cancelAnimationFrame(state.raf);
  state.raf = 0;

  const elapsedMs = Math.max(1000, Math.round(performance.now() - state.t0));
  const typed = $("#typingInput").value;
  $("#typingInput").disabled = true;

  try {
    const res = await apiPost("/game/submit", {
      game_type: "TYPING",
      session_id: state.session.session_id,
      typed_text: typed,
      elapsed_ms: elapsedMs,
    });
    state.lastResult = res;
    renderResult(res, reason);
  } catch (err) {
    if (err instanceof ApiFail && err.code === "ABNORMAL_SPEED") {
      toast(err.message, "error", 4000);
    } else {
      toast(err.message ?? "결과를 제출할 수 없습니다.", "error");
    }
    showSetup();
  }
}

function verdictOf(res) {
  if (res.accuracy >= 98 && res.completion >= 100) return { badge: "🎯", headline: "완벽해요!", great: true };
  if (res.accuracy >= 90) return { badge: "🎉", headline: "훌륭해요!", great: true };
  if (res.accuracy >= 70) return { badge: "👍", headline: "좋아요!", great: false };
  return { badge: "🌙", headline: "다시 도전해볼까요?", great: false };
}

function renderResult(res, reason) {
  const v = verdictOf(res);
  const primaryLabel = METRIC_LABEL[res.primary_metric];
  const primaryValue = res.primary_metric === "wpm" ? res.wpm : res.cpm;

  const badge = $("#resultBadge");
  badge.textContent = v.badge;
  badge.className = v.great ? "badge-round" : "badge-round badge-round--quiet";

  $("#resultHeadline").textContent = v.headline;
  $("#resultSub").textContent = `${LANG_LABEL[state.lang]} · ${DIFFICULTY_LABEL[state.difficulty]} · 최종 점수`;
  $("#resultScore").textContent = comma(res.score);

  clear($("#resultChips")).append(
    el("span", { class: "chip" }, `전체 ${comma(res.bucket_total)}명`),
    el("span", { class: "chip chip--accent" }, `#${comma(res.rank)} · TOP ${res.rank_pct}%`),
  );

  renderStats(
    $("#resultTiles"),
    [
      { label: "정확도", value: `${Math.round(res.accuracy)}%`, accent: true },
      { label: primaryLabel, value: Math.round(primaryValue) },
      { label: "소요", value: mmss(res.elapsed_ms) },
    ],
    { inset: true },
  );

  const extra = res.primary_metric === "cpm" ? `${res.wpm} WPM` : `${Math.round(res.cpm)} 타수`;
  const reasonText = reason === "timeout" ? "시간 초과 · " : "";
  // 정확도는 원본 전체 글자 수 기준이므로, 끝까지 못 친 경우 이유를 함께 알려 줍니다.
  const partial = res.completion < 100 ? ` · 완성도 ${res.completion}% (${res.typed_chars}/${res.target_chars}자)` : "";
  $("#resultNote").textContent = `${reasonText}오탈자 ${res.typos}개 · ${extra}${partial}`;

  showScreen("result");
  renderRewards("result");

  if (v.great) celebrate($("#resultCard"));
}

// ── 새 문장 도전권 (보상형 광고) ───────────────────────────────

async function requestNewSentence() {
  const res = await watchAdForReward("TYPING_SENTENCE");
  if (!res) return;
  toast("새 문장 도전권이 지급되었습니다.", "good");
  showSetup();
}

// ── 전체 순위 (전면 광고 후 열람) ──────────────────────────────

async function openRank() {
  const bucket = state.lastResult?.bucket;
  const load = async () => {
    renderRank(await apiGet("/game/rank", { game: "TYPING", bucket }));
    renderBuckets(await apiGet("/game/stats", { game: "TYPING", bucket }));
  };

  try {
    await load();
  } catch (err) {
    if (err instanceof ApiFail && err.code === "AD_REQUIRED") {
      if (!(await watchAdForReward("TYPING_RANK"))) return;
      try {
        await load();
      } catch (e) {
        toast(e.message, "error");
      }
      return;
    }
    toast(err.message, "error");
  }
}

function renderRank(data) {
  const [lang, difficulty] = String(data.bucket ?? ":").split(":");
  $("#rankTitle").textContent = `${LANG_LABEL[lang] ?? lang} · ${DIFFICULTY_LABEL[difficulty] ?? difficulty} 순위`;

  const host = clear($("#rankList"));
  if ((data.list ?? []).length === 0) {
    host.append(el("div", { class: "footnote--dim center" }, "아직 기록이 없습니다"));
  }
  for (const row of data.list ?? []) {
    const mine = data.my_rank === row.rank;
    host.append(
      el(
        "div",
        { class: `rank-row ${mine ? "is-me" : ""}` },
        el("span", { class: "rank-row__no" }, mine ? "ME" : `#${row.rank}`),
        el("span", { class: "rank-row__name" }, `${row.label} · 정확도 ${Math.round(row.accuracy ?? 0)}%`),
        el("span", { class: "rank-row__value" }, comma(row.score)),
      ),
    );
  }

  showScreen("rank");
  clearAllRewards();
}

function renderBuckets(stats) {
  const host = clear($("#bucketList"));
  for (const b of stats.by_bucket ?? []) {
    const [lang, difficulty] = b.bucket.split(":");
    host.append(
      el(
        "div",
        { class: "rank-row" },
        el("span", { class: "rank-row__no" }, comma(b.count)),
        el("span", { class: "rank-row__name" }, `${LANG_LABEL[lang] ?? lang} · ${DIFFICULTY_LABEL[difficulty] ?? difficulty}`),
        el("span", { class: "rank-row__value" }, `${comma(b.avg_score)} · ${b.avg_accuracy}%`),
      ),
    );
  }
}

// ── 보상 카드 ────────────────────────────────────────────────

// 함수 선언으로 둡니다. 모듈 최상단에서 showSetup() 이 동기적으로 호출하므로,
// const 화살표 함수로 두면 초기화 전에 접근해서 ReferenceError 가 납니다.
function clearAllRewards() {
  clearRewardCard($("#adbar"));
  clearRewardCard($("#adbar2"));
}

function renderRewards(screen) {
  clearAllRewards();

  if (screen === "setup") {
    renderRewardCard($("#adbar"), {
      icon: "📄",
      title: "광고 보고 새 문장 받기",
      desc: "하루 5회까지",
      cta: "받기",
      onClick: requestNewSentence,
    });
    return;
  }

  if (screen === "result") {
    renderRewardCard($("#adbar2"), {
      icon: "🏆",
      title: "광고 보고 전체 순위 열람",
      desc: "같은 언어·난이도 참가자 순위",
      cta: "보기",
      onClick: openRank,
    });
  }
}

// 진행 중에 화면을 벗어나면 알려 줍니다.
window.addEventListener("visibilitychange", () => {
  if (document.hidden && currentScreen() === "play" && !state.finished) {
    toast("화면을 벗어나면 기록이 불리해집니다.", "error", 2000);
  }
});
