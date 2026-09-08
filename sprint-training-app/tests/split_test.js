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

function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('PASS: ' + msg); } }

assert(JSON.stringify(splitExercises('Power Cleans 3x3-5, Broad Jumps 3x3, Bulgarian Split Squats 2-3x6, Med Ball Throws 2x5, Core 2x')) === JSON.stringify(['Power Cleans 3x3-5','Broad Jumps 3x3','Bulgarian Split Squats 2-3x6','Med Ball Throws 2x5','Core 2x']), 'lift_details splits cleanly into 5 items');

assert(JSON.stringify(splitExercises('(2x20,2x25,2x30,1x40)')) === JSON.stringify(['(2x20,2x25,2x30,1x40)']), 'parenthesized sprint group stays as ONE item');

assert(JSON.stringify(splitExercises('150,200,250,300,250,200,150')) === JSON.stringify(['150','200','250','300','250','200','150']), 'ladder format splits into 7 individual reps');

assert(JSON.stringify(splitExercises('2x40m fly, 2x30m fly')) === JSON.stringify(['2x40m fly','2x30m fly']), 'two distinct sprint exercises split into 2');

assert(JSON.stringify(splitExercises('8x200')) === JSON.stringify(['8x200']), 'single rep-scheme stays as one item');

assert(JSON.stringify(splitExercises('')) === '[]', 'empty string returns empty array');
assert(JSON.stringify(splitExercises(null)) === '[]', 'null returns empty array');
