const WORLD_MANIFEST_PATH = "world/manifest.json";
let WorldDB = null;
let GlobalState = null;

const StatLabels = { strength: "Сила", agility: "Ловкость", luck: "Удача", wisdom: "Мудрость" };
const ShortcutMap = { "о": "осмотреться", "ж": "взять", "и": "инвентарь", "с": "статус", "к": "карта", "п": "помощь", "г": "говорить", "з": "изучить", "ю": "обокрасть", "а": "атаковать" };
const SystemCommands = new Map([["инвентарь", "inventory"], ["i", "inventory"], ["статус", "status"], ["статы", "status"], ["карта", "map"], ["помощь", "help"], ["help", "help"], ["validate_world", "validate_world"], ["валидировать", "validate_world"]]);

function cloneState(state) { return JSON.parse(JSON.stringify(state)); }
function normalize(text) { return String(text || "").trim().toLowerCase().replace(/ё/g, "е"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char])); }
function signed(value) { return value >= 0 ? `+${value}` : String(value); }
function pick(list) { return Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : ""; }
function randomId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

const WorldLoader = {
    async fetchJson(path) {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        return response.json();
    },
    async load() {
        const manifest = await this.fetchJson(WORLD_MANIFEST_PATH);
        const db = { title: "VERMIS", subtitle: "", version: "", startLocation: null, settings: { turnMinutes: 10, startingTimeMinutes: 490, transitSecondsDefault: 5 }, fates: {}, locations: {}, entities: {}, actionPacks: {}, verbsByWord: {}, verbsById: {}, rules: [], fallbacks: [], sourceFiles: [] };
        for (const path of manifest.configs || []) this.mergeConfig(db, await this.fetchJson(path), path);
        for (const path of manifest.locations || []) this.mergeLocation(db, await this.fetchJson(path), path);
        for (const path of manifest.entities || []) this.mergeEntities(db, await this.fetchJson(path), path);
        for (const path of manifest.actions || []) this.mergeActions(db, await this.fetchJson(path), path);
        this.buildIndexes(db);
        return db;
    },
    mergeConfig(db, data, path) {
        Object.assign(db, { title: data.title || db.title, subtitle: data.subtitle || db.subtitle, version: data.version || db.version, startLocation: data.startLocation || db.startLocation, settings: { ...db.settings, ...(data.settings || {}) }, fates: { ...db.fates, ...(data.fates || {}) } });
        if (data.locations) this.mergeLocation(db, data.locations, path);
        if (data.entities) this.mergeEntities(db, data, path);
        if (data.actions) this.mergeActions(db, data, path);
        db.sourceFiles.push(path);
    },
    mergeLocation(db, data, path) {
        const list = Array.isArray(data) ? data : data.locations ? data.locations : data.id ? [data] : Object.values(data);
        list.forEach((loc) => { if (loc?.id) db.locations[loc.id] = loc; });
        db.sourceFiles.push(path);
    },
    mergeEntities(db, data, path) {
        const list = Array.isArray(data) ? data : data.entities ? data.entities : data.id ? [data] : Object.values(data);
        list.forEach((entity) => { if (entity?.id) db.entities[entity.id] = entity; });
        db.sourceFiles.push(path);
    },
    mergeActions(db, data, path) {
        const packs = Array.isArray(data) ? data : data.actions ? data.actions : [data];
        packs.forEach((pack) => {
            if (!pack?.id) return;
            db.actionPacks[pack.id] = pack;
            db.rules.push(...(pack.rules || []).map((rule) => ({ ...rule, packId: pack.id })));
            db.fallbacks.push(...(pack.fallbacks || []).map((fallback) => ({ ...fallback, packId: pack.id })));
        });
        db.sourceFiles.push(path);
    },
    buildIndexes(db) {
        Object.values(db.actionPacks).forEach((pack) => (pack.verbs || []).forEach((verb) => {
            const known = db.verbsById[verb.id] || { ...verb, words: [], tags: [] };
            known.words = [...new Set([...(known.words || []), ...(verb.words || [])])];
            known.tags = [...new Set([...(known.tags || []), ...(verb.tags || [])])];
            known.defaultTarget = known.defaultTarget || verb.defaultTarget;
            db.verbsById[verb.id] = known;
            known.words.forEach((word) => db.verbsByWord[normalize(word)] = known);
        }));
    }
};

function createInitialState(db) {
    const entities = {};
    Object.entries(db.entities).forEach(([id, entity]) => entities[id] = { hp: entity.hp ?? null, maxHp: entity.maxHp ?? entity.hp ?? null, isDead: false, location: null });
    Object.values(db.locations).forEach((loc) => (loc.entities || []).forEach((id) => { if (entities[id]) entities[id].location = loc.id; }));
    return { phase: "CREATION_NAME", turn: 0, player: { name: null, fate: null, hp: 0, maxHp: 0, stats: { strength: 0, agility: 0, luck: 0, wisdom: 0 }, inventory: [], location: db.startLocation, statuses: {}, reputation: 0 }, creation: { tempName: null, tempFate: null }, world: { timeMinutes: db.settings.startingTimeMinutes || 490, discoveredLocations: db.startLocation ? [db.startLocation] : [], entities, relations: {}, facts: {}, eventLog: [], validation: [] }, ui: { lastOutput: null } };
}

function getEntityState(state, id) { return state.world.entities[id] || {}; }
function getCurrentLocation(state) { return WorldDB.locations[state.player.location]; }
function getVisibleEntityIds(state, locId = state.player.location) { return Object.entries(state.world.entities).filter(([, e]) => e.location === locId).map(([id]) => id).filter((id) => WorldDB.entities[id]); }
function getVisibleEntities(state, locId = state.player.location) { return getVisibleEntityIds(state, locId).map((id) => ({ id, ...WorldDB.entities[id], state: getEntityState(state, id) })); }
function entityMatches(entity, query) { const q = normalize(query); return q && [entity.id, entity.name, ...(entity.aliases || [])].map(normalize).some((name) => name === q || name.includes(q) || q.includes(name)); }
function getRelation(state, entityId) { const entity = WorldDB.entities[entityId]; return (entity?.attitudeByFate?.[state.player.fate] || 0) + (state.world.relations[entityId] || 0) + Math.floor(state.player.reputation / 4); }
function isNight(state) { const h = Math.floor((state.world.timeMinutes % 1440) / 60); return h >= 20 || h < 5; }
function formatTime(state) { const minutes = state.world.timeMinutes % 1440; const day = Math.floor(state.world.timeMinutes / 1440) + 1; return `День ${day}, ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function timePhrase(state) { const h = Math.floor((state.world.timeMinutes % 1440) / 60); if (h >= 5 && h < 8) return "В лучах рассвета песок кажется пеплом, который ещё не успели развеять."; if (h >= 8 && h < 16) return "Солнце давит сверху без милости; любой металл становится маленькой печью."; if (h >= 16 && h < 20) return "В закатном солнце Агерут выглядит древнее и злее, чем днём."; return "Солнце скрылось; ночь приближается к каждому переулку как долг, который нельзя отменить."; }

function expandShortcuts(input) { const tokens = input.trim().split(/\s+/); const first = normalize(tokens[0]); if (ShortcutMap[first]) tokens[0] = ShortcutMap[first]; return tokens.join(" "); }
function validateFateSelection(input) {
    const lower = normalize(input);
    const keys = Object.keys(WorldDB.fates);
    const number = Number.parseInt(lower, 10);
    if (number >= 1 && number <= keys.length) return keys[number - 1];
    return keys.find((key) => { const fate = WorldDB.fates[key]; return normalize(key).includes(lower) || normalize(fate.name).includes(lower) || normalize(fate.nameEn).includes(lower); });
}

function parseInput(input, state) {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const expanded = expandShortcuts(trimmed);
    const lower = normalize(expanded);
    if (state.phase === "CREATION_NAME") return { type: "SET_NAME", payload: { name: trimmed } };
    if (state.phase === "CREATION_FATE") return { type: "SET_FATE", payload: { input: trimmed } };
    if (state.phase === "CREATION_CONFIRM") {
        if (["да", "yes", "y"].includes(lower)) return { type: "CONFIRM_CHARACTER" };
        if (["нет", "no", "n"].includes(lower)) return { type: "RESTART_CREATION" };
        return { type: "INVALID", payload: { text: "Напиши 'да' или 'нет'." } };
    }
    const tokens = lower.split(/\s+/);
    const verbWord = tokens[0];
    const targetText = tokens.slice(1).join(" ");
    const system = SystemCommands.get(verbWord);
    if (system) return { type: "SYSTEM", payload: { command: system } };
    const verb = WorldDB.verbsByWord[verbWord];
    if (!verb) return { type: "UNKNOWN", payload: { input: verbWord } };
    return { type: "PARSED", payload: { verb, verbWord, targetText, raw: trimmed } };
}

function resolveTarget(state, parsed) {
    const loc = getCurrentLocation(state);
    const targetText = parsed.targetText;
    if (!targetText) return { kind: "none", id: null, name: null, tags: [] };
    if (parsed.verb.defaultTarget === "location_exit" || parsed.verb.id === "move") {
        const exit = (loc.exits || []).find((candidate) => {
            const targetLoc = WorldDB.locations[candidate.target];
            const values = [candidate.target, candidate.label, candidate.direction, targetLoc?.title, targetLoc?.titleEn].map(normalize);
            const q = normalize(targetText);
            return values.some((value) => value && (value.includes(q) || q.includes(value)));
        });
        if (exit) {
            const targetLoc = WorldDB.locations[exit.target];
            return { kind: "location_exit", id: exit.target, name: exit.label || targetLoc?.title || exit.target, tags: targetLoc?.tags || [], exit };
        }
    }
    const entity = getVisibleEntities(state).find((candidate) => entityMatches(candidate, targetText));
    if (entity) return { kind: entity.kind, id: entity.id, name: entity.name, tags: entity.tags || [], entity };
    return { kind: "missing", id: null, name: targetText, tags: [] };
}

function targetKindMatches(ruleKind, target) {
    if (ruleKind === "any") return target.kind !== "missing";
    if (ruleKind === "none") return target.kind === "none";
    if (ruleKind === "any_creature") return ["npc", "monster"].includes(target.kind);
    return ruleKind === target.kind;
}
function findRule(parsed, target) {
    return WorldDB.rules.find((rule) => rule.verb === parsed.verb.id && targetKindMatches(rule.targetKind, target) && (!rule.requiredTags || rule.requiredTags.some((tag) => target.tags.includes(tag))));
}
function findFallback(parsed, target) {
    return WorldDB.fallbacks.find((fallback) => (fallback.verbTags || []).some((tag) => parsed.verb.tags.includes(tag)) && (fallback.targetTags || []).some((tag) => target.tags.includes(tag)));
}

function validatePipeline(state, parsed, target, rule) {
    const physicalTags = ["physical_movement", "physical_manipulation", "physical_attack"];
    if (state.player.statuses.in_transit && parsed.verb.tags.some((tag) => physicalTags.includes(tag))) {
        const transit = state.player.statuses.in_transit;
        return { ok: false, output: { type: "warning", text: `Ты уже в пути к ${transit.label}. Пока действует статус [in_transit], физические действия заблокированы.` } };
    }
    if (target.kind === "missing") return { ok: false, output: { type: "error", text: `Здесь не видно цели: "${target.name}".` } };
    if (target.id && getEntityState(state, target.id).isDead && parsed.verb.id === "attack") return { ok: false, output: { type: "warning", text: `Перед вами лишь безжизненная куча гнили. ${target.name} уже не отвечает на удары.` } };
    if (parsed.verb.id === "move" && target.kind === "location_exit") {
        const nextLoc = WorldDB.locations[target.id];
        if (nextLoc?.tags?.includes("tavern") && state.player.reputation <= -3) return { ok: false, output: { type: "warning", text: "Плохая репутация идёт впереди тебя. У входа в таверну уже подняли засов; безопаснее искать костяные лагеря." } };
    }
    return { ok: true };
}

function shouldRoll(rule, target, state) {
    if (!rule?.stat) return false;
    if (rule.dice === "always") return true;
    if (rule.dice === "hazard") return Boolean(target.exit?.hazard || target.exit?.difficulty);
    if (rule.dice === "dangerous_location") return (getCurrentLocation(state).tags || []).some((tag) => ["danger", "darkness", "water", "ruins"].includes(tag)) || isNight(state);
    return false;
}
function rollDice(rule, target, state) {
    if (!shouldRoll(rule, target, state)) return null;
    const d20 = Math.floor(Math.random() * 20) + 1;
    const modifier = state.player.stats[rule.stat] || 0;
    const base = target.exit?.difficulty || rule.difficulty || 10;
    const dc = base + (target.exit?.difficulty ? 0 : (getCurrentLocation(state).difficultyModifier || 0));
    const total = d20 + modifier;
    let grade = d20 === 20 ? "critical_success" : d20 === 1 ? "critical_failure" : total >= dc ? "success" : "failure";
    const label = { critical_success: "КРИТИЧЕСКИЙ УСПЕХ", success: "УСПЕХ", failure: "ПРОВАЛ", critical_failure: "КРИТИЧЕСКИЙ ПРОВАЛ" }[grade];
    const formula = `[ d20: ${d20} ] + [ ${StatLabels[rule.stat] || rule.stat}: ${signed(modifier)} ] = ${total} vs Сложность: ${dc}. ${label}!`;
    console.log(`[dice] ${formula}`);
    return { d20, modifier, total, dc, grade, label, stat: rule.stat, formula };
}

function reducer(state, action) {
    const next = cloneState(state);
    next.ui.lastOutput = null;
    switch (action.type) {
        case "SET_NAME":
            if (!action.payload.name || action.payload.name.length < 2) { next.ui.lastOutput = { type: "error", text: "Имя должно содержать минимум 2 символа. Как тебя зовут, странник?" }; return next; }
            if (WorldDB.verbsByWord[normalize(action.payload.name)] || SystemCommands.has(normalize(action.payload.name))) { next.ui.lastOutput = { type: "warning", text: `"${action.payload.name}" звучит как команда, а не имя.` }; return next; }
            next.creation.tempName = action.payload.name; next.phase = "CREATION_FATE"; next.ui.lastOutput = { type: "fate_selection", name: action.payload.name }; return next;
        case "SET_FATE": {
            const fateId = validateFateSelection(action.payload.input);
            if (!fateId) { next.ui.lastOutput = { type: "error", text: "Неверный выбор. Введи номер или название судьбы." }; return next; }
            next.creation.tempFate = fateId; next.phase = "CREATION_CONFIRM"; next.ui.lastOutput = { type: "fate_confirm", name: next.creation.tempName, fateId }; return next;
        }
        case "CONFIRM_CHARACTER": {
            const fate = WorldDB.fates[next.creation.tempFate];
            next.player.name = next.creation.tempName; next.player.fate = next.creation.tempFate; next.player.hp = fate.stats.hp; next.player.maxHp = fate.stats.maxHp;
            next.player.stats = { strength: fate.stats.strength, agility: fate.stats.agility, luck: fate.stats.luck, wisdom: fate.stats.wisdom };
            next.player.inventory = [...(fate.startingItems || [])]; next.player.reputation = fate.reputation || 0; next.player.location = WorldDB.startLocation; next.phase = "GAME"; next.world.discoveredLocations = [WorldDB.startLocation];
            next.player.inventory.forEach((id) => { if (next.world.entities[id]) next.world.entities[id].location = "inventory"; });
            next.ui.lastOutput = { type: "game_start" }; return next;
        }
        case "RESTART_CREATION": next.creation = { tempName: null, tempFate: null }; next.phase = "CREATION_NAME"; next.ui.lastOutput = { type: "creation_restart" }; return next;
        case "INVALID":
        case "UNKNOWN":
            next.ui.lastOutput = { type: "error", text: action.payload.text || `Неизвестная команда: "${action.payload.input}". Введи 'помощь'.` };
            return next;
        case "PIPELINE_REJECTED":
            next.ui.lastOutput = action.payload.output;
            return tick(next, 0);
        case "SYSTEM": return reduceSystem(next, action.payload.command);
        case "WORLD_ACTION": return reduceWorldAction(next, action.payload);
        case "FALLBACK_ACTION":
            next.ui.lastOutput = { type: "info", text: action.payload.text };
            return tick(next, WorldDB.settings.turnMinutes);
        case "COMPLETE_TRANSIT": return reduceCompleteTransit(next, action.payload);
        default: return next;
    }
}

function tick(state, minutes = WorldDB.settings.turnMinutes) {
    if (state.phase === "GAME") {
        state.turn += 1;
        state.world.timeMinutes += minutes;
    }
    return state;
}

function reduceSystem(state, command) {
    if (command === "inventory") state.ui.lastOutput = { type: "inventory" };
    if (command === "status") state.ui.lastOutput = { type: "status" };
    if (command === "map") state.ui.lastOutput = { type: "map" };
    if (command === "help") state.ui.lastOutput = { type: "help" };
    if (command === "validate_world") {
        const report = WorldValidator.validate(WorldDB);
        state.world.validation = report;
        state.ui.lastOutput = { type: "validation", report };
        report.forEach((line) => console[line.level === "error" ? "error" : "warn"](`[validate_world] ${line.message}`));
    }
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceWorldAction(state, payload) {
    const { parsed, target, rule, dice } = payload;
    const verbId = parsed.verb.id;
    if (verbId === "look") return reduceLook(state);
    if (verbId === "examine") return reduceExamine(state, target);
    if (verbId === "move") return reduceMove(state, target, rule, dice, payload.transitId);
    if (verbId === "take") return reduceTake(state, target, rule, dice);
    if (verbId === "talk") return reduceTalk(state, target);
    if (["flatter", "deceive", "threaten"].includes(verbId)) return reduceSocialRoll(state, target, rule, dice, verbId);
    if (verbId === "steal") return reduceSteal(state, target, rule, dice);
    if (verbId === "gamble") return reduceGamble(state, target, rule, dice);
    if (verbId === "attack") return reduceAttack(state, target, rule, dice);
    if (verbId === "open") return reduceOpen(state, target, rule, dice);
    state.ui.lastOutput = { type: "info", text: "Действие пока не имеет обработчика." };
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceLook(state) {
    state.ui.lastOutput = { type: "location", locationId: state.player.location };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceExamine(state, target) {
    if (target.kind === "none") state.ui.lastOutput = { type: "hint", text: "Что изучить?" };
    else if (target.entity) state.ui.lastOutput = { type: "examine_entity", entityId: target.id };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceMove(state, target, rule, dice, transitId) {
    const loc = getCurrentLocation(state);
    if (target.kind === "none") { state.ui.lastOutput = { type: "exits", exits: loc.exits || [] }; return tick(state, 0); }
    if (dice && dice.grade === "critical_failure") { state.player.hp = Math.max(0, state.player.hp - 5); state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.criticalFailureText || rule.failureText} Ты теряешь 5 HP и отступаешь.` }; return tick(state, WorldDB.settings.turnMinutes); }
    if (dice && dice.grade === "failure") { state.player.hp = Math.max(0, state.player.hp - 2); state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText || "Путь сопротивляется."} Ты теряешь 2 HP и остаёшься на месте.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const durationSeconds = target.exit.durationSeconds || WorldDB.settings.transitSecondsDefault || 5;
    state.player.statuses.in_transit = { id: transitId, from: state.player.location, to: target.id, label: target.name, durationSeconds, timeCostMinutes: rule.timeCostMinutes || 20 };
    state.ui.lastOutput = { type: "transit_started", targetId: target.id, label: target.name, durationSeconds, dice, text: rule.successText };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceTake(state, target, rule, dice) {
    if (target.kind === "none") { state.ui.lastOutput = { type: "hint", text: "Что взять?" }; return tick(state, 0); }
    if (target.kind !== "item") { state.ui.lastOutput = { type: "warning", text: `${target.name} не выглядит предметом, который можно просто забрать.` }; return tick(state, WorldDB.settings.turnMinutes); }
    if (dice && ["failure", "critical_failure"].includes(dice.grade)) { const damage = dice.grade === "critical_failure" ? 4 : 1; state.player.hp = Math.max(0, state.player.hp - damage); state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText} Ты теряешь ${damage} HP.` }; return tick(state, WorldDB.settings.turnMinutes); }
    state.player.inventory.push(target.id); state.world.entities[target.id].location = "inventory"; state.ui.lastOutput = { type: "success", text: `${rule?.successText || "Взято"}: ${target.name}.` };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceTalk(state, target) {
    if (!target.id) { state.ui.lastOutput = { type: "hint", text: "С кем говорить?" }; return tick(state, 0); }
    const entity = WorldDB.entities[target.id];
    const relation = getRelation(state, target.id);
    const stage = relation <= -2 ? "hostile" : relation >= 2 ? "warm" : "closed";
    const line = pick(entity.dialogue?.[stage]) || pick(entity.dialogue?.closed) || `${entity.name} молчит.`;
    state.world.relations[target.id] = (state.world.relations[target.id] || 0) + 1;
    state.ui.lastOutput = { type: "dialogue", entityId: target.id, stage, text: line };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceSocialRoll(state, target, rule, dice, verbId) {
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    const delta = success ? (dice.grade === "critical_success" ? 2 : 1) : -1;
    state.world.relations[target.id] = getRelation(state, target.id) + delta;
    if (verbId === "threaten") state.player.reputation -= success ? 1 : 2;
    state.ui.lastOutput = { type: "dice_result", dice, text: success ? rule.successText : rule.failureText };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceSteal(state, target, rule, dice) {
    const entity = WorldDB.entities[target.id];
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    state.player.reputation -= success ? 1 : 3;
    state.world.relations[target.id] = getRelation(state, target.id) + (success ? -1 : -3);
    if (success) {
        const loot = (entity.loot || []).slice(0, dice.grade === "critical_success" ? 2 : 1).filter((id) => WorldDB.entities[id]);
        loot.forEach((id) => { state.player.inventory.push(id); if (state.world.entities[id]) state.world.entities[id].location = "inventory"; });
        state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.successText} Добыча: ${loot.map((id) => WorldDB.entities[id].name).join(", ") || "ничего, кроме дурного знака"}.` };
    } else {
        const damage = target.tags.includes("guard") ? 4 : 2;
        state.player.hp = Math.max(0, state.player.hp - damage);
        state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText} Тебя замечают. Репутация падает, -${damage} HP.` };
    }
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceGamble(state, target, rule, dice) {
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    if (success && WorldDB.entities.bone_dice && !state.player.inventory.includes("bone_dice")) state.player.inventory.push("bone_dice");
    if (!success) state.player.reputation -= 1;
    state.ui.lastOutput = { type: "dice_result", dice, text: success ? `${rule.successText} Игрок кивает: теперь он меньше уверен, что ты лёгкая добыча.` : `${rule.failureText} Ты проигрываешь воду, монету или часть достоинства.` };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceAttack(state, target, rule, dice) {
    const entity = WorldDB.entities[target.id];
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    if (success) {
        const damage = (state.player.stats.strength || 1) + (dice.grade === "critical_success" ? 8 : 4);
        state.world.entities[target.id].hp = Math.max(0, (state.world.entities[target.id].hp || entity.hp || 1) - damage);
        state.player.reputation -= target.tags.includes("guard") || target.tags.includes("peaceful_npc") ? 4 : 1;
        let text = `${rule.successText} ${entity.name} получает ${damage} урона.`;
        if (state.world.entities[target.id].hp <= 0) {
            state.world.entities[target.id].isDead = true;
            text += ` ${entity.name} падает и больше не поднимается.`;
            (entity.loot || []).forEach((id) => { if (WorldDB.entities[id]) { state.player.inventory.push(id); if (state.world.entities[id]) state.world.entities[id].location = "inventory"; } });
        }
        state.ui.lastOutput = { type: "dice_result", dice, text };
    } else {
        const damage = dice?.grade === "critical_failure" ? 5 : 2;
        state.player.hp = Math.max(0, state.player.hp - damage);
        state.ui.lastOutput = { type: "dice_result", dice, text: `${dice?.grade === "critical_failure" ? rule.criticalFailureText : rule.failureText} Ответ стоит тебе ${damage} HP.` };
    }
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceOpen(state, target, rule, dice) {
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    if (success) state.world.facts.hidden_passage_known = true;
    else state.player.hp = Math.max(0, state.player.hp - 1);
    state.ui.lastOutput = { type: "dice_result", dice, text: success ? rule.successText : `${rule.failureText} Каменная пыль режет ладонь: -1 HP.` };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceCompleteTransit(state, payload) {
    const transit = state.player.statuses.in_transit;
    if (!transit || transit.id !== payload.id) return state;
    state.player.location = transit.to;
    delete state.player.statuses.in_transit;
    if (!state.world.discoveredLocations.includes(transit.to)) state.world.discoveredLocations.push(transit.to);
    state.world.timeMinutes += transit.timeCostMinutes || 20;
    state.turn += 1;
    state.ui.lastOutput = { type: "location", locationId: transit.to, arrivalText: `Переход завершён. Песок отпускает ноги у места: ${transit.label}.` };
    return state;
}

class MockServer {
    constructor(onServerAction) {
        this.onServerAction = onServerAction;
        this.timers = new Map();
    }
    handleInput(state, input) {
        const parsedAction = parseInput(input, state);
        if (!parsedAction) return state;
        if (parsedAction.type !== "PARSED") return reducer(state, parsedAction);
        const parsed = parsedAction.payload;
        const target = resolveTarget(state, parsed);
        const rule = findRule(parsed, target);
        const validation = validatePipeline(state, parsed, target, rule);
        if (!validation.ok) return reducer(state, { type: "PIPELINE_REJECTED", payload: { output: validation.output } });
        if (!rule) {
            const fallback = findFallback(parsed, target);
            if (fallback) return reducer(state, { type: "FALLBACK_ACTION", payload: { text: fallback.text.replaceAll("{target}", target.name || parsed.targetText) } });
            return reducer(state, { type: "INVALID", payload: { text: `Комбинация "${parsed.verbWord} + ${target.name || parsed.targetText}" не описана в матрицах действий.` } });
        }
        const dice = rollDice(rule, target, state);
        const next = reducer(state, { type: "WORLD_ACTION", payload: { parsed, target, rule, dice, transitId: randomId("transit") } });
        this.scheduleIfNeeded(next);
        return next;
    }
    scheduleIfNeeded(state) {
        const transit = state.player.statuses.in_transit;
        if (!transit || this.timers.has(transit.id)) return;
        const timer = setTimeout(() => {
            this.timers.delete(transit.id);
            this.onServerAction({ type: "COMPLETE_TRANSIT", payload: { id: transit.id } });
        }, transit.durationSeconds * 1000);
        this.timers.set(transit.id, timer);
    }
}

const WorldValidator = {
    validate(db) {
        const report = [];
        const push = (level, message) => report.push({ level, message });
        if (!db.startLocation || !db.locations[db.startLocation]) push("error", `Стартовая локация не найдена: ${db.startLocation}`);
        Object.values(db.locations).forEach((loc) => {
            (loc.exits || []).forEach((exit) => {
                if (!db.locations[exit.target]) push("error", `${loc.id}: выход ведёт в отсутствующую локацию ${exit.target}`);
                const back = db.locations[exit.target]?.exits?.some((candidate) => candidate.target === loc.id);
                if (db.locations[exit.target] && !back) push("warning", `${loc.id} -> ${exit.target}: нет обратной связи`);
            });
            (loc.entities || []).forEach((id) => { if (!db.entities[id]) push("error", `${loc.id}: сущность не найдена: ${id}`); });
        });
        Object.values(db.entities).forEach((entity) => (entity.loot || []).forEach((id) => { if (!db.entities[id]) push("warning", `${entity.id}: loot ссылается на отсутствующую сущность ${id}`); }));
        db.rules.forEach((rule) => { if (!db.verbsById[rule.verb]) push("error", `${rule.id}: правило ссылается на неизвестный глагол ${rule.verb}`); });
        if (report.length === 0) push("ok", "Мир валиден: битых связей не найдено.");
        return report;
    }
};

function get_available_actions(state = GlobalState) {
    if (!state || state.phase !== "GAME" || !WorldDB) return [];
    const loc = getCurrentLocation(state);
    const commands = ["осмотреться", "инвентарь", "статус", "карта", "помощь", "validate_world"];
    if (!state.player.statuses.in_transit) {
        (loc.exits || []).forEach((exit) => commands.push(`идти ${exit.label || exit.target}`));
        getVisibleEntities(state).forEach((entity) => {
            const name = entity.aliases?.[0] || entity.name;
            commands.push(`изучить ${name}`);
            if (entity.kind === "item") commands.push(`взять ${name}`);
            if (["npc", "monster"].includes(entity.kind)) {
                commands.push(`говорить ${name}`, `атаковать ${name}`);
                if (entity.kind === "npc") commands.push(`льстить ${name}`, `обмануть ${name}`, `обокрасть ${name}`);
                if ((entity.tags || []).includes("gambler")) commands.push(`играть ${name}`);
            }
        });
    } else {
        commands.push("статус", "помощь");
    }
    return [...new Set(commands)];
}

const Renderer = {
    outputEl: null,
    hintEl: null,
    devStateEl: null,
    init(outputEl, hintEl, devStateEl) { this.outputEl = outputEl; this.hintEl = hintEl; this.devStateEl = devStateEl; },
    render(state) {
        const output = state.ui.lastOutput;
        if (!output) return;
        let html = "";
        if (["error", "warning", "hint", "info", "success"].includes(output.type)) html = `<p class="${output.type}-msg">${escapeHtml(output.text)}</p>`;
        if (output.type === "fate_selection") html = this.renderFateSelection(output.name);
        if (output.type === "fate_confirm") html = this.renderFateConfirm(output.name, output.fateId);
        if (output.type === "creation_restart") html = `<p class="info-msg">Начнём сначала. Назови имя, с которым войдёшь в Агерут.</p>`;
        if (output.type === "game_start") html = this.renderGameStart(state);
        if (output.type === "location") html = this.renderLocation(state, output.locationId, output.arrivalText);
        if (output.type === "exits") html = this.renderExits(output.exits);
        if (output.type === "examine_entity") html = this.renderExamine(state, output.entityId);
        if (output.type === "dialogue") html = this.renderDialogue(output);
        if (output.type === "dice_result") html = this.renderDice(output.dice, output.text);
        if (output.type === "transit_started") html = this.renderTransit(output);
        if (output.type === "inventory") html = this.renderInventory(state);
        if (output.type === "status") html = this.renderStatus(state);
        if (output.type === "map") html = this.renderMap(state);
        if (output.type === "help") html = this.renderHelp();
        if (output.type === "validation") html = this.renderValidation(output.report);
        if (html) this.print(html);
    },
    print(html) {
        const block = document.createElement("div");
        block.className = "output-block";
        block.innerHTML = html;
        this.outputEl.appendChild(block);
        this.outputEl.scrollTop = this.outputEl.scrollHeight;
    },
    renderWelcome(db) {
        this.print(`<div class="welcome-screen"><p class="game-title">${escapeHtml(db.title)}</p><p class="game-subtitle">${escapeHtml(db.subtitle)}</p><p class="game-version">${escapeHtml(db.version)}</p><br><p class="welcome-text">Агерут дышит жаром, песком и недоверием.</p><p class="welcome-text">Все истории, локации, сущности и матрицы действий загружены из папки <span class="cmd-example">world/</span>.</p><br><p class="system-msg">═══ ПРОБУЖДЕНИЕ У ЮЖНЫХ ВОРОТ ═══</p><p>Ты стоишь перед городом, который не обещает спасения. Назови имя, под которым тебя запомнят стражники, торговцы и мёртвые под песком.</p><p class="hint-msg">Tab — автодополнение, ↑/↓ — история, команда validate_world — проверка JSON-связей.</p><div class="input-callout"><span>Чтобы продолжить, введи имя персонажа</span><strong>например: Арам</strong></div></div>`);
    },
    renderLoadError(error) { this.print(`<p class="error-msg">Не удалось загрузить мир из JSON: ${escapeHtml(error.message)}</p><p class="hint-msg">Запусти проект через локальный статический сервер: <span class="cmd-example">python -m http.server 8000</span>.</p>`); },
    renderFateSelection(name) {
        let html = `<p class="system-msg">═══ ВЫБЕРИ СУДЬБУ ═══</p><p>Имя: <strong>${escapeHtml(name)}</strong></p>`;
        Object.entries(WorldDB.fates).forEach(([, fate], index) => { html += `<div class="class-option"><p><strong>${index + 1}. ${escapeHtml(fate.name)}</strong> (${escapeHtml(fate.nameEn)})</p><p class="class-epithet">${escapeHtml(fate.epithet)}</p><p class="class-desc">${escapeHtml(fate.description)}</p></div>`; });
        return html + `<div class="input-callout"><span>Чтобы продолжить, введи номер или название судьбы</span><strong>например: 1</strong></div>`;
    },
    renderFateConfirm(name, fateId) {
        const fate = WorldDB.fates[fateId];
        return `<p class="system-msg">═══ ПОСЛЕДНИЙ ШАГ ═══</p><p>${escapeHtml(name)}, <strong>${escapeHtml(fate.name)}</strong> — ${escapeHtml(fate.epithet)}.</p><p class="class-desc">${escapeHtml(fate.description)}</p><p class="class-quote">"${escapeHtml(fate.quote)}"</p><p class="class-stats">HP: ${fate.stats.hp} | Сила: ${fate.stats.strength} | Ловкость: ${fate.stats.agility} | Удача: ${fate.stats.luck} | Мудрость: ${fate.stats.wisdom} | Репутация: ${signed(fate.reputation || 0)}</p><div class="input-callout important"><span>Чтобы подтвердить выбор, введи</span><strong>да</strong><span>или введи <b>нет</b>, чтобы выбрать заново</span></div>`;
    },
    renderGameStart(state) {
        const fate = WorldDB.fates[state.player.fate];
        return `<p class="system-msg">═══ АГЕРУТ ПРИНИМАЕТ НЕОХОТНО ═══</p><p>${escapeHtml(state.player.name)}, ${escapeHtml(fate.epithet)}.</p><p>Путь начинается у Южных ворот Агерута. Люди здесь сначала подозревают, потом торгуются, и лишь затем иногда говорят правду.</p><div class="input-callout"><span>Чтобы продолжить, введи команду</span><strong>осмотреться</strong></div>`;
    },
    renderLocation(state, locationId, arrivalText = "") {
        const loc = WorldDB.locations[locationId];
        let html = `<p class="system-msg">═══ ${escapeHtml(loc.title)} ═══</p><p class="location-en">(${escapeHtml(loc.titleEn)}) — ${formatTime(state)}</p>`;
        if (arrivalText) html += `<p class="success-msg">${escapeHtml(arrivalText)}</p>`;
        html += `<p class="atmosphere">${escapeHtml(timePhrase(state))}</p><p>${escapeHtml(loc.description)}</p><p class="atmosphere">${escapeHtml(loc.atmosphere)}</p>`;
        const visible = getVisibleEntities(state, loc.id);
        const npcs = visible.filter((e) => ["npc", "monster"].includes(e.kind) && !e.state.isDead);
        const dead = visible.filter((e) => e.state.isDead);
        const items = visible.filter((e) => e.kind === "item");
        if (npcs.length) html += `<p class="info-msg">[СУЩНОСТИ]: ${npcs.map((e) => `<span class="clickable" data-cmd="говорить ${escapeHtml(e.aliases?.[0] || e.name)}">${escapeHtml(e.name)}</span>`).join(", ")}</p>`;
        if (dead.length) html += `<p class="warning-msg">[МЁРТВЫЕ]: ${dead.map((e) => escapeHtml(e.name)).join(", ")}</p>`;
        if (items.length) html += `<p class="info-msg">[ПРЕДМЕТЫ]: ${items.map((e) => `<span class="clickable" data-cmd="взять ${escapeHtml(e.aliases?.[0] || e.name)}">${escapeHtml(e.name)}</span>`).join(", ")}</p>`;
        return html + this.renderExits(loc.exits || [], true);
    },
    renderExits(exits, inline = false) {
        const links = exits.map((exit) => {
            const loc = WorldDB.locations[exit.target];
            const label = exit.label || loc?.title || exit.target;
            const risk = exit.hazard ? `, риск: ${exit.hazard}` : "";
            return `<span class="clickable" data-cmd="идти ${escapeHtml(label)}">${escapeHtml(label)}</span><span class="location-en"> (${escapeHtml(exit.direction || "путь")}${escapeHtml(risk)})</span>`;
        }).join(" | ");
        return `${inline ? "" : "<p class=\"system-msg\">═══ ПУТИ ═══</p>"}<p class="info-msg">[ПУТИ]: ${links || "нет"}</p>`;
    },
    renderExamine(state, entityId) {
        const entity = WorldDB.entities[entityId];
        const eState = getEntityState(state, entityId);
        const hp = eState.hp !== null && eState.hp !== undefined ? `<p class="stat">HP: ${eState.hp}/${eState.maxHp}</p>` : "";
        return `<p><strong>${escapeHtml(entity.name)}</strong></p><p>${escapeHtml(entity.description)}</p><p class="info-msg">[ТЕГИ]: ${(entity.tags || []).map(escapeHtml).join(", ")}</p>${hp}`;
    },
    renderDialogue(output) {
        const entity = WorldDB.entities[output.entityId];
        const aside = output.stage === "warm" ? "Собеседник всё ещё осторожен, но уже не ищет глазами ближайший выход." : output.stage === "hostile" ? "Пальцы собеседника ближе к оружию, чем к сердцу." : "Собеседник говорит так, будто каждое слово отдаёт в долг.";
        return `<p class="npc-name">${escapeHtml(entity.name)}:</p><p>"${escapeHtml(output.text)}"</p><p class="atmosphere">${escapeHtml(aside)}</p>`;
    },
    renderDice(dice, text) {
        return `${dice ? `<p class="dice-log">${escapeHtml(dice.formula)}</p>` : ""}<p>${escapeHtml(text)}</p>`;
    },
    renderTransit(output) {
        return `${output.dice ? `<p class="dice-log">${escapeHtml(output.dice.formula)}</p>` : ""}<p class="info-msg">${escapeHtml(output.text || "Переход начался.")}</p><p class="warning-msg">Статус [in_transit]: переход к ${escapeHtml(output.label)} займёт ${output.durationSeconds} секунд. Физические действия временно заблокированы.</p>`;
    },
    renderInventory(state) {
        if (!state.player.inventory.length) return `<p class="info-msg">Инвентарь пуст.</p>`;
        return `<p class="system-msg">═══ ИНВЕНТАРЬ ═══</p>${state.player.inventory.map((id, index) => `<p>${index + 1}. ${escapeHtml(WorldDB.entities[id]?.name || id)}</p>`).join("")}`;
    },
    renderStatus(state) {
        const fate = WorldDB.fates[state.player.fate];
        const statuses = Object.keys(state.player.statuses).length ? Object.keys(state.player.statuses).map((s) => `[${s}]`).join(" ") : "нет";
        return `<p class="system-msg">═══ ${escapeHtml(state.player.name)} ═══</p><p class="info-msg">${escapeHtml(fate.name)} — ${escapeHtml(fate.epithet)}</p><p>HP: ${state.player.hp}/${state.player.maxHp}</p><p>Сила: ${state.player.stats.strength} | Ловкость: ${state.player.stats.agility} | Удача: ${state.player.stats.luck} | Мудрость: ${state.player.stats.wisdom}</p><p>Репутация: ${signed(state.player.reputation)} | Статусы: ${escapeHtml(statuses)} | ${formatTime(state)}</p>`;
    },
    renderMap(state) {
        let html = `<p class="system-msg">═══ КАРТА ═══</p>`;
        state.world.discoveredLocations.forEach((id) => {
            const loc = WorldDB.locations[id];
            html += `<p class="${id === state.player.location ? "success-msg" : ""}">${id === state.player.location ? "★" : "○"} ${escapeHtml(loc?.title || id)}</p>`;
        });
        return html;
    },
    renderHelp() {
        return `<p class="system-msg">═══ КОМАНДЫ ═══</p><p class="hint-msg">Сокращения: о=осмотреться, ж=взять, и=инвентарь, с=статус, к=карта, п=помощь.</p><p><span class="cmd-example">идти [место]</span>, <span class="cmd-example">изучить [цель]</span>, <span class="cmd-example">взять [предмет]</span>, <span class="cmd-example">говорить [кто]</span>, <span class="cmd-example">льстить [кто]</span>, <span class="cmd-example">обмануть [кто]</span>, <span class="cmd-example">обокрасть [кто]</span>, <span class="cmd-example">играть [кто]</span>, <span class="cmd-example">атаковать [кто]</span>.</p><p><span class="cmd-example">validate_world</span> проверяет JSON на битые выходы, сущности и правила.</p>`;
    },
    renderValidation(report) {
        return `<p class="system-msg">═══ VALIDATE_WORLD ═══</p>${report.map((line) => `<p class="${line.level === "ok" ? "success" : line.level === "error" ? "error" : "warning"}-msg">[${escapeHtml(line.level)}] ${escapeHtml(line.message)}</p>`).join("")}`;
    },
    updateSidebar(state) {
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set("char-name", state.player.name || "???");
        set("char-class", state.player.fate ? WorldDB.fates[state.player.fate].name : "???");
        set("char-strength", state.player.stats?.strength || "?");
        set("char-luck", state.player.stats?.luck || "?");
        set("world-time", state.phase === "GAME" ? formatTime(state) : "—");
        set("char-reputation", state.phase === "GAME" ? signed(state.player.reputation) : "—");
        const hpEl = document.getElementById("char-hp");
        const hpFill = document.getElementById("hp-fill");
        if (hpEl) hpEl.textContent = state.player.maxHp ? `${state.player.hp}/${state.player.maxHp}` : "?/?";
        if (hpFill) hpFill.style.width = state.player.maxHp ? `${Math.max(0, Math.min(100, state.player.hp / state.player.maxHp * 100))}%` : "0%";
        const env = document.getElementById("environment-list");
        if (env) {
            const loc = state.phase === "GAME" ? getCurrentLocation(state) : null;
            env.innerHTML = loc ? `${escapeHtml(loc.title)}<br>${getVisibleEntities(state).map((e) => escapeHtml(e.name)).join("<br>") || "никого рядом"}` : "Мир загружается...";
        }
        if (this.devStateEl) this.devStateEl.textContent = JSON.stringify(state, null, 2);
        window.GlobalState = state;
    },
    updateHints(inputValue, state) {
        if (!this.hintEl) return;
        const query = normalize(inputValue);
        if (!query || !state || state.phase !== "GAME") { this.hintEl.textContent = ""; return; }
        const matches = get_available_actions(state).filter((cmd) => normalize(cmd).startsWith(query)).slice(0, 8);
        this.hintEl.textContent = matches.length ? `Подсказки: ${matches.join("  ·  ")}` : "";
    }
};

const Audio = {
    context: null,
    enabled: true,
    init() { try { this.context = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } },
    play(freq, dur, type = "sine", vol = 0.1) {
        if (!this.enabled || !this.context) return;
        try {
            const osc = this.context.createOscillator();
            const gain = this.context.createGain();
            osc.connect(gain); gain.connect(this.context.destination);
            osc.type = type; osc.frequency.setValueAtTime(freq, this.context.currentTime);
            gain.gain.setValueAtTime(vol, this.context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + dur);
            osc.start(); osc.stop(this.context.currentTime + dur);
        } catch (e) { }
    },
    hover() { this.play(600, 0.03, "sine", 0.05); },
    click() { this.play(400, 0.08, "square", 0.08); },
    success() { this.play(523, 0.1); setTimeout(() => this.play(659, 0.1), 80); },
    error() { this.play(180, 0.14, "sawtooth", 0.12); }
};

const Game = {
    state: null,
    inputEl: null,
    history: [],
    historyIndex: 0,
    server: null,
    async init(inputEl, outputEl, hintEl, devStateEl) {
        this.inputEl = inputEl;
        Renderer.init(outputEl, hintEl, devStateEl);
        this.bindEvents();
        try {
            WorldDB = await WorldLoader.load();
            this.state = createInitialState(WorldDB);
            GlobalState = this.state;
            this.server = new MockServer((action) => this.applyServerAction(action));
            Renderer.renderWelcome(WorldDB);
            Renderer.updateSidebar(this.state);
            window.validate_world = () => this.executeCommand("validate_world");
            window.get_available_actions = () => get_available_actions(this.state);
        } catch (error) {
            console.error(error);
            Renderer.renderLoadError(error);
        }
    },
    bindEvents() {
        this.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); this.dispatch(this.inputEl.value); }
            if (e.key === "ArrowUp") { e.preventDefault(); this.navigateHistory(-1); }
            if (e.key === "ArrowDown") { e.preventDefault(); this.navigateHistory(1); }
            if (e.key === "Tab") { e.preventDefault(); this.autoComplete(); }
        });
        this.inputEl.addEventListener("input", () => Renderer.updateHints(this.inputEl.value, this.state));
    },
    dispatch(input) {
        const trimmed = input.trim();
        if (!trimmed || !this.state || !WorldDB) return;
        this.history.push(trimmed);
        this.historyIndex = this.history.length;
        Renderer.print(`<p class="user-input">&gt; ${escapeHtml(trimmed)}</p>`);
        this.state = this.server.handleInput(this.state, trimmed);
        this.afterStateChange();
        this.inputEl.value = "";
        Renderer.updateHints("", this.state);
    },
    applyServerAction(action) {
        if (!this.state) return;
        this.state = reducer(this.state, action);
        this.afterStateChange();
    },
    afterStateChange() {
        GlobalState = this.state;
        Renderer.render(this.state);
        Renderer.updateSidebar(this.state);
        const output = this.state.ui.lastOutput;
        if (output?.type === "error") Audio.error();
        else if (["success", "game_start"].includes(output?.type)) Audio.success();
        else Audio.click();
    },
    navigateHistory(dir) {
        const idx = this.historyIndex + dir;
        if (idx < 0 || idx > this.history.length) return;
        this.historyIndex = idx;
        this.inputEl.value = idx === this.history.length ? "" : this.history[idx];
        Renderer.updateHints(this.inputEl.value, this.state);
    },
    autoComplete() {
        if (!this.state || this.state.phase !== "GAME") return;
        const query = normalize(this.inputEl.value);
        const matches = get_available_actions(this.state).filter((cmd) => normalize(cmd).startsWith(query));
        if (!matches.length) return;
        this.inputEl.value = matches[0];
        Renderer.updateHints(this.inputEl.value, this.state);
    },
    executeCommand(cmd) {
        this.inputEl.value = cmd;
        this.dispatch(cmd);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const inputEl = document.getElementById("terminal-input");
    const outputEl = document.getElementById("terminal-output");
    const hintEl = document.getElementById("autocomplete-hint");
    const devStateEl = document.getElementById("state-json");
    const sidebarEl = document.getElementById("game-sidebar");
    const toggleBtn = document.getElementById("sidebar-toggle");
    if (!inputEl || !outputEl) return;
    if (toggleBtn) toggleBtn.addEventListener("click", () => sidebarEl?.classList.toggle("hidden"));
    document.addEventListener("click", () => { if (!Audio.context) Audio.init(); }, { once: true });
    document.addEventListener("click", (e) => {
        const clickable = e.target.closest(".clickable");
        if (clickable) {
            const cmd = clickable.getAttribute("data-cmd");
            if (cmd) Game.executeCommand(cmd);
            if (sidebarEl && window.innerWidth <= 900) sidebarEl.classList.add("hidden");
            return;
        }
        if (!e.target.closest("button") && e.target !== inputEl) inputEl.focus();
    });
    document.querySelectorAll(".cmd-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const cmd = btn.getAttribute("data-cmd");
            if (cmd) Game.executeCommand(cmd);
        });
        btn.addEventListener("mouseenter", () => Audio.hover());
    });
    Game.init(inputEl, outputEl, hintEl, devStateEl);
    inputEl.focus();
});
