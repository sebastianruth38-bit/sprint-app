const BODYWEIGHT_LIFT_KEYWORDS = ['core', 'broad jump', 'hurdle hop', 'pull-up', 'pull up'];
function isBodyweightExercise(item) {
  const name = item.toLowerCase();
  return BODYWEIGHT_LIFT_KEYWORDS.some((kw) => name.includes(kw));
}

function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('PASS: ' + msg); } }

const weighted = ['Power Cleans 3x3-5', 'Bulgarian Split Squats 3x6-8', 'Med Ball Throws 2x5', 'Hang Snatches 3x3-5',
  'Hang Power Cleans 3x3-5', 'Hang Cleans 2x3 @ ~half normal load', 'Quarter Squats 2-3x6', 'Step Ups & Squats 3x6-8',
  'Flat Bench 3x8', 'Back Row 3x8', 'Tricep Pushdowns 3x12', 'Lateral Raises 3x12', 'Incline Bench 3x8',
  'Barbell Back Row 3x8', 'Shoulder Press 3x8', 'Tricep Overhead Extensions 3x12'];
const bodyweight = ['Core 2x', 'Core 3x', 'Broad Jumps 3x3', 'Hurdle Hops 2-3x5', 'Hurdle Hops 3x5', 'Pull-Ups 3x'];

weighted.forEach((n) => assert(!isBodyweightExercise(n), `"${n}" correctly keeps a weight input`));
bodyweight.forEach((n) => assert(isBodyweightExercise(n), `"${n}" correctly flagged as bodyweight (no weight input)`));
