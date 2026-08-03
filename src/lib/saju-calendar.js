/**
 * 🌤️ 만세력 — 일주 · 시각 보정
 * ==========================================================================
 *
 * 확정 문서: docs/saju-calendar.md (SAJU 오픈이슈 #1)
 *
 * ── 여기 있는 것과 없는 것 ───────────────────────────────────────────────
 * **있는 것**: 일주(일진)와 시각 보정. 둘 다 외부 데이터가 필요 없다 —
 *   일주는 60갑자 순환 산술이고, 보정은 규칙이다.
 * **없는 것**: 연주·월주(절기 시각 필요)와 음력 변환. KASI 표가 들어오면
 *   `data/saju-terms.json` · `data/saju-lunar.json` 을 읽어 여기에 붙인다.
 *
 * 그래서 이 파일만으로 **오늘의 일진**은 이미 정확하게 나온다. 서비스의 코어
 * (일일 꽂기)가 쓰는 값이 그것이라, 표가 늦어도 코어는 먼저 검증할 수 있다.
 */

export const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
export const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];

/** 60갑자 이름 */
export const ganzhiName = (idx) => STEMS[((idx % 10) + 10) % 10] + BRANCHES[((idx % 12) + 12) % 12];

// ══════════════════════════════════════════════════════════════
// 일주 (일진)
// ══════════════════════════════════════════════════════════════

/**
 * 기준일. 조사 세션이 복수 출처로 교차 실측한 값이다.
 *
 * 이 기준으로 계산하면 **1900-01-01 이 갑술**로 나온다 — 널리 쓰이는 기준값과
 * 일치한다(docs/saju-calendar.md §4 에 검증 기록).
 *
 * 최종 확인은 KASI 일진 전수 대조 테스트가 한다. 그 전에는 사주를 라이브에
 * 올리지 않는다.
 */
const ANCHOR_UTC = Date.UTC(2026, 0, 1);
const ANCHOR_IDX = 11; // 을해

/** 'YYYY-MM-DD' → 그날의 60갑자 인덱스 (0~59) */
export function dayGanzhi(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  const diff = Math.round((Date.UTC(y, m - 1, d) - ANCHOR_UTC) / 86400000);
  return (((ANCHOR_IDX + diff) % 60) + 60) % 60;
}

// ══════════════════════════════════════════════════════════════
// 시각 보정 (docs/saju-calendar.md §3)
// ══════════════════════════════════════════════════════════════

/**
 * 한국이 UTC+8:30 을 쓰던 기간.
 *
 * 그때 시계의 자오선은 127.5°E 로 한반도 중앙과 같아서 **경도 보정이 0분**이다.
 * 이 구간을 모르고 일괄 −30분을 하면 그 시기 출생자의 시주가 한 칸 밀린다.
 */
const HALF_HOUR_ZONE = { from: "1954-03-21", to: "1961-08-09" };

/**
 * 서머타임 구간 (시계가 앞당겨져 있어 되돌려야 한다).
 *
 * **1948~1951 · 1955~1960 에도 있었다는 기록이 있으나 정확한 시행일을 출처로
 * 확인하지 못해 넣지 않았다.** 지금 타깃(20~65세)에는 닿지 않지만 등록 범위가
 * 1930~ 이므로, 쓰려면 먼저 출처를 확인하고 여기에 추가한다.
 */
const DST_RANGES = [
  { from: "1987-05-10", to: "1987-10-11" },
  { from: "1988-05-08", to: "1988-10-09" },
];

const inRange = (day, r) => day >= r.from && day <= r.to;

/**
 * 시계 시각을 진태양시에 가깝게 보정한다.
 *
 * @param {string} day 'YYYY-MM-DD' (시계 기준 날짜)
 * @param {number} hour 0~23 (시계 시각)
 * @param {number} minute 0~59
 * @returns {{ day:string, hour:number, minute:number, shiftMin:number, notes:string[] }}
 *   보정된 날짜·시각. 자정을 넘거나 앞당겨지면 `day` 가 바뀐다.
 */
export function correctClock(day, hour, minute = 0) {
  const notes = [];
  let shift = 0;

  if (DST_RANGES.some((r) => inRange(day, r))) {
    shift -= 60;
    notes.push("서머타임 −60분");
  }

  if (inRange(day, HALF_HOUR_ZONE)) {
    notes.push("UTC+8:30 시기 — 경도 보정 없음");
  } else {
    shift -= 30;
    notes.push("경도 보정 −30분");
  }

  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hour, minute + shift));
  const iso = t.toISOString();

  return {
    day: iso.slice(0, 10),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    shiftMin: shift,
    notes,
  };
}

/**
 * 보정된 시각 → 시지(0=자 … 11=해).
 *
 * 자시는 23:00~01:00 으로 **날짜 경계를 걸친다.** 그래서 (시각+1)/2 로 접는다.
 */
export const hourBranch = (hour) => Math.floor(((hour + 1) % 24) / 2);

/**
 * 명식의 일주와 시주를 함께 구한다.
 *
 * **야자시를 인정한다** — 보정된 시각이 23시 이후면 일진을 다음 날로 본다
 * (docs/saju-calendar.md §3.2). 시지가 이미 자시이므로 날짜만 넘긴다.
 *
 * @param {string} day 시계 기준 'YYYY-MM-DD'
 * @param {number|null} hour 0~23. null = 시간 모름 (시주 없음)
 */
export function dayAndHourPillar(day, hour, minute = 0) {
  if (hour == null) {
    return {
      dayIdx: dayGanzhi(day),
      dayName: ganzhiName(dayGanzhi(day)),
      hour: null,
      corrected: null,
    };
  }

  const c = correctClock(day, hour, minute);

  // 야자시 — 보정 시각이 23시대면 일진은 다음 날 것을 쓴다
  let effectiveDay = c.day;
  if (c.hour >= 23) {
    const [y, m, d] = c.day.split("-").map(Number);
    effectiveDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    c.notes.push("야자시 — 일진은 다음 날");
  }

  const dayIdx = dayGanzhi(effectiveDay);
  const hb = hourBranch(c.hour);
  // 오서둔 — 일간에서 시간(時干)을 뽑는다
  const hourStem = ((dayIdx % 10) % 5) * 2 + hb;

  return {
    dayIdx,
    dayName: ganzhiName(dayIdx),
    hour: {
      branch: hb,
      stem: hourStem % 10,
      name: STEMS[hourStem % 10] + BRANCHES[hb],
    },
    corrected: c,
  };
}
