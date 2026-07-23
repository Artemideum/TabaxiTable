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
  <h1>${ru} [${en}]</h1><p>Средний гуманоид, нейтральный</p>
  <p>Класс Доспеха ${ac}</p><p>Хиты ${hp} (${formula})</p><p>Скорость 30 футов</p>
  <p>СИЛ ЛОВ ТЕЛ ИНТ МДР ХАР</p><p>10 (+0) 14 (+2) 12 (+1) 10 (+0) 11 (+0) 8 (-1)</p>
  <p>Навыки Восприятие +2, Скрытность +4</p><p>Спасброски Лов +4</p>
  <p>Чувства тёмное зрение 60 футов, пассивное Восприятие 12</p><p>Языки Общий</p>
  <p>Опасность ${cr} (100 опыта)</p><p>Бонус мастерства +2</p>
  <h2>Особенности</h2><p>Тестовая особенность. Существо действует предсказуемо.</p>
  <h2>Действия</h2><p>Клинок. Рукопашная атака оружием: ${attack} к попаданию. Попадание: 5 (${damage}) рубящего урона.</p>
  <h2>Описание</h2><p>Проверочная карточка ${slug}.</p></body></html>`;
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

  const image=Buffer.alloc(3000,7);
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,"http://localhost").pathname;
    if(pathname==="/piece/bestiary/index-list/"||pathname==="/bestiary/"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      res.end('<a href="/bestiary/1-test-one/">Первый</a><a href="/bestiary/2-test-two/">Второй</a>');
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
      res.writeHead(200,{"content-type":"image/jpeg","content-length":image.length});
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
  assert.match(result.stdout,/Резервная копия прежней базы/);
});
