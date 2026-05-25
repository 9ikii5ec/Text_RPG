const WORLD_MANIFEST_PATH = "world/manifest.json";
let WorldDB = null;
let GlobalState = null;

const StatLabels = { strength: "Сила", agility: "Ловкость", luck: "Удача", wisdom: "Мудрость", constitution: "Телосложение", charisma: "Харизма", perception: "Восприятие", intelligence: "Интеллект" };
const DemonWhispers = ["Демон: перережь ему горло.", "Голос из клинка: он врёт.", "Шёпот: кровь ждёт.", "Демон смеётся: слабая плоть."];
const OneEyeWhispers = ["Гость в пустой глазнице: он боится.", "Тёмный шёпот: посмотри — у него тоже всего два глаза.", "Незваный гость: убей их. Всех.", "Шептун: ты носишь меня, а я ношу твою ненависть."];
const CurseLabels = { blinded: "Ослепление", decaying: "Разложение", demon_host: "Демон-хост", one_eye: "Один глаз", two_pupil_eye: "Два зрачка", diseased: "Болезнь" };
const ShortcutMap = { "ж": "взять", "и": "инвентарь", "с": "статус", "к": "карта", "п": "помощь", "г": "говорить", "з": "изучить", "ю": "обокрасть", "а": "атаковать" };
const SystemCommands = new Map([["инвентарь", "inventory"], ["i", "inventory"], ["статус", "status"], ["статы", "status"], ["карта", "map"], ["помощь", "help"], ["help", "help"], ["validate_world", "validate_world"], ["валидировать", "validate_world"], ["отдохнуть", "rest"], ["передохнуть", "rest"], ["отдых", "rest"], ["заново", "restart"], ["рестарт", "restart"]]);

function cloneState(state) { return JSON.parse(JSON.stringify(state)); }
function normalize(text) { return String(text || "").trim().toLowerCase().replace(/ё/g, "е"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char])); }
function signed(value) { return value >= 0 ? `+${value}` : String(value); }
function pick(list) { return Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : null; }
function applyCursedRelic(state, entity) {
    const cursedItems = ["forgotten_relic", "asp_amulet", "obsidian_dagger", "ritual_knife", "executioner_helm"];
    if (Math.random() > 0.05) return null;
    const id = pick(cursedItems);
    if (!id || !WorldDB.entities[id] || state.player.inventory.includes(id)) return null;
    state.player.inventory.push(id);
    if (state.world.entities[id]) state.world.entities[id].location = "inventory";
    const relic = WorldDB.entities[id];
    const curseMap = { blindness: "blinded", decay: "decaying", demon_host: "demon_host" };
    if (relic.curse && curseMap[relic.curse]) state.player.statuses[curseMap[relic.curse]] = true;
    return relic;
}
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
    return { phase: "CREATION_NAME", turn: 0, player: { name: null, fate: null, hp: 0, maxHp: 0, stats: { strength: 0, agility: 0, luck: 0, wisdom: 0, constitution: 0, charisma: 0, perception: 0, intelligence: 0 }, inventory: [], equipped: { weapon: null, helmet: null, armor: null, amulet: null }, summoned: [], bloodThirst: 0, location: db.startLocation, lastLocation: null, lastCombatKill: null, lastAttackerId: null, searchingCorpse: null, statuses: {}, reputation: 0, cleanseState: null }, creation: { tempName: null, tempFate: null }, world: { timeMinutes: db.settings.startingTimeMinutes || 490, discoveredLocations: db.startLocation ? [db.startLocation] : [], entities, relations: {}, facts: {}, eventLog: [], validation: [] }, ui: { lastOutput: null } };
}

function getEntityState(state, id) { return state.world.entities[id] || {}; }
function getCurrentLocation(state) { return WorldDB.locations[state.player.location]; }
function getVisibleEntityIds(state, locId = state.player.location) { return Object.entries(state.world.entities).filter(([, e]) => e.location === locId).map(([id]) => id).filter((id) => WorldDB.entities[id]); }
function getVisibleEntities(state, locId = state.player.location) { return getVisibleEntityIds(state, locId).map((id) => ({ id, ...WorldDB.entities[id], state: getEntityState(state, id) })); }
function entityMatches(entity, query) { const q = normalize(query); return q && [entity.id, entity.name, ...(entity.aliases || [])].map(normalize).some((name) => name === q || name.includes(q) || q.includes(name)); }
function getRelation(state, entityId) { return (state.world.relations[entityId] || 0) + Math.floor(state.player.reputation / 3); }
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
    if (["wear", "remove", "drop"].includes(parsed.verb.id)) {
        return { kind: "none", id: null, name: targetText, tags: [] };
    }
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
            next.player.stats = { strength: fate.stats.strength, agility: fate.stats.agility, luck: fate.stats.luck, wisdom: fate.stats.wisdom, constitution: fate.stats.constitution || 3, charisma: fate.stats.charisma || 2, perception: fate.stats.perception || 2, intelligence: fate.stats.intelligence || 2 };
            next.player.inventory = [...(fate.startingItems || [])]; next.player.reputation = fate.reputation || 0;
            const boneHunterStart = next.creation.tempFate === "bone_hunter" ? "bone_hunters_camp" : null;
            next.player.location = boneHunterStart || WorldDB.startLocation;
            next.player.lastLocation = next.player.location;
            next.phase = "GAME"; next.world.discoveredLocations = [next.player.location];
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
        if (state.player.equipped.weapon === "sealed_blade" && state.ui.lastOutput?.type !== "dice_result") {
            state.player.bloodThirst = (state.player.bloodThirst || 0) + 1;
        }
        if (state.player.bloodThirst >= 7 && state.player.equipped.weapon === "sealed_blade") {
            const targets = getVisibleEntities(state).filter((e) => ["npc", "monster"].includes(e.kind) && !e.state.isDead && e.id !== state.player.id);
            if (targets.length) {
                const aiData = {
                    bloodThirst: state.player.bloodThirst,
                    targets,
                    playerHp: state.player.hp,
                    playerMaxHp: state.player.maxHp,
                    lastAttackerId: state.player.lastAttackerId
                };
                const aiResult = evaluateAi("demon_blade", aiData);
                if (aiResult.action !== "stand_down" && aiResult.score > 0) {
                    const forced = aiResult.action === "attack_weakest"
                        ? targets.reduce((a, b) => ((a.state.hp ?? 999) < (b.state.hp ?? 999) ? a : b))
                        : aiResult.action === "attack_strongest"
                        ? targets.reduce((a, b) => ((a.damage || 0) > (b.damage || 0) ? a : b))
                        : aiResult.action === "attack_attacker" && targets.some(t => t.id === state.player.lastAttackerId)
                        ? (targets.find(t => t.id === state.player.lastAttackerId) || pick(targets))
                        : pick(targets);
                    state.player.bloodThirst = 2;
                    const d20 = Math.floor(Math.random() * 20) + 1;
                    const modifier = state.player.stats.strength || 1;
                    const dc = 12;
                    const total = d20 + modifier;
                    const success = total >= dc || d20 === 20;
                    const fakeDice = { d20, modifier, total, dc, grade: d20 === 20 ? "critical_success" : d20 === 1 ? "critical_failure" : success ? "success" : "failure", stat: "strength", formula: `[d20: ${d20}] + [Сила: ${modifier}] = ${total} vs ${dc}` };
                    const msg = "Демон выворачивает твою руку. Клинок сам находит цель! ";
                    if (success) {
                        const dmg = modifier + (d20 === 20 ? 8 : 4);
                        const eState = state.world.entities[forced.id];
                        eState.hp = Math.max(0, (eState.hp || forced.hp || 1) - dmg);
                        const repCh = forced.tags?.includes("guard") || forced.tags?.includes("peaceful_npc") ? -4 : forced.tags?.includes("raider") || forced.tags?.includes("beast") || forced.tags?.includes("undead") || forced.tags?.includes("hunter") ? 1 : -1;
                        state.player.reputation += repCh;
                        let t = msg + `${forced.name} получает ${dmg} урона.`;
                        if (eState.hp <= 0) { eState.isDead = true; state.player.lastCombatKill = forced.id; t += ` ${forced.name} падает замертво. Ты можешь обыскать тело.`; }
                        state.ui.lastOutput = { type: "dice_result", dice: fakeDice, text: t };
                    } else {
                        const enemyDmg = forced.damage || 2;
                        state.player.hp = Math.max(0, state.player.hp - (d20 === 1 ? enemyDmg * 2 : enemyDmg));
                        state.player.lastAttackerId = forced.id;
                        state.ui.lastOutput = { type: "dice_result", dice: fakeDice, text: msg + `Клинок промахивается, и ${forced.name} отвечает ударом.` };
                    }
                }
            }
        }
        if (state.player.location && !state.player.statuses.in_transit) {
            const curLoc = WorldDB.locations[state.player.location];
            const raidCount = Object.keys(state.world.facts).filter(k => k.startsWith("raid_")).length;
            const aiRaidData = {
                state,
                isNight: isNight(state),
                inDesert: curLoc?.tags?.includes("desert") && !curLoc?.tags?.includes("city"),
                inCity: curLoc?.tags?.includes("city"),
                playerInCamp: curLoc?.tags?.includes("camp"),
                hasRaidThisTurn: !!state.world.facts[`raid_${state.turn}`],
                raidCount,
                campDiscovered: state.world.discoveredLocations.includes("bone_hunters_camp"),
                playerHp: state.player.hp,
                playerMaxHp: state.player.maxHp,
                playerRep: state.player.reputation,
                playerFate: state.player.fate,
                inTransit: !!state.player.statuses.in_transit,
                headingToCamp: state.player.statuses.in_transit?.to === "bone_hunters_camp"
            };
            const raidResult = evaluateAi("raid", aiRaidData);
            if (raidResult.action !== "no_raid" && raidResult.score > 0) {
                state.world.facts[`raid_${state.turn}`] = true;
                if (raidResult.action === "spawn_scout") {
                    const scoutId = "raider_scout";
                    if (state.world.entities[scoutId] && state.world.entities[scoutId].location !== state.player.location) {
                        state.world.entities[scoutId].location = state.player.location;
                        state.world.entities[scoutId].isDead = false;
                        state.world.entities[scoutId].hp = WorldDB.entities[scoutId]?.hp || 20;
                    }
                    state.ui.lastOutput = { type: "warning", text: "Тень мелькнула между барханами. Тебя заметили." };
                } else if (raidResult.action === "spawn_raiders") {
                    const raiderIds = ["raider_scout", "raider_scout"];
                    raiderIds.forEach((id) => {
                        if (state.world.entities[id] && state.world.entities[id].location !== state.player.location) {
                            state.world.entities[id].location = state.player.location;
                            state.world.entities[id].isDead = false;
                            state.world.entities[id].hp = WorldDB.entities[id]?.hp || 20;
                        }
                    });
                    const isCamp = curLoc?.tags?.includes("camp");
                    state.ui.lastOutput = { type: "warning", text: isCamp ? "Крики и топот копыт со стороны пустыни. Костяные охотники ворвались в лагерь!" : "Из темноты доносятся голоса. Костяные охотники! Они рядом. Ты слышишь лязг металла и чей-то смех." };
                } else if (raidResult.action === "ambush_exit") {
                    const scoutId = "raider_scout";
                    if (state.world.entities[scoutId]) {
                        state.world.entities[scoutId].location = state.player.location;
                        state.world.entities[scoutId].isDead = false;
                        state.world.entities[scoutId].hp = WorldDB.entities[scoutId]?.hp || 20;
                    }
                    state.ui.lastOutput = { type: "warning", text: "Песок взрывается у твоих ног — засада! Кто-то ждал тебя здесь." };
                }
            }
        }
        const curLocTags = WorldDB.locations[state.player.location]?.tags || [];
        const isHoly = curLocTags.includes("holy");
        const hostileHere = getVisibleEntities(state).filter(e => ["npc", "monster"].includes(e.kind) && !e.state.isDead && (e.tags || []).some(t => ["hunter", "raider"].includes(t)));
        if (hostileHere.length && !state.player.statuses.in_transit && state.ui.lastOutput?.type !== "dice_result") {
            if (isHoly) {
                if (state.player.fate === "bone_hunter") {
                    const ally = pick(hostileHere);
                    state.world.relations[ally.id] = (state.world.relations[ally.id] || 0) + 1;
                }
            } else {
                const enemyHp = hostileHere[0].state.hp !== null ? (hostileHere[0].state.hp / (hostileHere[0].state.maxHp || hostileHere[0].hp || 1)) * 100 : 100;
                const aiHunterData = {
                    playerFate: state.player.fate, playerHp: state.player.hp, playerMaxHp: state.player.maxHp,
                    playerRep: state.player.reputation, hasSealedBlade: state.player.equipped.weapon === "sealed_blade",
                    hasItems: state.player.inventory.length > 0, hasBoneToken: state.player.inventory.includes("bone_token"),
                    isNight: isNight(state), justArrived: false, alreadyAmbushed: !!state.world.facts.camp_ambush_spawned,
                    hunterCount: hostileHere.length, threatCount: getVisibleEntities(state).filter(e => !e.state.isDead && !(e.tags || []).some(t => ["hunter", "raider"].includes(t))).length,
                    hunterHp: enemyHp, hunterMaxHp: 100, inDesert: curLocTags.includes("desert")
                };
                const huntResult = evaluateAi("bone_hunter", aiHunterData);
                if (huntResult.action === "attack" && huntResult.score > 0) {
                    const attacker = pick(hostileHere);
                    const dmg = attacker.damage || 3;
                    state.player.hp = Math.max(0, state.player.hp - dmg);
                    state.player.lastAttackerId = attacker.id;
                    const enemyName = attacker.aliases?.[0] || attacker.name;
                    state.ui.lastOutput = { type: "warning", text: `${enemyName} бросается на тебя! ${dmg > 5 ? "Удар сокрушительный. " : ""}Ты теряешь ${dmg} HP.` };
                } else if (huntResult.action === "flee" && huntResult.score > 0) {
                    const fleeing = pick(hostileHere);
                    fleeing.state.location = null;
                    state.ui.lastOutput = { type: "info", text: `${fleeing.aliases?.[0] || fleeing.name} скрывается в пустыне, получив отпор.` };
                } else if (huntResult.action === "demand_toll" && huntResult.score > 0) {
                    if (state.ui.lastOutput?.type !== "dice_result") {
                        state.ui.lastOutput = { type: "info", text: `Костяной охотник преграждает путь: «Плати за проход, чужак.»` };
                    }
                }
            }
        }
        if (state.player.bloodThirst >= 5 && state.player.equipped.weapon === "sealed_blade") {
            state.player.hp = Math.max(0, state.player.hp - 2);
            const msg = state.player.bloodThirst >= 8 ? "Демон в клинке заставляет тебя сжать рукоять так, что кости трещат. Кровь сочится из-под пальцев." : "Демон в клинке ворочается и шепчет: кровь. дай мне кровь.";
            if (state.ui.lastOutput) state.ui.lastOutput.text = (state.ui.lastOutput.text || "") + " " + msg;
        }
        if (state.player.statuses.decaying && state.ui.lastOutput?.type === "dice_result") {
            const grade = state.ui.lastOutput?.dice?.grade;
            if (grade === "failure" || grade === "critical_failure") {
                state.player.hp = Math.max(0, state.player.hp - 5);
                state.ui.lastOutput.text = (state.ui.lastOutput.text || "") + " Проклятие разложения высасывает жизнь: -5 HP.";
            }
        }
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
    if (command === "restart" && state.phase === "GAME_OVER") {
        state.phase = "CREATION_NAME";
        state.creation = { tempName: null, tempFate: null };
        state.ui.lastOutput = { type: "creation_restart" };
        return state;
    }
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceWorldAction(state, payload) {
    const { parsed, target, rule, dice } = payload;
    const verbId = parsed.verb.id;
    if (verbId === "examine") return reduceExamine(state, target);
    if (verbId === "move") return reduceMove(state, target, rule, dice, payload.transitId);
    if (verbId === "take") return reduceTake(state, target, rule, dice, parsed);
    if (verbId === "talk") return reduceTalk(state, target);
    if (["threaten"].includes(verbId)) return reduceSocialRoll(state, target, rule, dice, verbId);
    if (verbId === "steal") return reduceSteal(state, target, rule, dice);
    if (verbId === "gamble") return reduceGamble(state, target, rule, dice);
    if (verbId === "attack") return reduceAttack(state, target, rule, dice);
    if (verbId === "flee") return reduceFlee(state, rule, dice);
    if (verbId === "search") return reduceSearch(state, target, rule, dice);
    if (verbId === "wear") return reduceWear(state, parsed);
    if (verbId === "remove") return reduceRemove(state, parsed);
    if (verbId === "drop") return reduceDrop(state, parsed);
    if (verbId === "sell") return reduceSell(state, target, rule, dice, parsed);
    if (verbId === "cleanse") return reduceCleanse(state, target, rule, dice, parsed);
    if (verbId === "buy") return reduceBuy(state, target, rule, dice, parsed);
    if (verbId === "experiment") return reduceExperiment(state, target, rule, dice);
    if (verbId === "rest") return reduceRest(state);
    if (verbId === "open") return reduceOpen(state, target, rule, dice);
    state.ui.lastOutput = { type: "info", text: "Действие пока не имеет обработчика." };
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceRest(state) {
    const loc = getCurrentLocation(state);
    const safe = (loc.tags || []).some(t => ["city", "holy", "camp", "safe", "tavern"].includes(t));
    if (!safe) { state.ui.lastOutput = { type: "warning", text: "В пустыне нет места для отдыха. Песок не даст тебе забыться." }; return tick(state, 0); }
    const heal = (state.player.stats.constitution || 1) * 2 + Math.floor(Math.random() * 4);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
    state.ui.lastOutput = { type: "success", text: `Ты садишься у стены и закрываешь глаза. Время течёт мимо. ${heal > 0 ? `+${heal} HP.` : "Отдых не приносит облегчения."}` };
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
function reduceTake(state, target, rule, dice, parsed) {
    if (state.player.searchingCorpse) {
        const corpseId = state.player.searchingCorpse;
        const corpseEntity = WorldDB.entities[corpseId];
        const eState = getEntityState(state, corpseId);
        if (!corpseEntity || !eState.isDead) { state.player.searchingCorpse = null; }
        else {
            const availableLoot = (corpseEntity.loot || []).filter((id) => WorldDB.entities[id] && !state.player.inventory.includes(id));
            if (!availableLoot.length) {
                state.player.searchingCorpse = null;
                state.ui.lastOutput = { type: "info", text: `С трупа ${corpseEntity.name} больше нечего взять.` };
                return tick(state, 0);
            }
            const q = normalize(parsed?.targetText || "");
            if (q === "всё" || q === "все") {
                availableLoot.forEach((id) => { state.player.inventory.push(id); if (state.world.entities[id]) state.world.entities[id].location = "inventory"; });
                state.player.searchingCorpse = null;
                const cursed = applyCursedRelic(state, corpseEntity);
                let text = `Взято всё: ${availableLoot.map((id) => WorldDB.entities[id].name).join(", ")}.`;
                if (cursed) text += ` Среди вещей ты находишь: ${cursed.name}.`;
                state.ui.lastOutput = { type: "success", text };
                return tick(state, WorldDB.settings.turnMinutes);
            }
            const num = parseInt(q, 10);
            const matched = num >= 1 && num <= availableLoot.length
                ? availableLoot[num - 1]
                : availableLoot.find((id) => {
                      const ent = WorldDB.entities[id];
                      return ent && [ent.id, ent.name, ...(ent.aliases || [])].map(normalize).some((n) => n === q || n.includes(q) || q.includes(n));
                  });
            if (!matched) {
                const lootList = availableLoot.map((id, i) => `${i + 1}. ${WorldDB.entities[id].name}`).join("; ");
                state.ui.lastOutput = { type: "warning", text: `На теле ${corpseEntity.name}: ${lootList}. Напиши номер или название.` };
                return tick(state, 0);
            }
            state.player.inventory.push(matched);
            if (state.world.entities[matched]) state.world.entities[matched].location = "inventory";
            const remaining = availableLoot.filter((id) => id !== matched);
            state.player.searchingCorpse = remaining.length ? corpseId : null;
            const cursed = applyCursedRelic(state, corpseEntity);
            let text = `Взято: ${WorldDB.entities[matched]?.name || matched}.`;
            if (cursed) text += ` Среди вещей ты находишь: ${cursed.name}.`;
            state.ui.lastOutput = { type: "success", text };
            return tick(state, WorldDB.settings.turnMinutes);
        }
    }
    if (target.kind === "none") { state.ui.lastOutput = { type: "hint", text: "Что взять?" }; return tick(state, 0); }
    if (target.kind !== "item") { state.ui.lastOutput = { type: "warning", text: `${target.name} не выглядит предметом, который можно просто забрать.` }; return tick(state, WorldDB.settings.turnMinutes); }
    if (dice && ["failure", "critical_failure"].includes(dice.grade)) { const damage = dice.grade === "critical_failure" ? 4 : 1; state.player.hp = Math.max(0, state.player.hp - damage); state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText} Ты теряешь ${damage} HP.` }; return tick(state, WorldDB.settings.turnMinutes); }
    state.player.inventory.push(target.id); state.world.entities[target.id].location = "inventory"; state.ui.lastOutput = { type: "success", text: `${rule?.successText || "Взято"}: ${target.name}.` };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceTalk(state, target) {
    if (!target.id) { state.ui.lastOutput = { type: "hint", text: "С кем говорить?" }; return tick(state, 0); }
    const entity = WorldDB.entities[target.id];
    if (state.player.fate === "forbidden_blade_keeper" && (entity.tags || []).some(t => ["guard", "merchant", "peaceful_npc"].includes(t))) {
        state.ui.lastOutput = { type: "dialogue", entityId: target.id, stage: "hostile", text: `${entity.name} отворачивается, едва взглянув на тебя. «С таким, как ты, говорят только клинком.»`, whisper: null };
        return tick(state, WorldDB.settings.turnMinutes);
    }
    const relation = getRelation(state, target.id);
    const stage = relation <= -2 ? "hostile" : relation >= 2 ? "warm" : "closed";
    const line = pick(entity.dialogue?.[stage]) || pick(entity.dialogue?.closed) || `${entity.name} молчит.`;
    state.world.relations[target.id] = (state.world.relations[target.id] || 0) + 1;
    const demonInBlade = state.player.equipped.weapon === "sealed_blade" && state.player.bloodThirst >= 3;
    const whisper = (state.player.statuses.demon_host || state.player.statuses.one_eye || demonInBlade) && Math.random() < 0.15 ? pick(DemonWhispers.concat(state.player.statuses.one_eye ? OneEyeWhispers : [])) : null;
    state.ui.lastOutput = { type: "dialogue", entityId: target.id, stage, text: line, whisper };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceSocialRoll(state, target, rule, dice, verbId) {
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    const delta = success ? (dice.grade === "critical_success" ? 2 : 1) : -1;
    state.world.relations[target.id] = (state.world.relations[target.id] || 0) + delta;
    if (verbId === "threaten") state.player.reputation -= success ? 1 : 2;
    state.ui.lastOutput = { type: "dice_result", dice, text: success ? rule.successText : rule.failureText };
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceSteal(state, target, rule, dice) {
    const entity = WorldDB.entities[target.id];
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    state.player.reputation -= success ? 1 : 3;
    state.world.relations[target.id] = (state.world.relations[target.id] || 0) + (success ? -1 : -3);
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
    let entity = WorldDB.entities[target.id];
    let eState = state.world.entities[target.id];
    if (state.player.equipped.weapon === "sealed_blade") state.player.bloodThirst = 0;
    if (target.tags?.includes("homunculus_master")) {
        const homunculusIds = ["lion_of_saara", "bronze_bull", "meat_slave"];
        const alive = homunculusIds.filter((id) => { const es = state.world.entities[id]; return es && es.location === state.player.location && !es.isDead; });
        if (alive.length) {
            const aiData = {
                alive,
                attackerDamage: state.player.stats?.strength || 1,
                attackerTags: target.tags || [],
                attackerDamageType: target.entity?.damageType || "physical",
                homunculusHp: Object.fromEntries(alive.map(id => [id, state.world.entities[id]?.hp !== null ? (state.world.entities[id].hp / (WorldDB.entities[id]?.hp || 1)) * 100 : 0])),
                alchemistHp: eState?.hp !== null ? (eState.hp / (WorldDB.entities[target.id]?.hp || 1)) * 100 : 0,
                playerHasSealedBlade: state.player.equipped.weapon === "sealed_blade"
            };
            const aiResult = evaluateAi("homunculus", aiData);
            const protector = aiResult.action !== "all_three" && aiResult.score > 0
                ? aiResult.action
                : pick(alive);
            entity = WorldDB.entities[protector];
            eState = state.world.entities[protector];
            target = { id: protector, kind: "monster", name: entity.name, tags: entity.tags || [], entity };
            state.ui.lastOutput = { type: "warning", text: `${entity.name} встаёт на пути твоего удара, принимая его на себя!` };
        }
    }
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    if (success) {
        const damage = (state.player.stats.strength || 1) + (dice.grade === "critical_success" ? 8 : 4);
        eState.hp = Math.max(0, (eState.hp || entity.hp || 1) - damage);
        const repChange = target.tags.includes("guard") || target.tags.includes("peaceful_npc") ? -4 : target.tags.includes("raider") || target.tags.includes("beast") || target.tags.includes("undead") || target.tags.includes("hostile") || target.tags.includes("hunter") ? 1 : -1;
        state.player.reputation += repChange;
        let text = `${rule.successText} ${entity.name} получает ${damage} урона.`;
        if (eState.hp <= 0) {
            eState.isDead = true;
            state.player.lastCombatKill = target.id;
            text += ` ${entity.name} падает и больше не поднимается. Ты можешь обыскать тело.`;
        }
        state.ui.lastOutput = { type: "dice_result", dice, text };
    } else {
        const enemyDamage = entity.damage || 2;
        const damage = dice?.grade === "critical_failure" ? enemyDamage * 2 : enemyDamage;
        const dType = entity.damageType || "physical";
        const resisted = entity.resistances && entity.resistances[dType];
        const finalDamage = resisted ? Math.max(1, Math.floor(damage / 2)) : damage;
        state.player.hp = Math.max(0, state.player.hp - finalDamage);
        state.player.lastAttackerId = target.id;
        const resistText = resisted ? " (сопротивление снижает урон вдвое)" : "";
        state.ui.lastOutput = { type: "dice_result", dice, text: `${dice?.grade === "critical_failure" ? rule.criticalFailureText : rule.failureText} ${entity.name} отвечает ${dType === "fire" ? "огнём" : dType === "poison" ? "ядом" : "ударом"}. Ты теряешь ${finalDamage} HP${resistText}.` };
    }
    return tick(state, WorldDB.settings.turnMinutes);
}
function reduceFlee(state, rule, dice) {
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    state.player.reputation -= 2;
    if (state.player.lastLocation && WorldDB.locations[state.player.lastLocation]) {
        state.player.location = state.player.lastLocation;
    }
    const damage = success ? 0 : (dice?.grade === "critical_failure" ? 4 : 2);
    state.player.hp = Math.max(0, state.player.hp - damage);
    const text = success ? `${rule.successText} Ты возвращаешься туда, откуда пришёл. Репутация падает.` : `${rule.failureText} Ты получаешь ${damage} HP урона, но всё же вырываешься. Репутация падает.`;
    state.ui.lastOutput = { type: "dice_result", dice, text };
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceSearch(state, target, rule, dice) {
    if (target.kind === "none") { state.ui.lastOutput = { type: "hint", text: "Кого обыскать?" }; return tick(state, 0); }
    const eState = getEntityState(state, target.id);
    if (!eState.isDead) { state.ui.lastOutput = { type: "warning", text: `${target.name} ещё жив. Обыскивают только мёртвых.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const entity = WorldDB.entities[target.id];
    if (target.tags.includes("homunculus")) { state.ui.lastOutput = { type: "warning", text: `Гомункул рассыпается в пепел, не оставив ничего ценного.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const availableLoot = (entity.loot || []).filter((id) => WorldDB.entities[id] && !state.player.inventory.includes(id));
    if (!availableLoot.length) {
        const cursed = applyCursedRelic(state, entity);
        if (cursed) {
            state.ui.lastOutput = { type: "success", text: `${rule.successText} Среди тряпья ты находишь: ${cursed.name}.` };
            return tick(state, WorldDB.settings.turnMinutes);
        }
        state.ui.lastOutput = { type: "info", text: `Тело ${entity.name} не хранит ничего ценного.` };
        return tick(state, WorldDB.settings.turnMinutes);
    }
    state.player.searchingCorpse = target.id;
    const lootList = availableLoot.map((id, i) => `${i + 1}. ${WorldDB.entities[id].name}`).join("; ");
    state.ui.lastOutput = { type: "info", text: `Ты приседаешь над телом ${entity.name}. На теле: ${lootList}. Напиши "взять [номер или название]" или "взять всё".` };
    return tick(state, 0);
}

const SlotMap = { weapon: "weapon", helmet: "helmet", armor: "armor", amulet: "amulet", charm: "amulet" };
function getSlot(itemTags) { for (const tag of itemTags) { if (SlotMap[tag]) return SlotMap[tag]; } return null; }

function findInventoryItem(state, query) {
    const q = normalize(query);
    if (!q) return null;
    return state.player.inventory.find((id) => {
        const ent = WorldDB.entities[id];
        return ent && [ent.id, ent.name, ...(ent.aliases || [])].map(normalize).some((n) => n === q || n.includes(q) || q.includes(n));
    }) || null;
}

function reduceWear(state, parsed) {
    const itemId = findInventoryItem(state, parsed.targetText);
    if (!itemId) { state.ui.lastOutput = { type: "error", text: `У тебя нет "${parsed.targetText}" в инвентаре.` }; return tick(state, 0); }
    const entity = WorldDB.entities[itemId];
    const slot = getSlot(entity.tags || []);
    if (!slot) { state.ui.lastOutput = { type: "warning", text: `${entity.name} нельзя экипировать.` }; return tick(state, WorldDB.settings.turnMinutes); }
    if (state.player.fate === "forbidden_blade_keeper") {
        if (slot === "weapon" && itemId !== "sealed_blade") {
            state.ui.lastOutput = { type: "warning", text: `Ты не можешь взять в руку другое оружие — клинок в твоей груди не отпустит.` }; return tick(state, WorldDB.settings.turnMinutes);
        }
        if (slot === "armor") {
            state.ui.lastOutput = { type: "warning", text: `Твоя одежда пропитана кровью клинка. Броня будет только мешать.` }; return tick(state, WorldDB.settings.turnMinutes);
        }
    }
    if (itemId === "sealed_blade" && state.player.equipped.weapon && state.player.equipped.weapon !== "sealed_blade") {
        state.ui.lastOutput = { type: "warning", text: `Демонический клинок не потерпит соседства другого оружия.` }; return tick(state, WorldDB.settings.turnMinutes);
    }
    if (state.player.equipped[slot] === itemId) { state.ui.lastOutput = { type: "info", text: `${entity.name} уже надет.` }; return tick(state, 0); }
    if (state.player.equipped[slot]) {
        const oldId = state.player.equipped[slot];
        const oldEnt = WorldDB.entities[oldId];
        if (oldEnt?.statBonuses) Object.entries(oldEnt.statBonuses).forEach(([stat, val]) => { state.player.stats[stat] = Math.max(0, (state.player.stats[stat] || 0) - val); });
        state.player.inventory.push(oldId);
    }
    state.player.equipped[slot] = itemId;
    if (entity.statBonuses) Object.entries(entity.statBonuses).forEach(([stat, val]) => { state.player.stats[stat] = (state.player.stats[stat] || 0) + val; });
    state.player.inventory = state.player.inventory.filter((id) => id !== itemId);
    const bonusText = entity.statBonuses ? ` ${Object.entries(entity.statBonuses).map(([s, v]) => `${StatLabels[s] || s} ${signed(v)}`).join(", ")}` : "";
    state.ui.lastOutput = { type: "success", text: `${entity.name} надет${slot === "weapon" ? " в руку" : slot === "armor" ? " на тело" : slot === "helmet" ? " на голову" : " на шею"}.${bonusText}` };
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceRemove(state, parsed) {
    const q = normalize(parsed.targetText);
    const slotKey = Object.keys(SlotMap).find((s) => q.includes(s) || s.includes(q));
    let targetSlot = slotKey ? SlotMap[slotKey] : null;
    if (!targetSlot) {
        const entry = Object.entries(state.player.equipped).find(([, id]) => {
            if (!id) return false;
            const ent = WorldDB.entities[id];
            return ent && [ent.id, ent.name, ...(ent.aliases || [])].map(normalize).some((n) => n === q || n.includes(q) || q.includes(n));
        });
        if (entry) targetSlot = entry[0];
    }
    if (!targetSlot) targetSlot = Object.keys(state.player.equipped).find((s) => q.includes(s) || s.includes(q));
    if (!targetSlot || !state.player.equipped[targetSlot]) { state.ui.lastOutput = { type: "warning", text: `У тебя ничего не надето в этот слот.` }; return tick(state, 0); }
    const itemId = state.player.equipped[targetSlot];
    if (itemId === "sealed_blade" && state.player.fate === "forbidden_blade_keeper") {
        state.ui.lastOutput = { type: "warning", text: `Клинок не отпускает руку. Ты пытаешься разжать пальцы — бесполезно.` }; return tick(state, WorldDB.settings.turnMinutes);
    }
    const oldEnt = WorldDB.entities[itemId];
    if (oldEnt?.statBonuses) Object.entries(oldEnt.statBonuses).forEach(([stat, val]) => { state.player.stats[stat] = Math.max(0, (state.player.stats[stat] || 0) - val); });
    state.player.inventory.push(itemId);
    const name = WorldDB.entities[itemId]?.name || itemId;
    state.player.equipped[targetSlot] = null;
    state.ui.lastOutput = { type: "success", text: `${name} снят${targetSlot === "weapon" ? " из руки" : targetSlot === "armor" ? " с тела" : targetSlot === "helmet" ? " с головы" : " с шеи"}.` };
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceDrop(state, parsed) {
    const itemId = findInventoryItem(state, parsed.targetText);
    if (!itemId) { state.ui.lastOutput = { type: "error", text: `У тебя нет "${parsed.targetText}" в инвентаре.` }; return tick(state, 0); }
    const name = WorldDB.entities[itemId]?.name || itemId;
    if (WorldDB.entities[itemId]?.tags?.includes("cursed")) {
        state.ui.lastOutput = { type: "warning", text: `${name} исчезает в песке, но проклятие остаётся с тобой. Ты всё ещё чувствуешь его вес.` };
        state.player.inventory = state.player.inventory.filter((id) => id !== itemId);
        return tick(state, WorldDB.settings.turnMinutes);
    }
    state.player.inventory = state.player.inventory.filter((id) => id !== itemId);
    if (state.world.entities[itemId]) state.world.entities[itemId].location = state.player.location;
    state.ui.lastOutput = { type: "success", text: `${name} выброшен.` };
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceSell(state, target, rule, dice, parsed) {
    const isMerchant = target.tags?.includes("merchant");
    if (!isMerchant) { state.ui.lastOutput = { type: "warning", text: `${target.name} не торгует.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const tokens = parsed.targetText.split(/\s+/);
    const itemName = tokens.slice(0, -1).join(" ") || tokens[0];
    const itemId = findInventoryItem(state, itemName);
    if (!itemId) { state.ui.lastOutput = { type: "error", text: `У тебя нет "${itemName}" для продажи.` }; return tick(state, 0); }
    const success = dice ? ["success", "critical_success"].includes(dice.grade) : state.player.reputation >= 2;
    const repRequirement = state.player.reputation < 2;
    if (!success && repRequirement) { state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText} Твоя репутация слишком низка для торга.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const item = WorldDB.entities[itemId];
    const price = (state.player.stats.charisma || 1) + (dice?.grade === "critical_success" ? 3 : 1);
    state.player.inventory = state.player.inventory.filter((id) => id !== itemId);
    state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.successText} ${item?.name || itemId} продан${item?.tags?.includes("fate_item") ? ". Ты пожалеешь об этом." : ` за ${price} песчаных монет.`}` };
    return tick(state, WorldDB.settings.turnMinutes);
}

const CurseList = ["blinded", "decaying", "demon_host"];
function reduceCleanse(state, target, rule, dice, parsed) {
    const isHealer = target.tags?.includes("mystic") || target.tags?.includes("healer") || target.tags?.includes("alchemist");
    if (!isHealer) { state.ui.lastOutput = { type: "warning", text: `${target.name} не занимается очищением.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const activeCurses = CurseList.filter((c) => state.player.statuses[c]);
    if (!activeCurses.length) { state.ui.lastOutput = { type: "info", text: `${target.name} всматривается в тебя: «На тебе нет проклятий, путник. Или ты пришёл не за тем.»` }; state.player.cleanseState = null; return tick(state, WorldDB.settings.turnMinutes); }
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    if (!success) { state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText} Отшельник опускает голову: «Твоя вера слаба. Возвращайся, когда будешь готов отдать по-настоящему.»` }; state.player.cleanseState = null; return tick(state, WorldDB.settings.turnMinutes); }
    if (state.player.cleanseState === "awaiting_sacrifice") {
        const choice = normalize(parsed.targetText);
        if (choice === "предмет" || choice === "вещь") {
            const tradeItems = state.player.inventory.filter((id) => { const e = WorldDB.entities[id]; return e && !e.tags?.includes("fate_item") && !e.tags?.includes("cursed"); });
            if (!tradeItems.length) { state.ui.lastOutput = { type: "warning", text: "У тебя нет подходящих вещей для жертвы." }; return tick(state, 0); }
            const lost = pick(tradeItems);
            state.player.inventory = state.player.inventory.filter((id) => id !== lost);
            const name = WorldDB.entities[lost]?.name || lost;
            activeCurses.forEach((c) => delete state.player.statuses[c]);
            state.player.cleanseState = null;
            state.ui.lastOutput = { type: "success", text: `Отшельник берёт ${name} и бросает в чашу. Предмет шипит и чернеет. Проклятие спадает.` };
            return tick(state, WorldDB.settings.turnMinutes);
        }
        if (choice === "здоровье" || choice === "жизнь" || choice === "хп") {
            const loss = 5;
            state.player.maxHp = Math.max(1, state.player.maxHp - loss);
            state.player.hp = Math.min(state.player.hp, state.player.maxHp);
            activeCurses.forEach((c) => delete state.player.statuses[c]);
            state.player.cleanseState = null;
            state.ui.lastOutput = { type: "success", text: `Отшельник проводит рукой по твоей груди. Ты чувствуешь, как что-то внутри рвётся. −${loss} к макс. HP. Проклятие спадает.` };
            return tick(state, WorldDB.settings.turnMinutes);
        }
        if (choice === "глаз") {
            state.player.statuses.one_eye = true;
            state.player.stats.perception = Math.max(1, (state.player.stats.perception || 3) - 2);
            activeCurses.forEach((c) => delete state.player.statuses[c]);
            state.player.cleanseState = null;
            state.ui.lastOutput = { type: "success", text: `Отшельник касается твоего лица. Боль вспышкой — и один глаз больше не видит. «Теперь во тьме поселился новый гость», — шепчет он. Проклятие спадает, но ты чувствуешь, что внутри тебя теперь не пусто.»` };
            return tick(state, WorldDB.settings.turnMinutes);
        }
        state.ui.lastOutput = { type: "info", text: `Выбери жертву: предмет, здоровье или глаз. Напиши "очиститься предмет/здоровье/глаз".` };
        return tick(state, 0);
    }
    state.player.cleanseState = "awaiting_sacrifice";
    const curseText = activeCurses.map((c) => CurseLabels[c] || c).join(", ");
    state.ui.lastOutput = { type: "dialogue", entityId: target.id, stage: "closed", text: `«Я вижу на тебе: ${curseText}. Проклятие не уходит просто так. Отдай мне что-то: вещь, часть здоровья или глаз. Тогда тьма отпустит.»`, whisper: null };
    return tick(state, WorldDB.settings.turnMinutes);
}

const HomunculusCatalog = {
    "лев": { id: "lion_of_saara", label: "Лев Саара", role: "guardian", desc: "заменит одного из гомункулов алхимика и будет защищать тебя" },
    "бык": { id: "bronze_bull", label: "Бронзовый Бык", role: "assault", desc: "будет сражаться рядом с тобой, круша врагов" },
    "раб": { id: "meat_slave", label: "Мясной Раб", role: "carrier", desc: "будет носить твой груз, увеличивая вместимость инвентаря" }
};
function reduceBuy(state, target, rule, dice, parsed) {
    if (!target.tags?.includes("homunculus_master")) { state.ui.lastOutput = { type: "warning", text: `${target.name} ничего не продаёт.` }; return tick(state, WorldDB.settings.turnMinutes); }
    if (state.player.fate === "forbidden_blade_keeper" && state.player.equipped.weapon === "sealed_blade") { state.ui.lastOutput = { type: "warning", text: "Демон в клинке сжимается от гнева: «Никаких тварей рядом со мной.» Алхимик понимающе кивает и убирает руку с клетки." }; return tick(state, WorldDB.settings.turnMinutes); }
    if (state.player.summoned.length >= 2) { state.ui.lastOutput = { type: "warning", text: "Ты уже не можешь контролировать столько гомункулов. Отпусти одного, прежде чем брать нового." }; return tick(state, WorldDB.settings.turnMinutes); }
    const q = normalize(parsed.targetText);
    const entry = Object.values(HomunculusCatalog).find((h) => q.includes(h.label.toLowerCase().slice(0, 4)) || h.id.includes(q));
    if (!entry) {
        const list = Object.values(HomunculusCatalog).map((h) => `${h.label} (${h.role}) — ${h.desc}`).join("; ");
        state.ui.lastOutput = { type: "info", text: `Алхимик обводит рукой клетки: «Выбирай. ${list}» Напиши "купить [имя]".` };
        return tick(state, 0);
    }
    if (state.player.summoned.includes(entry.id)) { state.ui.lastOutput = { type: "warning", text: `У тебя уже есть ${entry.label}.` }; return tick(state, WorldDB.settings.turnMinutes); }
    state.player.summoned.push(entry.id);
    state.ui.lastOutput = { type: "success", text: `Алхимик открывает клетку. ${entry.label} выходит и садится у твоих ног. Ты чувствуешь новую связь — тяжёлую, тёплую, живую.` };
    if (entry.role === "carrier") state.ui.lastOutput.text += " Твой инвентарь расширен.";
    return tick(state, WorldDB.settings.turnMinutes);
}

function reduceExperiment(state, target, rule, dice) {
    if (!target.tags?.includes("alchemist")) { state.ui.lastOutput = { type: "warning", text: `${target.name} не проводит экспериментов.` }; return tick(state, WorldDB.settings.turnMinutes); }
    const success = dice && ["success", "critical_success"].includes(dice.grade);
    if (!success) { state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.failureText} Алхимик отпускает твою руку: «Слишком слабый материал. Приходи, когда накопишь сил.»` }; return tick(state, WorldDB.settings.turnMinutes); }
    const roll = Math.random();
    if (roll < 0.4) {
        state.player.statuses.two_pupil_eye = true;
        state.player.stats.perception = Math.min(10, (state.player.stats.perception || 3) + 2);
        state.player.stats.charisma = Math.max(1, (state.player.stats.charisma || 2) - 1);
        state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.successText} Ты просыпаешься с дикой болью в глазу. В зеркале ты видишь — зрачков два. Ты видишь то, чего не замечал раньше. +2 Восприятие, −1 Харизма.` };
    } else if (roll < 0.7) {
        state.player.statuses.diseased = true;
        state.player.stats.constitution = Math.max(1, (state.player.stats.constitution || 3) - 2);
        state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.successText} Ты просыпаешься в поту. Тело ломит. Алхимик смотрит на тебя с интересом: «Реакция нестандартная. Ты подхватил что-то интересное.» −2 Телосложение (болезнь).` };
    } else {
        const cursePool = ["blinded", "decaying", "demon_host"];
        const curse = pick(cursePool);
        state.player.statuses[curse] = true;
        const label = CurseLabels[curse] || curse;
        state.ui.lastOutput = { type: "dice_result", dice, text: `${rule.successText} Ты просыпаешься и чувствуешь, что внутри тебя что-то изменилось. Алхимик стоит у изголовья: «Побочный эффект. Не смертельный. Почти.» Ты получаешь проклятие: ${label}.` };
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
    state.player.lastLocation = state.player.location;
    state.player.location = transit.to;
    delete state.player.statuses.in_transit;
    if (transit.to === "bone_hunters_camp" && state.player.fate !== "bone_hunter" && !state.world.facts.camp_ambush_spawned) {
        state.world.facts.camp_ambush_spawned = true;
        state.world.relations["bone_hunter_captain"] = -10;
        state.player.reputation -= 2;
        state.ui.lastOutput = { type: "warning", text: "Едва ты входишь в лагерь, как костяные охотники хватаются за оружие. «Чужак!» — кричит кто-то. Воздух звенит от натянутых тетив." };
    }
    if (!state.world.discoveredLocations.includes(transit.to)) state.world.discoveredLocations.push(transit.to);
    state.world.timeMinutes += transit.timeCostMinutes || 20;
    state.turn += 1;
    state.ui.lastOutput = { type: "success", text: `Переход завершён. Песок отпускает ноги у места: ${transit.label}. Окружение обновлено справа.` };
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
        if (parsed.verb.id === "take" && state.player.searchingCorpse) {
            const next = cloneState(state);
            next.ui.lastOutput = null;
            const result = reducer(next, { type: "WORLD_ACTION", payload: { parsed, target: { kind: "corpse_item", id: null, name: parsed.targetText, tags: [] }, rule: null, dice: null } });
            this.scheduleIfNeeded(result);
            return result;
        }
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
    if (!state || !WorldDB) return [];
    if (state.phase === "GAME_OVER") return ["заново", "рестарт"];
    const loc = getCurrentLocation(state);
    const commands = ["инвентарь", "статус", "карта", "помощь", "validate_world"];
    if (!state.player.statuses.in_transit) {
        (loc.exits || []).forEach((exit) => commands.push(`идти ${exit.label || exit.target}`));
        getVisibleEntities(state).forEach((entity) => {
            const name = entity.aliases?.[0] || entity.name;
            commands.push(`изучить ${name}`);
            if (entity.kind === "item") commands.push(`взять ${name}`);
            if (["npc", "monster"].includes(entity.kind)) {
                commands.push(`говорить ${name}`, `атаковать ${name}`);
                if (entity.kind === "npc") commands.push(`обокрасть ${name}`);
                if (getVisibleEntities(state).some((e) => ["npc", "monster"].includes(e.kind) && !e.state.isDead && (e.tags || []).some(t => ["raider", "hunter", "hostile", "beast", "undead"].includes(t)))) commands.push(`сбежать`);
                if ((entity.tags || []).includes("gambler")) commands.push(`играть ${name}`);
                if (entity.tags?.includes("merchant")) commands.push(`продать [предмет] ${name}`);
                if (entity.tags?.some((t) => ["mystic", "healer", "alchemist"].includes(t))) commands.push(`очиститься ${name}`);
                if (entity.tags?.includes("homunculus_master")) { commands.push(`купить ${name}`); commands.push(`эксперимент ${name}`); }
            }
            if (entity.state?.isDead) commands.push(`обыскать ${name}`);
        });
        if (state.player.inventory.length || Object.values(state.player.equipped).some(Boolean)) {
            commands.push("выбросить [предмет]", "надеть [предмет]");
            Object.entries(state.player.equipped).forEach(([slot, id]) => {
                if (id) commands.push(`снять ${WorldDB.entities[id]?.name || id}`);
            });
        }
        if (state.player.searchingCorpse) {
            const corpseEntity = WorldDB.entities[state.player.searchingCorpse];
            const eState = getEntityState(state, state.player.searchingCorpse);
            if (corpseEntity && eState.isDead) {
                const loot = (corpseEntity.loot || []).filter(id => WorldDB.entities[id] && !state.player.inventory.includes(id));
                loot.forEach((id) => commands.push(`взять ${WorldDB.entities[id]?.name || id}`));
                if (loot.length > 1) commands.push("взять всё");
            } else {
                state.player.searchingCorpse = null;
            }
        }
        const curLocTags = getCurrentLocation(state).tags || [];
        if (curLocTags.some(t => ["city", "holy", "camp", "safe", "tavern"].includes(t))) commands.push("отдохнуть");
    } else {
        commands.push("статус", "помощь");
    }
    return [...new Set(commands)];
}

const Renderer = {
    outputEl: null,
    hintEl: null,
    devStateEl: null,
    environmentEl: null,
    init(outputEl, hintEl, devStateEl, environmentEl) { this.outputEl = outputEl; this.hintEl = hintEl; this.devStateEl = devStateEl; this.environmentEl = environmentEl; },
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
        this.print(`<div class="welcome-screen"><p class="game-title">${escapeHtml(db.title)}</p><p class="game-subtitle">${escapeHtml(db.subtitle)}</p><p class="game-version">${escapeHtml(db.version)}</p><br><p class="welcome-text">Агерут дышит жаром, песком и недоверием.</p><p class="welcome-text">Все истории, локации, сущности и матрицы действий загружены из папки <span class="cmd-example">world/</span>.</p><br><p class="system-msg">═══ ПРОБУЖДЕНИЕ У ЮЖНЫХ ВОРОТ ═══</p><p>Ты стоишь перед городом, который не обещает спасения. Назови имя, под которым тебя запомнят стражники, торговцы и мёртвые под песком.</p><p class="hint-msg">Tab — автодополнение, ↑/↓ — история, команда validate_world — проверка JSON-связей.</p><p class="hint-msg">Введи имя персонажа:</p></div>`);
    },
    renderLoadError(error) { this.print(`<p class="error-msg">Не удалось загрузить мир из JSON: ${escapeHtml(error.message)}</p><p class="hint-msg">Запусти проект через локальный статический сервер: <span class="cmd-example">python -m http.server 8000</span>.</p>`); },
    renderFateSelection(name) {
        let html = `<p class="system-msg">═══ ВЫБЕРИ СУДЬБУ ═══</p><p>Имя: <strong>${escapeHtml(name)}</strong></p>`;
        Object.entries(WorldDB.fates).forEach(([, fate], index) => { html += `<div class="class-option"><p><strong>${index + 1}. ${escapeHtml(fate.name)}</strong> (${escapeHtml(fate.nameEn)})</p><p class="class-epithet">${escapeHtml(fate.epithet)}</p><p class="class-desc">${escapeHtml(fate.description)}</p></div>`; });
        return html + `<p class="hint-msg">Введи номер или название судьбы.</p>`;
    },
    renderFateConfirm(name, fateId) {
        const fate = WorldDB.fates[fateId];
        const s = fate.stats;
        return `<p class="system-msg">═══ ПОСЛЕДНИЙ ШАГ ═══</p><p>${escapeHtml(name)}, <strong>${escapeHtml(fate.name)}</strong> — ${escapeHtml(fate.epithet)}.</p><p class="class-desc">${escapeHtml(fate.description)}</p><p class="class-quote">"${escapeHtml(fate.quote)}"</p><p class="class-stats">HP: ${fate.stats.hp} | Сил:${s.strength} Лов:${s.agility} Тел:${s.constitution} Инт:${s.intelligence} Муд:${s.wisdom} Хар:${s.charisma} Вос:${s.perception} Уд:${s.luck} | Реп: ${signed(fate.reputation || 0)}</p><p class="hint-msg">Напиши 'да' для подтверждения или 'нет' для нового выбора.</p>`;
    },
    renderGameStart(state) {
        const fate = WorldDB.fates[state.player.fate];
        const loc = getCurrentLocation(state);
        const startMsg = state.player.location === "bone_hunters_camp" ? `Ты просыпаешься в лагере костяных охотников. Костер ещё тлеет, и кто-то в темноте перебирает кости.` : `Путь начинается у Южных ворот Агерута.`;
        return `<p class="system-msg">═══ АГЕРУТ ПРИНИМАЕТ НЕОХОТНО ═══</p><p>${escapeHtml(state.player.name)}, ${escapeHtml(fate.epithet)}.</p><p>${escapeHtml(startMsg)} Окно окружения справа уже показывает место, существ, предметы и доступные взаимодействия.</p>`;
    },
    renderLocation(state, locationId, arrivalText = "") {
        const loc = WorldDB.locations[locationId];
        const demonPhrases = ["Вокруг тебя лишь тени и шёпот демонов.", "Город в огне. Ты слышишь крики, которых нет.", "Камни дышат жаром преисподней. Везде — только ложь."];
        let html = `<p class="system-msg">═══ ${escapeHtml(loc.title)} ═══</p><p class="location-en">(${escapeHtml(loc.titleEn)}) — ${formatTime(state)}</p>`;
        if (arrivalText) html += `<p class="success-msg">${escapeHtml(arrivalText)}</p>`;
        if (state.player.statuses.blinded) {
            html += `<p class="warning-msg">Тьма застилает глаза. Ты ничего не видишь, только чувствуешь жар песка под ногами.</p>`;
        } else if (state.player.statuses.demon_host) {
            html += `<p class="warning-msg">${escapeHtml(pick(demonPhrases))}</p>`;
            html += `<p class="atmosphere">${escapeHtml(timePhrase(state))}</p><p>${escapeHtml(loc.description)}</p>`;
            html += `<p class="warning-msg">[ЛОЖНЫЕ ПУТИ]: ${pick(["север", "юг", "восток", "запад", "городская стена", "тёмный проход", "ржавая лестница вниз"])}, ${pick(["север", "юг", "восток", "запад", "колодец", "обрыв", "путь к храму"])}</p>`;
        } else {
            html += `<p class="atmosphere">${escapeHtml(timePhrase(state))}</p><p>${escapeHtml(loc.description)}</p><p class="atmosphere">${escapeHtml(loc.atmosphere)}</p>`;
        }
        const visible = getVisibleEntities(state, loc.id);
        const npcs = visible.filter((e) => ["npc", "monster"].includes(e.kind) && !e.state.isDead);
        const dead = visible.filter((e) => e.state.isDead);
        const items = visible.filter((e) => e.kind === "item");
        if (!state.player.statuses.blinded) {
            if (npcs.length) {
                html += `<p class="info-msg">[СУЩНОСТИ]: ${npcs.map((e) => `<span class="clickable" data-cmd="говорить ${escapeHtml(e.aliases?.[0] || e.name)}">${escapeHtml(e.name)}</span>`).join(", ")}</p>`;
                html += this.renderCreatureActions(npcs);
            }
            if (dead.length) html += `<p class="warning-msg">[МЁРТВЫЕ]: ${dead.map((e) => `<span class="clickable" data-cmd="обыскать ${escapeHtml(e.aliases?.[0] || e.name)}">${escapeHtml(e.name)}</span>`).join(", ")}</p>`;
            if (items.length) html += `<p class="info-msg">[ПРЕДМЕТЫ]: ${items.map((e) => `<span class="clickable" data-cmd="взять ${escapeHtml(e.aliases?.[0] || e.name)}">${escapeHtml(e.name)}</span>`).join(", ")}</p>`;
        }
        return html + this.renderExits(loc.exits || [], true);
    },
    renderCreatureActions(creatures) {
        return `<div class="creature-actions"><p class="creature-actions-title">Действия с существами:</p>${creatures.map((entity) => {
            const target = entity.aliases?.[0] || entity.name;
            const actions = [
                ["изучить", "Изучить"],
                ["говорить", "Говорить"],
                ["атаковать", "Атаковать"]
            ];
            if (entity.kind === "npc") actions.push(["обокрасть", "Обокрасть"]);
            if ((entity.tags || []).includes("gambler")) actions.push(["играть", "Играть"]);
            if (entity.state?.isDead) actions.push(["обыскать", "Обыскать"]);
            return `<div class="creature-action-card"><div class="creature-action-name">${escapeHtml(entity.name)}</div><div class="creature-action-buttons">${actions.map(([verb, label]) => `<button type="button" class="creature-action-btn clickable" data-cmd="${escapeHtml(`${verb} ${target}`)}">${escapeHtml(label)}</button>`).join("")}</div></div>`;
        }).join("")}</div>`;
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
        const whisper = output.whisper || (Math.random() < 0.15 ? pick(DemonWhispers) : null);
        const whisperHtml = whisper ? `<p class="warning-msg">${escapeHtml(whisper)}</p>` : "";
        return `<p class="npc-name">${escapeHtml(entity.name)}:</p><p>"${escapeHtml(output.text)}"</p>${whisperHtml}<p class="atmosphere">${escapeHtml(aside)}</p>`;
    },
    renderDice(dice, text) {
        return `${dice ? `<p class="dice-log">${escapeHtml(dice.formula)}</p>` : ""}<p>${escapeHtml(text)}</p>`;
    },
    renderTransit(output) {
        return `${output.dice ? `<p class="dice-log">${escapeHtml(output.dice.formula)}</p>` : ""}<p class="info-msg">${escapeHtml(output.text || "Переход начался.")}</p><p class="warning-msg">Статус [in_transit]: переход к ${escapeHtml(output.label)} займёт ${output.durationSeconds} секунд. Физические действия временно заблокированы.</p>`;
    },
    renderInventory(state) {
        const eq = state.player.equipped;
        let html = `<p class="system-msg">═══ ИНВЕНТАРЬ ═══</p>`;
        const eqSlots = [];
        if (eq.weapon) { const e = WorldDB.entities[eq.weapon]; eqSlots.push(`<span class="clickable" data-cmd="снять ${escapeHtml(e?.name || eq.weapon)}">[${escapeHtml(e?.name || eq.weapon)}]</span>`); }
        if (eq.helmet) { const e = WorldDB.entities[eq.helmet]; eqSlots.push(`<span class="clickable" data-cmd="снять ${escapeHtml(e?.name || eq.helmet)}">[${escapeHtml(e?.name || eq.helmet)}]</span>`); }
        if (eq.armor) { const e = WorldDB.entities[eq.armor]; eqSlots.push(`<span class="clickable" data-cmd="снять ${escapeHtml(e?.name || eq.armor)}">[${escapeHtml(e?.name || eq.armor)}]</span>`); }
        if (eq.amulet) { const e = WorldDB.entities[eq.amulet]; eqSlots.push(`<span class="clickable" data-cmd="снять ${escapeHtml(e?.name || eq.amulet)}">[${escapeHtml(e?.name || eq.amulet)}]</span>`); }
        if (eqSlots.length) html += `<p class="info-msg">[НАДЕТО]: ${eqSlots.join(", ")}</p>`;
        if (!state.player.inventory.length) { html += `<p class="info-msg">Инвентарь пуст.</p>`; return html; }
        html += state.player.inventory.map((id, index) => {
            const ent = WorldDB.entities[id];
            const tags = ent?.tags || [];
            const name = escapeHtml(ent?.name || id);
            return `<p>${index + 1}. <span class="clickable" data-cmd="изучить ${name}">${name}</span> <span class="cmd-example">[<span class="clickable" data-cmd="надеть ${name}">надеть</span>] [<span class="clickable" data-cmd="выбросить ${name}">сбросить</span>]</span></p>`;
        }).join("");
        return html;
    },
    renderStatus(state) {
        const fate = WorldDB.fates[state.player.fate];
        const statuses = Object.keys(state.player.statuses).length ? Object.keys(state.player.statuses).map((s) => `[${s}]`).join(" ") : "нет";
        const curseDisplay = Object.keys(state.player.statuses).filter((s) => CurseLabels[s]).map((s) => `<span class="warning-msg">[${CurseLabels[s]}]</span>`).join(" ") || "";
        const eq = state.player.equipped;
        const eqStr = [eq.weapon ? `⚔${escapeHtml(WorldDB.entities[eq.weapon]?.name || "")}` : "", eq.helmet ? `⛑${escapeHtml(WorldDB.entities[eq.helmet]?.name || "")}` : "", eq.armor ? `🛡${escapeHtml(WorldDB.entities[eq.armor]?.name || "")}` : "", eq.amulet ? `📿${escapeHtml(WorldDB.entities[eq.amulet]?.name || "")}` : ""].filter(Boolean).join(", ");
        const thirst = state.player.equipped.weapon === "sealed_blade" ? ` | Жажда крови: ${"█".repeat(Math.min(state.player.bloodThirst || 0, 5))}${"░".repeat(Math.max(0, 5 - (state.player.bloodThirst || 0)))}` : "";
        const summonNames = state.player.summoned.map((id) => WorldDB.entities[id]?.name || id).join(", ");
        const summonStr = summonNames ? ` | Призваны: ${escapeHtml(summonNames)}` : "";
        return `<p class="system-msg">═══ ${escapeHtml(state.player.name)} ═══</p><p class="info-msg">${escapeHtml(fate.name)} — ${escapeHtml(fate.epithet)}</p><p>HP: ${state.player.hp}/${state.player.maxHp}</p><p>Сил: ${state.player.stats.strength} | Лов: ${state.player.stats.agility} | Тел: ${state.player.stats.constitution} | Инт: ${state.player.stats.intelligence}</p><p>Муд: ${state.player.stats.wisdom} | Хар: ${state.player.stats.charisma} | Вос: ${state.player.stats.perception} | Уд: ${state.player.stats.luck}</p><p>Репутация: ${signed(state.player.reputation)}${thirst}${summonStr}</p><p>Статусы: ${escapeHtml(statuses)} | ${formatTime(state)}</p>${eqStr ? `<p class="info-msg">[ЭКИПИРОВКА]: ${eqStr}</p>` : ""}${curseDisplay ? `<p>${curseDisplay}</p>` : ""}`;
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
        return `<p class="system-msg">═══ КОМАНДЫ ═══</p><p class="hint-msg">Сокращения: ж=взять, и=инвентарь, с=статус, к=карта, п=помощь.</p><p>Окружение, пути, предметы и действия с существами всегда доступны в правом окне.</p><p><span class="cmd-example">идти [место]</span>, <span class="cmd-example">изучить [цель]</span>, <span class="cmd-example">взять [предмет]</span>, <span class="cmd-example">говорить [кто]</span>, <span class="cmd-example">обокрасть [кто]</span>, <span class="cmd-example">играть [кто]</span>, <span class="cmd-example">атаковать [кто]</span>, <span class="cmd-example">сбежать</span>, <span class="cmd-example">обыскать [труп]</span>.</p><p><span class="cmd-example">надеть [предмет]</span>, <span class="cmd-example">снять [слот]</span>, <span class="cmd-example">выбросить [предм.]</span>, <span class="cmd-example">продать [предм.] [торговцу]</span>.</p><p><span class="cmd-example">validate_world</span> проверяет JSON на битые выходы, сущности и правила.</p>`;
    },
    renderValidation(report) {
        return `<p class="system-msg">═══ VALIDATE_WORLD ═══</p>${report.map((line) => `<p class="${line.level === "ok" ? "success" : line.level === "error" ? "error" : "warning"}-msg">[${escapeHtml(line.level)}] ${escapeHtml(line.message)}</p>`).join("")}`;
    },
    updateSidebar(state) {
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set("char-name", state.player.name || "???");
        set("char-class", state.player.fate ? WorldDB.fates[state.player.fate].name : "???");
        set("char-strength", state.player.stats?.strength ?? "?");
        set("char-luck", state.player.stats?.luck ?? "?");
        set("char-constitution", state.player.stats?.constitution ?? "?");
        set("char-intelligence", state.player.stats?.intelligence ?? "?");
        set("char-charisma", state.player.stats?.charisma ?? "?");
        set("char-perception", state.player.stats?.perception ?? "?");
        set("char-wisdom", state.player.stats?.wisdom ?? "?");
        set("world-time", state.phase === "GAME" ? formatTime(state) : "—");
        set("char-reputation", state.phase === "GAME" ? signed(state.player.reputation) : "—");
        const eq = state.player.equipped;
        const display = [eq.weapon ? `⚔${WorldDB.entities[eq.weapon]?.name || ""}` : "", eq.helmet ? `⛑${WorldDB.entities[eq.helmet]?.name || ""}` : "", eq.armor ? `🛡${WorldDB.entities[eq.armor]?.name || ""}` : "", eq.amulet ? `📿${WorldDB.entities[eq.amulet]?.name || ""}` : ""].filter(Boolean).join(", ");
        set("char-equip", display || "—");
        const summonNames = state.player.summoned.map((id) => WorldDB.entities[id]?.name || id).join(", ");
        set("char-summoned", summonNames || "—");
        const hpEl = document.getElementById("char-hp");
        const hpFill = document.getElementById("hp-fill");
        if (hpEl) hpEl.textContent = state.player.maxHp ? `${state.player.hp}/${state.player.maxHp}` : "?/?";
        if (hpFill) hpFill.style.width = state.player.maxHp ? `${Math.max(0, Math.min(100, state.player.hp / state.player.maxHp * 100))}%` : "0%";
        const curseList = Object.keys(state.player.statuses).filter((s) => CurseLabels[s]).map((s) => CurseLabels[s]);
        set("char-curses", curseList.length ? curseList.join(", ") : "—");
        const env = document.getElementById("environment-list");
        if (env) {
            const loc = state.phase === "GAME" ? getCurrentLocation(state) : null;
            env.innerHTML = loc ? `${escapeHtml(loc.title)}<br>${getVisibleEntities(state).map((e) => escapeHtml(e.name)).join("<br>") || "никого рядом"}` : "Мир загружается...";
        }
        this.updateEnvironmentWindow(state);
        if (this.devStateEl) this.devStateEl.textContent = JSON.stringify(state, null, 2);
        window.GlobalState = state;
    },
    updateEnvironmentWindow(state) {
        if (!this.environmentEl) return;
        if (!state || state.phase !== "GAME") {
            this.environmentEl.innerHTML = `<p class="hint-msg">Создай персонажа, чтобы увидеть окружение Агерута.</p>`;
            return;
        }
        this.environmentEl.innerHTML = this.renderLocation(state, state.player.location);
    },
    updateHints(inputValue, state) {
        if (!this.hintEl) return;
        const query = normalize(inputValue);
        if (!query || !state || !["GAME", "GAME_OVER"].includes(state.phase)) { this.hintEl.textContent = ""; return; }
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
    async init(inputEl, outputEl, hintEl, devStateEl, environmentEl) {
        this.inputEl = inputEl;
        Renderer.init(outputEl, hintEl, devStateEl, environmentEl);
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
        if (this.state.player.hp <= 0 && this.state.phase === "GAME") {
            this.state.phase = "GAME_OVER";
            const nearbyHunters = getVisibleEntities(this.state).filter((e) => (e.tags || []).some((t) => ["hunter", "raider"].includes(t)));
            if (nearbyHunters.length) {
                this.state.ui.lastOutput = { type: "warning", text: "Костяные охотники окружают тебя. Последнее, что ты видишь — как один из них поднимает крючковатое копьё. Твоя голова отделяется от тела. Агерут забывает твоё имя." };
            } else {
                this.state.ui.lastOutput = { type: "warning", text: "Ты умираешь. Пустыня принимает твоё тело, как принимала тысячи до тебя. Агерут не запомнит твоего имени." };
            }
            Renderer.render(this.state);
            Renderer.updateSidebar(this.state);
            return;
        }
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
        if (!this.state || !["GAME", "GAME_OVER"].includes(this.state.phase)) return;
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
    const environmentEl = document.getElementById("environment-window");
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
    Game.init(inputEl, outputEl, hintEl, devStateEl, environmentEl);
    inputEl.focus();
});
