const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = {};
require(path.join(process.cwd(), "public", "content-packs.js"));
require(path.join(process.cwd(), "public", "content-details-xgte-tcoe.js"));
require(path.join(process.cwd(), "public", "subclass-spells-xgte-tcoe.js"));
require(path.join(process.cwd(), "public", "rules-5e.js"));
const rules = global.window.TT_RULES;
const spells = [
  ...require(path.join(process.cwd(), "public", "spells-5e.json")),
  ...require(path.join(process.cwd(), "public", "spells-phb-support-xgte-tcoe.json")),
  ...require(path.join(process.cwd(), "public", "spells-xgte-tcoe.json"))
];

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

test("опыт использует полную шкалу уровней 5e", () => {
  assert.equal(rules.experienceThresholds.length, 20);
  assert.equal(rules.xpForLevel(2), 300);
  assert.equal(rules.xpForLevel(10), 64000);
  assert.equal(rules.levelFromXp(6499), 4);
  assert.equal(rules.levelFromXp(6500), 5);
  assert.deepEqual(rules.xpProgress(7000, 5), {
    xp:7000, currentLevel:5, start:6500, next:14000, value:500/7500, remaining:7000, xpLevel:5
  });
});

test("все 13 классов имеют подсказки на каждом уровне и заметный показатель", () => {
  assert.equal(Object.keys(rules.classes).length, 13);
  Object.keys(rules.classes).forEach(classKey => {
    for (let level = 1; level <= 20; level += 1) {
      const features = rules.featuresAt(classKey, level);
      assert.ok(features.length > 0, `Нет описания ${classKey} ${level}`);
      features.forEach(feature => {
        assert.ok(feature.name, `Нет названия ${classKey} ${level}`);
        assert.ok(feature.summary, `Нет пояснения ${classKey} ${level}: ${feature.name}`);
      });
    }
    assert.ok(rules.classHighlights(classKey, 10).length > 0, `Нет показателей ${classKey}`);
  });
  assert.match(rules.featuresAt("rogue", 5).map(feature => feature.name).join(" "), /Скрытая атака 3к6/);
  assert.match(rules.featuresAt("fighter", 20).map(feature => feature.name).join(" "), /Дополнительная атака/);
  assert.match(rules.featuresAt("wizard", 18).map(feature => feature.name).join(" "), /Мастерство заклинаний/);
});

test("компетентность предлагается плуту и барду в нужные уровни", () => {
  assert.equal(rules.expertiseChoicesAt("rogue", 1), 2);
  assert.equal(rules.expertiseChoicesAt("rogue", 6), 2);
  assert.equal(rules.expertiseChoicesAt("rogue", 5), 0);
  assert.equal(rules.expertiseChoicesAt("bard", 3), 2);
  assert.equal(rules.expertiseChoicesAt("bard", 10), 2);
  assert.equal(rules.expertiseChoicesAt("fighter", 1), 0);
});



test("Занатар и Таша подключаются как отдельные контент-паки", () => {
  assert.equal(rules.sourceInfo("xgte").short, "XGtE");
  assert.equal(rules.sourceInfo("tcoe").short, "TCoE");
  assert.equal(rules.classes.artificer.name, "Изобретатель");
  assert.equal(rules.classes.artificer.source, "tcoe");
  assert.equal(rules.subclassLevel("artificer"), 3);
  assert.equal(rules.subclassOptions("artificer").length, 4);
  assert.ok(rules.subclassOptions("barbarian").some(entry => entry.source === "xgte" && entry.name === "Путь фанатика"));
  assert.ok(rules.subclassOptions("wizard").some(entry => entry.source === "tcoe" && entry.name === "Орден писцов"));
  assert.equal(Object.values(rules.feats).filter(entry => entry.source === "xgte").length, 15);
  assert.equal(Object.values(rules.feats).filter(entry => entry.source === "tcoe").length, 15);
  assert.ok(rules.optionalClassFeatures.ranger.some(entry => entry.name === "Искусный исследователь"));
});

test("изобретатель использует собственную прогрессию ячеек и мультикласса", () => {
  assert.deepEqual(rules.slotsFor("artificer", 1), [2]);
  assert.deepEqual(rules.slotsFor("artificer", 5), [4,2]);
  assert.equal(rules.preparedLimit("artificer", 5, 3), 5);
  assert.equal(rules.meetsRequirement("artificer", { int:13 }), true);
  assert.equal(rules.meetsRequirement("artificer", { int:12 }), false);
  const magic = rules.multiclassSpellcasting([
    { key:"wizard", level:3 },
    { key:"artificer", level:1 },
    { key:"paladin", level:2 }
  ]);
  assert.equal(magic.casterLevel, 5);
  assert.deepEqual(magic.slots, [4,3,2]);
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


test("происхождение Таши и расовые черты Занатара имеют механические ограничения", () => {
  assert.equal(rules.races.customlineage.name, "Особая родословная");
  const build = rules.abilityBuild("wizard", "customlineage", 1, { flexible:[2], flexibleAbilities:["int"], bonuses:{} });
  assert.equal(build.total.int, 17);
  assert.equal(rules.featAvailable("elvenaccuracy", { raceKey:"customlineage", classes:[{key:"wizard",level:1}] }).ok, false);
  assert.equal(rules.featAvailable("elvenaccuracy", { raceKey:"highelf", classes:[{key:"wizard",level:1}] }).ok, true);
});

test("опциональные особенности, инфузии и списки подклассов доступны по уровню", () => {
  assert.ok(rules.optionalFeaturesFor("ranger", 3).some(entry => entry.name === "Искусный исследователь"));
  assert.equal(rules.infusionsFor(2).length > 0, true);
  assert.equal(rules.infusionsFor(1).length, 0);
  const alchemist = rules.subclassSpellsFor({ classes:[{ key:"artificer", subclass:"Алхимик", level:9 }] });
  assert.equal(alchemist.length, 6);
  assert.ok(alchemist.every(spell => spell.mode === "always"));
  const celestial = rules.subclassSpellKeysFor({ classes:[{ key:"warlock", subclass:"Небожитель", level:5 }] }, "warlock");
  assert.ok(celestial.includes("guiding-bolt"));
  assert.ok(celestial.includes("revivify"));
});

test("книжные каталоги заклинаний полны и не содержат повторяющихся ключей", () => {
  const supplemental = require(path.join(process.cwd(), "public", "spells-xgte-tcoe.json"));
  assert.equal(supplemental.filter(spell => spell.sourceId === "xgte").length, 95);
  assert.equal(supplemental.filter(spell => spell.sourceId === "tcoe").length, 21);
  assert.equal(new Set(supplemental.map(spell => spell.key)).size, supplemental.length);
  assert.ok(supplemental.some(spell => spell.key === "summon-aberration" && spell.summon));
});


test("все расширенные и подклассовые списки ссылаются на существующий гримуар", () => {
  const subclassCatalog = global.window.TT_SUBCLASS_SPELLS_XGTE_TCOE || {};
  const spellKeys = new Set(spells.map(spell => spell.key));
  const subclassEntries = Object.values(subclassCatalog).flatMap(classEntries => Object.values(classEntries).flat());
  subclassEntries.forEach(entry => spellKeys.add(entry.key));

  Object.entries(rules.spellClassKeys).forEach(([classKey, keys]) => {
    keys.forEach(key => assert.ok(spellKeys.has(key), `Нет заклинания ${key} в списке ${classKey}`));
  });
  Object.entries(rules.expandedSpellClassKeys).forEach(([classKey, keys]) => {
    keys.forEach(key => assert.ok(spellKeys.has(key), `Нет расширенного заклинания ${key} для ${classKey}`));
  });
  subclassEntries.forEach(entry => assert.ok(spellKeys.has(entry.key), `Нет подклассового заклинания ${entry.key}`));
  assert.equal(spellKeys.size, 336);
  assert.equal(rules.sourceInfo("phb2014").short, "PHB");
});

test("опциональные спутники учитывают подкласс и активные инфузии", () => {
  assert.ok(rules.optionalFeaturesFor("ranger", 3, "Повелитель зверей").some(entry => entry.key === "primal-companion"));
  assert.equal(rules.optionalFeaturesFor("ranger", 3, "Охотник").some(entry => entry.key === "primal-companion"), false);

  const beastMaster = rules.companionMarkersFor({
    level:5,
    stats:{ wis:16 },
    classes:[{ key:"ranger", subclass:"Повелитель зверей", level:5 }],
    optionalFeatures:["primal-companion"]
  });
  assert.ok(beastMaster.some(entry => entry.id === "primal-companion" && entry.hpMax === 30));

  const artificerBase = { level:5, stats:{ int:16 }, classes:[{ key:"artificer", level:5 }], infusionsKnown:["homunculus-servant"] };
  assert.equal(rules.companionMarkersFor({ ...artificerBase, inventoryList:[] }).some(entry => entry.id === "homunculus-servant"), false);
  assert.equal(rules.companionMarkersFor({ ...artificerBase, inventoryList:[{ infused:true, infusionKey:"homunculus-servant" }] }).some(entry => entry.id === "homunculus-servant"), true);
});

test("глубокий пакет Таши и Занатара имеет ожидаемые объёмы", () => {
  assert.equal(Object.values(rules.optionalClassFeatures).flat().length, 43);
  assert.equal(rules.infusions.length, 16);
  assert.equal(Object.keys(rules.feats).length, 49);
  assert.equal(Object.keys(rules.races).length, 15);
  assert.equal(Object.keys(rules.classes).reduce((sum, classKey) => sum + rules.subclassOptions(classKey).length, 0), 101);
});
