// The pool of running sessions the week is drawn from.
//
// Nothing tested this. logic_test walks buildWeekPlan but against its own
// forked copy of WORKOUT_TEMPLATES, so the real pool could say anything and
// every suite would stay green. That was survivable while it held twenty-two
// entries written in one sitting; it is not now it holds fifty-one and grows
// whenever someone wants more variety.
//
// What can actually go wrong here is dull and specific: a session that needs
// kit the athlete does not own and offers no substitute, a tempo rep that
// comes apart when the Friday shortener trims it, and a piece of equipment in
// the settings that nothing ever asks for.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ctx = { console, Math, JSON, Object, Array, Number };
vm.createContext(ctx);
const grab = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  return src.slice(a, b);
};
vm.runInContext(
  grab('const WORKOUT_TEMPLATES', 'function pickRaceModelingText')
  + grab('function shortenTempo', 'function pickTemplateText')
  + grab('function pickTemplateText', 'async function getEquipment')
  + grab('const EQUIPMENT_OPTIONS', '\n')
  + '\nglobalThis.WORKOUT_TEMPLATES=WORKOUT_TEMPLATES;'
  + 'globalThis.shortenTempo=shortenTempo;'
  + 'globalThis.pickTemplateText=pickTemplateText;'
  + 'globalThis.EQUIPMENT_OPTIONS=EQUIPMENT_OPTIONS;', ctx);

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : ''));
};

const TYPES = Object.keys(ctx.WORKOUT_TEMPLATES);
const ALL = TYPES.flatMap((t) => ctx.WORKOUT_TEMPLATES[t].map((o) => ({ type: t, ...o })));

// ---------- there is enough of a pool to be a pool ----------
// Four options means a fortnight of Mondays repeats. The point of the pool is
// that a month does not read like the same week four times.
TYPES.forEach((t) => {
  check(`"${t}" offers enough sessions to vary a month`,
    ctx.WORKOUT_TEMPLATES[t].length >= 8, `${ctx.WORKOUT_TEMPLATES[t].length}`);
});
check('every template has text to show', ALL.every((o) => o.text && o.text.trim()),
  JSON.stringify(ALL.filter((o) => !o.text)));
TYPES.forEach((t) => {
  const texts = ctx.WORKOUT_TEMPLATES[t].map((o) => o.text);
  const dupes = texts.filter((x, i) => texts.indexOf(x) !== i);
  check(`"${t}" has no duplicate sessions`, dupes.length === 0, dupes.join(' | '));
});

// ---------- kit the athlete may not own ----------
// An equipment-locked template with no fallback is simply not offered to an
// athlete without the kit, which is fine. One WITH a fallback has to swap to
// something they can actually do -- and the fallback must not itself name the
// equipment, or the substitution reads as a joke.
const locked = ALL.filter((o) => o.requires);
check('every locked template names equipment the settings actually offer',
  locked.every((o) => ctx.EQUIPMENT_OPTIONS.includes(o.requires)),
  locked.filter((o) => !ctx.EQUIPMENT_OPTIONS.includes(o.requires)).map((o) => o.requires).join(', '));
locked.filter((o) => o.fallback).forEach((o) => {
  check(`the fallback for "${o.text}" does not need the kit it replaces`,
    !new RegExp(o.requires, 'i').test(o.fallback), o.fallback);
});

// Every piece of equipment in the settings should be worth ticking. Blocks sat
// in that list for weeks with nothing in the pool asking for them, so an
// athlete who owned blocks got exactly the same plan as one who did not.
ctx.EQUIPMENT_OPTIONS.forEach((kit) => {
  check(`owning "${kit}" changes what gets prescribed`,
    ALL.some((o) => o.requires === kit),
    `nothing in the pool requires ${kit}`);
});

// And the plan has to be complete without any of it.
const phase = { modifier: null, label: '', seasonPhase: 'off' };
TYPES.forEach((t) => {
  const bare = new Set();
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(ctx.pickTemplateText(t, bare, phase));
  check(`"${t}" always returns a session with no equipment at all`,
    [...seen].every((s) => s && s.trim()), JSON.stringify([...seen].filter((s) => !s)));
  check(`and never prescribes kit the athlete does not have`,
    ![...seen].some((s) => /\bfrom blocks\b|\bsled\b|\bhill\b/i.test(s) && !/\(no /.test(s)),
    [...seen].filter((s) => /\bfrom blocks\b|\bsled\b|\bhill\b/i.test(s) && !/\(no /.test(s)).join(' | '));
});

// ---------- the Friday shortener has to cope with all of them ----------
// The mobility/tempo day reuses a tempo session with the volume trimmed. The
// trimmer reads three shapes -- NxMxD, NxD, and a comma ladder -- and a
// template that matches the wrong one comes out mangled rather than shorter.
// "5x200, 5x100" was the case: it matches the NxD shape, so only the first
// half was ever cut.
ctx.WORKOUT_TEMPLATES['Tempo (extensive/aerobic)'].forEach(({ text }) => {
  const short = ctx.shortenTempo(text);
  check(`shortening "${text}" gives something back`, !!short && short.trim(), String(short));
  check(`and does not leave "${text}" with an unbalanced bracket`,
    (short.match(/\(/g) || []).length === (short.match(/\)/g) || []).length, short);
  // A reps-and-distance session must come back lighter, not merely different.
  const reps = text.match(/^(\d+)x(\d+)$/);
  if (reps) {
    const after = short.match(/^(\d+)x(\d+)$/);
    check(`and actually cuts "${text}"`,
      after && +after[1] < +reps[1] && after[2] === reps[2], short);
  }
  // The shapes must not overlap.
  //
  // The trimmer tries NxMxD, then NxD, then the comma ladder, and stops at
  // the first match. A session that is BOTH -- reps-and-distance with a
  // top-level comma, like "5x200, 5x100" -- matches NxD, so only the first
  // half is ever cut and the second half comes through at full volume. It
  // comes back shorter-looking and is not, which is worse than not trimming.
  //
  // Checked structurally because the outcome is not obviously wrong to look
  // at: "3x200, 5x100" reads like a real session. Commas inside brackets are
  // fine -- "2x(100,200,300)" never reaches the ladder branch.
  const topLevelComma = text.replace(/\([^)]*\)/g, '').includes(',');
  check(`"${text}" is one shape the trimmer understands, not two`,
    !(/^\d+x/.test(text) && topLevelComma),
    `shortens to "${short}"`);
});

// ---------- the phase notes ----------
// Deload and taper append a volume note. It has to land on the end of the
// session text rather than replacing it.
[['deload', 'Deload'], ['taper', 'Taper'], ['competition', 'Competition']].forEach(([modifier, label]) => {
  const text = ctx.pickTemplateText('Tempo (extensive/aerobic)', new Set(), { modifier, label });
  check(`a ${modifier} week still prescribes a session`, /\d/.test(text), text);
  check(`and says it is a ${modifier} week`, /--/.test(text), text);
});

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
