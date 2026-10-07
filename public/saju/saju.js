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
import { $, $$, el, clear, showScreen, toast, renderHeader } from "../shared/ui.js";
import { watchAdForReward, renderRewardCard, clearRewardCard } from "../shared/ad.js";
import { SAJU_DB } from "./saju-db.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { renderNextStep } from "../shared/nextstep.js";

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
const STEM_HJ = "甲乙丙丁戊己庚辛壬癸";
const BRANCH_HJ = "子丑寅卯辰巳午未申酉戌亥";
const EL_NAME = ["나무", "불", "흙", "쇠", "물"];
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 오늘 운세 유형 — 십신의 쉬운 이름(flow/saju.md D-2). 십신 이름은 뒤에 괄호로 작게 */
const TYPE_EASY = [
  "나와 비슷한 사람이 힘이 되는 날", "경쟁심이 힘이 되는 날", "즐기는 일에서 결과가 나오는 날",
  "말과 표현이 잘 통하는 날", "움직인 만큼 돌아오는 날", "차곡차곡 쌓이는 날",
  "밀어붙이면 풀리는 날", "원칙대로 하면 이기는 날", "직감과 남다른 생각이 통하는 날",
  "도움과 배움이 들어오는 날",
];

/** 서버 chart.notes(보정 메모) → 쉬운 말 (s7 「계산 기준 보기」 · recheck N5). 없는 항목은 보이지 않는다 */
const NOTE_EASY = {
  "경도 보정 −30분": "태어난 곳의 해 위치에 맞춰 시계보다 30분 이르게 봐요",
  "UTC+8:30 시기 — 경도 보정 없음": "그 무렵 표준시는 이미 해 위치에 가까워 그대로 봐요",
  "서머타임 −60분": "그해 여름 시간(서머타임)을 1시간 되돌려 봐요",
  "야자시 — 일진은 다음 날": "보정한 시각이 밤 11시를 넘어 ‘날’ 칸은 다음 날 글자예요",
};

const ARM_DELAY_MS = 400;
/** 14세 미만 거부를 이 기기에 기억한다 — 다음 안내 바·허브가 사주를 「이용 불가」로 볼 때 쓴다 */
const TOO_YOUNG_KEY = "mg_saju_too_young";
const MORE_KEY = "mg_saju_more_open";
const state = { st: null, form: null, busy: false };

/** 편의 기억(펼침·14세) — 막혀 있어도 화면은 돌아간다 */
const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* 기억 못 해도 그만 */
    }
  },
};

// 원안의 `activeView = inSuite ? 'hub' : v` — 서비스 화면에서도 「오늘의 나」 탭이
// 켜진 채 남는다. 게임 화면과 달리 여기는 판 중이 아니라 결과를 보는 자리다.
renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "印", title: "오늘의 사주", back: "/today/" });

$("#hourFold").addEventListener("click", () => setHourOpen($("#hourBox").hidden));
$("#hourClear").addEventListener("click", () => {
  $("#hourH").value = "";
  $("#hourM").value = "";
  setHourOpen(false);
});
$("#regBtn").addEventListener("click", openConfirm);
$("#confirmOk").addEventListener("click", register);
$("#confirmEdit").addEventListener("click", () => closeSheet("confirm"));
$("#confirmDim").addEventListener("click", () => closeSheet("confirm"));
$("#orb").addEventListener("click", stampToday);
$("#stampBtn2").addEventListener("click", showStamps);
$("#stampBackBtn").addEventListener("click", backToToday);
$("#stampAll").addEventListener("click", () => {
  const open = $("#stampAllBody").hidden;
  $("#stampAllBody").hidden = !open;
  $("#stampAll").setAttribute("aria-expanded", String(open));
});
$("#moreToggle").addEventListener("click", () => {
  const open = $("#moreBody").hidden;
  setMore(open);
  ls.set(MORE_KEY, open ? "1" : null);
});
$("#mychartLink").addEventListener("click", showMyChart);
$("#mychartBack").addEventListener("click", backToToday);
for (const a of $$("[data-edit-profile]")) {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    if (!a.classList.contains("is-locked")) openFix();
  });
}
$("#deleteProfile").addEventListener("click", openDelete);
$("#deleteOk").addEventListener("click", doDelete);
$("#deleteCancel").addEventListener("click", () => closeSheet("delete"));
$("#deleteDim").addEventListener("click", () => closeSheet("delete"));

boot();

const pad2 = (n) => String(n).padStart(2, "0");
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const dowOf = (day) => WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()];
const gzName = (g) => STEMS[g % 10] + BRANCHES[g % 12];
const hanSpans = (g) => [el("span", {}, STEM_HJ[g % 10]), el("span", {}, BRANCH_HJ[g % 12])];
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function backToToday() {
  showScreen(state.st?.done ? "reading" : "chart");
}
/** 「1976.3.14」 */
const birthDot = (birth) => birth.split("-").map(Number).join(".");
/** 「오후 2시 30분」 — 넣은 값 그대로(보정 설명 없음) */
const timeLabel = (h, m) =>
  `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시${m ? ` ${m}분` : ""}`;
/** 「나는 ‘…’ 같은 사람」 — 일간 소개는 날짜마다 바뀌지 않게 첫 문장 고정(v3 · impact #19) */
const myIntro = () => SAJU_DB.dayMaster[state.st.chart.day_master.stem].intro[0];

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

/**
 * 첫 방문 흐름(K4): 생일 → 확인 → 인장 찍기 → 오늘의 한 줄. 기둥은 「내 글자 보기」 안에.
 * 등록 전이면 등록, 오늘 아직이면 인장, 오늘 열었으면 오늘의 한 줄.
 */
function showMain() {
  renderEditLinks();
  if (!state.st.registered) {
    renderReg();
    showScreen("reg");
    return;
  }
  if (state.st.done) renderReading(null);
  else renderStampScreen();
}

// ══════════════════════════════════════════════════════════════
// ① 등록 · ② 확인 시트
// ══════════════════════════════════════════════════════════════

/** 예시 카드(오늘 날짜 + DB 원문 정재 theme[0]·advice[0]·luckyItems[0]) · 「+5P부터」 는 서버 값 */
function renderReg() {
  const [, m, d] = state.st.day.split("-").map(Number);
  const tg = SAJU_DB.tenGod[5];
  $("#sampleDate").textContent = `${m}월 ${d}일 · 오늘의 한 줄`;
  $("#sampleTheme").textContent = `“${tg.theme[0]}”`;
  $("#sampleAdv").textContent = tg.advice[0];
  $("#sampleItem").textContent = SAJU_DB.luckyItems[0];
  $("#regPoints").textContent = `하루 한 번 열면 +${state.st.core_points}P부터 쌓여요`;
}

function setHourOpen(open) {
  $("#hourBox").hidden = !open;
  $("#hourFold").setAttribute("aria-expanded", String(open));
  $("#hourFold .s-fold__chev").textContent = open ? "접기 ▴" : "넣기 ▾";
}

const maxBirthYear = () => Number(state.st.day.slice(0, 4)) - 14;
const rangeMsg = () => `1930년~${maxBirthYear()}년생까지 볼 수 있어요`;

/** 3칸 날짜 + 시·분(선택) → 서버 형식 { birth:'YYYY-MM-DD', hour, minute }. 틀리면 { err } */
function readForm() {
  const [ys, ms, ds] = ["#birthY", "#birthM", "#birthD"].map((s) => $(s).value.trim());
  if (!/^\d{4}$/.test(ys) || !/^\d{1,2}$/.test(ms) || !/^\d{1,2}$/.test(ds)) {
    return { err: "생년월일을 넣어 주세요" };
  }
  const [y, m, d] = [ys, ms, ds].map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) {
    return { err: "생년월일을 확인해 주세요" };
  }
  if (y < 1930 || y > maxBirthYear()) return { err: rangeMsg() };

  // 시·분 직접 입력(선택). 시를 비우면 시간 모름 — 보정은 서버가 생일 날짜로 한다 (E3)
  const hs = $("#hourH").value.trim();
  const mins = $("#hourM").value.trim();
  let hour = null;
  let minute = null;
  if (hs !== "") {
    hour = Number(hs);
    minute = mins === "" ? 0 : Number(mins);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return { err: "태어난 시간을 확인해 주세요 (시 0~23 · 분 0~59)" };
    }
  }
  return { birth: `${ys}-${pad2(m)}-${pad2(d)}`, hour, minute, y, m, d };
}

function openSheet(name) {
  $(`#${name}Dim`).hidden = false;
  $(`#${name}Sheet`).hidden = false;
  $(`#${name}Ok`).focus();
}
function closeSheet(name) {
  $(`#${name}Dim`).hidden = true;
  $(`#${name}Sheet`).hidden = true;
}

function openConfirm() {
  const f = readForm();
  if (f.err) {
    toast(f.err, "error");
    return;
  }
  state.form = { birth: f.birth, hour: f.hour, minute: f.minute };
  clear($("#confirmBirth")).append(
    el("span", { class: "s-num" }, f.y), "년 ", el("span", { class: "s-num" }, f.m), "월 ",
    el("span", { class: "s-num" }, f.d), "일 ", el("small", {}, "양력"),
  );
  clear($("#confirmHour")).append(
    ...(f.hour == null ? ["비워 둠 ", el("small", {}, "모름")] : [timeLabel(f.hour, f.minute)]),
  );
  $("#confirmErr").hidden = true;
  openSheet("confirm");
}

async function register() {
  $("#confirmOk").disabled = true;
  try {
    await apiPost("/api/saju/profile", state.form);
    ls.set(TOO_YOUNG_KEY, null);
    state.st = await apiGet("/api/saju/state");
    closeSheet("confirm");
    showMain();
    toast("생일을 등록했어요", "good");
  } catch (err) {
    // 14세 미만 — 서버는 기억하지 않으므로 이 기기에 남긴다(허브·다음 안내 바가 사주를 빼고 본다)
    if (err instanceof ApiFail && err.code === "TOO_YOUNG") ls.set(TOO_YOUNG_KEY, "1");
    const msg = err instanceof ApiFail && err.code === "OUT_OF_RANGE" ? rangeMsg() : err.message;
    $("#confirmErr").textContent = msg ?? "등록하지 못했습니다.";
    $("#confirmErr").hidden = false;
  } finally {
    $("#confirmOk").disabled = false;
  }
}

/**
 * 생일 고치기 링크 세 곳(인장·더 읽기·내 글자) — 열 수 있는지는 서버 값으로만(D3).
 * 24시간 정정 창이 열려 있으면 「(24시간 안 한 번)」, 잠긴 동안은 링크 대신 날짜 한 줄.
 */
function renderEditLinks() {
  const pc = state.st.profile_change ?? {};
  const canFix = state.st.registered && (pc.fix_open || !pc.next_day || pc.next_day <= state.st.day);
  let lock = "";
  if (!canFix && pc.next_day) {
    const [, m, d] = pc.next_day.split("-").map(Number);
    lock = `${m}월 ${d}일부터 바꿀 수 있어요`;
  }
  for (const a of $$("[data-edit-profile]")) {
    a.classList.toggle("is-locked", !canFix);
    a.setAttribute("aria-disabled", String(!canFix));
    if (a.id === "editProfileStamp") {
      a.hidden = !canFix; // 인장 화면은 맨 위 한 줄이라 잠긴 날짜는 쓰지 않는다
      continue;
    }
    clear(a).append(
      ...(canFix
        ? ["생일 정보 고치기", pc.fix_open ? el("small", {}, " (24시간 안 한 번)") : null]
        : [lock]),
    );
  }
}

/** 등록 화면을 지금 값으로 채워 연다 — 옛 12칸 값도 서버가 시:분으로 바꿔 준다(REQ-62 ②) */
function openFix() {
  const p = state.st.profile;
  const [y, m, d] = p.birth.split("-");
  $("#birthY").value = y;
  $("#birthM").value = m;
  $("#birthD").value = d;
  $("#hourH").value = p.hour == null ? "" : pad2(p.hour);
  $("#hourM").value = p.hour == null ? "" : pad2(p.minute ?? 0);
  setHourOpen(p.hour != null);
  renderReg();
  showScreen("reg");
}

// ══════════════════════════════════════════════════════════════
// ⑧ 사주 정보 지우기 (E4)
// ══════════════════════════════════════════════════════════════

function openDelete() {
  const p = state.st.profile;
  $("#deleteGo").textContent = `생일 ${birthDot(p.birth)} · 태어난 시간 · 내 글자`;
  $("#deleteStay").textContent = `모은 도장 ${state.st.stamp_count}개 · 받은 포인트`;
  openSheet("delete");
}

async function doDelete() {
  $("#deleteOk").disabled = true;
  try {
    await apiPost("/api/saju/profile/delete", {});
    state.st = await apiGet("/api/saju/state");
    closeSheet("delete");
    for (const s of ["#birthY", "#birthM", "#birthD", "#hourH", "#hourM"]) $(s).value = "";
    setHourOpen(false);
    showMain();
    toast("사주 정보를 지웠어요", "good");
  } catch (err) {
    toast(err.message ?? "지우지 못했습니다.", "error");
  } finally {
    $("#deleteOk").disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// ③ 인장 찍기
// ══════════════════════════════════════════════════════════════

function renderStampScreen() {
  const { profile: p, today, day } = state.st;
  $("#doneText").textContent =
    `생일 ${birthDot(p.birth)} · ${p.hour == null ? "시간 모름" : timeLabel(p.hour, p.minute ?? 0)}`;
  $("#todayLabel").textContent = `오늘(${md(day)})의 글자`;
  $("#orbName").textContent = today.name;
  clear($("#orbHan")).append(...hanSpans(today.ganzhi));
  $("#orb").classList.remove("is-stamped");
  $("#orb").disabled = false;
  $("#orb").setAttribute("aria-label", `오늘의 글자 ${today.name} — 눌러서 오늘 운세 열기`);
  $("#orbSub").textContent = `오늘의 한 줄이 열리고 +${state.st.core_points}P부터 쌓여요`;
  showScreen("chart");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stampToday() {
  if (state.busy) return;
  state.busy = true;
  $("#orb").disabled = true;
  let res;
  try {
    res = await apiPost("/api/saju/today", {});
  } catch (err) {
    state.busy = false;
    if (err instanceof ApiFail && err.code === "ALREADY_DONE") {
      state.st = await apiGet("/api/saju/state");
      renderReading(null);
      return;
    }
    toast(err.message ?? "오늘 운세를 열지 못했어요", "error");
    $("#orb").disabled = false;
    return;
  }
  // 인장 연출은 서버 성공 응답 뒤에만 — 자국 글자는 응답의 간지(자정 넘김 대비 · impact #13)
  clear($("#orbHan")).append(...hanSpans(res.ganzhi));
  $("#orb").classList.add("is-stamped");
  const next = apiGet("/api/saju/state");
  if (!reduceMotion()) await sleep(700);
  try {
    state.st = await next;
  } finally {
    state.busy = false;
  }
  renderReading(res);
}

function renderReading(res) {
  const day = state.st.day;
  const gz = state.st.today.ganzhi;
  const c = state.st.chart;

  // 리딩 파라미터는 서버가 준 것을 쓴다. 재열람이면 state 의 reading — 오늘 십신은 열 때
  // 저장한 값이라 그 뒤 생일을 고쳐도 허브·분포와 같다 (REQ-62 ①).
  // reading 이 없는 것은 열기 도중 허브 기록이 실패한 경우뿐이다 — 그때만 지금 명식으로 세운다
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
  const name = state.st.today.name;
  const [, m, d] = day.split("-").map(Number);
  $("#rdGanzhi").textContent = `${m}월 ${d}일 (${dowOf(day)}) · 나의 오늘 한 줄`;
  $("#rdTheme").textContent = pick(tg.theme, `${day}|theme|${god}`);
  clear($("#rdSealHan")).append(...hanSpans(gz));
  $("#rdSealKo").textContent = `오늘 ${name}일`;
  $("#rdAdvice").textContent = pick(tg.advice, `${day}|adv|${god}`);
  clear($("#rdLucky")).append(
    el("span", { class: "hero__k" }, "행운의 물건"),
    el("b", {}, pick(SAJU_DB.luckyItems, `${day}|item|${gz}`)),
  );

  // 더 읽기 — 「계축 — …」 을 「오늘(계축일)은 …」 으로 읽히게만 가공(DB 수정 없음)
  $("#rdIljin").textContent = SAJU_DB.iljin60[gz].replace(/^\S+ — /, `오늘(${name}일)은 `);
  const rl = rel ? SAJU_DB.branchRel.find((r) => r.key === rel) : null;
  $("#rdRelation").textContent = rl ? pick(rl.lines, `${day}|rel|${rel}`) : "오늘은 평온한 날이에요.";
  const me = myIntro().split(" ").pop();
  clear($("#rdEls")).append(
    el("span", {}, `나(${me} · `, el("b", { class: `elt${myEl}` }, `${EL_NAME[myEl]} 기운`), ")"),
    el("span", { class: "arr", "aria-label": "와" }, "←"),
    el("span", {}, "오늘(", el("b", { class: `elt${todayEl}` }, `${EL_NAME[todayEl]} 기운`), ")"),
  );
  $("#rdElement").textContent = SAJU_DB.elementMatrix[myEl][todayEl];
  clear($("#rdType")).append(el("b", {}, TYPE_EASY[god]), " ", el("small", { class: "tg" }, `(${tg.name})`));
  setMore(ls.get(MORE_KEY) === "1");

  renderGain(res);
  renderSoonBar();
  const tmr = addDays(day, 1);
  clear($("#tomorrowLine")).append(
    `내일 ${md(tmr)}(${dowOf(tmr)})은 `, el("b", {}, `${gzName((gz + 1) % 60)}일`), " — 새 운세가 열려요",
  );
  $("#mychartWho").textContent = `나는 ‘${myIntro()}’ 같은 사람`;

  // 서비스 사이 이동 = 공용 다음 안내 바 (REQ-63 · 크로스 칩 대체)
  renderNextStep({ svc: "saju", suite: state.st.suite, justCompleted: (res?.triple_gained ?? 0) > 0 });
  renderEditLinks();
  renderAds();
  showScreen("reading");
  armScreen("reading");
}

function setMore(open) {
  $("#moreBody").hidden = !open;
  $("#moreToggle").setAttribute("aria-expanded", String(open));
  $("#moreChev").textContent = open ? "접기 ▴" : "▾";
}

/** 적립 = 받은 합계 크게 + 내역 한 줄(서버 gain_detail · D1). 셋 다 보너스는 다음 안내 바가 말한다 */
function renderGain(res) {
  const host = clear($("#rdGain"));
  const ck = el("span", { class: "ck", "aria-hidden": "true" });
  if (!res) {
    host.append(ck, "오늘 적립 완료");
    return;
  }
  const label = (g) =>
    g.kind === "daily" ? "오늘" : g.kind === "new" ? "새 도장" : g.p === state.st.soon_bonus ? "열흘 보너스" : "60칸 보너스";
  const parts = (res.gain_detail ?? []).filter((g) => g.kind !== "triple").map((g) => `${label(g)} ${g.p}`);
  host.append(ck, el("span", { class: "pt" }, `+${res.gained}P`), " 받았어요", parts.length ? el("small", {}, parts.join(" + ")) : null);
}

/**
 * 열흘 +20P 안내 — 칸 단위 판정(s4 notes v4 ①②③). 오늘 도장을 찍은 뒤 기준.
 * ① 이번 열흘이 미지급이고 오늘까지 칸이 다 찼고 남은 빈 칸이 있으면 → 이번 열흘
 * ② 아니면 다음 열흘이 미지급이고 빈 칸이 있으면 → 다음 열흘(시작일·빈 칸 중 마지막 날)
 * ③ 둘 다 아니면 null(줄 없음). 도장판(s6)도 같은 판정을 쓴다.
 */
function bonusPlan() {
  const { stamps, today, day, soon_paid: paid } = state.st;
  const got = new Set(stamps);
  const gz = today.ganzhi;
  const cur = Math.floor(gz / 10);
  if (!paid[cur]) {
    let full = true;
    for (let g = cur * 10; g <= gz; g++) if (!got.has(g)) full = false;
    const empty = [];
    for (let g = gz + 1; g <= cur * 10 + 9; g++) if (!got.has(g)) empty.push(g);
    if (full && empty.length) return { soon: cur, from: null, to: addDays(day, empty.at(-1) - gz) };
  }
  const next = (cur + 1) % 6;
  if (!paid[next]) {
    const ahead = (g) => (((g - gz) % 60) + 60) % 60;
    const empty = [];
    for (let g = next * 10; g < next * 10 + 10; g++) if (!got.has(g)) empty.push(g);
    if (empty.length) return { soon: next, from: addDays(day, ahead(next * 10)), to: addDays(day, ahead(empty.at(-1))) };
  }
  return null;
}

function bonusCaption(plan) {
  const p = `+${state.st.soon_bonus}P`;
  if (!plan.from) return [el("b", {}, `${md(plan.to)}까지`), " 매일 오면 ", el("b", {}, p)];
  const start = plan.from === addDays(state.st.day, 1) ? "내일부터 새 열흘" : `${md(plan.from)}부터 새 열흘`;
  return [el("b", {}, start), ` · ${md(plan.to)}까지 매일 오면 `, el("b", {}, p)];
}

/** 오늘 도장 + 열흘 10칸(+20P 안내가 가리키는 열흘, 없으면 이번 열흘) */
function renderSoonBar() {
  const { stamps, today } = state.st;
  const got = new Set(stamps);
  const plan = bonusPlan();
  const show = plan?.soon ?? Math.floor(today.ganzhi / 10);
  const dots = Array.from({ length: 10 }, (_, i) =>
    el("span", { class: `s-ten__dot${got.has(show * 10 + i) ? " is-got" : ""}` }),
  );
  const n = dots.filter((x) => x.classList.contains("is-got")).length;
  clear($("#soonBar")).append(
    el("div", { class: "soon__today" }, el("span", { class: "s-ten__dot is-got", "aria-hidden": "true" }), "오늘"),
    el("span", { class: "soon__sep", "aria-hidden": "true" }),
    el("div", { class: "s-ten", role: "img", "aria-label": `열흘 10칸 중 ${n}칸 찍힘` }, dots),
    plan ? el("p", { class: "soon__cap" }, bonusCaption(plan)) : null,
  );
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
    const t = tomorrowPeek();
    $("#adbarTomorrow").append(
      el("div", { class: "s-paper s-paper--plain tmrpeek" },
        el("span", { class: "hero__k" }, "내일의 한 줄"),
        el("p", { class: "tmrpeek__theme" }, t.theme),
        el("p", { class: "tmrpeek__adv" }, t.advice)),
    );
  } else {
    renderRewardCard($("#adbarTomorrow"), {
      icon: "🌅",
      title: "광고 보고 내일 미리보기",
      desc: "내일의 한 줄을 여기에 바로 보여 드려요",
      note: "미리 봐도 오늘의 운세와 적립은 그대로예요",
      cta: "보기",
      onClick: async () => {
        const r = await watchAdForReward("SAJU_TOMORROW");
        if (!r) return;
        state.st = await apiGet("/api/saju/state");
        renderAds();
      },
    });
  }

  // 분포가 아직 닫혀 있으면 광고 카드도 결과 줄도 없이 한 줄만 — 인원 수 없음 (REQ-62 ⑭ · D2)
  $("#distWait").hidden = true;
  $("#rdDist").hidden = true;
  if (state.st.ad_stats_seen) {
    loadStats();
  } else if (!state.st.dist_open) {
    $("#distWait").hidden = false;
  } else {
    renderRewardCard($("#adbarStats"), {
      icon: "🗺️",
      title: "광고 보고 오늘 나와 같은 운세를 받은 사람 보기",
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
 * 내일 미리보기 — 내일 리딩(#rdTheme·#rdAdvice)과 **같은 함수·같은 시드**라 다음 날 같은 문장이 나온다.
 * 내일 = 서버 day + 1(UTC 계산, 서버 unlockTomorrow 와 같은 방식). 기기 시계를 쓰지 않는다.
 */
function tomorrowPeek() {
  const tomorrow = addDays(state.st.day, 1);
  const tgz = (state.st.today.ganzhi + 1) % 60;
  const god = tenGodLocal(state.st.chart.day.stem, tgz % 10);
  const tg = SAJU_DB.tenGod[god];
  return { theme: pick(tg.theme, `${tomorrow}|theme|${god}`), advice: pick(tg.advice, `${tomorrow}|adv|${god}`) };
}

async function loadStats() {
  try {
    const s = await apiGet("/api/saju/stats");
    if (!s.open) {
      $("#distWait").hidden = false;
      return;
    }
    const mine = s.items.find((i) => String(i.key) === String(s.mine));
    const top = s.items[0];
    const topName = TYPE_EASY[Number(top.key)] ?? "—";
    $("#rdDist").textContent = mine
      ? `나와 같은 운세 유형 ${mine.pct}% · 오늘 가장 많은 유형은 ‘${topName}’(${top.pct}%)`
      : `오늘 가장 많은 유형은 ‘${topName}’(${top.pct}%)`;
    $("#rdDist").hidden = false;
  } catch {
    /* 광고 전이면 잠겨 있는 것이 정상이다 */
  }
}

// ══════════════════════════════════════════════════════════════
// ⑤ 열흘 도장판 — 이번·다음 열흘 크게, 나머지는 접힘 (s6)
// ══════════════════════════════════════════════════════════════

function showStamps() {
  const st = state.st;
  const { day, soon_paid: paid, soon_bonus: bonus } = st;
  const gz = st.today.ganzhi;
  const got = new Set(st.stamps ?? []);
  const cur = Math.floor(gz / 10);
  const next = (cur + 1) % 6;
  const plan = bonusPlan();
  // 이번 열흘은 지나온 날짜, 그 밖의 열흘은 다음에 돌아오는 날짜로 센다
  const offset = (g, s) => (s === cur ? g - gz : (((g - gz) % 60) + 60) % 60);
  const dateOf = (g, s) => addDays(day, offset(g, s));

  const cell = (g, s) => {
    const o = offset(g, s);
    const isGot = got.has(g);
    const isTmr = o === 1 && !isGot;
    return el(
      "div",
      {
        class: `stampcell s-stampcell${isGot ? " is-got" : ""}${g === gz ? " is-today" : ""}${isTmr ? " is-tomorrow" : ""}`,
        title: `${gzName(g)} · ${md(dateOf(g, s))}${g === gz ? " 오늘" : isTmr ? " 내일" : ""}`,
      },
      isGot ? el("span", { class: "s-stampcell__han" }, hanSpans(g)) : isTmr ? el("span", { class: "tm" }, "내일") : null,
    );
  };
  const board = (s) => el("div", { class: "s-stampboard" }, Array.from({ length: 10 }, (_, i) => cell(s * 10 + i, s)));
  const range = (s) => `${md(dateOf(s * 10, s))} ~ ${md(dateOf(s * 10 + 9, s))}`;
  const pt = el("b", { class: "s-num" }, `+${bonus}P`);

  // 이번 열흘 — 지난 빈 칸은 60일 뒤 같은 날 다시 (다 채우면 +20P 는 미지급일 때만)
  const pastEmpty = [];
  for (let g = cur * 10; g < gz; g++) if (!got.has(g)) pastEmpty.push(g);
  const curSec = el(
    "section",
    { class: "soon2 is-now", "aria-label": `이번 열흘 ${range(cur)} · ${st.soon_done[cur]}칸 찍음` },
    el("header", { class: "soon2__head" },
      el("b", {}, gz % 10 === 9 ? "이번 열흘은 오늘로 끝나요" : `이번 열흘 · ${md(dateOf(cur * 10 + 9, cur))}까지`),
      el("span", { class: "soon2__cnt" }, paid[cur] ? "다 채운 열흘이에요" : [el("span", { class: "s-num" }, st.soon_done[cur]), "칸 찍었어요"])),
    el("p", { class: "soon2__date" }, el("span", { class: "s-num" }, range(cur)),
      plan?.soon === cur ? [" · ", bonusCaption(plan)] : null),
    board(cur),
    pastEmpty.length
      ? el("p", { class: "refill" },
          `빈 칸은 60일 뒤 같은 날(${md(addDays(day, pastEmpty[0] - gz + 60))}~${md(addDays(day, pastEmpty.at(-1) - gz + 60))}) 다시 찍을 수 있어요`,
          paid[cur] ? null : [" · 다 채우면 ", pt])
      : null,
  );

  // 다음 열흘
  const nextStart = dateOf(next * 10, next);
  const nextSec = el(
    "section",
    { class: "soon2 is-next", "aria-label": `다음 열흘 ${range(next)} · ${st.soon_done[next]}칸` },
    el("header", { class: "soon2__head" },
      el("b", {}, `다음 열흘 ${md(nextStart)}부터`),
      el("span", { class: "soon2__cnt" },
        plan?.soon === next
          ? [`${md(plan.to)}까지 매일 `, pt.cloneNode(true)]
          : paid[next] ? "다 채운 열흘이에요" : `${st.soon_done[next]}칸`)),
    el("p", { class: "soon2__date" }, el("span", { class: "s-num" }, range(next)),
      nextStart === addDays(day, 1) ? " · 내일 첫 칸이 찍혀요" : null),
    board(next),
  );
  clear($("#stampGrid")).append(curSec, nextSec);

  // 접힘 — 나머지 넷(날짜 순, 번호 없음) · +100P(미지급일 때만) · 날 이름 설명
  const rest = [2, 3, 4, 5].map((k) => {
    const s = (cur + k) % 6;
    return el("section", { class: "soon2 soon2--sm", "aria-label": `${range(s)} · ${st.soon_done[s]}칸` },
      el("header", { class: "soon2__head" },
        el("b", { class: "s-num" }, range(s)),
        el("span", { class: "soon2__cnt" }, paid[s] ? "다 채운 열흘이에요" : [`${st.soon_done[s]}칸 · 다 채우면 `, pt.cloneNode(true)])),
      board(s));
  });
  clear($("#stampAllBody")).append(
    ...rest,
    st.grand_paid ? null : el("p", { class: "refill" }, "여섯 줄을 모두 채우면 ", el("b", { class: "s-num" }, `+${st.grand_bonus}P`), " 더"),
    el("p", { class: "info" }, el("i", { "aria-hidden": "true" }, "i"),
      el("span", {}, "날마다 이름이 있고, 60개의 날 이름이 차례로 돌아와요. 오늘 운세를 열면 오늘 날 이름 칸에 도장이 찍혀요.")),
  );
  $("#stampAllBody").hidden = true;
  $("#stampAll").setAttribute("aria-expanded", "false");
  showScreen("stamp");
}

// ══════════════════════════════════════════════════════════════
// ⑦ 내 글자 보기 — 기둥 넷 + 오늘 칸 (s7)
// ══════════════════════════════════════════════════════════════

function showMyChart() {
  const { chart: c, profile: p, today, done } = state.st;
  const [y, m, d] = p.birth.split("-").map(Number);
  const intro = myIntro();
  const word = intro.split(" ").pop();
  clear($("#chartNote")).append(
    el("p", { class: "hero__pre" }, `내 글자 · ${y}년 ${m}월 ${d}일생`),
    el("p", { class: "hero__line" }, "나는 ", el("b", {}, `‘${intro.slice(0, -word.length)}`, el("em", {}, word), "’"), " 같은 사람"),
  );

  // 한글 크게 · 한자는 모서리에 작게(ROUND2). 순서 = 해·달·날·시 + 오늘
  const col = (label, pl) =>
    pl
      ? el("div", { class: "s-pillar pillar", "aria-label": `태어난 ${label} ${STEMS[pl.stem]}${BRANCHES[pl.branch]}` },
          el("span", { class: `s-pillar__stem pillar__stem el${STEM_EL[pl.stem]}` }, STEMS[pl.stem],
            el("span", { class: "s-pillar__hj", "aria-hidden": "true" }, STEM_HJ[pl.stem])),
          el("span", { class: `s-pillar__branch pillar__branch el${BRANCH_EL[pl.branch]}` }, BRANCHES[pl.branch],
            el("span", { class: "s-pillar__hj", "aria-hidden": "true" }, BRANCH_HJ[pl.branch])),
          el("i", { class: `s-pillar__band-bot el${BRANCH_EL[pl.branch]}` }))
      : el("div", { class: "s-pillar pillar pillar--empty s-pillar--empty", "aria-label": `태어난 ${label} 모름` },
          el("span", { class: "s-pillar__stem pillar__stem" }, "?"),
          el("span", { class: "s-pillar__branch pillar__branch" }, "?"),
          el("span", { class: "s-pillar__read" }, "몰라도", el("br"), "괜찮아요"));
  const slot = done
    ? el("div", { class: "s-slot is-filled", "aria-label": `오늘 칸 — ${today.name}` },
        el("span", { class: "s-seal--mark", "aria-hidden": "true" }, el("span", { class: "s-seal__han" }, hanSpans(today.ganzhi))),
        el("span", { class: "s-slot__hint" }, today.name))
    : el("div", { class: "s-slot", "aria-label": "오늘 칸 — 아직" },
        el("span", { class: "s-slot__target" }, "여기", el("br"), "찍혀요"));
  clear($("#pillars")).append(col("해", c.year), col("달", c.month), col("날", c.day), col("시", c.hour), slot);

  // 계산 기준 — 그 사람의 보정 메모만 쉬운 말로(고정 문구 없음 · recheck N5)
  const items = (c.notes ?? []).map((n) => NOTE_EASY[n]).filter(Boolean);
  if (c.jeol?.at?.slice(0, 10) === p.birth) items.push("태어난 날이 절기가 바뀌는 날이라 ‘달’ 칸이 달라질 수 있어요");
  clear($("#calcList")).append(...items.map((t) => el("li", {}, t)));
  $("#calcBox").hidden = items.length === 0;
  $("#calcNote").hidden = p.hour != null;
  $("#mychartBack").textContent = done ? "← 오늘 운세로 돌아가기" : "← 돌아가기";
  showScreen("mychart");
}
