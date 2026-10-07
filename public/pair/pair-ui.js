/**
 * 너를 맞혀볼게 v2 — /pair/(보내는 쪽)와 /p/(받는 쪽)가 같이 쓰는 그림·문구 조각 (REQ-65 묶음 2)
 *
 * 두 화면이 같은 관계 조사·같은 원판·같은 케미 문장을 써야 「양쪽이 같은 결과를 본다」가 성립한다.
 */

/** 관계 조사 표 (pair/IMPL 「관계 조사 표」) — 받침에 따라 이/가가 갈린다 */
export const REL = {
  lover: { label: "연인", icon: "💗", iga: "연인이", ege: "연인에게", ramyeon: "연인이라면" },
  friend: { label: "친구", icon: "🧡", iga: "친구가", ege: "친구에게", ramyeon: "친구라면" },
  family: { label: "가족", icon: "🏠", iga: "가족이", ege: "가족에게", ramyeon: "가족이라면" },
  coworker: { label: "동료", icon: "💼", iga: "동료가", ege: "동료에게", ramyeon: "동료라면" },
};

/** 상단바 아이콘 — 겹친 두 원(크림 = 나, 귤노랑 = 그 사람) */
export const DUO_ICON =
  '<svg class="topbar__icon" viewBox="-14 -12 28 24" aria-hidden="true"><circle cx="-4.5" r="9" fill="#FFF8E7" stroke="#1D6156" stroke-width="1.6"/><circle cx="4.5" r="9" fill="#FFD24A" fill-opacity=".92" stroke="#E2572B" stroke-width="1.4"/></svg>';

const CENTER = {
  lock: '<g transform="translate(0 4)"><rect x="-13" y="-4" width="26" height="20" rx="5" fill="#0E2B28"/><path d="M-8 -4v-6a8 8 0 0 1 16 0v6" fill="none" stroke="#0E2B28" stroke-width="4"/><circle cy="5" r="3" fill="#FFD24A"/></g>',
  check: '<circle r="17" fill="#1D6156"/><path d="M-8 0l5.5 5.5L9 -6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle r="17" fill="#FFF8E7" stroke="#0E2B28" stroke-width="2.4"/><path d="M0 -10V0l7 5" fill="none" stroke="#0E2B28" stroke-width="3" stroke-linecap="round"/>',
  q: '<text y="9" text-anchor="middle" font-family="Gugi" font-size="28" fill="#0E2B28">?</text>',
};

/** 큰 엠블럼 — 겹친 두 원 + 가운데 표식(자물쇠·체크·시계·물음표) */
export function duoSvg(kind, width = 150) {
  return `<svg class="pr-duo" width="${width}" height="${Math.round(width * 0.65)}" viewBox="-62 -40 124 80" aria-hidden="true">
  <circle cx="-19" r="37" fill="#FFF8E7" stroke="#1D6156" stroke-width="2"/>
  <circle cx="19" r="37" fill="#FFD24A" fill-opacity=".93" stroke="#E2572B" stroke-width="1.8"/>
  <g stroke="#E2572B" stroke-width="1.6" stroke-linecap="round"><path d="M19 -37v5M19 32v5M56 0h-5"/></g>
  <g stroke="#1D6156" stroke-width="1.6" stroke-linecap="round"><path d="M-19 -37v5M-19 32v5M-56 0h5"/></g>
  ${CENTER[kind] ?? ""}</svg>`;
}

const pt = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(1)} ${(-r * Math.cos(a)).toFixed(1)}`;
};

/** 진행 원판 — 3칸 중 지금까지(현재 포함) 켜짐. 시안 #qDial 과 같은 기하 */
export function dialInner(step, total = 3) {
  const seg = 360 / total;
  let s = '<circle r="25" fill="#FFF8E7"/><g fill="none" stroke-width="6">';
  for (let i = 0; i < total; i++) {
    const on = i <= step;
    s += `<path d="M ${pt(20, i * seg + 6)} A 20 20 0 0 1 ${pt(20, i * seg + seg - 6)}" stroke="${on ? "#FFD24A" : "#0E2B28"}"${on ? "" : ' stroke-opacity=".13"'}/>`;
  }
  return `${s}</g>`;
}

/** 지수 원판의 호 — 위에서 시계 방향, pct 만큼 */
export function arcPath(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (p === 0) return "";
  if (p >= 100) return `M ${pt(70, 0)} A 70 70 0 1 1 ${pt(70, 180)} A 70 70 0 1 1 ${pt(70, 359.9)}`;
  const deg = p * 3.6;
  return `M ${pt(70, 0)} A 70 70 0 ${deg > 180 ? 1 : 0} 1 ${pt(70, deg)}`;
}

/** 케미 한 줄 — 양쪽이 같은 문장을 보도록 같은 규칙 */
export function chemiLine(db, pct) {
  const band = pct >= 67 ? "high" : pct >= 34 ? "mid" : "low";
  const list = db.chemiComments?.[band] ?? [];
  return list.length ? list[pct % list.length] : "";
}

/**
 * 다른 답을 골랐을 때 한 줄 — 상대 답을 몰라도 성립하는 것만(시안 pr5b notes: 15·16 「모험가·신중」 등 제외).
 * 고르기 = (문항 번호 + 지수) % 후보 수.
 */
const DIFF_OK = [0, 1, 2, 3, 4, 6, 7, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23];
export function diffLine(db, qid, pct) {
  const list = DIFF_OK.filter((i) => db.diffFlavor?.[i]);
  return list.length ? db.diffFlavor[list[(qid + pct) % list.length]] : "";
}

/** 놀이 3단계 (소개 시트 B 와 같은 문장) — `now` 단계를 귤노랑으로 */
export function stepsHtml(now = 0) {
  const rows = [
    "그 사람이라면 뭘 고를지 3문항을 내가 맞혀 봐요",
    "링크를 보내면 그 사람이 진짜 답을 골라요 <small>가입·설치 없음</small>",
    "서로 얼마나 아는지 %가 나와요",
  ];
  return rows
    .map((t, i) => `<li class="${i + 1 === now ? "is-now" : ""}"><span class="pr-steps__n">${i + 1}</span><span>${t}</span></li>`)
    .join("");
}
