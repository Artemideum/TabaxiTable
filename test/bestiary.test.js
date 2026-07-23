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
