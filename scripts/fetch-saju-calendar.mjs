/**
 * 🌤️ 만세력 표 수집 — 한국천문연구원(KASI) 공공데이터
 * ==========================================================================
 *
 *   SAJU_API_KEY=... node scripts/fetch-saju-calendar.mjs
 *   SAJU_API_KEY=... node scripts/fetch-saju-calendar.mjs --from 1930 --to 2050
 *
 * 확정 문서: docs/saju-calendar.md
 *
 * ── 왜 배치로 받아 정적 표로 굳히는가 ────────────────────────────────────
 * 런타임에 외부를 호출하지 않는 것이 이 저장소의 원칙이고, 만세력 값은 **불변**이라
 * 한 번 받아 검증하면 끝난다. 알고리즘을 서버에 심으면 정확도 검증 부담이 계속 남는다.
 *
 * ── 두 가지를 받는다 ─────────────────────────────────────────────────────
 *   절기  특일 정보 get24DivisionsInfo  → locdate + kst(시각) + sunLongitude
 *   일진  음양력 정보 getLunCalInfo      → 음/양 변환 + 윤달 + 일진
 *
 * **음양력 API 의 연·월 간지(세차·월건)는 쓰지 않는다.** 그것은 음력 달 기준이고
 * 사주는 절기 기준이다(docs/saju-calendar.md §2). 일진만 가져와 계산값을 검증한다.
 *
 * ── 라이선스 ─────────────────────────────────────────────────────────────
 * 두 서비스 모두 공공데이터포털 「이용허락범위 제한 없음」 · 상업적 이용 가능.
 * 키는 회원가입·활용신청으로 각자 발급받는다(저장소에 넣지 않는다).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dayGanzhi, ganzhiName } from "../src/lib/saju-calendar.js";

/**
 * 인증키는 두 형태로 발급된다 — Encoding(`%2F` 같은 이스케이프 포함)과 Decoding(원문).
 *
 * `URLSearchParams` 가 다시 인코딩하므로 Encoding 키를 그대로 넣으면 **이중 인코딩**이
 * 되어 인증이 실패한다. 어느 쪽을 붙여넣어도 되게 여기서 한 번 되돌린다.
 * (원문 키에는 `%` 가 없으므로 이 판별로 충분하다)
 */
function normalizeKey(raw) {
  if (!raw) return raw;
  const k = raw.trim();
  return /%[0-9A-Fa-f]{2}/.test(k) ? decodeURIComponent(k) : k;
}

const KEY = normalizeKey(process.env.SAJU_API_KEY);
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const FROM = arg("from", 1930);
const TO = arg("to", 2050);

const TERMS_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/get24DivisionsInfo";
const LUNAR_URL = "https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo";

if (!KEY) {
  console.error(
    [
      "SAJU_API_KEY 가 없습니다.",
      "",
      "  1) https://www.data.go.kr 회원가입",
      "  2) 「한국천문연구원_특일 정보」와 「한국천문연구원_음양력 정보」 활용신청",
      "  3) 발급받은 일반 인증키(Decoding)를 환경변수로 넘깁니다",
      "",
      "     SAJU_API_KEY=발급키 node scripts/fetch-saju-calendar.mjs",
      "",
      "키는 저장소에 넣지 않습니다.",
    ].join("\n"),
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** XML 응답에서 <item> 들을 뽑는다 — 의존성을 늘리지 않으려고 정규식으로 읽는다 */
function items(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].trim();
    return o;
  });
}

async function call(url, params) {
  const q = new URLSearchParams({ serviceKey: KEY, _type: "xml", numOfRows: "100", ...params });
  const res = await fetch(`${url}?${q}`);
  const xml = await res.text();
  if (!res.ok || xml.includes("<returnAuthMsg>")) {
    throw new Error(`API 실패 ${res.status} — ${xml.slice(0, 200)}`);
  }
  return items(xml);
}

// ══════════════════════════════════════════════════════════════
// 절기 — 연주·월주의 경계
// ══════════════════════════════════════════════════════════════

async function fetchTerms() {
  const out = [];
  for (let y = FROM; y <= TO; y++) {
    for (let m = 1; m <= 12; m++) {
      const rows = await call(TERMS_URL, { solYear: String(y), solMonth: String(m).padStart(2, "0") });
      for (const r of rows) {
        if (!r.locdate) continue;
        out.push({
          // 'YYYY-MM-DDTHH:MM' — 시각까지 있어야 경계일 출생을 가른다
          at: `${r.locdate.slice(0, 4)}-${r.locdate.slice(4, 6)}-${r.locdate.slice(6, 8)}T${(r.kst ?? "0000").slice(0, 2)}:${(r.kst ?? "0000").slice(2, 4)}`,
          name: r.dateName,
          sun: Number(r.sunLongitude),
        });
      }
      await sleep(60); // 예의상 간격
    }
    if (y % 10 === 0) console.log(`  절기 ${y}년까지 ${out.length}건`);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ══════════════════════════════════════════════════════════════
// 일진 검증 — 계산값과 KASI 값을 전수 대조
// ══════════════════════════════════════════════════════════════

/**
 * **이 검사가 이 스크립트의 존재 이유다.**
 *
 * 일주는 데이터가 필요 없지만 기준일이 2일만 어긋나도 결과가 그럴듯해 보인다
 * (구현 중 실제로 걸렸다 — docs/saju-calendar.md §4). 그래서 표본을 넓게 잡아
 * 계산값과 KASI 일진을 대조한다. 하나라도 어긋나면 사주를 라이브에 올리지 않는다.
 */
async function verifyDayPillars(samples) {
  let bad = 0;
  for (const day of samples) {
    const [y, m, d] = day.split("-");
    const rows = await call(LUNAR_URL, { solYear: y, solMonth: m, solDay: d });
    const kasi = rows[0]?.lunIljin?.replace(/\(.*\)/, "").trim(); // '기유(己酉)' → '기유'
    const mine = ganzhiName(dayGanzhi(day));
    if (kasi && kasi !== mine) {
      bad++;
      console.error(`  ✗ ${day} — KASI ${kasi} / 계산 ${mine}`);
    }
    await sleep(60);
  }
  return bad;
}

/** 1930~2050 에서 고르게 뽑은 검증 표본 (연·월·요일이 치우치지 않게) */
function sampleDays(n = 60) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = FROM + Math.floor(((TO - FROM) * i) / n);
    const m = ((i * 7) % 12) + 1;
    const d = ((i * 11) % 28) + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════

(async () => {
  console.log(`만세력 수집 ${FROM}~${TO}`);

  console.log("\n[1/2] 일진 검증 — 계산값 vs KASI");
  const bad = await verifyDayPillars(sampleDays());
  if (bad > 0) {
    console.error(`\n✗ 일진이 ${bad}건 어긋납니다. 기준일을 고치기 전에는 진행하지 않습니다.`);
    process.exit(1);
  }
  console.log("  ✓ 표본 전건 일치 — 기준일이 맞습니다");

  console.log("\n[2/2] 절기 수집");
  const terms = await fetchTerms();

  mkdirSync("data", { recursive: true });
  writeFileSync("data/saju-terms.json", JSON.stringify({ from: FROM, to: TO, terms }, null, 0));
  console.log(`\n✓ data/saju-terms.json — 절기 ${terms.length}건`);
  console.log("  다음: 이 표를 src/lib/saju-calendar.js 에 붙여 연주·월주를 세웁니다.");
})();
