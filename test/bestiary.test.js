const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const bestiary=require("../bestiary-data.js");
const importer=require("../scripts/bestiary-import-lib.cjs");

const loaded=bestiary.loadBestiary(path.resolve(__dirname,".."));

test("пилотный бестиарий загружается и содержит уникальные полноценные карточки",()=>{
  assert.equal(loaded.monsters.length,10);
  assert.equal(new Set(loaded.monsters.map(monster=>monster.key)).size,loaded.monsters.length);
  for(const monster of loaded.monsters){
    assert.ok(monster.name);
    assert.ok(monster.portrait);
    assert.ok(monster.token);
    assert.ok(monster.ac.value>0);
    assert.ok(monster.hp.average>0);
    assert.ok(monster.hp.formula);
    assert.equal(Object.keys(monster.abilities).length,6);
    assert.ok(monster.actions.length>0);
    for(const action of monster.actions.filter(action=>action.kind==="attack")){
      assert.match(action.attackFormula,/^1d20[+-]\d+$/);
      assert.match(action.damageFormula,/\d+d\d+/);
    }
  }
});

test("лёгкий каталог не отдаёт жирный статблок",()=>{
  const goblin=loaded.byKey.get("goblin");
  const catalog=bestiary.catalogEntry(goblin);
  assert.equal(catalog.key,"goblin");
  assert.equal(catalog.hp,7);
  assert.equal(catalog.ac,15);
  assert.equal("actions" in catalog,false);
  assert.equal("description" in catalog,false);
  assert.equal("traits" in catalog,false);
});

test("монстр превращается в редактируемый NPC-токен",()=>{
  const monster=loaded.byKey.get("young-red-dragon");
  const token=bestiary.tokenFromMonster(monster,{id:()=>"dragon-token",x:3,y:4,count:1,disposition:"neutral"});
  assert.equal(token.id,"dragon-token");
  assert.equal(token.bestiaryKey,"young-red-dragon");
  assert.equal(token.hp,178);
  assert.equal(token.hpMax,178);
  assert.equal(token.ac,18);
  assert.equal(token.size,2);
  assert.equal(token.disposition,"neutral");
  assert.equal(token.badge,"");
  assert.equal(token.npcSheet.profile.cr,"10");
  assert.ok(token.npcSheet.features.some(entry=>entry.name==="Мультиатака"));
  assert.ok(token.npcSheet.attacks.every(entry=>"text" in entry));
  assert.ok(token.npcSheet.attacks.length>=2);
  assert.ok(token.npcSheet.attacks.some(action=>/Укус/i.test(action.name)));
});

test("черновой импортёр извлекает основу карточки и первое изображение",()=>{
  const html=`<!doctype html><html><head><meta property="og:image" content="https://dnd.su/gallery/bestiary/test_s.jpg"></head><body>
  <h2>Гоблин [Goblin]</h2><p>Маленький гуманоид (гоблиноид), нейтрально-злой</p>
  <p>Класс Доспеха 15 (кожаный доспех, щит)</p><p>Хиты 7 (2к6)</p><p>Скорость 30 футов</p>
  <table><tr><th>СИЛ</th><th>ЛОВ</th><th>ТЕЛ</th><th>ИНТ</th><th>МДР</th><th>ХАР</th></tr><tr><td>8 (-1)</td><td>14 (+2)</td><td>10 (+0)</td><td>10 (+0)</td><td>8 (-1)</td><td>8 (-1)</td></tr></table>
  <p>Бонус мастерства +2</p><p>Опасность 1/4 (50 опыта)</p><h3>Действия</h3>
  <p>Скимитар. Рукопашная атака оружием: +4 к попаданию. Попадание: 5 (1к6 + 2) рубящего урона.</p>
  </body></html>`;
  const monster=importer.parseDndSuMonster(html,{url:"https://dnd.su/bestiary/4-goblin/"});
  assert.equal(monster.name,"Гоблин");
  assert.equal(monster.enName,"Goblin");
  assert.equal(monster.size,"small");
  assert.equal(monster.type,"humanoid");
  assert.equal(monster.cr,.25);
  assert.equal(monster.ac.value,15);
  assert.equal(monster.hp.formula,"2d6");
  assert.equal(monster.abilities.dex,14);
  assert.equal(monster.actions[0].attackFormula,"1d20+4");
  assert.equal(monster.actions[0].damageFormula,"1d6+2");
  assert.match(monster.portrait,/test_s\.jpg$/);
});

test("NPC из бестиария получает все шесть спасбросков и восемнадцать навыков",()=>{
  const goblin=loaded.byKey.get("goblin");
  const sheet=bestiary.npcSheetFromMonster(goblin);
  assert.equal(sheet.saves.length,6);
  assert.equal(sheet.checks.length,18);
  assert.equal(new Set(sheet.saves.map(entry=>entry.name)).size,6);
  assert.equal(new Set(sheet.checks.map(entry=>entry.name)).size,18);
  assert.equal(sheet.saves.find(entry=>entry.name==="Ловкость").formula,"1d20+2");
  assert.equal(sheet.checks.find(entry=>entry.name==="Скрытность").formula,"1d20+6");
  assert.equal(sheet.checks.find(entry=>entry.name==="Атлетика").formula,"1d20-1");
  assert.equal(sheet.checks.find(entry=>entry.name==="Восприятие").formula,"1d20-1");
});

test("детальная карточка отдаёт полный справочник бросков, а исходные данные остаются компактными",()=>{
  const goblin=loaded.byKey.get("goblin");
  assert.equal(goblin.saves.length,0);
  assert.equal(goblin.skills.length,1);
  const detail=bestiary.detailEntry(goblin);
  assert.equal(detail.saves.length,6);
  assert.equal(detail.skills.length,18);
});

test("массовый импортёр находит карточки индекса и отбрасывает homebrew",()=>{
  const html=`<div><a href="/bestiary/1-aboleth/">Аболет</a><a href="https://dnd.su/bestiary/4-goblin/">Гоблин</a><a href="/homebrew/bestiary/99-test/">Хоумбрю</a><a href="/multiverse/bestiary/4-goblin/">2024</a></div>`;
  assert.deepEqual(importer.extractBestiaryIndexLinks(html,"https://dnd.su"),[
    "https://dnd.su/bestiary/1-aboleth/",
    "https://dnd.su/bestiary/4-goblin/"
  ]);
});

test("сложный статблок раскладывается на магию, реакции, легендарные и логовные действия",()=>{
  const html=`<!doctype html><html><head><meta property="og:image" content="/gallery/bestiary/archmage.jpg"></head><body>
  <h1>Тестовый архимаг [Test Archmage]</h1>
  <p>Средний гуманоид (человек), законно-злой</p>
  <p>Класс Доспеха 17 (магическая защита)</p><p>Хиты 99 (18к8 + 18)</p><p>Скорость 30 футов, полёт 60 футов</p>
  <p>СИЛ ЛОВ ТЕЛ ИНТ МДР ХАР</p><p>10 (+0) 14 (+2) 12 (+1) 20 (+5) 16 (+3) 18 (+4)</p>
  <p>Спасброски Инт +9, Мдр +7</p><p>Навыки Магия +13, Восприятие +7</p><p>Чувства тёмное зрение 120 футов, пассивное Восприятие 17</p><p>Языки Общий, Драконий</p><p>Опасность 12 (8400 опыта)</p><p>Бонус мастерства +4</p>
  <h2>Особенности</h2><p>Использование заклинаний. Заговоры (неограниченно): огненный снаряд, волшебная рука. 1-й уровень (4 ячейки): щит, магическая стрела.</p>
  <h2>Действия</h2><p>Посох. Рукопашная атака оружием: +6 к попаданию. Попадание: 6 (1к8 + 2) дробящего урона.</p>
  <h2>Бонусные действия</h2><p>Теневой шаг. Архимаг телепортируется на 30 футов.</p>
  <h2>Реакции</h2><p>Магический отпор. Архимаг получает +3 к КД против одной атаки.</p>
  <h2>Легендарные действия</h2><p>Заговор. Архимаг накладывает один заговор.</p>
  <h2>Мифические действия</h2><p>Вторая фаза. Архимаг восстанавливает 20 хитов.</p>
  <h2>Действия логова</h2><p>Вспышка. Каждое существо совершает спасбросок Ловкости Сл 17.</p>
  <h2>Региональные эффекты</h2><p>Искажённая земля. В радиусе мили мерцают тени.</p>
  <h2>Описание</h2><p>Очень длинное и полезное описание.</p></body></html>`;
  const monster=importer.parseDndSuMonster(html,{url:"https://dnd.su/bestiary/999-test-archmage/"});
  assert.equal(monster.size,"medium");
  assert.equal(monster.type,"humanoid");
  assert.equal(monster.speed.fly,60);
  assert.equal(monster.saves.length,2);
  assert.equal(monster.skills.length,2);
  assert.equal(monster.actions[0].attackFormula,"1d20+6");
  assert.equal(monster.bonusActions.length,1);
  assert.equal(monster.reactions.length,1);
  assert.equal(monster.legendaryActions.length,1);
  assert.equal(monster.mythicActions.length,1);
  assert.equal(monster.lairActions.length,1);
  assert.equal(monster.regionalEffects.length,1);
  assert.ok(monster.spells.some(entry=>entry.name.toLowerCase().includes("огненный снаряд")));
  assert.ok(monster.spells.some(entry=>entry.name.toLowerCase().includes("щит")));
  assert.match(monster.description,/полезное описание/);
});

test("расширенный NPC-лист сохраняет атаки всех типов и длинную магию",()=>{
  const base=loaded.byKey.get("goblin");
  const monster=bestiary.normalizeMonster({...base,
    bonusActions:[{name:"Быстрый укус",kind:"attack",attackFormula:"1d20+4",damageFormula:"1d4+2",damageType:"колющий",text:"Бонусная атака."}],
    mythicActions:[{name:"Мифический рывок",kind:"text",text:"Сдвигается без провокации."}],
    lairActions:[{name:"Обвал",kind:"formula",formula:"2d6",text:"Камни падают с потолка."}],
    regionalEffects:[{name:"Тревожный лес",kind:"text",text:"Следы исчезают."}],
    spells:[{name:"Щит",kind:"text",level:1,text:"Реакция, повышающая КД."}]
  });
  const sheet=bestiary.npcSheetFromMonster(monster);
  assert.ok(sheet.attacks.some(entry=>entry.name==="Быстрый укус"&&entry.category==="Бонусное действие"));
  assert.ok(sheet.features.some(entry=>entry.category==="Мифическое действие"));
  assert.ok(sheet.features.some(entry=>entry.category==="Региональный эффект"));
  assert.ok(sheet.formulas.some(entry=>entry.name==="Обвал"));
  assert.ok(sheet.spells.some(entry=>entry.name==="Щит"));
});
