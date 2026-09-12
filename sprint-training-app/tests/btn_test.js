const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const APP_DIR=process.env.APP_DIR || require('path').join(__dirname, 'fixtures/app');
const OUT=process.env.OUT_DIR || require('path').join(__dirname, 'out');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
function serve(){return new Promise(r=>{const s=http.createServer((rq,rs)=>{const fp=path.join(APP_DIR,rq.url==='/'?'/index.html':rq.url);fs.readFile(fp,(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});rs.end(d);});});s.listen(0,()=>r(s));});}
let pass=0,fail=0;
const assert=(c,m)=>{if(c){console.log('PASS: '+m);pass++;}else{console.error('FAIL: '+m);fail++;}};

(async()=>{
  const server=await serve(),port=server.address().port;
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  const page=await ctx.newPage();
  page.on('pageerror',e=>console.error('PAGE ERROR:',e.message));

  let workouts = [];
  const dialogs = [];
  let dialogAction = 'accept';
  page.on('dialog', async (d) => { dialogs.push(d.message()); await (dialogAction==='accept'? d.accept() : d.dismiss()); });
  const EX=[{id:'e1',name:'Power Clean',url:'https://www.youtube.com/watch?v=ORGBFvyUwGs',is_custom:false},
            {id:'e2',name:'My Own Lift',url:null,is_custom:true}];

  await page.route('**/*supabase.co/**',async route=>{
    const u=route.request().url(),m=route.request().method();
    const json=b=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
    if(u.includes('/rest/v1/exercises')) return json(EX);
    if(u.includes('/rest/v1/workouts')&&m==='GET') return json(workouts);
    if(u.includes('/rest/v1/workouts')&&m==='POST'){
      workouts=JSON.parse(route.request().postData()).map((r,i)=>({...r,id:'w'+i}));
      return json([]);
    }
    if(u.includes('/rest/v1/athlete_settings')) return json({primary_events:['100m'],equipment:[],next_meet_date:null,next_meet_events:[]});
    if(u.includes('/rest/v1/competition_seasons')) return json({outdoor_start:'2027-04-01',outdoor_end:'2027-06-30'});
    return json([]);
  });

  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(()=>typeof window.handleSession==='function');
  await page.evaluate(()=>window.handleSession({user:{id:'u'}}));
  await page.click('[data-tab="workouts"]');
  await page.waitForSelector('.day-card');

  // --- Empty week: primary call-to-action ---
  let st = await page.$eval('#generateWeekPlan',b=>({text:b.textContent.trim(),cls:b.className,disabled:b.disabled}));
  let note = await page.$eval('#regenNote',n=>n.textContent.trim());
  assert(st.text==="Generate This Week's Plan",'empty week: button reads as a normal generate action, got "'+st.text+'"');
  assert(st.cls.includes('primary')&&!st.cls.includes('regen'),'empty week: styled as the primary action, got '+st.cls);
  assert(note==='','empty week: no warning note shown');

  await page.screenshot({path:`${OUT}/btn_empty.png`,clip:{x:0,y:150,width:390,height:260}});

  // --- Generate, then check it de-emphasises ---
  dialogAction='accept';
  await page.click('#generateWeekPlan');
  await page.waitForTimeout(700);
  await page.mouse.move(0,0);   // don't measure the :hover style
  await page.waitForTimeout(500);  // let the background transition settle

  st = await page.$eval('#generateWeekPlan',b=>({text:b.textContent.trim(),cls:b.className,disabled:b.disabled}));
  note = await page.$eval('#regenNote',n=>n.textContent.trim());
  assert(st.text==='Regenerate week','after generating: label changes, got "'+st.text+'"');
  assert(st.cls.includes('regen')&&!st.cls.includes('primary'),'after generating: greyed/dashed, no longer primary, got '+st.cls);
  assert(st.disabled===false,'still clickable -- de-emphasised, not disabled');
  assert(note==='Erases this week and builds a new one.','warning note appears: "'+note+'"');

  const styles = await page.$eval('#generateWeekPlan',b=>{const c=getComputedStyle(b);return {bg:c.backgroundColor,border:c.borderStyle,color:c.color};});
  assert(styles.border==='dashed','regen button uses a dashed border: '+styles.border);
  const alpha = parseFloat((styles.bg.match(/rgba?\([^)]*?([\d.]+)\)$/)||[,'1'])[1]);
  assert(styles.bg==='rgba(0, 0, 0, 0)'||alpha<0.05,'regen button background is transparent, not solid white: '+styles.bg);

  await page.screenshot({path:`${OUT}/btn_regen.png`,clip:{x:0,y:150,width:390,height:260}});

  // --- Regenerating still requires the confirm ---
  dialogAction='dismiss';
  dialogs.length=0;
  await page.click('#generateWeekPlan');
  await page.waitForTimeout(400);
  assert(dialogs.length===1&&/DELETE/i.test(dialogs[0]),'regenerating still raises the destructive confirm: '+JSON.stringify(dialogs));
  const afterCancel = await page.$eval('#generateWeekPlan',b=>b.textContent.trim());
  assert(afterCancel==='Regenerate week','cancelling the confirm leaves the week untouched');

  // --- Reference page: seeded entries are not removable, custom ones are ---
  await page.click('[data-tab="weights"]');
  await page.waitForSelector('#weightsList .ex-row');
  const rows=await page.$$eval('#weightsList .ex-row',rs=>rs.map(r=>({
    name:r.querySelector('.ex-name').textContent.trim(),
    canRemove:!!r.querySelector('.delete-btn'),
    canEditLink:!!r.querySelector('.ex-link-btn'),
  })));
  const seeded=rows.find(r=>r.name.includes('Power Clean'));
  const custom=rows.find(r=>r.name.includes('My Own Lift'));
  assert(seeded&&!seeded.canRemove,'seeded reference entry has no Remove button');
  assert(seeded&&seeded.canEditLink,'seeded entry can still have its link swapped');
  assert(custom&&custom.canRemove,'an exercise you added yourself is still removable');

  await browser.close();server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
