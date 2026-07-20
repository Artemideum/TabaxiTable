const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = {};
require(path.join(process.cwd(), "public", "rules-5e.js"));
const rules = global.window.TT_RULES;
const spells = require(path.join(process.cwd(), "public", "spells-5e.json"));

test("быстрая сборка учитывает приоритет класса и бонусы расы", () => {
  const tabaxiRogue = rules.abilityBuild("rogue", "tabaxi");
  assert.deepEqual(tabaxiRogue.base, { dex:15, con:14, cha:13, wis:12, int:10, str:8 });
  assert.equal(tabaxiRogue.total.dex, 17);
  assert.equal(tabaxiRogue.total.cha, 14);

  const halfElfPaladin = rules.abilityBuild("paladin", "halfelf");
  assert.equal(halfElfPaladin.total.cha, 16);
  assert.equal(halfElfPaladin.total.str, 16);
  assert.equal(halfElfPaladin.total.con, 14);

  const veteranFighter = rules.abilityBuild("fighter", "human", 8);
  assert.equal(veteranFighter.total.str, 20);
  assert.equal(veteranFighter.total.con, 17);
  assert.deepEqual(veteranFighter.levelBonuses, { str:4, dex:0, con:2, int:0, wis:0, cha:0 });
});

test("каталоги создания персонажа покрывают все классы", () => {
  Object.keys(rules.classes).forEach(classKey => {
    assert.ok(rules.subclasses[classKey]?.length, `Нет подклассов: ${classKey}`);
    assert.ok(rules.statPriorities[classKey]?.length === 6, `Нет приоритета: ${classKey}`);
    assert.ok(rules.startingKits[classKey]?.length, `Нет стартового набора: ${classKey}`);
    assert.ok(rules.classSkills[classKey]?.count > 0, `Нет навыков: ${classKey}`);
  });
  assert.equal(rules.subclassLevel("wizard"), 2);
  assert.equal(rules.subclassLevel("rogue"), 3);
  assert.ok(Object.keys(rules.backgrounds).length >= 12);
});

test("мультикласс проверяет требования и правильно объединяет магию", () => {
  assert.equal(rules.meetsRequirement("paladin", { str:13, cha:13 }), true);
  assert.equal(rules.meetsRequirement("paladin", { str:13, cha:12 }), false);
  assert.equal(rules.meetsRequirement("fighter", { str:8, dex:13 }), true);
  assert.match(rules.requirementText("ranger"), /Ловкость 13.*Мудрость 13/);

  const magic = rules.multiclassSpellcasting([
    { key:"wizard", level:5 },
    { key:"paladin", level:4 },
    { key:"warlock", level:3 }
  ]);
  assert.equal(magic.casterLevel, 7);
  assert.deepEqual(magic.slots, [4,3,3,1]);
  assert.deepEqual(magic.pact, { level:2, total:2 });
});

test("уровни ASI и пулы костей хитов учитывают особенности классов", () => {
  assert.equal(rules.isAsiLevel("fighter", 6), true);
  assert.equal(rules.isAsiLevel("rogue", 10), true);
  assert.equal(rules.isAsiLevel("wizard", 6), false);
  assert.deepEqual(rules.hitDicePoolsFor([
    { key:"fighter", level:3, hitDie:10 },
    { key:"wizard", level:2, hitDie:6 }
  ], []), [
    { sides:10, total:3, current:3 },
    { sides:6, total:2, current:2 }
  ]);
  assert.ok(Object.keys(rules.feats).length >= 15);
});

test("быстрая сборка ссылается только на существующие предметы и заклинания", () => {
  const itemKeys = new Set([...rules.weapons, ...rules.armor, ...rules.gear].map(item => item.key));
  const spellKeys = new Set(spells.map(spell => spell.key));

  Object.entries(rules.startingKits).forEach(([classKey, keys]) => {
    keys.forEach(key => assert.ok(itemKeys.has(key), `Нет предмета ${key} для ${classKey}`));
  });
  Object.entries(rules.recommendedSpells).forEach(([classKey, keys]) => {
    keys.forEach(key => assert.ok(spellKeys.has(key), `Нет заклинания ${key} для ${classKey}`));
  });
});
