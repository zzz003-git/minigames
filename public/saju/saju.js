/**
 * 🌤️ 오늘의 사주 — 화면
 *
 * 기획: SAJU-SPEC-01 · 만세력: docs/saju-calendar.md
 *
 * ── 계산은 전부 서버가 한다 ──────────────────────────────────────────────
 * 명식·일진·십신·지지관계·오행은 서버가 정해 내려준다. 화면이 정할 수 있으면
 * 도장판을 원하는 간지로 채울 수 있고 그건 순 완성 +20P·대완성 +100P 에 닿는다.
 * 여기서 하는 것은 **그 파라미터로 문장을 고르는 것**뿐이다(보상과 무관).
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, toast, renderHeader, setHeaderBadge } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { SAJU_DB } from "./saju-db.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { renderNextStep } from "../shared/nextstep.js";

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
const EL_NAME = ["나무", "불", "흙", "쇠", "물"];
const DIST_SOON = "사람이 더 모이면 열려요";

const ARM_DELAY_MS = 400;
const state = { st: null, last: null };

// 원안의 `activeView = inSuite ? 'hub' : v` — 서비스 화면에서도 「오늘의 나」 탭이
// 켜진 채 남는다. 게임 화면과 달리 여기는 판 중이 아니라 결과를 보는 자리다.
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "🌤️", title: "오늘의 사주", back: "/today/" });

// 생일 고치기·지우기 자리 — 명식·리딩 화면의 메모 아래. HTML 에 id 를 더하지 않고 여기서 만든다 (REQ-62 ⑫⑰)
const profileBoxes = ["#chartNote", "#rdNote"].map((sel) => {
  const box = el("div", { class: "center" });
  $(sel).after(box);
  return box;
});

$("#regBtn").addEventListener("click", register);
$("#orb").addEventListener("click", stampToday);
$("#stampBtn").addEventListener("click", showStamps);
$("#stampBtn2").addEventListener("click", showStamps);
$("#stampBackBtn").addEventListener("click", () => showScreen(state.st?.done ? "reading" : "chart"));

boot();

/** 같은 입력이면 언제나 같은 문장 — 날짜가 바뀔 때만 바뀐다 */
function seeded(str) {
  let h = 2166136261;
  for (const c of String(str)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
const pick = (arr, seed) => arr[seeded(seed) % arr.length];

async function boot() {
  try {
    state.st = await apiGet("/api/saju/state");
  } catch (err) {
    toast(err.message ?? "불러오지 못했습니다.", "error");
    return;
  }

  showMain();
}

/** 등록 전이면 등록 화면, 아니면 명식(오늘 꽂았으면 리딩) */
function showMain() {
  if (!state.st.registered) {
    showScreen("reg");
    return;
  }
  renderChart();
  if (state.st.done) renderReading(null);
}

// ══════════════════════════════════════════════════════════════
// 등록
// ══════════════════════════════════════════════════════════════

async function register() {
  const birth = $("#birth").value;
  // 시·분 직접 입력(선택). 비우면 시간 모름 — 보정은 서버가 생일 날짜로 한다 (REQ-62 ② · E3)
  const [h, m] = $("#birthTime").value.split(":");
  if (!birth) {
    toast("생년월일을 골라 주세요", "error");
    return;
  }

  $("#regBtn").disabled = true;
  try {
    await apiPost("/api/saju/profile", { birth, hour: h ? Number(h) : null, minute: h ? Number(m) : null });
    state.st = await apiGet("/api/saju/state");
    showMain();
    toast("명식을 세웠어요", "good");
  } catch (err) {
    const msg =
      err instanceof ApiFail && err.code === "OUT_OF_RANGE"
        ? "1930~2050년 사이만 지원해요"
        : err.message;
    toast(msg ?? "등록하지 못했습니다.", "error");
  } finally {
    $("#regBtn").disabled = false;
  }
}

const ghostBtn = (label, onClick) => el("button", { class: "btn btn--ghost", type: "button", onclick: onClick }, label);

/** 생일 고치기(24시간 1회 · 이후 30일) · 지우기 — 열 수 있는지는 서버가 준 값으로만 판단한다 */
function renderProfileLinks() {
  const pc = state.st.profile_change ?? {};
  const canFix = pc.fix_open || !pc.next_day || pc.next_day <= state.st.day;
  for (const box of profileBoxes) {
    clear(box);
    if (canFix) box.append(ghostBtn("생일 정보 고치기", openFix));
    else {
      const [, m, d] = pc.next_day.split("-").map(Number);
      box.append(el("p", { class: "footnote--dim" }, `${m}월 ${d}일부터 바꿀 수 있어요`));
    }
    box.append(ghostBtn("내 사주 정보 지우기", () => confirmDelete(box)));
  }
}

/** 등록 화면을 지금 값으로 채워 연다 — 옛 12칸 값도 서버가 시:분으로 바꿔 준다 */
function openFix() {
  const p = state.st.profile;
  const pad = (n) => String(n).padStart(2, "0");
  $("#birth").value = p.birth;
  $("#birthTime").value = p.hour == null ? "" : `${pad(p.hour)}:${pad(p.minute ?? 0)}`;
  showScreen("reg");
}

function confirmDelete(box) {
  clear(box).append(
    el("p", { class: "footnote" }, "생일과 태어난 시간을 지워요. 모은 도장은 그대로 남아요."),
    ghostBtn("지우기", async () => {
      try {
        await apiPost("/api/saju/profile/delete", {});
        state.st = await apiGet("/api/saju/state");
        $("#birth").value = "";
        $("#birthTime").value = "";
        setHeaderBadge("");
        showMain();
      } catch (err) {
        toast(err.message ?? "지우지 못했습니다.", "error");
      }
    }),
    ghostBtn("그만두기", renderProfileLinks),
  );
}

// ══════════════════════════════════════════════════════════════
// 명식
// ══════════════════════════════════════════════════════════════

function renderChart() {
  const c = state.st.chart;
  const host = clear($("#pillars"));

  const col = (label, p) =>
    el(
      "div",
      { class: `pillar ${p ? "" : "pillar--empty"}` },
      el("div", { class: "pillar__label" }, label),
      el("div", { class: `pillar__stem ${p ? `el${STEM_EL[p.stem]}` : ""}` }, p ? STEMS[p.stem] : "?"),
      el("div", { class: `pillar__branch ${p ? `el${BRANCH_EL[p.branch]}` : ""}` }, p ? BRANCHES[p.branch] : "?"),
    );

  host.append(col("연주", c.year), col("월주", c.month), col("일주", c.day), col("시주", c.hour));

  $("#orbName").textContent = state.st.today.name;
  $("#orb").disabled = state.st.done;
  $("#orbHint").textContent = state.st.done
    ? "오늘은 이미 꽂았어요"
    : "구슬을 눌러 오늘을 꽂아 보세요";

  const dm = SAJU_DB.dayMaster[c.day_master.stem];
  setHeaderBadge(`${c.day_master.name} 일간`);
  $("#chartNote").textContent = `${pick(dm.intro, state.st.day + "dm")} · 도장 ${state.st.stamp_count}/60`;

  // 명식 화면에서는 다른 서비스로 보내지 않는다 — 오늘 몫을 하기 전 이탈 금지 (REQ-63 hub/IMPL)
  renderProfileLinks();
  showScreen("chart");
}

// ══════════════════════════════════════════════════════════════
// 꽂기 · 리딩
// ══════════════════════════════════════════════════════════════

async function stampToday() {
  $("#orb").disabled = true;
  try {
    const res = await apiPost("/api/saju/today", {});
    state.st = await apiGet("/api/saju/state");
    renderReading(res);
  } catch (err) {
    if (err instanceof ApiFail && err.code === "ALREADY_DONE") {
      state.st = await apiGet("/api/saju/state");
      renderReading(null);
      return;
    }
    toast(err.message ?? "꽂지 못했습니다.", "error");
    $("#orb").disabled = false;
  }
}

function renderReading(res) {
  const day = state.st.day;
  const gz = state.st.today.ganzhi;
  const c = state.st.chart;

  // 리딩 파라미터는 서버가 준 것을 쓴다. 재열람이면 state 의 reading — 오늘 십신은 꽂을 때
  // 저장한 값이라 그 뒤 생일을 고쳐도 허브·분포와 같다 (REQ-62 ①).
  // reading 이 없는 것은 꽂기 도중 허브 기록이 실패한 경우뿐이다 — 그때만 지금 명식으로 세운다
  const rd = res?.reading ??
    state.st.reading ?? {
      ten_god: tenGodLocal(c.day.stem, gz % 10),
      relation: null,
      my_element: STEM_EL[c.day.stem],
      today_element: STEM_EL[gz % 10],
    };
  const god = rd.ten_god;
  const rel = rd.relation;
  const myEl = rd.my_element;
  const todayEl = rd.today_element;

  const tg = SAJU_DB.tenGod[god];
  $("#rdGanzhi").textContent = `${state.st.today.name} · ${tg.name}`;
  $("#rdTheme").textContent = pick(tg.theme, `${day}|theme|${god}`);
  $("#rdIljin").textContent = SAJU_DB.iljin60[gz];
  $("#rdAdvice").textContent = pick(tg.advice, `${day}|adv|${god}`);

  const rl = rel ? SAJU_DB.branchRel.find((r) => r.key === rel) : null;
  $("#rdRelation").textContent = rl ? pick(rl.lines, `${day}|rel|${rel}`) : "오늘은 평온한 날이에요.";
  $("#rdElement").textContent = SAJU_DB.elementMatrix[myEl][todayEl];

  clear($("#rdLucky")).append(
    stat("내 기운", EL_NAME[myEl]),
    stat("오늘 기운", EL_NAME[todayEl]),
    stat("행운의 물건", pick(SAJU_DB.luckyItems, `${day}|item|${gz}`)),
  );

  $("#rdGain").textContent = res
    ? `+${res.gained}P 적립 · 도장 ${state.st.stamp_count}/60${res.is_new ? " (새 칸!)" : ""}`
    : `오늘의 기운을 꽂았어요 · 도장 ${state.st.stamp_count}/60`;

  const soon = Math.floor(gz / 10);
  $("#rdNote").textContent = `이번 순 ${state.st.soon_done[soon]}/10`;

  // 서비스 사이 이동 = 공용 다음 안내 바 (REQ-63 · 크로스 칩 대체)
  renderNextStep({ svc: "saju", suite: state.st.suite, justCompleted: (res?.triple_gained ?? 0) > 0 });
  renderProfileLinks();
  renderAds();
  showScreen("reading");
  armScreen("reading");
}

/** 서버와 같은 규칙 — 내일 미리보기의 한 줄에 쓴다(오늘 리딩은 서버 값이 온다) */
function tenGodLocal(me, other) {
  const GEN = [1, 2, 3, 4, 0];
  const CTRL = [2, 3, 4, 0, 1];
  const em = STEM_EL[me];
  const eo = STEM_EL[other];
  const same = me % 2 === other % 2;
  if (em === eo) return same ? 0 : 1;
  if (GEN[em] === eo) return same ? 2 : 3;
  if (CTRL[em] === eo) return same ? 4 : 5;
  if (CTRL[eo] === em) return same ? 6 : 7;
  return same ? 8 : 9;
}

const stat = (label, value) =>
  el("div", { class: "stat" },
    el("div", { class: "stat__label" }, label),
    el("div", { class: "stat__value" }, value));

function armScreen(name, ms = ARM_DELAY_MS) {
  const s = document.querySelector(`[data-screen="${name}"]`);
  if (!s) return;
  s.style.pointerEvents = "none";
  setTimeout(() => { s.style.pointerEvents = ""; }, ms);
}

// ══════════════════════════════════════════════════════════════
// 광고
// ══════════════════════════════════════════════════════════════

function renderAds() {
  clearRewardCard($("#adbarTomorrow"));
  clearRewardCard($("#adbarStats"));

  if (state.st.ad_tomorrow) {
    // 본 뒤에는 그 자리에 그날 내내 카드로 남긴다 — 토스트 2.4초가 전부면 받은 것이 없다 (REQ-62 ⑦)
    $("#adbarTomorrow").append(
      el("div", { class: "card card--info" }, el("p", { class: "footnote" }, tomorrowLine())),
    );
  } else {
    renderRewardCard($("#adbarTomorrow"), {
      icon: "🌅",
      title: "광고 보고 내일 미리보기",
      desc: "미리 봐도 오늘의 운세와 적립은 그대로예요",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("SAJU_TOMORROW");
        if (!r) return;
        state.st = await apiGet("/api/saju/state");
        renderAds();
      },
    });
  }

  // 분포가 아직 닫혀 있으면 광고 카드를 내지 않는다 — 봐도 받을 것이 없다 (REQ-62 ⑭ · D2)
  if (state.st.ad_stats_seen) {
    loadStats();
  } else if (!state.st.dist_open) {
    $("#rdDist").textContent = DIST_SOON;
  } else {
    $("#rdDist").textContent = "전국 분포는 광고를 보면 열려요";
    renderRewardCard($("#adbarStats"), {
      icon: "🗺️",
      title: "광고 보고 전국 분포 보기",
      desc: "오늘 같은 기운을 받은 사람들",
      note: "봐도 오늘의 운세와 적립은 그대로예요",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("SAJU_STATS");
        if (!r) return;
        state.st = await apiGet("/api/saju/state");
        renderAds();
      },
    });
  }
}

/**
 * 내일 미리보기 한 줄 — 내일 리딩 헤드라인(#rdTheme)과 **같은 함수·같은 시드**라 다음 날 같은 문장이 나온다.
 * 내일 = 서버 day + 1(UTC 계산, 서버 unlockTomorrow 와 같은 방식). 기기 시계를 쓰지 않는다.
 */
function tomorrowLine() {
  const [y, m, d] = state.st.day.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const tgz = (state.st.today.ganzhi + 1) % 60;
  const god = tenGodLocal(state.st.chart.day.stem, tgz % 10);
  return `내일 ${STEMS[tgz % 10]}${BRANCHES[tgz % 12]}일 · ${pick(SAJU_DB.tenGod[god].theme, `${tomorrow}|theme|${god}`)}`;
}

async function loadStats() {
  try {
    const s = await apiGet("/api/saju/stats");
    const line = $("#rdDist");
    if (!s.open) {
      line.textContent = DIST_SOON;
      return;
    }
    const mine = s.items.find((i) => String(i.key) === String(s.mine));
    const top = SAJU_DB.tenGod[Number(s.items[0].key)]?.name ?? "—";
    line.textContent = mine
      ? `나와 같은 십신 ${mine.pct}% · 오늘 가장 많은 기운은 ${top}(${s.items[0].pct}%)`
      : `오늘 가장 많은 기운은 ${top}(${s.items[0].pct}%)`;
  } catch {
    /* 광고 전이면 잠겨 있는 것이 정상이다 */
  }
}

// ══════════════════════════════════════════════════════════════
// 도장판
// ══════════════════════════════════════════════════════════════

function showStamps() {
  const got = new Set(state.st.stamps ?? []);
  const today = state.st.today.ganzhi;
  const host = clear($("#stampGrid"));

  for (let i = 0; i < 60; i++) {
    const name = STEMS[i % 10] + BRANCHES[i % 12];
    host.append(
      el("div", {
        class: `stampcell ${got.has(i) ? "is-got" : ""} ${i === today ? "is-today" : ""}`,
        title: name,
      }, got.has(i) ? name : ""),
    );
  }

  $("#stampTitle").textContent = `도장판 ${got.size} / 60`;
  showScreen("stamp");
}
