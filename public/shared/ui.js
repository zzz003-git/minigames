/** 공통 UI 헬퍼 — DOM 생성, 화면 전환, 숫자패드, 토스트, 서식 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el('div', { class: 'panel' }, '내용') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

// ── 화면 전환 ─────────────────────────────────────────────────

export function showScreen(name) {
  for (const s of $$("[data-screen]")) {
    s.classList.toggle("is-active", s.dataset.screen === name);
  }
  window.scrollTo({ top: 0 });
}

export const currentScreen = () => $(".screen.is-active")?.dataset.screen ?? null;

// ── 토스트 ───────────────────────────────────────────────────

function toastHost() {
  let host = $(".toast-host");
  if (!host) {
    host = el("div", { class: "toast-host" });
    document.body.append(host);
  }
  return host;
}

export function toast(message, kind = "", ms = 2600) {
  const node = el("div", { class: `toast ${kind ? `toast--${kind}` : ""}`, text: message });
  toastHost().append(node);
  setTimeout(() => node.remove(), ms);
}

// ── 숫자패드 (기획서 화면② / 화면③) ──────────────────────────

/**
 * @param {HTMLElement} host
 * @param {{ onDigit:(d:string)=>void, onBack:()=>void, onOk:()=>void, okLabel?:string }} handlers
 * @returns {{ setOkEnabled:(v:boolean)=>void }}
 */
export function mountNumpad(host, { onDigit, onBack, onOk, okLabel = "OK" }) {
  clear(host);
  host.classList.add("numpad");

  for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    host.append(el("button", { class: "numpad__key", type: "button", onclick: () => onDigit(d) }, d));
  }
  host.append(el("button", { class: "numpad__key", type: "button", onclick: onBack, "aria-label": "지우기" }, "←"));
  host.append(el("button", { class: "numpad__key", type: "button", onclick: () => onDigit("0") }, "0"));

  const okBtn = el("button", { class: "numpad__key numpad__key--ok", type: "button", onclick: onOk }, okLabel);
  host.append(okBtn);

  return { setOkEnabled: (v) => (okBtn.disabled = !v) };
}

/** 물리 키보드로도 숫자패드를 쓸 수 있게 연결합니다. */
export function bindKeyboardNumpad({ onDigit, onBack, onOk, isActive }) {
  const handler = (e) => {
    if (isActive && !isActive()) return;
    if (/^[0-9]$/.test(e.key)) { onDigit(e.key); e.preventDefault(); }
    else if (e.key === "Backspace") { onBack(); e.preventDefault(); }
    else if (e.key === "Enter") { onOk(); e.preventDefault(); }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

// ── 조각 렌더러 ───────────────────────────────────────────────

/** 도전 기회 점 표시 ●●●○○ */
export function renderDots(host, { total, used }) {
  clear(host);
  host.classList.add("dots");
  for (let i = 0; i < total; i++) {
    host.append(el("span", { class: `dot ${i < total - used ? "is-filled" : ""}` }, i < total - used ? "●" : "○"));
  }
}

/** 입력 중인 숫자 슬롯 */
export function renderSlots(host, { length, value, small = false, marks = null }) {
  clear(host);
  host.classList.add("slots");
  for (let i = 0; i < length; i++) {
    const ch = value[i];
    let cls = "slot";
    if (small) cls += " slot--sm";
    if (marks) cls += marks[i] ? " is-correct" : " is-wrong";
    else if (ch != null) cls += " is-filled";
    else if (i === value.length) cls += " is-active";
    host.append(el("div", { class: cls }, ch ?? "_"));
  }
}

/**
 * 히스토그램. bins 는 [{from,to,count}], mine 은 내 값(해당 구간을 강조).
 * @param {(bin:object)=>string} caption 하단 설명 생성기
 */
export function renderChart(host, { bins, mine = null, caption = "" }) {
  clear(host);
  const chart = el("div", { class: "chart" });

  if (!bins || bins.length === 0) {
    chart.append(el("div", { class: "hint", style: "margin:auto" }, "아직 데이터가 없습니다"));
  } else {
    const max = Math.max(...bins.map((b) => b.count), 1);
    for (const b of bins) {
      const isMine = mine != null && mine >= b.from && mine <= b.to;
      chart.append(
        el("div", {
          class: `chart__bar ${isMine ? "is-mine" : ""}`,
          style: `height:${Math.max(3, (b.count / max) * 100)}%`,
          title: `${b.count}명`,
        }),
      );
    }
  }

  host.append(chart);
  if (caption) host.append(el("div", { class: "chart__caption" }, caption));
}

// ── 서식 ─────────────────────────────────────────────────────

/** 3470 → '3.470' (소수점 3자리, 기획서 오차 표기 규격) */
export const ms3 = (ms) => (ms / 1000).toFixed(3);

/** 3470 → '3.47' */
export const ms2 = (ms) => (ms / 1000).toFixed(2);

/** 부호를 붙인 오차 표기: 120 → '+0.120초' */
export const gapText = (ms) => `${ms >= 0 ? "+" : "-"}${(Math.abs(ms) / 1000).toFixed(3)}초`;

/** 74000 → '1:14' */
export function mmss(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const comma = (n) => Number(n ?? 0).toLocaleString("ko-KR");

/** 화면 상단 헤더를 만듭니다. */
export function renderHeader(host, { title, badge }) {
  clear(host);
  host.append(
    el("a", { href: "/", "aria-label": "목록으로" }, "←"),
    el("span", { class: "app__title" }, title),
    el("span", { class: "app__spacer" }),
    badge ? el("span", { class: "app__badge", id: "headerBadge" }, badge) : null,
  );
}
