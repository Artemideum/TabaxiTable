const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");

const root=path.resolve(__dirname,"..");

function monsterPage({ru,en,slug,image,ac=13,hp=9,formula="2к8",cr="1/2",attack="+4",damage="1к6 + 2"}){
  return `<!doctype html><html><head><meta property="og:image" content="${image}"></head><body>
  <h1>${ru} [${en}] <span class="source-plaque" title="Monster Manual">MM14</span></h1><p>Средний гуманоид, нейтральный</p>
  <p>Класс Доспеха ${ac}</p><p>Хиты ${hp} (${formula})</p><p>Скорость 30 футов</p>
  <p>СИЛ ЛОВ ТЕЛ ИНТ МДР ХАР</p><p>10 (+0) 14 (+2) 12 (+1) 10 (+0) 11 (+0) 8 (-1)</p>
  <p>Навыки Восприятие +2, Скрытность +4</p><p>Спасброски Лов +4</p>
  <p>Чувства тёмное зрение 60 футов, пассивное Восприятие 12</p><p>Языки Общий</p>
  <p>Опасность ${cr} (100 опыта)</p><p>Бонус мастерства +2</p>
  <h2>Особенности</h2><p>Тестовая особенность. Существо действует предсказуемо.</p>
  <h2>Действия</h2><p>Клинок. Рукопашная атака оружием: ${attack} к попаданию. Попадание: 5 (${damage}) рубящего урона.</p>
  <h2>Описание</h2><p>Проверочная карточка ${slug}.</p></body></html>`;
}


function fakePng({size=3200,width=512,height=512,fill=7}={}){
  const buffer=Buffer.alloc(size,fill);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer,0);
  buffer.writeUInt32BE(13,8);
  buffer.write("IHDR",12,"ascii");
  buffer.writeUInt32BE(width,16);
  buffer.writeUInt32BE(height,20);
  return buffer;
}

function runNode(args,{cwd=root,timeout=20000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd,stdio:["ignore","pipe","pipe"]});
    let stdout="";let stderr="";
    child.stdout.on("data",chunk=>{stdout+=chunk;});
    child.stderr.on("data",chunk=>{stderr+=chunk;});
    const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error(`timeout\n${stdout}\n${stderr}`));},timeout);
    child.on("error",error=>{clearTimeout(timer);reject(error);});
    child.on("close",code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}

test("массовый импортёр проходит discovery → портреты → merge → backup",{timeout:30000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"tabaxi-mm-import-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const packageDir=path.join(temp,"monster-manual-2014");
  await fs.mkdir(packageDir,{recursive:true});
  await fs.writeFile(path.join(packageDir,"monsters.json"),JSON.stringify([{key:"pilot",name:"Пилот",portrait:"/pilot.webp",token:"/pilot.webp"}],null,2));
  await fs.writeFile(path.join(packageDir,"manifest.json"),JSON.stringify({id:"monster-manual-2014",count:1},null,2));

  const image=fakePng({size:3000,fill:7});
  let pieceHits=0;
  const filteredIndex=`
    <div class="paper card" data-cardlink="/bestiary/1-test-one/"><span class="source-plaque" title="Monster Manual">MM14</span></div>
    <div class="paper card" data-cardlink="/bestiary/2-test-two/"><span class="source-plaque" title="Monster Manual">MM14</span></div>
    <div class="paper card" data-cardlink="/bestiary/900-not-mm/"><span class="source-plaque" title="Volo's Guide to Monsters">VGM</span></div>`;
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://localhost").pathname;
    if(pathname==="/piece/bestiary/index-list/"){
      pieceHits+=1;
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(Array.from({length:2874},(_,index)=>`<a href="/bestiary/${10000+index}-other-${index}/">Весь бестиарий</a>`).join(""));
      return;
    }
    if(pathname==="/bestiary/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(filteredIndex);
      return;
    }
    if(pathname==="/bestiary/1-test-one/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Первый тест",en:"Test One",slug:"one",image:"/gallery/bestiary/test-one.jpg"}));
      return;
    }
    if(pathname==="/bestiary/2-test-two/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Второй тест",en:"Test Two",slug:"two",image:"/gallery/bestiary/test-two.jpg",ac:15,hp:18,formula:"4к8",cr:"1"}));
      return;
    }
    if(pathname.startsWith("/gallery/bestiary/")){
      res.writeHead(200,{"content-type":"image/png","content-length":image.length});
      res.end(image);return;
    }
    res.writeHead(404);res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();

  const result=await runNode([
    "scripts/import-bestiary-dndsu.mjs",
    "--discover","--source-id=103","--resume=false","--download-images","--merge",
    "--minimum=2","--maximum=10","--delay=100","--timeout=5000","--retries=1",
    `--base-url=http://127.0.0.1:${port}`,
    `--package=${packageDir}`
  ]);
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);

  const imported=JSON.parse(await fs.readFile(path.join(packageDir,"imported-monsters.json"),"utf8"));
  const merged=JSON.parse(await fs.readFile(path.join(packageDir,"monsters.json"),"utf8"));
  const manifest=JSON.parse(await fs.readFile(path.join(packageDir,"manifest.json"),"utf8"));
  const portraits=await fs.readdir(path.join(packageDir,"portraits"));
  const backups=await fs.readdir(path.join(packageDir,"backups"));

  assert.equal(imported.length,2);
  assert.equal(merged.length,3);
  assert.ok(merged.some(monster=>monster.key==="pilot"));
  assert.ok(merged.some(monster=>monster.key==="test-one"&&monster.portrait.startsWith("/bestiary-content/portraits/")));
  assert.equal(manifest.count,3);
  assert.equal(manifest.import.discovered,2);
  assert.equal(manifest.import.successful,2);
  assert.equal(portraits.length,2);
  assert.equal(backups.length,1);
  assert.equal(pieceHits,0,"при достаточном серверном source-фильтре общий piece-индекс не должен запрашиваться");
  assert.match(result.stdout,/Резервная копия прежней базы/);
});

test("Windows-лаунчер переключает консоль на UTF-8 до русского текста",async()=>{
  const bat=await fs.readFile(path.join(root,"IMPORT-MONSTER-MANUAL.bat"),"utf8");
  const chcp=bat.toLowerCase().indexOf("chcp 65001");
  const firstRussian=bat.indexOf("импорт");
  assert.ok(chcp>=0);
  assert.ok(firstRussian<0||chcp<firstRussian);
});

test("игнорирование source=103 не превращает discovery в импорт всего бестиария",{timeout:30000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"tabaxi-mm-source-filter-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const packageDir=path.join(temp,"monster-manual-2014");
  await fs.mkdir(packageDir,{recursive:true});

  const allIndex=Array.from({length:2874},(_,index)=>`<a href="/bestiary/${10000+index}-other-${index}/">Общий индекс</a>`).join("");
  const filteredPiece=`
    <div class="col list-item__beast for_filter" data-source="103"><a href="/bestiary/1-test-one/">Первый</a></div>
    <div class="col list-item__beast for_filter" data-source="111"><a href="/bestiary/900-not-mm/">Не MM</a></div>
    <div class="col list-item__beast for_filter" data-source="[103, 204]"><a href="/bestiary/2-test-two/">Второй</a></div>`;
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://localhost").pathname;
    if(pathname==="/bestiary/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(allIndex);return;
    }
    if(pathname==="/piece/bestiary/index-list/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(filteredPiece);return;
    }
    if(pathname==="/bestiary/1-test-one/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Первый тест",en:"Test One",slug:"one",image:"/gallery/bestiary/test-one.jpg"}));return;
    }
    if(pathname==="/bestiary/2-test-two/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Второй тест",en:"Test Two",slug:"two",image:"/gallery/bestiary/test-two.jpg"}));return;
    }
    res.writeHead(404);res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();

  const result=await runNode([
    "scripts/import-bestiary-dndsu.mjs",
    "--discover","--source-id=103","--resume=false",
    "--minimum=2","--maximum=10","--delay=100","--timeout=5000","--retries=1",
    `--base-url=http://127.0.0.1:${port}`,
    `--package=${packageDir}`
  ]);
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);
  const urls=JSON.parse(await fs.readFile(path.join(packageDir,"mm14-urls.json"),"utf8"));
  const imported=JSON.parse(await fs.readFile(path.join(packageDir,"imported-monsters.json"),"utf8"));
  assert.deepEqual(urls,[
    `http://127.0.0.1:${port}/bestiary/1-test-one/`,
    `http://127.0.0.1:${port}/bestiary/2-test-two/`
  ]);
  assert.equal(imported.length,2);
  assert.doesNotMatch(result.stdout,/2874 карточ/);
});

test("пустой JS-shell DnD.su использует резервные source=103 страницы без явных меток",{timeout:30000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"tabaxi-mm-mirror-fallback-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const packageDir=path.join(temp,"monster-manual-2014");
  await fs.mkdir(packageDir,{recursive:true});

  const allIndex=Array.from({length:2874},(_,index)=>`<a href="/bestiary/${10000+index}-other-${index}/">Общий индекс</a>`).join("");
  const mirrorPage=`
    <div class="paper card" data-cardlink="/bestiary/1-test-one/"><span>Первый</span></div>
    <div class="paper card" data-cardlink="/bestiary/2-test-two/"><span>Второй</span></div>`;
  const server=http.createServer((req,res)=>{
    const parsed=new URL(req.url,"http://localhost");
    const pathname=parsed.pathname;
    if(pathname==="/bestiary/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end("<html><body><section id='piece1'>Загрузка...</section></body></html>");return;
    }
    if(pathname==="/piece/bestiary/index-list/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(allIndex);return;
    }
    if(pathname==="/mirror/page-1"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(mirrorPage);return;
    }
    if(pathname.startsWith("/mirror/page-")){
      res.writeHead(404);res.end("not found");return;
    }
    if(pathname==="/bestiary/1-test-one/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Первый тест",en:"Test One",slug:"one",image:"/gallery/bestiary/test-one.jpg"}));return;
    }
    if(pathname==="/bestiary/2-test-two/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Второй тест",en:"Test Two",slug:"two",image:"/gallery/bestiary/test-two.jpg"}));return;
    }
    res.writeHead(404);res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();

  const result=await runNode([
    "scripts/import-bestiary-dndsu.mjs",
    "--discover","--source-id=103","--resume=false",
    "--minimum=2","--maximum=10","--delay=100","--timeout=5000","--retries=1",
    `--base-url=http://127.0.0.1:${port}`,
    `--mirror-index-template=http://127.0.0.1:${port}/mirror/page-{page}`,
    `--package=${packageDir}`
  ]);
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);
  const urls=JSON.parse(await fs.readFile(path.join(packageDir,"mm14-urls.json"),"utf8"));
  const imported=JSON.parse(await fs.readFile(path.join(packageDir,"imported-monsters.json"),"utf8"));
  assert.deepEqual(urls,[
    `http://127.0.0.1:${port}/bestiary/1-test-one/`,
    `http://127.0.0.1:${port}/bestiary/2-test-two/`
  ]);
  assert.equal(imported.length,2);
  assert.match(result.stdout,/резервный список source=103/i);
});


test("полный резервный каталог из 224 MM14-карточек проходит стандартный предохранитель",{timeout:30000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"tabaxi-mm-224-fallback-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const packageDir=path.join(temp,"monster-manual-2014");
  await fs.mkdir(packageDir,{recursive:true});

  const allIndex=Array.from({length:2874},(_,index)=>`<a href="/bestiary/${10000+index}-other-${index}/">Общий индекс</a>`).join("");
  const mirrorPage=Array.from({length:224},(_,index)=>
    `<div class="paper card" data-cardlink="/bestiary/${index+1}-mm-monster-${index+1}/"><span>MM ${index+1}</span></div>`
  ).join("");
  const server=http.createServer((req,res)=>{
    const parsed=new URL(req.url,"http://localhost");
    const pathname=parsed.pathname;
    if(pathname==="/bestiary/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end("<html><body><section id='piece1'>Загрузка...</section></body></html>");return;
    }
    if(pathname==="/piece/bestiary/index-list/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(allIndex);return;
    }
    if(pathname==="/mirror/page-1"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(mirrorPage);return;
    }
    if(pathname.startsWith("/mirror/page-")){
      res.writeHead(404);res.end("not found");return;
    }
    if(pathname==="/bestiary/1-mm-monster-1/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Первый MM монстр",en:"First MM Monster",slug:"mm-one",image:"/gallery/bestiary/mm-one.jpg"}));return;
    }
    res.writeHead(404);res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();

  const result=await runNode([
    "scripts/import-bestiary-dndsu.mjs",
    "--discover","--source-id=103","--resume=false","--limit=1",
    "--maximum=300","--mirror-pages=4","--delay=100","--timeout=5000","--retries=1",
    `--base-url=http://127.0.0.1:${port}`,
    `--mirror-index-template=http://127.0.0.1:${port}/mirror/page-{page}`,
    `--package=${packageDir}`
  ]);
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);
  const urls=JSON.parse(await fs.readFile(path.join(packageDir,"mm14-urls.json"),"utf8"));
  const imported=JSON.parse(await fs.readFile(path.join(packageDir,"imported-monsters.json"),"utf8"));
  assert.equal(urls.length,224);
  assert.equal(new Set(urls).size,224,"резервный каталог должен сохраняться без дублей");
  assert.equal(imported.length,1,"--limit применяется после discovery и не урезает сохранённый каталог");
  assert.match(result.stdout,/Найдено карточек MM14: 224/);
  assert.doesNotMatch(result.stderr,/требуется минимум 250/);
});

test("финальный аудит локализует старые внешние портреты после merge",{timeout:30000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"tabaxi-mm-portrait-audit-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const packageDir=path.join(temp,"monster-manual-2014");
  await fs.mkdir(packageDir,{recursive:true});

  const image=fakePng({size:3200,fill:9});
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://localhost").pathname;
    if(pathname==="/bestiary/1-test-one/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru:"Первый тест",en:"Test One",slug:"one",image:"/gallery/bestiary/test-one.jpg"}));return;
    }
    if(pathname==="/gallery/bestiary/test-one.jpg"||pathname==="/gallery/bestiary/pilot.jpg"){
      res.writeHead(200,{"content-type":"image/png","content-length":image.length});
      res.end(image);return;
    }
    res.writeHead(404);res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();

  await fs.writeFile(path.join(packageDir,"monsters.json"),JSON.stringify([{
    key:"pilot",name:"Старый пилот",enName:"Old Pilot",source:"MM14",
    portrait:`http://127.0.0.1:${port}/gallery/bestiary/pilot.jpg`,
    token:`http://127.0.0.1:${port}/gallery/bestiary/pilot.jpg`,
    ac:{value:12},hp:{average:5,formula:"1d8+1"},
    abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},
    actions:[{name:"Удар",kind:"attack",attackFormula:"1d20+2"}]
  }],null,2));
  await fs.writeFile(path.join(packageDir,"manifest.json"),JSON.stringify({id:"monster-manual-2014",count:1},null,2));
  await fs.writeFile(path.join(packageDir,"urls.json"),JSON.stringify([
    `http://127.0.0.1:${port}/bestiary/1-test-one/`
  ],null,2));

  const result=await runNode([
    "scripts/import-bestiary-dndsu.mjs",
    `--urls=${path.join(packageDir,"urls.json")}` ,"--resume=false","--download-images","--merge",
    "--delay=100","--timeout=5000","--retries=1",
    `--base-url=http://127.0.0.1:${port}`,
    `--legacy-image-base=http://127.0.0.1:${port}/legacy`,
    `--package=${packageDir}`
  ]);
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);

  const merged=JSON.parse(await fs.readFile(path.join(packageDir,"monsters.json"),"utf8"));
  const report=JSON.parse(await fs.readFile(path.join(packageDir,"import-report.json"),"utf8"));
  const manifest=JSON.parse(await fs.readFile(path.join(packageDir,"manifest.json"),"utf8"));
  const reportText=await fs.readFile(path.join(packageDir,"import-report.txt"),"utf8");
  const portraits=await fs.readdir(path.join(packageDir,"portraits"));

  assert.equal(merged.length,2);
  assert.ok(merged.every(monster=>monster.portrait.startsWith("/bestiary-content/portraits/")));
  assert.equal(portraits.length,2);
  assert.equal(report.portraits.local,2);
  assert.equal(report.portraits.repaired,1,"старый внешний портрет должен догрузиться на финальном аудите");
  assert.equal(report.portraits.entries.length,0);
  assert.equal(manifest.import.localPortraitCount,2);
  assert.equal(manifest.import.portraitRepairCount,1);
  assert.match(reportText,/Локальных портретов: 2\/2/);
  assert.match(result.stdout,/восстановлен: Старый пилот/);
});


test("аудит заменяет DnD.su-заглушки доверенными MM14-токенами",{timeout:30000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"tabaxi-mm-placeholder-audit-"));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const packageDir=path.join(temp,"monster-manual-2014");
  const portraitsDir=path.join(packageDir,"portraits");
  await fs.mkdir(portraitsDir,{recursive:true});

  const placeholder=fakePng({size:3600,width:400,height:400,fill:3});
  const orcReal=fakePng({size:4200,width:512,height:512,fill:11});
  const moutherReal=fakePng({size:4300,width:512,height:512,fill:12});
  await fs.writeFile(path.join(portraitsDir,"orc-war-chief.png"),placeholder);
  await fs.writeFile(path.join(portraitsDir,"gibbering-mouther.png"),placeholder);

  const trustedRequests=[];
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://localhost").pathname;
    if(pathname.startsWith("/legacy/"))trustedRequests.push(decodeURIComponent(pathname));
    const sendPage=(ru,en,slug,real)=>{
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end(monsterPage({ru,en,slug,image:"/gallery/bestiary/not-found.png"})
        .replace("</body>",`<a data-full="${real}">Галерея</a></body>`));
    };
    if(pathname==="/bestiary/1-orc-war-chief/"){sendPage("Боевой вождь орков","Orc war chief","orc-war-chief","/gallery/bestiary/orc-real.png");return;}
    if(pathname==="/bestiary/2-gibbering-mouther/"){sendPage("Бормочущий ротовик","Gibbering mouther","gibbering-mouther","/gallery/bestiary/mouther-real.png");return;}
    if(pathname==="/gallery/bestiary/not-found.png"){
      res.writeHead(200,{"content-type":"image/png","content-length":placeholder.length});res.end(placeholder);return;
    }
    const decoded=decodeURIComponent(pathname);
    if(decoded==="/legacy/bestiary/tokens/MM/Orc War Chief.webp"){
      res.writeHead(200,{"content-type":"image/png","content-length":orcReal.length});res.end(orcReal);return;
    }
    if(decoded==="/legacy/bestiary/tokens/MM/Gibbering Mouther.webp"){
      res.writeHead(200,{"content-type":"image/png","content-length":moutherReal.length});res.end(moutherReal);return;
    }
    // Even alternative DnD.su gallery URLs remain placeholders in the real
    // failure mode. The repair must not accept them merely because their hash
    // differs from the first placeholder.
    if(pathname==="/gallery/bestiary/orc-real.png"||pathname==="/gallery/bestiary/mouther-real.png"){
      const alternatePlaceholder=fakePng({size:3700,width:400,height:400,fill:4});
      res.writeHead(200,{"content-type":"image/png","content-length":alternatePlaceholder.length});res.end(alternatePlaceholder);return;
    }
    res.writeHead(404);res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();

  const existing=[
    {
      key:"orc-war-chief",name:"Боевой вождь орков",enName:"Orc war chief",source:"MM14",
      sourceUrl:`http://127.0.0.1:${port}/bestiary/1-orc-war-chief/`,
      portrait:"/bestiary-content/portraits/orc-war-chief.png",token:"/bestiary-content/portraits/orc-war-chief.png",
      ac:{value:16},hp:{average:93,formula:"11d8+44"},abilities:{str:18,dex:12,con:18,int:11,wis:11,cha:16},actions:[{name:"Топор",kind:"attack",attackFormula:"1d20+6"}],import:{}
    },
    {
      key:"gibbering-mouther",name:"Бормочущий ротовик",enName:"Gibbering mouther",source:"MM14",
      sourceUrl:`http://127.0.0.1:${port}/bestiary/2-gibbering-mouther/`,
      portrait:"/bestiary-content/portraits/gibbering-mouther.png",token:"/bestiary-content/portraits/gibbering-mouther.png",
      ac:{value:9},hp:{average:67,formula:"9d8+27"},abilities:{str:10,dex:8,con:16,int:3,wis:10,cha:6},actions:[{name:"Укусы",kind:"attack",attackFormula:"1d20+2"}],import:{}
    }
  ];
  await fs.writeFile(path.join(packageDir,"monsters.json"),JSON.stringify(existing,null,2));
  await fs.writeFile(path.join(packageDir,"manifest.json"),JSON.stringify({id:"monster-manual-2014",count:2},null,2));
  await fs.writeFile(path.join(packageDir,"urls.json"),JSON.stringify(existing.map(item=>item.sourceUrl),null,2));

  const result=await runNode([
    "scripts/import-bestiary-dndsu.mjs",
    `--urls=${path.join(packageDir,"urls.json")}`,"--resume=false","--download-images","--merge",
    "--delay=100","--timeout=5000","--retries=1",
    `--base-url=http://127.0.0.1:${port}`,
    `--legacy-image-base=http://127.0.0.1:${port}/legacy`,
    `--package=${packageDir}`
  ]);
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);

  const merged=JSON.parse(await fs.readFile(path.join(packageDir,"monsters.json"),"utf8"));
  const report=JSON.parse(await fs.readFile(path.join(packageDir,"import-report.json"),"utf8"));
  const reportText=await fs.readFile(path.join(packageDir,"import-report.txt"),"utf8");
  const buffers=await Promise.all(merged.map(async monster=>{
    const filename=monster.portrait.split("/").at(-1);
    return fs.readFile(path.join(portraitsDir,filename));
  }));

  assert.equal(report.portraits.placeholderDetected,2);
  assert.equal(report.portraits.placeholderRepaired,2);
  assert.equal(report.portraits.local,2);
  assert.equal(report.portraits.entries.length,0);
  assert.deepEqual(buffers[0],orcReal);
  assert.deepEqual(buffers[1],moutherReal);
  assert.notDeepEqual(buffers[0],buffers[1]);
  assert.match(reportText,/Заглушек not found обнаружено: 2/);
  assert.match(reportText,/Исправлено заглушек: 2/);
  assert.match(result.stdout,/восстановлен: Боевой вождь орков/);
  assert.match(result.stdout,/восстановлен: Бормочущий ротовик/);
  assert.ok(trustedRequests.includes("/legacy/bestiary/tokens/MM/Orc War Chief.webp"));
  assert.ok(trustedRequests.includes("/legacy/bestiary/tokens/MM/Gibbering Mouther.webp"));
  assert.ok(!trustedRequests.includes("/legacy/bestiary/tokens/MM/Orc war chief.webp"));
});
