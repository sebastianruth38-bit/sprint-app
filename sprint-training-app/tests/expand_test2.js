// Splits a plan description into its individual exercises/reps so each can
// get its own weight/time input -- e.g. "Power Cleans 3x3-5, Broad Jumps 3x3"
// becomes two items. Commas inside parentheses stay grouped, e.g.
// "(2x20,2x25,2x30,1x40)" is kept as one item rather than exploding it.
function splitExercises(str) {
  if (!str) return [];
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

// Breaks one sprint item down into its individual reps, each getting its
// own stable key (tied to the item's text) and a short display label --
// e.g. "8x200" becomes 8 rows, "(2x20,2x25,2x30,1x40)" becomes 6. Falls
// back to a single row when no rep count is recognized (a single ladder
// rung like "150", or free text).
function expandSprintItem(item) {
  const trimmed = item.trim();

  // "3x3x100" -- sets x reps x distance.
  let m = /^(\d+)\s*x\s*(\d+)\s*x\s*(.+)$/i.exec(trimmed);
  if (m) {
    const sets = parseInt(m[1], 10);
    const reps = parseInt(m[2], 10);
    const rows = [];
    for (let s = 1; s <= sets; s++) {
      for (let r = 1; r <= reps; r++) rows.push({ key: `${item} :: set ${s} rep ${r}`, display: `Set ${s}, rep ${r}` });
    }
    return rows;
  }

  // "2x(10,20,30)" -- repeat an inner ladder N times.
  m = /^(\d+)\s*x\s*\((.+)\)$/i.exec(trimmed);
  if (m) {
    const rounds = parseInt(m[1], 10);
    const legs = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (let r = 1; r <= rounds; r++) {
      legs.forEach((leg) => rows.push({ key: `${item} :: round ${r} - ${leg}`, display: `Round ${r}, ${leg}` }));
    }
    return rows;
  }

  // A trailing parenthesized ladder, with or without a name prefix --
  // "(2x20,2x25,2x30,1x40)" or "Sleds (2x10,20,30)". Only treated as a
  // ladder when the parenthesized part actually looks like one (multiple
  // comma legs, or a single "NxM" leg) -- otherwise it's just a
  // descriptive suffix like "4x float sprint (40-60-90)" and falls
  // through to the simple leading-multiplier case below.
  m = /^(.*?)\(([^()]+)\)\s*$/.exec(trimmed);
  if (m) {
    const prefix = m[1].trim();
    const legs = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const looksLikeLadder = legs.length > 1 || /^\d+\s*x/i.test(legs[0] || '');
    if (looksLikeLadder) {
      const rows = [];
      legs.forEach((leg) => {
        const lm = /^(\d+)\s*x\s*(.+)$/i.exec(leg);
        if (lm) {
          const reps = parseInt(lm[1], 10);
          for (let r = 1; r <= reps; r++) rows.push({ key: `${item} :: ${leg} rep ${r}`, display: `${prefix ? prefix + ' ' : ''}${lm[2]} rep ${r}` });
        } else {
          rows.push({ key: `${item} :: ${leg}`, display: `${prefix ? prefix + ' ' : ''}${leg}` });
        }
      });
      return rows;
    }
  }

  // Simple "8x200" -- N reps of one distance.
  m = /^(\d+)\s*x\s*(.+)$/i.exec(trimmed);
  if (m) {
    const reps = parseInt(m[1], 10);
    const rows = [];
    for (let r = 1; r <= reps; r++) rows.push({ key: `${item} :: rep ${r}`, display: `Rep ${r}` });
    return rows;
  }

  return [{ key: item, display: item }];
}

// Breaks one lift item down into its individual sets -- e.g.
// "Power Cleans 3x3-5" becomes 3 rows so each set can carry its own weight.
// A range on the set count ("2-3x6") uses the low end. Falls back to a
// single row when no set count is recognized (e.g. free-typed text).
function expandLiftItem(item) {
  const m = /^(.*?)\s+(\d+)(?:-\d+)?\s*x/i.exec(item.trim());
  if (m) {
    const sets = parseInt(m[2], 10);
    const rows = [];
    for (let s = 1; s <= sets; s++) rows.push({ key: `${item} :: Set ${s}`, display: `Set ${s}` });
    return rows;
  }
  return [{ key: item, display: item }];
}

// Renders a plan description with each set/rep's logged value appended in
// parentheses where any were logged, e.g. "Power Cleans 3x3-5 (135, 145, 155)".

function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('PASS: ' + msg); } }
function expandDetails(details, fn) { return splitExercises(details).flatMap(fn); }

assert(expandDetails('2x(10,20,30)', expandSprintItem).length === 6, '2x(10,20,30) -> 6 reps');
assert(expandDetails('2x20-30m hill sprints', expandSprintItem).length === 2, '2x20-30m hill sprints -> 2 reps');
assert(expandDetails('(2x20,2x25,2x30,1x40)', expandSprintItem).length === 7, '(2x20,2x25,2x30,1x40) -> 7 reps');
assert(expandDetails('Sleds (2x10,20,30)', expandSprintItem).length === 4, 'Sleds (2x10,20,30) -> 4 reps');
assert(expandDetails('4x30m fly', expandSprintItem).length === 4, '4x30m fly -> 4 reps');
assert(expandDetails('4x float sprint (40-60-90)', expandSprintItem).length === 4, '4x float sprint (40-60-90) -> 4 reps, got ' + expandDetails('4x float sprint (40-60-90)', expandSprintItem).length);
assert(expandDetails('2x40m fly, 2x30m fly', expandSprintItem).length === 4, '2x40m fly, 2x30m fly -> 4 reps');
assert(expandDetails('8x200', expandSprintItem).length === 8, '8x200 -> 8 reps');
assert(expandDetails('3x3x100', expandSprintItem).length === 9, '3x3x100 -> 9 reps');
assert(expandDetails('150,200,250,300,250,200,150', expandSprintItem).length === 7, 'ladder -> 7 rows');
assert(expandDetails('200,300,200', expandSprintItem).length === 3, '200,300,200 -> 3 rows');
assert(expandDetails('3x300', expandSprintItem).length === 3, '3x300 -> 3 reps');
assert(expandDetails('5x150', expandSprintItem).length === 5, '5x150 -> 5 reps');
assert(expandDetails('3x250', expandSprintItem).length === 3, '3x250 -> 3 reps');
assert(expandDetails('5x120', expandSprintItem).length === 5, '5x120 -> 5 reps');
assert(expandDetails('4x250', expandSprintItem).length === 4, '4x250 -> 4 reps');
assert(expandDetails('1x110, 1x120, 1x150, 1x180, 1x220', expandSprintItem).length === 5, 'race modeling pool 1 -> 5 rows, got ' + expandDetails('1x110, 1x120, 1x150, 1x180, 1x220', expandSprintItem).length);
assert(expandDetails('2x150, 1x180', expandSprintItem).length === 3, 'race modeling pool 2 -> 3 rows');
assert(expandDetails('Broken 450s (150,150,150)', expandSprintItem).length === 3, 'Broken 450s ladder -> 3 rows, got ' + expandDetails('Broken 450s (150,150,150)', expandSprintItem).length);
assert(expandDetails('5x80', expandSprintItem).length === 5, '5x80 -> 5 reps');
assert(expandDetails('300,200,300', expandSprintItem).length === 3, '300,200,300 -> 3 rows');
assert(expandDetails('2x350', expandSprintItem).length === 2, '2x350 -> 2 reps');

const accelLift = 'Power Cleans 3x3-5, Broad Jumps 3x3, Bulgarian Split Squats 3x6-8, Core 3x';
assert(expandDetails(accelLift, expandLiftItem).length === 12, 'full accel off-season lift string -> 12 set-rows');
const maxvLiftInSeason = 'Hang Power Cleans 3x3-5, Hurdle Hops 2-3x5, Quarter Squats 2-3x6, Med Ball Throws 2x5, Core 2x';
assert(expandDetails(maxvLiftInSeason, expandLiftItem).length === 11, 'in-season maxv lift string -> 11 set-rows');
assert(expandDetails('Flat Bench 3x8, Back Row 3x8, Pull-Ups 3x, Tricep Pushdowns 3x12, Lateral Raises 3x12', expandLiftItem).length === 15, 'tempo1 lift string -> 15 set-rows');
assert(expandDetails('Incline Bench 3x8, Barbell Back Row 3x8, Shoulder Press 3x8, Tricep Overhead Extensions 3x12', expandLiftItem).length === 12, 'tempo2 lift string -> 12 set-rows');
assert(expandDetails('Core 2x, Med Ball Throws 2x5, Hang Cleans 2x3 @ ~half normal load, Quarter Squats 2x5 @ ~half normal load', expandLiftItem).length === 8, 'competitionLight lift string -> 8 set-rows, got ' + expandDetails('Core 2x, Med Ball Throws 2x5, Hang Cleans 2x3 @ ~half normal load, Quarter Squats 2x5 @ ~half normal load', expandLiftItem).length);
