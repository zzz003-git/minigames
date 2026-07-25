/**
 * 타이핑 스피드 챌린지용 문장 DB 생성 스크립트
 *
 *   node scripts/gen-sentences.mjs   →   migrations/0002_seed_sentences.sql
 *
 * 기획서 7장 요구사항: 한국어 100문장 이상 / English 100문장 이상 / 한·영 혼합 50문장 이상.
 * 글자수(char_count)와 단어수(word_count)는 손으로 세지 않고 이 스크립트가 계산합니다.
 * 모든 문장은 저작권 문제가 없는 창작 문장입니다.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ===================================================================
// 한국어 — 지표: CPM (타수/분)
// ===================================================================

const KO_EASY = [
  `오늘 날씨가 참 맑고 좋다.`,
  `아침에 물 한 잔을 마셨다.`,
  `우리는 함께 공원을 걸었다.`,
  `작은 습관이 하루를 바꾼다.`,
  `창문 밖으로 새가 날아갔다.`,
  `나는 매일 조금씩 성장한다.`,
  `따뜻한 차 한 잔이 생각난다.`,
  `책상 위에 노트를 펼쳤다.`,
  `저녁에 가족과 밥을 먹었다.`,
  `천천히 가도 결국 도착한다.`,
  `오래된 사진을 다시 보았다.`,
  `바람이 부드럽게 불어온다.`,
  `그는 조용히 문을 닫았다.`,
  `시간은 누구에게나 공평하다.`,
  `나무 그늘에서 잠시 쉬었다.`,
  `새로운 하루가 다시 시작된다.`,
  `좋은 질문이 좋은 답을 만든다.`,
  `우산을 챙겨서 집을 나섰다.`,
  `어제보다 조금 더 나아졌다.`,
  `마음이 편해지는 음악을 들었다.`,
  `계단을 하나씩 올라갔다.`,
  `강아지가 꼬리를 흔들었다.`,
  `정리된 공간은 생각을 맑게 한다.`,
  `나는 오늘도 최선을 다했다.`,
  `첫걸음이 가장 어렵고 중요하다.`,
  `노란 은행잎이 길에 쌓였다.`,
  `짧은 산책이 기분을 바꾼다.`,
  `그녀는 밝게 웃으며 인사했다.`,
  `조용한 아침이 가장 좋다.`,
  `물을 자주 마시는 것이 좋다.`,
  `창밖에 비가 내리고 있다.`,
  `작은 친절이 오래 기억된다.`,
  `나는 새 책을 한 권 샀다.`,
  `우리 동네에 꽃이 피었다.`,
  `하늘이 붉게 물들고 있다.`,
  `오늘 할 일을 먼저 적었다.`,
  `쉬는 것도 중요한 일이다.`,
];

const KO_NORMAL = [
  `아침 햇살이 커튼 사이로 들어와 방 안을 천천히 밝혔다.`,
  `계획을 세우는 일보다 그 계획을 지켜내는 일이 훨씬 어렵다.`,
  `오랫동안 미뤄두었던 편지를 오늘 저녁에야 겨우 다 썼다.`,
  `낯선 도시의 골목을 걷다 보면 예상하지 못한 풍경을 만난다.`,
  `좋은 문장은 짧고 명확하며 읽는 사람의 시간을 아껴 준다.`,
  `사소해 보이는 기록이 몇 년 뒤에는 소중한 자료가 되기도 한다.`,
  `실패를 정확히 기록해 두면 다음 시도에서 같은 실수를 줄일 수 있다.`,
  `창가에 놓아둔 화분이 어느새 손바닥만큼 자라 있었다.`,
  `서로의 속도를 존중하는 관계가 오래 유지되는 법이다.`,
  `복잡한 문제일수록 종이에 적어 보면 실마리가 보이기 시작한다.`,
  `이른 새벽에 일어나 조용히 책을 읽는 시간이 가장 마음에 든다.`,
  `목표를 작게 쪼개면 부담이 줄고 시작하기가 훨씬 쉬워진다.`,
  `오래 걸어야 하는 길이라면 처음부터 속도를 아껴 두는 편이 낫다.`,
  `지난달에 심은 씨앗에서 초록색 싹이 조심스럽게 올라왔다.`,
  `대화에서 가장 어려운 기술은 끝까지 조용히 듣는 일이다.`,
  `여행의 즐거움은 도착지보다 그곳으로 가는 과정에 있는 경우가 많다.`,
  `필요한 물건만 남기고 정리하니 방이 두 배쯤 넓어 보였다.`,
  `매일 같은 시간에 같은 일을 반복하는 힘은 생각보다 강하다.`,
  `비 오는 날의 도시는 평소와 전혀 다른 소리를 들려준다.`,
  `완벽한 준비를 기다리다 보면 시작할 시기를 놓치기 쉽다.`,
  `손으로 직접 적어 본 내용은 훨씬 오래 기억에 남는다.`,
  `낮에 잠깐 눈을 붙이는 습관이 오후의 집중력을 크게 높여 주었다.`,
  `새로운 기술을 배울 때는 완성보다 반복이 먼저 필요하다.`,
  `문을 열자 오래 묵혀 둔 책 냄새가 조용히 흘러나왔다.`,
  `상대의 입장을 한 번 상상해 보면 갈등의 절반은 풀린다.`,
  `오늘 하루를 어떻게 보냈는지 세 줄로 정리해 보기로 했다.`,
  `좋은 도구는 손에 익을 때까지 시간을 조금 요구한다.`,
  `겨울 아침의 공기는 차갑지만 머리를 아주 맑게 만들어 준다.`,
  `남과 비교하는 습관을 줄이니 마음이 훨씬 가벼워졌다.`,
  `처음 만든 결과물은 대체로 부족하지만 그래도 가치가 있다.`,
  `조용한 도서관에서 페이지를 넘기는 소리만 규칙적으로 들렸다.`,
  `익숙한 길을 벗어나면 잠시 헤매지만 새로운 것을 배운다.`,
  `오래 쓴 물건에는 그 사람의 생활 습관이 그대로 남아 있다.`,
  `어려운 결정을 앞두었을 때는 하루 정도 미뤄 보는 것도 방법이다.`,
  `정성껏 끓인 국 한 그릇이 지친 하루를 위로해 주었다.`,
  `배운 것을 다른 사람에게 설명해 보면 이해가 훨씬 단단해진다.`,
  `계절이 바뀌는 시기에는 몸이 먼저 변화를 알아차린다.`,
];

const KO_HARD = [
  `우리는 흔히 "노력하면 된다"고 말하지만, 방향이 틀린 노력은 시간을 배로 소모할 뿐이다.`,
  `통계에 따르면 응답자 중 68.4%가 새해 계획을 3주 안에 포기한다고 답했다.`,
  `좋은 설계란 무엇을 넣을지 고민하는 일이 아니라, 무엇을 빼도 되는지 판단하는 일이다.`,
  `그는 "내일부터"라는 말을 스물세 번쯤 되풀이한 뒤에야 비로소 첫 줄을 적기 시작했다.`,
  `습관은 의지의 문제가 아니라 환경의 문제이며, 환경은 의외로 쉽게 바꿀 수 있다.`,
  `회의록에는 결정 사항·담당자·기한이 반드시 함께 적혀 있어야 나중에 쓸모가 있다.`,
  `데이터는 거짓말을 하지 않지만, 데이터를 고르는 사람은 얼마든지 거짓말을 할 수 있다.`,
  `1937년에 지어진 이 건물은 세 차례의 보수를 거쳐 지금의 모습으로 남았다.`,
  `배움의 속도가 느려졌다고 느껴질 때는, 대개 기초로 되돌아가야 한다는 신호다.`,
  `완성도를 90%까지 올리는 데 걸린 시간과, 남은 10%를 채우는 데 걸린 시간이 비슷했다.`,
  `편집이란 문장을 아름답게 꾸미는 작업이 아니라, 오해의 여지를 지워 내는 작업이다.`,
  `그녀가 남긴 메모에는 "겁내지 말고, 다만 준비는 철저히"라는 한 줄이 적혀 있었다.`,
  `어떤 조직이든 문제를 숨기는 문화가 자리 잡으면, 작은 결함이 큰 사고로 자란다.`,
  `오전 9시 15분에 출발한 열차는 예정보다 4분 늦게 종착역에 도착했다.`,
  `우리가 기억하는 과거는 실제로 일어난 일이 아니라, 여러 번 다시 쓰인 이야기에 가깝다.`,
  `반복되는 실수에는 대개 개인의 부주의보다 구조적인 원인이 숨어 있는 경우가 많다.`,
  `그는 지도 없이 걷는 편을 택했고, 그 덕분에 아무도 알려 주지 않은 길을 찾아냈다.`,
  `"빠르게"와 "제대로"가 충돌할 때, 무엇을 먼저 포기할지 미리 정해 두어야 한다.`,
  `초고는 언제나 부끄럽지만, 그 부끄러움을 견디지 않으면 두 번째 원고는 오지 않는다.`,
  `측정하지 않는 목표는 희망일 뿐이며, 희망만으로 개선되는 일은 거의 없다.`,
  `총 1,024명이 참가한 대회에서 상위 18%에 들기 위해서는 184등 안에 들어야 했다.`,
  `도구를 바꾸면 결과가 달라질 것 같지만, 대개 바뀌어야 하는 것은 습관 쪽이다.`,
  `오래된 코드를 고칠 때는, 왜 그렇게 작성되었는지를 먼저 이해하는 편이 안전하다.`,
  `협업에서 가장 값비싼 비용은 실수가 아니라, 서로 다르게 이해한 채 지나간 시간이다.`,
  `그날의 기온은 영하 12.7도까지 떨어졌고, 강 표면은 완전히 얼어붙어 있었다.`,
  `좋은 질문은 답을 요구하지 않고도 상대의 생각을 스스로 정리하게 만들어 준다.`,
  `계획대로 되지 않는 일이 반복될 때, 문제는 실행력보다 계획의 해상도에 있을 수 있다.`,
  `읽은 책의 목록보다, 그 책을 읽고 바뀐 행동의 목록이 훨씬 정직한 기록이다.`,
  `위험을 감수하지 않는 선택도 결국 하나의 위험이며, 그 대가는 천천히 나타난다.`,
  `사람들은 대체로 조언을 구하지만, 실제로 원하는 것은 이미 정한 결정에 대한 동의다.`,
  `3개월 동안 매일 30분씩 투자하면 총 45시간이 되고, 그 정도면 무언가는 반드시 바뀐다.`,
  `문서를 쓰는 진짜 목적은 기록이 아니라, 미래의 자신과 동료를 구하는 일이다.`,
  `실력은 계단처럼 오르기 때문에, 한동안 변화가 없어 보이는 구간을 반드시 지나야 한다.`,
  `그는 낡은 만년필로 서명했고, 잉크가 마르기를 기다리며 창밖을 오래 바라보았다.`,
  `어떤 기술이 낡았는지 판단하려면, 그것이 해결하려던 문제가 아직 남아 있는지 보면 된다.`,
  `우리는 정보를 더 많이 얻으면 더 나은 결정을 할 것이라 믿지만, 실제로는 자주 반대다.`,
];

// ===================================================================
// English — 지표: WPM
// ===================================================================

const EN_EASY = [
  `The morning light filled the quiet room.`,
  `She wrote a short note and left it there.`,
  `Small habits build a better day.`,
  `He opened the window to let the air in.`,
  `We walked slowly along the river.`,
  `A good question beats a fast answer.`,
  `The cat slept on the warm windowsill.`,
  `I made a cup of tea and sat down.`,
  `Every day is a chance to begin again.`,
  `The train arrived a little early today.`,
  `She kept her promise without saying much.`,
  `Rain tapped gently on the old roof.`,
  `He read the same page three times.`,
  `Time treats everyone exactly the same.`,
  `A short walk can change your mood.`,
  `The garden smelled of wet soil and grass.`,
  `They shared one umbrella and laughed.`,
  `I wrote down three things to finish.`,
  `The room felt larger once it was clean.`,
  `He learned to rest without feeling guilty.`,
  `Her voice was calm and very clear.`,
  `The bread was still warm from the oven.`,
  `We watched the sky turn deep orange.`,
  `Start small and simply keep going.`,
  `The dog waited quietly by the door.`,
  `I found an old photo in my desk.`,
  `A kind word can last a long time.`,
  `He counted the stairs on the way up.`,
  `The library was silent all afternoon.`,
  `She packed light and left before dawn.`,
  `Good tools take time to learn.`,
  `The coffee cooled while I kept typing.`,
  `He wrote one sentence, then another.`,
  `None of it was easy, but it worked.`,
  `The path was narrow but well marked.`,
  `I chose the slower road on purpose.`,
  `She asked one question that changed everything.`,
];

const EN_NORMAL = [
  `The best plans are the ones simple enough to survive a busy week.`,
  `She learned that finishing badly still beats not starting at all.`,
  `A well written page respects the reader and saves everyone time.`,
  `He kept a record of his mistakes so he would not repeat them.`,
  `The city sounds completely different in the hour before sunrise.`,
  `Breaking a goal into small steps makes the first move much easier.`,
  `They agreed to meet again once both had slept on the decision.`,
  `Most difficult problems get clearer the moment you write them down.`,
  `The hardest part of listening is staying quiet until the very end.`,
  `She kept only what she needed, and the room felt twice as large.`,
  `Learning a new skill demands repetition long before it demands talent.`,
  `He walked the same route each morning and noticed something new.`,
  `Waiting for perfect conditions is the most common way to never begin.`,
  `Notes written by hand tend to stay in memory far longer than typed ones.`,
  `The journey often matters more than the place you meant to reach.`,
  `A short nap in the afternoon restored more focus than another coffee.`,
  `She explained the idea to a friend and finally understood it herself.`,
  `Doing the same thing at the same hour daily builds surprising strength.`,
  `The first version of anything is rough, and that is exactly its purpose.`,
  `He stopped comparing his progress to other people and slept much better.`,
  `Old objects carry the daily habits of whoever used them for years.`,
  `When a decision feels heavy, delaying it one day is often a fair choice.`,
  `Good design is less about what you add than what you leave out.`,
  `The quiet click of turning pages was the only sound in the whole room.`,
  `Leaving a familiar path means getting lost briefly and learning quickly.`,
  `A warm bowl of soup made the long and difficult day feel manageable.`,
  `She measured her progress in weeks rather than in single hard days.`,
  `Nobody remembers the plan; they remember whether the work got finished.`,
  `He wrote for twenty minutes every morning and finished a book in a year.`,
  `The strongest teams are the ones where bad news travels fast and safely.`,
  `Understanding why old code was written that way keeps you from breaking it.`,
  `The costliest part of teamwork is time spent misunderstanding each other.`,
  `She replaced her long list with three items and finally made progress.`,
  `Reading widely matters less than changing something after you read.`,
  `Avoiding every risk is itself a risk, and the bill arrives slowly.`,
  `Most people ask for advice when what they really want is permission.`,
  `Thirty minutes a day for three months adds up to forty five hours.`,
];

const EN_HARD = [
  `According to the survey, 68.4% of respondents abandoned their plans within three weeks.`,
  `"Work harder" is useless advice when the direction is wrong; the effort then costs double.`,
  `The building, completed in 1937, was restored three times before reaching its present form.`,
  `Getting the project to 90% took four months; the final 10% took almost exactly as long.`,
  `Editing is not the art of making sentences pretty — it is the art of removing ambiguity.`,
  `Her last note read: "Don't be afraid, but do prepare thoroughly," and nothing more.`,
  `When an organization rewards hiding problems, small defects reliably grow into disasters.`,
  `The 9:15 train left on time and still reached the final station four minutes late.`,
  `What we remember is not the past itself, but a story that has been rewritten many times.`,
  `Repeated mistakes usually point to a broken process rather than a careless individual.`,
  `He traveled without a map, and because of that he found roads nobody had recommended.`,
  `When "fast" and "correct" collide, decide in advance which one you are willing to lose.`,
  `A goal you cannot measure is only a wish, and wishes rarely improve on their own.`,
  `Out of 1,024 participants, reaching the top 18% required finishing within 184th place.`,
  `Changing your tools feels productive; changing your habits is what actually works.`,
  `The temperature dropped to -12.7 degrees, and the surface of the river froze solid.`,
  `Skill improves in steps, so you must pass through long stretches that feel like nothing.`,
  `He signed with an old fountain pen, then watched the window while the ink dried.`,
  `To judge whether a technology is obsolete, ask whether its original problem still exists.`,
  `We assume more information leads to better decisions; frequently the opposite is true.`,
  `Meeting notes are worthless unless they record the decision, the owner, and the deadline.`,
  `Data does not lie, but the person selecting which data to show absolutely can.`,
  `The real purpose of documentation is to rescue your future self and your colleagues.`,
  `She had said "starting tomorrow" roughly twenty three times before writing line one.`,
  `Habits rely far less on willpower than on environment, and environments are easy to edit.`,
  `A first draft is always embarrassing; refusing that embarrassment guarantees no second one.`,
  `If progress feels slow, that is usually a signal to return to the fundamentals.`,
  `The list of books you read matters less than the list of behaviors you changed.`,
  `Roughly 42% of the budget was spent before anyone questioned the original estimate.`,
  `Good questions organize the other person's thinking without demanding any answer at all.`,
  `He wrote 1,200 words, deleted 900, and counted the remaining 300 as a good morning.`,
  `Respecting each other's pace is what keeps a long relationship from quietly breaking.`,
  `The report ran 47 pages; the single useful paragraph appeared on page 31.`,
  `Nobody plans to fail slowly, yet slow failure is by far the most common kind.`,
  `She asked for the deadline first, the budget second, and the reason for both third.`,
  `Complex systems fail gradually, in ways that look ordinary until they suddenly do not.`,
];

// ===================================================================
// 한·영 혼합 — 지표: WPM + CPM 병행
// ===================================================================

const MIX_EASY = [
  `오늘 meeting은 오후 3시에 시작한다.`,
  `새 laptop을 책상 위에 올려두었다.`,
  `나는 매일 아침 email을 정리한다.`,
  `이번 project는 생각보다 빠르게 끝났다.`,
  `아침에 coffee 한 잔을 마셨다.`,
  `그는 지금 office에 없다.`,
  `우리 team은 조용히 일하는 편이다.`,
  `이 app은 정말 간단하고 편하다.`,
  `나는 주말에 movie를 한 편 봤다.`,
  `오늘 schedule을 다시 확인했다.`,
  `그녀는 short note를 남기고 떠났다.`,
  `이 file은 어디에 저장했을까.`,
  `새로운 idea가 갑자기 떠올랐다.`,
  `나는 매일 backup을 실행한다.`,
  `이번 update는 아주 안정적이다.`,
  `우리는 짧은 break를 가졌다.`,
  `그 design은 단순해서 좋았다.`,
  `오늘 test는 모두 통과했다.`,
];

const MIX_NORMAL = [
  `이번 sprint에서 배운 것은 계획보다 실행이 어렵다는 사실이었다.`,
  `좋은 feedback은 사람을 공격하지 않고 문제를 정확히 가리킨다.`,
  `나는 매일 아침 todo list를 세 줄로 줄이는 연습을 하고 있다.`,
  `이 feature는 사용자가 아무 설명 없이도 쓸 수 있어야 의미가 있다.`,
  `회의 전에 agenda를 공유하면 회의 시간이 절반으로 줄어든다.`,
  `deadline이 다가올수록 우리는 무엇을 빼야 할지 더 정확히 알게 된다.`,
  `좋은 document는 미래의 나와 동료를 구하는 안전장치 역할을 한다.`,
  `새 framework를 배우는 일보다 기존 습관을 바꾸는 일이 더 어려웠다.`,
  `이번 release에서는 새 기능보다 안정성을 먼저 챙기기로 결정했다.`,
  `나는 매주 금요일 오후에 지난 week를 짧게 되돌아본다.`,
  `처음 만든 prototype은 부족했지만 방향을 확인하는 데 충분했다.`,
  `좋은 interface는 사용자가 고민하는 시간을 줄여 주는 쪽이다.`,
  `우리 team은 나쁜 소식을 빨리 공유하는 문화를 만들려고 노력한다.`,
  `이 bug는 재현 조건을 찾는 데 거의 이틀이 걸렸다.`,
  `짧은 daily meeting이 긴 주간 회의보다 훨씬 효과적이었다.`,
  `새로운 tool을 도입하기 전에 지금의 문제를 먼저 정의해야 한다.`,
  `나는 코드를 고치기 전에 항상 test를 먼저 작성하려고 한다.`,
  `이번 review에서 지적된 내용은 대부분 이름 짓기에 관한 것이었다.`,
  `좋은 log 한 줄이 새벽 두 시의 디버깅 시간을 절반으로 줄여 준다.`,
];

const MIX_HARD = [
  `이번 A/B test 결과 전환율이 3.2%에서 4.7%로 올랐지만, 표본이 부족해 재검증이 필요했다.`,
  `"Ship it"이라는 말은 용기의 표현이지만, 때로는 검증을 건너뛰는 핑계가 되기도 한다.`,
  `legacy code를 수정할 때는 왜 그렇게 작성되었는지를 먼저 이해해야 안전하다.`,
  `우리는 CI 파이프라인을 정리해 build 시간을 12분에서 3분 40초까지 줄였다.`,
  `좋은 API란 문서를 읽지 않아도 절반은 짐작할 수 있는 API를 말한다.`,
  `총 1,024명의 user 중 상위 18%에 들기 위해서는 184등 안에 들어야 했다.`,
  `rollback 계획이 없는 배포는 배포가 아니라 그저 희망에 가깝다.`,
  `이번 incident의 원인은 개인의 실수가 아니라 alert 설정의 공백이었다.`,
  `"나중에 리팩터링하자"는 약속의 이행률은 경험상 20%를 넘기지 않았다.`,
  `우리 서비스의 p95 응답 시간은 340ms였고, 목표는 200ms 이하였다.`,
  `측정하지 않는 KPI는 희망일 뿐이며, 희망만으로 개선되는 지표는 없다.`,
  `새 database로 이전하면서 약 4.3GB의 데이터를 무중단으로 옮겨야 했다.`,
  `code review에서 가장 값비싼 비용은 지적이 아니라 서로 다르게 이해한 시간이다.`,
  `그는 PR 설명란에 "왜"를 세 줄로 적어 두는 습관을 끝까지 지켰다.`,
  `cache를 도입해 조회 성능은 좋아졌지만, 데이터 정합성 문제가 새로 생겼다.`,
  `2026년 1분기 목표는 재방문율을 31%에서 45%까지 끌어올리는 것이었다.`,
  `좋은 error message는 무엇이 잘못되었는지와 다음에 무엇을 할지를 함께 알려 준다.`,
  `monitoring 없이 운영하는 시스템은 눈을 감고 고속도로를 달리는 것과 같다.`,
];

// ===================================================================
// SQL 생성
// ===================================================================

const GROUPS = [
  ["ko", "easy", KO_EASY],
  ["ko", "normal", KO_NORMAL],
  ["ko", "hard", KO_HARD],
  ["en", "easy", EN_EASY],
  ["en", "normal", EN_NORMAL],
  ["en", "hard", EN_HARD],
  ["mix", "easy", MIX_EASY],
  ["mix", "normal", MIX_NORMAL],
  ["mix", "hard", MIX_HARD],
];

const sqlQuote = (s) => `'${s.replace(/'/g, "''")}'`;
const charCount = (s) => [...s].length;
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

const rows = [];
const seen = new Set();
const counts = {};

for (const [lang, difficulty, list] of GROUPS) {
  for (const raw of list) {
    const text = raw.trim();
    if (seen.has(text)) throw new Error(`중복 문장 발견: ${text}`);
    seen.add(text);
    rows.push(
      `  (${sqlQuote(lang)}, ${sqlQuote(difficulty)}, ${sqlQuote(text)}, ${charCount(text)}, ${wordCount(text)})`,
    );
  }
  counts[lang] = (counts[lang] ?? 0) + list.length;
}

// 기획서 요구 최소 수량 검증
const MINIMUM = { ko: 100, en: 100, mix: 50 };
for (const [lang, min] of Object.entries(MINIMUM)) {
  if ((counts[lang] ?? 0) < min) {
    throw new Error(`${lang} 문장이 부족합니다: ${counts[lang] ?? 0} / 최소 ${min}`);
  }
}

const header = `-- 타이핑 스피드 챌린지 문장 DB
-- 이 파일은 scripts/gen-sentences.mjs 가 생성합니다. 직접 수정하지 마세요.
-- 문장을 추가·수정할 때는 스크립트를 고치고 \`node scripts/gen-sentences.mjs\` 를 다시 실행하세요.
--
-- 수량: 한국어 ${counts.ko}문장 / English ${counts.en}문장 / 한·영 혼합 ${counts.mix}문장 (총 ${rows.length}문장)

INSERT INTO sentences (lang, difficulty, text, char_count, word_count) VALUES
`;

const outPath = join(ROOT, "migrations", "0002_seed_sentences.sql");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header + rows.join(",\n") + ";\n", "utf8");

console.log(`생성 완료: migrations/0002_seed_sentences.sql`);
console.log(`  한국어 ${counts.ko} / English ${counts.en} / 혼합 ${counts.mix}  = 총 ${rows.length}문장`);
