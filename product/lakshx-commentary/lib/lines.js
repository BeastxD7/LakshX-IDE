"use strict";
/**
 * The line bank — this content IS the feature. Cricket-commentary energy:
 * enthusiastic, a bit theatrical, has fun with both triumph and failure, but
 * never actually cruel to the player who dropped the catch. Every line here
 * passed a "would this sting on someone's bad day" read-back before landing.
 *
 * Seven categories. `{files}` and `{count}` are the only two template
 * tokens supported (see renderLine below) — used sparingly, only where a
 * concrete number genuinely adds punch. Everything else is fully static:
 * zero runtime cost, no LLM involved in picking or rendering these.
 */

/** (a) A build/test/task command failed, repeatedly, in the same terminal. */
const buildFail = [
  "And that's out again — same bowler, same delivery, same result. The build's got your number today.",
  "Oh, played and missed! That's the third one in a row — even the umpire's starting to feel bad for you.",
  "Not out... wait, sorry, it absolutely is out. Back to the nets, champion.",
  "That's two failures on the trot. The pitch is testing your patience more than your code right now.",
  "Another red scoreboard. Somewhere out there, a semicolon is very pleased with itself.",
  "The tail is wagging, but the runs aren't coming — keep at it, this one's turning eventually.",
  "That's a maiden over of failures. Frustrating to watch, but plenty of us have been stuck on this exact wicket.",
  "Third strike and still swinging — respect for the persistence, even if the scoreboard disagrees.",
  "Well, the build gremlins are having an absolute field day. Time to check the stack trace.",
  "Ooh, that's not the shot selection you wanted. Same error, different attempt. It happens to the best of them.",
  "The reviewers in the commentary box are shaking their heads — but so was every legend before their breakthrough over.",
  "Another failed run. Somewhere a very calm coach is nodding solemnly about the virtue of patience.",
  "That's {count} wickets down and the tests still won't budge. Time for a drinks break and a fresh pair of eyes.",
  "Keeps hitting the same fielder. Might be worth changing the angle of attack on this one.",
  "The scoreboard's stuck, but the persistence is elite-level. This is how comebacks start.",
  "That's a proper collapse — failed build number who's-even-counting. Take five, breathe, come back swinging.",
  "The umpire's raised the finger again. Somewhere in that stack trace is the answer — it's just being shy.",
  "Struggling to find the gaps today. Even the greats have quiet series — this one's just a rough patch.",
  "That's another dot ball on the build front. No boundary yet, but no run-out either — still very much in this.",
  "The crowd's gone quiet, but the good ones don't panic three wickets down. Onwards.",
];

/** (b) Tests pass after a struggle, or a large clean diff lands. */
const bigWin = [
  "AND THAT'S OUT OF THE PARK! Tests green after all that — what a turnaround!",
  "HE'S DONE IT! Green across the board. Take a bow, that was a proper fightback.",
  "From repeated failures to a clean sweep — that, ladies and gentlemen, is how you finish an innings.",
  "OWZAT for a comeback! The build's gone from red to green faster than a run-out appeal.",
  "That's a monster six over the pavilion — {files} landed clean, not a single fielder laid a glove on it.",
  "Absolute standing ovation. Struggled, adjusted, and now it's all green lights. Take the lap of honour.",
  "The scoreboard just flipped — GREEN. ACROSS. THE. BOARD. Somebody pour the celebratory tea.",
  "That's a century of persistence paying off right there. Beautifully played.",
  "From nervous nineties to a clean ton — tests pass, and the crowd's on its feet.",
  "What a turnaround! One minute it's carnage, the next it's a masterclass. Brilliant recovery.",
  "That's the kind of comeback they'll replay in the highlights reel for years.",
  "He's cleared the ropes! {files}, all green, no fuss. Some days it just clicks.",
  "The tension in the commentary box just evaporated. Beautiful, clean, all-green finish.",
  "That's the sound of a job well and truly done. Sit back, that one deserved the ovation.",
  "From the depths of a batting collapse to a declaration-worthy total — remarkable stuff.",
  "Every light on the board just turned green — somewhere, a very relieved QA engineer is smiling.",
  "That's a five-star finish after a rocky start. This is why we love this game.",
  "The comeback of the season, right there in the diff. Absolutely take a bow.",
  "Clean sweep! Whatever gremlin was in there earlier has officially left the building.",
  "That's a declaration-worthy total after a shaky start — well and truly earned.",
];

/** (c) Late-night coding (roughly 1am-4am local time). */
const lateNight = [
  "It's gone the small hours and this one's still at the crease. Dedication, or mild insanity? Bit of both, probably.",
  "The floodlights are on and so, apparently, is the code editor. Night session, ladies and gentlemen.",
  "Nobody in the stands at this hour except us. Respect for the graveyard-shift hustle.",
  "Test match temperament right here — still grinding well past the close of play.",
  "Deep into the night and still bowling overs. Someone get this player a nightwatchman.",
  "The rest of the ground's gone home, but this one's playing under lights. Bold.",
  "Burning the midnight oil — or possibly just burning. Stay hydrated out there, champion.",
  "This is either peak focus or peak insomnia. The commentary box votes focus, generously.",
  "Late-night session, small crowd, big commitment. Someone hand this player a coffee.",
  "The clock says most sensible people are asleep. This player says 'one more function.'",
  "Playing deep into the night — either a deadline or true love for the game. Possibly both.",
  "It's the witching hour and the keyboard's still clicking. Absolute nightwatchman energy.",
  "Most of the ground's in bed. This one's still going for the extra over.",
  "Somewhere a sensible person is asleep. This is not that person, and honestly, respect.",
  "The moon's out, the coffee's cold, and the commits keep coming. Night-owl special.",
  "This late in the day, most teams declare. This one's still batting. Impressive stamina.",
  "The code you write at this hour either becomes legendary or gets rewritten tomorrow. Either way, respect the grind.",
  "The stumps should've been drawn hours ago. Someone's playing extra time.",
  "Late-night overs are the toughest ones to bowl well. Nice to see you still swinging.",
  "It's properly late. The code will still compile tomorrow — but hey, we're here for it tonight.",
];

/** (d) The agent itself hit an error or got denied a permission. */
const agentTrouble = [
  "Oh, the agent's been given out lbw there — that permission wasn't given, and fair enough.",
  "That's a no-ball from the agent's end. Back to the mark, try that delivery again.",
  "The agent went for the big shot and got caught at the boundary. Happens to the best of them.",
  "That's a dropped catch on the agent's part — no harm done, just dust it off and go again.",
  "The umpire's stepped in there — permission denied, and quite right too. Good captaincy.",
  "That's a wide down the agent's end. Recalibrating and coming back around.",
  "The agent tried a risky single and got run out. Bold call, didn't quite come off.",
  "Review requested — and the on-field decision stands. Denied, as it should be sometimes.",
  "That's a bit of a fumble in the field from the agent. Nobody's perfect out there.",
  "The agent overstepped the crease on that one — no-ball, no runs, no drama.",
  "That attempt just got stumped. Back to the non-striker's end, agent.",
  "The agent's been sent back to the pavilion on that swing — the gatekeeper stood firm.",
  "That's a mistimed shot straight to the fielder. Agent, dust yourself off.",
  "The third umpire's checked it and, yep, that one's not out — request denied, carry on.",
  "A bit of a mix-up in the middle there. The agent's error, easily forgotten.",
  "That's the safety net doing exactly its job — nice bit of fielding by the human in charge.",
  "The agent swung hard and missed. No shame in that, plenty of great players have too.",
  "Permission not granted — good call by the skipper. The agent will live to bowl another over.",
  "That's a hiccup on the agent's scorecard, nothing more. Onward.",
  "The gate stayed shut on that one — sensible defending, no harm to the innings.",
];

/** (e) A really fast, slick multi-file agent change. */
const slickChange = [
  "OH THAT WAS QUICK! {files} touched, clean as you like, and barely a beat missed.",
  "Lightning-fast hands there — {files} rewritten before the over even finished.",
  "That's textbook footwork — in, out, {files} handled, gone before anyone blinked.",
  "Blink and you missed it — {files} changed with the tidiness of a proper professional.",
  "That's the kind of quick, clean work that gets a nod from the commentary box.",
  "Fast hands, clean lines — {files} sorted in the time it takes to say 'well played.'",
  "That was surgical. In, done, out — {files}, no mess left on the pitch.",
  "Absolute clinic in efficiency there. {files}, tidy as a freshly rolled wicket.",
  "That's the quickest, cleanest bit of work all session. Take a bow.",
  "In and out like a proper death-overs specialist — {files}, no fuss, no drama.",
  "That's some serious hand speed — {files} down before the crowd even registered the shot.",
  "Textbook. Precise. Quick. {files}, and every one of them landed exactly where it should.",
  "That's a slip fielder's reflexes right there — sharp, clean, and gone in a flash.",
  "Whew — that was over before it started. {files}, tidy and true.",
  "That's the kind of composure under pace that wins matches. Beautifully quick work.",
  "Efficient, elegant, over almost as soon as it began. {files}, textbook stuff.",
  "That's a proper fast bowler's rhythm — {files}, all landed on a good length.",
  "Sharp hands in the field there — clean pickup, quick release, job done.",
  "That's the kind of speed that makes it look easy. It never is. Well played.",
  "Quick single turned into a full sprint — {files} and not a moment wasted.",
];

/** (f) Idle for a while, then suddenly active again. */
const welcomeBack = [
  "And we're back! The players are walking out again after a bit of a rain delay.",
  "Oh, is that movement in the middle? Yes — we're back in play after a quiet spell.",
  "The covers are off and play has resumed. Good to have you back at the crease.",
  "Well, the drinks break's over — back to business.",
  "There's the first ball after the interval. Welcome back to the middle.",
  "The lights just came back on. Let's see what's in store for this session.",
  "After a bit of a lull, the action's back on. Here we go again.",
  "The crowd's stirring — looks like play's resuming after that break.",
  "Back from the pavilion and straight to work. No warm-up needed, apparently.",
  "That's the bails back on the stumps — play is very much back underway.",
  "Rain stopped play for a bit, but the covers are off and we're rolling again.",
  "Welcome back to the middle — the over left off right where you're picking it up.",
  "The umpire's called play — and so, evidently, have you.",
  "After a quiet stretch, the action's stirring again. Good to see you back.",
  "That's the interval over. Fresh legs, fresh over, let's go.",
  "The tea break's done — back out there and straight into it.",
  "A little lull, and now we're off again. Let's see what this session brings.",
  "Back in the middle after a breather — the good ones always find their rhythm again fast.",
  "Play resumes! Whatever kept you away, the pitch missed you.",
  "There it is — first sign of life after the break. Let's get back into it.",
];

/** (g) A rapid burst of undo/redo in a short window — a frustration signal. */
const frustrationBurst = [
  "That's a flurry of reviews at the third umpire — undo, redo, undo again. Indecision at the crease.",
  "Ooh, changed his mind there. And again. And... again. The review system's getting a workout.",
  "That's some serious back-and-forth — like reviewing an lbw call three times over.",
  "The undo button's had quite the over there. Take a breath, the code isn't going anywhere.",
  "That's a proper rethink mid-shot — happens to everyone when the pitch is playing tricks.",
  "Quite the flurry of second-guessing there. Might be worth stepping back for a sec.",
  "Undo, redo, undo again — that's a rally worthy of a tennis match, not cricket.",
  "The reviews are stacking up. Sometimes the first instinct was fine all along.",
  "That's a lot of back-and-forth for one delivery. Worth a quick breather before the next one.",
  "Indecision at the crease — nothing wrong with that, just maybe time for a short walk.",
  "That's the mental-scoreboard equivalent of pacing the crease. Take a beat.",
  "Undo, redo, undo — sounds like this one's still finding its rhythm. No rush.",
  "The keyboard shortcuts are getting quite the workout right now. All good, happens to everyone.",
  "That's a few too many reviews for one ball. Might be a good moment for a sip of water.",
  "Rapid-fire changes of heart there — the code's patient, it'll wait for you to settle.",
  "That's some fast footwork, but in circles. Worth pausing to pick a direction.",
  "The scoreboard operator's struggling to keep up with all these reversals. Take five.",
  "A whirlwind of undo/redo — sometimes the answer is a short break, not another edit.",
  "That's proper indecision at the crease. No shame in stepping away from the ball for a second.",
  "Quite the tug-of-war with yourself there. Might be worth sketching it out before the next swing.",
];

const LINE_BANKS = {
  buildFail,
  bigWin,
  lateNight,
  agentTrouble,
  slickChange,
  welcomeBack,
  frustrationBurst,
};

const CATEGORIES = Object.keys(LINE_BANKS);

/** Replace the two supported template tokens with values from `meta` (or a graceful generic fallback if absent). Pure. */
function renderLine(line, meta = {}) {
  let out = line;
  if (out.includes("{files}")) {
    const n = meta.fileCount;
    const phrase = typeof n === "number" && n > 0 ? `${n} file${n === 1 ? "" : "s"}` : "a stack of files";
    out = out.split("{files}").join(phrase);
  }
  if (out.includes("{count}")) {
    const n = meta.count;
    const phrase = typeof n === "number" && n > 0 ? String(n) : "several";
    out = out.split("{count}").join(phrase);
  }
  return out;
}

/**
 * Pick an index from `bank` (array), avoiding any index in `recentIndices`
 * (a Set) — the "no immediate repeat" rule. Falls back to picking from the
 * full bank if every index has been recently shown (small banks + a long
 * history would otherwise deadlock). Pure — takes its randomness as an
 * injectable function so it's deterministically testable.
 */
function pickIndex(bank, recentIndices = new Set(), rng = Math.random) {
  const candidates = [];
  for (let i = 0; i < bank.length; i++) {
    if (!recentIndices.has(i)) candidates.push(i);
  }
  const pool = candidates.length > 0 ? candidates : bank.map((_, i) => i);
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Pick a rendered line for `category`, tracking history in `historyState`
 * (a Map<category, number[]> the caller owns and persists across calls —
 * e.g. one field on the extension's in-memory state). `noRepeatWindow`
 * caps how many of the most recent picks per category are excluded.
 */
function pickLine(category, { historyState = new Map(), meta = {}, rng = Math.random, noRepeatWindow = 6 } = {}) {
  const bank = LINE_BANKS[category];
  if (!bank || bank.length === 0) return null;
  const history = historyState.get(category) ?? [];
  const recent = new Set(history.slice(-noRepeatWindow));
  const idx = pickIndex(bank, recent, rng);
  history.push(idx);
  // bound the stored history so it doesn't grow forever across a long session
  if (history.length > noRepeatWindow * 4) history.splice(0, history.length - noRepeatWindow * 2);
  historyState.set(category, history);
  return renderLine(bank[idx], meta);
}

module.exports = { LINE_BANKS, CATEGORIES, renderLine, pickIndex, pickLine };
