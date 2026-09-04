/**
 * ✍ 너의스토리 — 결과 그림 서빙
 * ==========================================================================
 *
 * ── 읽기 축과 정반대의 규칙이다 ─────────────────────────────────────────
 * 연재 회차(`/webtoon/w/*`)는 전원 공개에 `max-age=31536000, immutable` 이다.
 * 여기는 **한 사람의 이야기**다. 같은 규칙을 쓰면 두 가지가 한꺼번에 무너진다 —
 * 주소를 아는 누구나 볼 수 있게 되고, 삭제 요청(policy §3-4)을 받아 R2 에서 지워도
 * 엣지 캐시에 1년 동안 남는다.
 *
 * 그래서 **요청마다 소유자를 확인하고**, 캐시는 브라우저 개인 캐시까지만 허용한다.
 * 컷 그림은 한 번 만들면 바뀌지 않으므로 `private, max-age=…` 로 재방문은 가볍게
 * 두되, 공용 캐시(엣지·중계)에는 절대 두지 않는다.
 *
 * ── 추측 불가 주소로 대신하지 않는다 ────────────────────────────────────
 * 긴 무작위 토큰을 주소에 넣는 방법이 더 싸지만, 그러면 링크가 새는 순간 통제가
 * 끝난다. 공유는 3단계에서 **의도적으로** 열 기능이므로(relay_spec §1), 그때까지는
 * 새지 않는 편이 낫다. 확인 한 번의 비용은 D1 조회 한 줄이다.
 */

import { resolveUser } from "../lib/user.js";
import { YS_ORDER_ID_RE } from "../lib/config.js";

/**
 * `/ys/a/<주문ID>/<파일명>`
 *
 * ✍✍ **접두는 트랙마다 다르다** (`YS-` · `YS2-`). 여기가 한 접두로 박혀 있으면
 * YS2 주문의 그림은 주소가 맞는데도 **404** 가 된다 — 조용히 새는 것이 아니라
 * 고객 화면에서 빈 칸이 되는 자리다.
 *
 * ID 부분은 **`YS_ORDER_ID_RE` 를 그대로 떼어 쓴다** — 접두 목록에서 패턴을 여기서
 * 또 짜면 그 순간 「같은 규칙을 두 곳에서 재는」 자리가 된다(원칙 21).
 */
const PATH = new RegExp(
  `^/ys/a/(${YS_ORDER_ID_RE.source.replace(/^\^/, "").replace(/\$$/, "")})` +
    String.raw`/([a-z0-9_]+\.(?:png|jpg|webp))$`,
);

export async function ysAsset(request, env) {
  const url = new URL(request.url);
  const m = url.pathname.match(PATH);
  if (!m) return new Response("Not found", { status: 404 });

  const [, orderId, name] = m;
  const { userId } = await resolveUser(request, env);

  // 소유자 확인. **남의 것이면 404 다** — 403 을 주면 "그 주문은 있다"는 사실을
  // 알려 주게 된다. 개인 서사에서는 존재 여부 자체가 정보다.
  const row = await env.DB.prepare(
    `SELECT status FROM ys_order WHERE id = ? AND user_id = ?`,
  )
    .bind(orderId, userId)
    .first();
  if (!row || row.status === "deleted") return new Response("Not found", { status: 404 });

  const object = await env.YS?.get(`${orderId}/${name}`);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=86400");
  return new Response(object.body, { headers });
}
