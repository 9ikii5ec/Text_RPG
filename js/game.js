/**
╔═══════════════════════════════════════════════════════════════════════════╗
║  VERMIS: ENDLESS PURGATORY — Finite State Machine Architecture           ║
║  Подход: Deterministic Action Pipeline + Reducer + Event Sourcing        ║
╚═══════════════════════════════════════════════════════════════════════════╝
*/

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 1: СОСТОЯНИЕ (STATE) — Единственный источник правды
// ═══════════════════════════════════════════════════════════════════════════════
const InitialState = {
    // Meta
    phase: "CREATION_NAME", // CREATION_NAME | CREATION_CLASS | CREATION_CONFIRM | GAME | GAME_OVER
    turn: 0,

    // Player
    player: {
        name: null,
        class: null,
        hp: 0,
        maxHp: 0,
        luck: 0,
        strength: 0,
        agility: 0,
        wisdom: 0,
        inventory: [],
        location: "glass_purgatory"
    },

    // Temp creation state
    creation: {
        tempName: null,
        tempClass: null
    },

    // World state
    world: {
        discoveredLocations: ["glass_purgatory"],
        killedEnemies: [],
        eventLog: []
    },

    // UI state
    ui: {
        lastOutput: null,
        pendingScroll: false
    }
};

// Глубокое копирование состояния
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 2: ДЕЙСТВИЯ (ACTIONS) — Типизированные события
// ═══════════════════════════════════════════════════════════════════════════════
const ActionTypes = {
    // Creation
    SET_NAME: "SET_NAME",
    SET_CLASS: "SET_CLASS",
    CONFIRM_CHARACTER: "CONFIRM_CHARACTER",
    RESTART_CREATION: "RESTART_CREATION",

    // Game
    MOVE: "MOVE",
    LOOK: "LOOK",
    EXAMINE: "EXAMINE",
    TAKE: "TAKE",
    TALK: "TALK",
    STEAL: "STEAL",
    ATTACK: "ATTACK",
    SHOW_INVENTORY: "SHOW_INVENTORY",
    SHOW_STATUS: "SHOW_STATUS",
    SHOW_MAP: "SHOW_MAP",
    SHOW_HELP: "SHOW_HELP",

    // System
    UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
    INVALID_INPUT: "INVALID_INPUT"
};

// Фабрики действий (Action Creators)
const Actions = {
    setName: (name) => ({ type: ActionTypes.SET_NAME, payload: { name } }),
    setClass: (classId) => ({ type: ActionTypes.SET_CLASS, payload: { classId } }),
    confirmCharacter: () => ({ type: ActionTypes.CONFIRM_CHARACTER }),
    restartCreation: () => ({ type: ActionTypes.RESTART_CREATION }),
    move: (target) => ({ type: ActionTypes.MOVE, payload: { target } }),
    look: (target = null) => ({ type: ActionTypes.LOOK, payload: { target } }),
    examine: (target) => ({ type: ActionTypes.EXAMINE, payload: { target } }),
    take: (target) => ({ type: ActionTypes.TAKE, payload: { target } }),
    talk: (target) => ({ type: ActionTypes.TALK, payload: { target } }),
    steal: (target) => ({ type: ActionTypes.STEAL, payload: { target } }),
    attack: (target) => ({ type: ActionTypes.ATTACK, payload: { target } }),
    showInventory: () => ({ type: ActionTypes.SHOW_INVENTORY }),
    showStatus: () => ({ type: ActionTypes.SHOW_STATUS }),
    showMap: () => ({ type: ActionTypes.SHOW_MAP }),
    showHelp: () => ({ type: ActionTypes.SHOW_HELP }),

    unknownCommand: (input) => ({ type: ActionTypes.UNKNOWN_COMMAND, payload: { input } }),
    invalidInput: (reason) => ({ type: ActionTypes.INVALID_INPUT, payload: { reason } })
};

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 3: РЕДУКТОР (REDUCER) — Чистая функция (state, action) → state
// ═══════════════════════════════════════════════════════════════════════════════
function reducer(state, action) {
    const newState = cloneState(state);
    newState.turn++;

    switch (action.type) {
        // ═─ CREATION PHASE ─────────────────────────────────────────
        case ActionTypes.SET_NAME:
            if (!action.payload.name || action.payload.name.length < 2) {
                newState.ui.lastOutput = {
                    type: "error",
                    text: "Имя должно содержать минимум 2 символа. Как тебя зовут, странник?"
                };
                return newState;
            }
            // Проверка что это не команда
            const cmdVerbs = ["осмотреться", "помощь", "инвентарь", "статус", "карта", "идти", "взять", "атаковать"];
            if (cmdVerbs.includes(action.payload.name.toLowerCase())) {
                newState.ui.lastOutput = {
                    type: "warning",
                    text: `"${action.payload.name}" — это команда, а не имя. Введи своё настоящее имя.`
                };
                return newState;
            }
            newState.creation.tempName = action.payload.name;
            newState.phase = "CREATION_CLASS";
            newState.ui.lastOutput = {
                type: "class_selection",
                name: action.payload.name
            };
            return newState;

        case ActionTypes.SET_CLASS:
            const classId = validateClassSelection(action.payload.classId);
            if (!classId) {
                newState.ui.lastOutput = {
                    type: "error",
                    text: "Неверный выбор. Введи номер (1-4) или название класса."
                };
                return newState;
            }
            newState.creation.tempClass = classId;
            newState.phase = "CREATION_CONFIRM";
            newState.ui.lastOutput = {
                type: "class_confirm",
                name: newState.creation.tempName,
                classId: classId
            };
            return newState;

        case ActionTypes.CONFIRM_CHARACTER:
            const classData = WorldDB.classes[newState.creation.tempClass];
            newState.player = {
                name: newState.creation.tempName,
                class: newState.creation.tempClass,
                hp: classData.stats.hp,
                maxHp: classData.stats.maxHp,
                luck: classData.stats.luck,
                strength: classData.stats.strength,
                agility: classData.stats.agility,
                wisdom: classData.stats.wisdom,
                inventory: [...classData.startingItems],
                location: "glass_purgatory"
            };
            newState.phase = "GAME";
            newState.ui.lastOutput = {
                type: "game_start",
                name: newState.player.name,
                className: classData.name,
                epithet: classData.epithet
            };
            return newState;

        case ActionTypes.RESTART_CREATION:
            newState.creation = { tempName: null, tempClass: null };
            newState.phase = "CREATION_NAME";
            newState.ui.lastOutput = { type: "creation_restart" };
            return newState;

        // ═─ GAME PHASE ─────────────────────────────────────────────
        case ActionTypes.MOVE:
            return handleMove(newState, action.payload.target);
        case ActionTypes.LOOK:
            return handleLook(newState, action.payload.target);
        case ActionTypes.EXAMINE:
            return handleExamine(newState, action.payload.target);
        case ActionTypes.TAKE:
            return handleTake(newState, action.payload.target);
        case ActionTypes.TALK:
            return handleTalk(newState, action.payload.target);
        case ActionTypes.STEAL:
            return handleSteal(newState, action.payload.target);
        case ActionTypes.ATTACK:
            return handleAttack(newState, action.payload.target);
        case ActionTypes.SHOW_INVENTORY:
            return handleInventory(newState);
        case ActionTypes.SHOW_STATUS:
            return handleStatus(newState);
        case ActionTypes.SHOW_MAP:
            return handleMap(newState);
        case ActionTypes.SHOW_HELP:
            return handleHelp(newState);
        case ActionTypes.UNKNOWN_COMMAND:
            newState.ui.lastOutput = {
                type: "error",
                text: `Неизвестная команда: "${action.payload.input}". Введи 'помощь' для списка команд.`
            };
            return newState;
        case ActionTypes.INVALID_INPUT:
            newState.ui.lastOutput = {
                type: "error",
                text: action.payload.reason
            };
            return newState;

        default:
            return newState;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 4: БАЗА ДАННЫХ МИРА
// ═══════════════════════════════════════════════════════════════════════════════
const WorldDB = {
    classes: {
        wayfarer: {
            name: "Скиталец",
            nameEn: "Wayfarer",
            epithet: "Блуждающий в Тумане",
            description: "Потерянная душа, забредшая в Чистилище. Ни силы, ни мудрости — лишь воля к выходу.",
            stats: { hp: 20, maxHp: 20, luck: 3, strength: 3, agility: 4, wisdom: 4 },
            startingItems: ["Рваный плащ", "Тусклый фонарь"],
            quote: "Я не помню, как попал сюда. Но я помню, что должен найти выход."
        },
        scavenger: {
            name: "Мусорщик",
            nameEn: "Scavenger",
            epithet: "Коллекционер Осколков",
            description: "Собиратель осколков в коридорах. Торгует находками, грабит трупы.",
            stats: { hp: 15, maxHp: 15, luck: 7, strength: 2, agility: 6, wisdom: 3 },
            startingItems: ["Ржавый крюк", "Мешок для осколков"],
            quote: "Всё имеет цену. Особенно твоя душа."
        },
        graver: {
            name: "Могильщик",
            nameEn: "Grave Walker",
            epithet: "Страж Костяного Сада",
            description: "Хранитель забытых гробниц. Тяжёлый молот, тяжёлая душа.",
            stats: { hp: 30, maxHp: 30, luck: 1, strength: 8, agility: 2, wisdom: 4 },
            startingItems: ["Тяжёлый молот", "Фонарь мертвеца"],
            quote: "Я хороню тех, кого даже смерть не принимает."
        },
        seer: {
            name: "Зеркальный Провидец",
            nameEn: "Mirror Seer",
            epithet: "Голос Стеклянных Стен",
            description: "Тот, кто смотрит в зеркала слишком долго. Видит прошлое в осколках.",
            stats: { hp: 12, maxHp: 12, luck: 4, strength: 1, agility: 3, wisdom: 9 },
            startingItems: ["Зеркальный посох", "Осколок истины"],
            quote: "Зеркала лгут. Но иногда они говорят правду."
        }
    },

    locations: {
        glass_purgatory: {
            id: "glass_purgatory",
            title: "Стеклянное Чистилище",
            titleEn: "The Glass Purgatory",
            description: "Бесконечные коридоры между реальностью и иллюзией. Стены покрыты слоями битого зеркального стекла. Туман стелется по полу.",
            atmosphere: "Звон осколков под ногами. Холодное дыхание тумана.",
            exits: ["silver_road", "glass_nest"],
            items: ["осколок_зеркала"],
            npcs: {
                "купец": {
                    name: "Теневой Купец",
                    type: "merchant",
                    status: "neutral",
                    description: "Фигура в рваном плаще. Лицо скрыто под капюшоном.",
                    dialogue: [
                        "Осколки — единственная валюта здесь.",
                        "У меня есть кое-что особенное... но ты пока не можешь позволить себе.",
                        "Они наблюдают. Зеркала всегда наблюдают."
                    ]
                }
            },
            dc_modifier: 0
        },
        silver_road: {
            id: "silver_road",
            title: "Серебряная Дорога",
            titleEn: "The Silver Road",
            description: "Древний путь, вымощенный чем-то похожим на кости и серебро. Стены украшены статуэтками с зеркалами вместо лиц.",
            atmosphere: "Тяжёлый воздух. Скрежет под ногами. Шёпот из ниоткуда.",
            exits: ["glass_purgatory", "bone_garden"],
            items: ["серебряная_монета"],
            npcs: {
                "страж": {
                    name: "Страж Дороги",
                    type: "guard",
                    status: "aggressive",
                    description: "Огромная фигура в ржавых латах. Забрало — сплошное зеркало.",
                    stats: { hp: 30, damage: 8, defense: 5 },
                    dialogue: ["Стой. Дорога закрыта для таких как ты."]
                }
            },
            dc_modifier: 2
        },
        glass_nest: {
            id: "glass_nest",
            title: "Стеклянное Гнездо",
            titleEn: "The Glass Nest",
            description: "Пещера, где стены покрыты слоями битого стекла и чего-то органического. Зеркальные соты тянутся в темноту.",
            atmosphere: "Чьё-то дыхание в темноте. Ты не один.",
            exits: ["glass_purgatory"],
            items: ["стеклянное_яйцо"],
            npcs: {},
            dc_modifier: 3
        },
        bone_garden: {
            id: "bone_garden",
            title: "Костяной Сад",
            titleEn: "The Bone Garden",
            description: "Сад, где вместо цветов — кости. Деревья из позвонков, кусты из рёбер. В центре — фонтан из черепов.",
            atmosphere: "Сладковатый запах гниения. Кости двигаются?",
            exits: ["silver_road"],
            items: ["костяной_цветок"],
            npcs: {
                "садовник": {
                    name: "Садовник",
                    type: "caretaker",
                    status: "neutral",
                    description: "Сгорбленная фигура. Ухаживает за костями.",
                    dialogue: ["Не трогай мои цветы... Они растут из воспоминаний."]
                }
            },
            dc_modifier: 4
        }
    },

    items: {
        осколок_зеркала: { name: "Осколок Зеркала", description: "Кусок зеркала. В отражении ты видишь кого-то другого." },
        серебряная_монета: { name: "Серебряная Монета", description: "Монета с изображением закрытого глаза." },
        стеклянное_яйцо: { name: "Стеклянное Яйцо", description: "Яйцо из стекла. Внутри что-то движется." },
        костяной_цветок: { name: "Костяной Цветок", description: "Цветок из кости. Красивый и ужасный." }
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 5: ОБРАБОТЧИКИ ДЕЙСТВИЙ (Action Handlers)
// ═══════════════════════════════════════════════════════════════════════════════
function validateClassSelection(input) {
    const classKeys = Object.keys(WorldDB.classes);
    const lower = input.toLowerCase();

    // По номеру
    const num = parseInt(input);
    if (num >= 1 && num <= classKeys.length) return classKeys[num - 1];

    // По названию
    return classKeys.find(k =>
        k.includes(lower) ||
        WorldDB.classes[k].name.toLowerCase().includes(lower) ||
        WorldDB.classes[k].nameEn.toLowerCase().includes(lower)
    );
}

function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

function formatDiceResult(d20, modifier, total, dc, type) {
    const colors = {
        critical_success: "#ffd700",
        success: "#2d5a27",
        failure: "#8b4500",
        critical_failure: "#8b2500"
    };
    const labels = {
        critical_success: "КРИТИЧЕСКИЙ УСПЕХ",
        success: "УСПЕХ",
        failure: "ПРОВАЛ",
        critical_failure: "КРИТИЧЕСКИЙ ПРОВАЛ"
    };
    return `<span style="color:${colors[type]}">[${labels[type]}] d20:${d20} + ${modifier} = ${total} (DC ${dc})</span>`;
}

function handleMove(state, target) {
    const loc = WorldDB.locations[state.player.location];

    if (!target) {
        const exits = loc.exits.map(e => {
            const l = WorldDB.locations[e];
            const discovered = state.world.discoveredLocations.includes(e);
            const title = discovered ? l.title : "???";
            return `<span class="clickable" data-cmd="идти ${e}">${title}</span>`;
        }).join(", ");
        state.ui.lastOutput = { type: "info_html", html: `Доступные пути: ${exits}` };
        return state;
    }

    const targetLoc = loc.exits.find(e => e.toLowerCase().includes(target.toLowerCase()));
    if (!targetLoc) {
        state.ui.lastOutput = { type: "error", text: `Путь "${target}" закрыт. Туман скрывает этот маршрут.` };
        return state;
    }

    const newLoc = WorldDB.locations[targetLoc];
    state.player.location = targetLoc;

    if (!state.world.discoveredLocations.includes(targetLoc)) {
        state.world.discoveredLocations.push(targetLoc);
    }

    state.ui.lastOutput = {
        type: "location",
        title: newLoc.title,
        titleEn: newLoc.titleEn,
        description: newLoc.description,
        atmosphere: newLoc.atmosphere,
        exits: newLoc.exits,
        npcs: newLoc.npcs,
        items: newLoc.items
    };

    return state;
}

function handleLook(state, target) {
    if (target) {
        state.ui.lastOutput = { type: "hint", text: `Используй 'изучить ${target}' для детального осмотра.` };
        return state;
    }
    const loc = WorldDB.locations[state.player.location];
    state.ui.lastOutput = {
        type: "location",
        title: loc.title,
        titleEn: loc.titleEn,
        description: loc.description,
        atmosphere: loc.atmosphere,
        exits: loc.exits,
        npcs: loc.npcs,
        items: loc.items
    };
    return state;
}

function handleExamine(state, target) {
    if (!target) {
        state.ui.lastOutput = { type: "hint", text: "Что изучить?" };
        return state;
    }
    const loc = WorldDB.locations[state.player.location];

    // Поиск среди NPC
    if (loc.npcs) {
        for (const [key, npc] of Object.entries(loc.npcs)) {
            if (key.includes(target.toLowerCase()) || npc.name.toLowerCase().includes(target.toLowerCase())) {
                state.ui.lastOutput = { type: "examine_npc", npc: npc };
                return state;
            }
        }
    }

    // Поиск среди предметов
    if (loc.items) {
        for (const itemKey of loc.items) {
            if (itemKey.includes(target.toLowerCase())) {
                state.ui.lastOutput = { type: "examine_item", item: WorldDB.items[itemKey] };
                return state;
            }
        }
    }

    state.ui.lastOutput = { type: "error", text: `Не вижу "${target}" здесь.` };
    return state;
}

function handleTake(state, target) {
    if (!target) {
        state.ui.lastOutput = { type: "hint", text: "Что взять?" };
        return state;
    }
    const loc = WorldDB.locations[state.player.location];
    if (!loc.items || loc.items.length === 0) {
        state.ui.lastOutput = { type: "info", text: "Здесь нечего брать." };
        return state;
    }

    const itemIndex = loc.items.findIndex(i => i.includes(target.toLowerCase()));
    if (itemIndex === -1) {
        state.ui.lastOutput = { type: "error", text: `Не нахожу "${target}".` };
        return state;
    }

    const itemKey = loc.items[itemIndex];
    const item = WorldDB.items[itemKey];

    loc.items.splice(itemIndex, 1);
    state.player.inventory.push(item ? item.name : itemKey);

    state.ui.lastOutput = { type: "success", text: `Взял: ${item ? item.name : itemKey}` };
    return state;
}

function handleTalk(state, target) {
    if (!target) {
        state.ui.lastOutput = { type: "hint", text: "С кем говорить?" };
        return state;
    }
    const loc = WorldDB.locations[state.player.location];
    if (!loc.npcs) {
        state.ui.lastOutput = { type: "info", text: "Не с кем говорить." };
        return state;
    }

    for (const [key, npc] of Object.entries(loc.npcs)) {
        if (key.includes(target.toLowerCase()) || npc.name.toLowerCase().includes(target.toLowerCase())) {
            if (!npc.dialogue) {
                state.ui.lastOutput = { type: "info", text: `${npc.name} молчит.` };
            } else {
                const phrase = npc.dialogue[Math.floor(Math.random() * npc.dialogue.length)];
                state.ui.lastOutput = { type: "dialogue", npc: npc.name, text: phrase };
            }
            return state;
        }
    }

    state.ui.lastOutput = { type: "error", text: `"${target}" не найден.` };
    return state;
}

function handleSteal(state, target) {
    if (!target) {
        state.ui.lastOutput = { type: "hint", text: "Кого обокрасть?" };
        return state;
    }
    const loc = WorldDB.locations[state.player.location];
    if (!loc.npcs) {
        state.ui.lastOutput = { type: "info", text: "Некого обокрасть." };
        return state;
    }

    for (const [key, npc] of Object.entries(loc.npcs)) {
        if (key.includes(target.toLowerCase()) || npc.name.toLowerCase().includes(target.toLowerCase())) {
            const dc = 12 + (loc.dc_modifier || 0);
            const d20 = rollD20();
            const total = d20 + state.player.luck;

            let result;
            if (d20 === 20) result = "critical_success";
            else if (d20 === 1) result = "critical_failure";
            else if (total >= dc) result = "success";
            else result = "failure";

            const diceText = formatDiceResult(d20, state.player.luck, total, dc, result);
            let responseText = diceText + "<br>";

            switch (result) {
                case "critical_success":
                    state.player.inventory.push("Серебряный осколок", "Странный ключ");
                    responseText += "Чистая работа! Два предмета твои.";
                    break;
                case "success":
                    state.player.inventory.push("Серебряный осколок");
                    responseText += "Успех! Взял Серебряный осколок.";
                    break;
                case "failure":
                    responseText += `${npc.name} замечает тебя. Пора уходить.`;
                    break;
                case "critical_failure":
                    state.player.hp -= 5;
                    responseText += `КОШМАР! ${npc.name} хватает тебя! -5 HP.`;
                    break;
            }

            state.ui.lastOutput = { type: "dice_result", text: responseText };
            return state;
        }
    }

    state.ui.lastOutput = { type: "error", text: `"${target}" не найден.` };
    return state;
}

function handleAttack(state, target) {
    if (!target) {
        state.ui.lastOutput = { type: "hint", text: "Кого атаковать?" };
        return state;
    }
    const loc = WorldDB.locations[state.player.location];
    if (!loc.npcs) {
        state.ui.lastOutput = { type: "info", text: "Нечего атаковать." };
        return state;
    }

    for (const [key, npc] of Object.entries(loc.npcs)) {
        if (key.includes(target.toLowerCase()) || npc.name.toLowerCase().includes(target.toLowerCase())) {
            const dc = 10 + (loc.dc_modifier || 0);
            const d20 = rollD20();
            const total = d20 + state.player.strength;

            let result;
            if (d20 === 20) result = "critical_success";
            else if (d20 === 1) result = "critical_failure";
            else if (total >= dc) result = "success";
            else result = "failure";

            const diceText = formatDiceResult(d20, state.player.strength, total, dc, result);
            let responseText = diceText + "<br>";

            switch (result) {
                case "critical_success":
                    responseText += `ДЕВИТИРУЮЩИЙ УДАР! ${state.player.strength * 2 + 6} урона!`;
                    break;
                case "success":
                    responseText += `Удар! ${state.player.strength + 4} урона.`;
                    break;
                case "failure":
                    responseText += `${npc.name} уклоняется.`;
                    break;
                case "critical_failure":
                    state.player.hp -= 3;
                    responseText += `Ты оступаешься! -3 HP.`;
                    break;
            }

            state.ui.lastOutput = { type: "dice_result", text: responseText };
            return state;
        }
    }

    state.ui.lastOutput = { type: "error", text: `"${target}" не найден.` };
    return state;
}

function handleInventory(state) {
    if (state.player.inventory.length === 0) {
        state.ui.lastOutput = { type: "info", text: "Инвентарь пуст." };
    } else {
        state.ui.lastOutput = { type: "inventory", items: state.player.inventory };
    }
    return state;
}

function handleStatus(state) {
    const classData = WorldDB.classes[state.player.class];
    state.ui.lastOutput = {
        type: "status",
        name: state.player.name,
        className: classData.name,
        epithet: classData.epithet,
        hp: state.player.hp,
        maxHp: state.player.maxHp,
        luck: state.player.luck,
        strength: state.player.strength,
        agility: state.player.agility,
        wisdom: state.player.wisdom
    };
    return state;
}

function handleMap(state) {
    state.ui.lastOutput = {
        type: "map",
        locations: WorldDB.locations,
        discovered: state.world.discoveredLocations,
        current: state.player.location
    };
    return state;
}

function handleHelp(state) {
    state.ui.lastOutput = { type: "help" };
    return state;
}

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 6: ПАРСЕР ВВОДА
// ═══════════════════════════════════════════════════════════════════════════════
const VerbMap = {
    // Полные команды
    "идти": "move", "иду": "move", "пройти": "move",
    "осмотреться": "look", "осмотреть": "look", "смотреть": "look",
    "изучить": "examine", "рассмотреть": "examine",
    "взять": "take", "поднять": "take",
    "говорить": "talk", "поговорить": "talk",
    "обокрасть": "steal", "украсть": "steal",
    "атаковать": "attack", "ударить": "attack",
    "инвентарь": "inventory", "и": "inventory",
    "статус": "status", "статы": "status",
    "карта": "map",
    "помощь": "help", "help": "help"
};

// Сокращения команд
const ShortcutMap = {
    "о": "осмотреться",
    "ж": "взять",
    "и": "инвентарь",
    "с": "статус",
    "к": "карта",
    "п": "помощь",
    "г": "говорить",
    "з": "изучить",
    "ю": "обокрасть",
    "а": "атаковать"
};

function expandShortcuts(input) {
    const tokens = input.trim().split(/\s+/);
    if (tokens.length > 0 && ShortcutMap[tokens[0]]) {
        tokens[0] = ShortcutMap[tokens[0]];
        return tokens.join(" ");
    }
    return input;
}

function parseInput(input, phase) {
    const trimmed = input.trim();
    if (!trimmed) return null;
    
    // Расширить сокращения
    const expanded = expandShortcuts(trimmed);
    const lower = expanded.toLowerCase();
    const tokens = lower.split(/\s+/);
    const verb = tokens[0];
    const target = tokens.slice(1).join(" ");

    // В фазе создания персонажа — только ввод текста
    if (phase === "CREATION_NAME") {
        return Actions.setName(trimmed);
    }

    if (phase === "CREATION_CLASS") {
        return Actions.setClass(trimmed);
    }

    if (phase === "CREATION_CONFIRM") {
        if (lower === "да" || lower === "yes" || lower === "y") {
            return Actions.confirmCharacter();
        }
        if (lower === "нет" || lower === "no" || lower === "n") {
            return Actions.restartCreation();
        }
        return Actions.invalidInput("Напиши 'да' или 'нет'.");
    }

    // В фазе игры — парсинг команд
    const actionType = VerbMap[verb];

    switch (actionType) {
        case "move": return Actions.move(target);
        case "look": return Actions.look(target);
        case "examine": return Actions.examine(target);
        case "take": return Actions.take(target);
        case "talk": return Actions.talk(target);
        case "steal": return Actions.steal(target);
        case "attack": return Actions.attack(target);
        case "inventory": return Actions.showInventory();
        case "status": return Actions.showStatus();
        case "map": return Actions.showMap();
        case "help": return Actions.showHelp();
        default: return Actions.unknownCommand(verb);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 7: РЕНДЕРЕР (VIEW) — Отображение состояния
// ═══════════════════════════════════════════════════════════════════════════════
const Renderer = {
    outputEl: null,

    init(outputEl) {
        this.outputEl = outputEl;
    },

    render(state) {
        const output = state.ui.lastOutput;
        if (!output) return;

        let html = "";

        switch (output.type) {
            case "error":
                html = `<p class="error-msg">${output.text}</p>`;
                break;

            case "warning":
                html = `<p class="warning-msg">${output.text}</p>`;
                break;

            case "hint":
                html = `<p class="hint-msg">${output.text}</p>`;
                break;

            case "info":
                html = `<p class="info-msg">${output.text}</p>`;
                break;

            case "info_html":
                html = `<p class="info-msg">${output.html}</p>`;
                break;

            case "success":
                html = `<p class="success-msg">${output.text}</p>`;
                break;

            case "class_selection":
                html = this.renderClassSelection(output.name);
                break;

            case "class_confirm":
                html = this.renderClassConfirm(output.name, output.classId);
                break;

            case "game_start":
                html = this.renderGameStart(output.name, output.className, output.epithet);
                break;

            case "creation_restart":
                html = this.renderCreationRestart();
                break;

            case "location":
                html = this.renderLocation(output);
                break;

            case "examine_npc":
                html = `<p><strong>${output.npc.name}</strong></p><p>${output.npc.description}</p><p class="info-msg">[СТАТУС]: ${output.npc.status}</p>`;
                break;

            case "examine_item":
                html = `<p><strong>${output.item.name}</strong></p><p>${output.item.description}</p>`;
                break;

            case "dialogue":
                html = `<p class="npc-name">${output.npc}:</p><p>"${output.text}"</p>`;
                break;

            case "dice_result":
                html = `<p>${output.text}</p>`;
                break;

            case "inventory":
                html = this.renderInventory(output.items);
                break;

            case "status":
                html = this.renderStatus(output);
                break;

            case "map":
                html = this.renderMap(output);
                break;

            case "help":
                html = this.renderHelp();
                break;
        }

        if (html) {
            this.print(html);
            this.scrollToBottom();
        }
    },

    print(html) {
        const p = document.createElement("div");
        p.className = "output-block";
        p.innerHTML = html;
        this.outputEl.appendChild(p);
        // Камера следит за строкой ввода - скролим после рендера
        this.scrollToInputArea();
    },

    scrollToBottom() {
        // Для совместимости, вызывает то же самое
        this.scrollToInputArea();
    },

    scrollToInputArea() {
        // Скролим output-log вниз
        const outputLog = document.querySelector(".output-log");
        if (outputLog) {
            outputLog.scrollTop = outputLog.scrollHeight;
        }
    },

    renderClassSelection(name) {
        let html = `<p class="system-msg">═══ КТО ТЫ? ═══</p>`;
        html += `<p>Имя: <strong>${name}</strong></p>`;
        html += `<p>Выбери, кем ты был до того, как оказался здесь:</p>`;

        const classes = Object.entries(WorldDB.classes);
        classes.forEach(([key, data], i) => {
            html += `<div class="class-option">`;
            html += `<p><strong>${i + 1}. ${data.name}</strong> (${data.nameEn})</p>`;
            html += `<p class="class-epithet">${data.epithet}</p>`;
            html += `<p class="class-desc">${data.description}</p>`;
            html += `</div>`;
        });

        html += `<p class="hint-msg">Введи номер или название класса:</p>`;
        return html;
    },

    renderClassConfirm(name, classId) {
        const c = WorldDB.classes[classId];
        let html = `<p class="system-msg">═══ ПОСЛЕДНИЙ ШАГ ═══</p>`;
        html += `<p><strong>${c.name}</strong> — ${c.epithet}</p>`;
        html += `<p class="class-desc">${c.description}</p>`;
        html += `<p class="class-quote">"${c.quote}"</p>`;
        html += `<p class="class-stats">HP: ${c.stats.hp} | Сила: ${c.stats.strength} | Ловкость: ${c.stats.agility} | Удача: ${c.stats.luck} | Мудрость: ${c.stats.wisdom}</p>`;
        html += `<p class="hint-msg">Напиши 'да' чтобы подтвердить, или 'нет' чтобы выбрать другой класс.</p>`;
        return html;
    },

    renderGameStart(name, className, epithet) {
        let html = `<p class="system-msg">═══ ДА БУДЕТ ТАК ═══</p>`;
        html += `<p>${name}, ${epithet}.</p>`;
        html += `<p>Твоё путешествие начинается в Стеклянном Чистилище.</p>`;
        html += `<p class="hint-msg">Кликай по выделенным словам, печатай команды (о, ж, и, с, к — быстрые сокращения), или введи 'помощь' для полного списка.</p>`;
        return html;
    },

    renderCreationRestart() {
        return `<p class="info-msg">Начнём сначала. Как тебя зовут, странник?</p>`;
    },

    renderLocation(data) {
        let html = `<p class="system-msg">═══ ${data.title} ═══</p>`;
        html += `<p class="location-en">(${data.titleEn})</p>`;
        html += `<p>${data.description}</p>`;
        html += `<p class="atmosphere">${data.atmosphere}</p>`;

        // NPC — кликабельные (talk)
        if (data.npcs && Object.keys(data.npcs).length > 0) {
            const npcLinks = Object.entries(data.npcs).map(([key, n]) =>
                `<span class="clickable" data-cmd="говорить ${key}">${n.name}</span>`
            ).join(", ");
            html += `<p class="info-msg">[СУЩНОСТИ]: ${npcLinks}</p>`;
        }

        // Предметы — кликабельные (take)
        if (data.items && data.items.length > 0) {
            const itemLinks = data.items.map(iKey => {
                const item = WorldDB.items[iKey];
                const name = item ? item.name : iKey;
                return `<span class="clickable" data-cmd="взять ${iKey}">${name}</span>`;
            }).join(", ");
            html += `<p class="info-msg">[ПРЕДМЕТЫ]: ${itemLinks}</p>`;
        }

        // Пути — кликабельные (move)
        const exitLinks = data.exits.map(e => {
            const l = WorldDB.locations[e];
            const title = l ? l.title : e;
            return `<span class="clickable" data-cmd="идти ${e}">${title}</span>`;
        }).join(" | ");
        html += `<p class="info-msg">[ПУТИ]: ${exitLinks}</p>`;

        return html;
    },

    renderInventory(items) {
        let html = `<p class="system-msg">═══ ИНВЕНТАРЬ ═══</p>`;
        items.forEach((item, i) => html += `<p>${i + 1}. ${item}</p>`);
        return html;
    },

    renderStatus(data) {
        let html = `<p class="system-msg">═══ ${data.name} ═══</p>`;
        html += `<p class="info-msg">${data.className} — ${data.epithet}</p>`;
        html += `<p>HP: ${data.hp}/${data.maxHp}</p>`;
        html += `<p>Сила: ${data.strength} | Ловкость: ${data.agility} | Удача: ${data.luck} | Мудрость: ${data.wisdom}</p>`;
        return html;
    },

    renderMap(data) {
        let html = `<p class="system-msg">═══ КАРТА ═══</p>`;
        Object.values(data.locations).forEach(loc => {
            const isCurrent = loc.id === data.current;
            const discovered = data.discovered.includes(loc.id);

            if (isCurrent) {
                html += `<p class="success-msg">★ ${loc.title}</p>`;
            } else if (discovered) {
                html += `<p>○ ${loc.title}</p>`;
            }
        });
        return html;
    },

    renderHelp() {
        let html = `<p class="system-msg">═══ КОМАНДЫ ═══</p>`;
        html += `<p class="hint-msg">Сокращения: о=осмотреться, ж=взять, и=инвентарь, с=статус, к=карта, п=помощь</p>`;
        html += `<p><strong>ПЕРЕДВИЖЕНИЕ:</strong></p>`;
        html += `<p>• <span class="cmd-example">идти [место]</span> — перейти в локацию (быстро: нажми на название места)</p>`;
        html += `<p>• <span class="cmd-example">осмотреться</span> (сокр: о) — осмотреться вокруг, узнать, что рядом</p>`;
        html += `<p>• <span class="cmd-example">изучить [объект]</span> (сокр: з) — рассмотреть детально предмет или персонажа</p>`;
        html += `<p><strong>ДЕЙСТВИЯ:</strong></p>`;
        html += `<p>• <span class="cmd-example">взять [предмет]</span> (сокр: ж) — подобрать предмет (быстро: нажми на его название)</p>`;
        html += `<p>• <span class="cmd-example">говорить [кто]</span> (сокр: г) — поговорить с кем-то (быстро: нажми на имя)</p>`;
        html += `<p>• <span class="cmd-example">обокрасть [кто]</span> (сокр: ю) — попытаться украсть что-то</p>`;
        html += `<p>• <span class="cmd-example">атаковать [кто]</span> (сокр: а) — атаковать врага</p>`;
        html += `<p><strong>ИНФОРМАЦИЯ:</strong></p>`;
        html += `<p>• <span class="cmd-example">инвентарь</span> (сокр: и) — показать всё в рюкзаке</p>`;
        html += `<p>• <span class="cmd-example">статус</span> (сокр: с) — характеристики персонажа</p>`;
        html += `<p>• <span class="cmd-example">карта</span> (сокр: к) — карта посещённых мест</p>`;
        html += `<p>• <span class="cmd-example">помощь</span> (сокр: п) — эта справка</p>`;
        html += `<p class="hint-msg">💡 Совет: кликай по <span class="clickable">выделенным словам</span> в тексте — это быстро вызывает команду. Используй ↑↓ стрелки для истории команд.</p>`;
        return html;
    },

    updateSidebar(state) {
        // Имя
        const nameEl = document.getElementById("char-name");
        if (nameEl) nameEl.textContent = state.player.name || "???";

        // Класс
        const classEl = document.getElementById("char-class");
        if (classEl) {
            classEl.textContent = state.player.class ? WorldDB.classes[state.player.class].name : "???";
        }

        // HP
        const hpEl = document.getElementById("char-hp");
        const hpFill = document.getElementById("hp-fill");
        if (hpEl && state.player.maxHp > 0) {
            hpEl.textContent = `${state.player.hp}/${state.player.maxHp}`;
            const percent = (state.player.hp / state.player.maxHp) * 100;
            if (hpFill) hpFill.style.width = `${percent}%`;
        }

        // Сила
        const strEl = document.getElementById("char-strength");
        if (strEl) strEl.textContent = state.player.strength || "?";

        // Удача
        const luckEl = document.getElementById("char-luck");
        if (luckEl) luckEl.textContent = state.player.luck || "?";
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 8: ЗВУКОВАЯ СИСТЕМА
// ═══════════════════════════════════════════════════════════════════════════════
const Audio = {
    context: null,
    enabled: true,

    init() {
        try {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { }
    },

    play(freq, dur, type = 'sine', vol = 0.15) {
        if (!this.enabled || !this.context) return;
        try {
            const osc = this.context.createOscillator();
            const gain = this.context.createGain();
            osc.connect(gain);
            gain.connect(this.context.destination);
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.context.currentTime);
            gain.gain.setValueAtTime(vol, this.context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + dur);
            osc.start();
            osc.stop(this.context.currentTime + dur);
        } catch (e) { }
    },

    hover() { this.play(600, 0.03, 'sine', 0.05); },
    click() { this.play(400, 0.08, 'square', 0.1); },
    success() {
        this.play(523, 0.1, 'sine', 0.1);
        setTimeout(() => this.play(659, 0.1, 'sine', 0.1), 80);
    },
    error() { this.play(200, 0.15, 'sawtooth', 0.15); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 9: ИГРОВОЙ КОНТРОЛЛЕР (Controller) — Dispatcher + Event Loop
// ═══════════════════════════════════════════════════════════════════════════════
const Game = {
    state: null,
    inputEl: null,
    history: [],
    historyIndex: 0,
    autoCompleteMatches: [],
    autoCompleteIndex: 0,

    init(inputEl, outputEl) {
        this.state = cloneState(InitialState);
        this.inputEl = inputEl;
        Renderer.init(outputEl);

        this.bindEvents();
        this.renderWelcome();
    },

    bindEvents() {
        this.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.dispatch(this.inputEl.value);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                this.navigateHistory(1);
            } else if (e.key === "Tab") {
                e.preventDefault();
                this.autoComplete();
            }
        });

        this.inputEl.addEventListener("input", () => {
            this.autoCompleteIndex = 0;
            this.autoCompleteMatches = [];
        });

        this.inputEl.addEventListener("focus", () => {
            this.inputEl.style.boxShadow = "0 0 0 2px var(--accent-blood)";
        });

        this.inputEl.addEventListener("blur", () => {
            this.inputEl.style.boxShadow = "none";
        });
    },

    dispatch(input) {
        const trimmed = input.trim();
        if (!trimmed) return;

        // Сохранить в историю
        this.history.push(trimmed);
        this.historyIndex = this.history.length;

        // Вывести ввод пользователя
        Renderer.print(`<p class="user-input">&gt; ${trimmed}</p>`);

        // Парсинг и редьюс
        const action = parseInput(trimmed, this.state.phase);

        if (action) {
            // Применить редьюсер
            this.state = reducer(this.state, action);

            // Рендер результата
            Renderer.render(this.state);

            // Обновить sidebar
            Renderer.updateSidebar(this.state);

            // Звук
            if (this.state.ui.lastOutput) {
                if (this.state.ui.lastOutput.type === "error") Audio.error();
                else if (this.state.ui.lastOutput.type === "success" || this.state.ui.lastOutput.type === "game_start") Audio.success();
                else Audio.click();
            }
        }

        // Очистить ввод
        this.inputEl.value = "";
    },

    navigateHistory(dir) {
        const idx = this.historyIndex + dir;
        if (idx < 0 || idx > this.history.length) return;
        this.historyIndex = idx;
        this.inputEl.value = idx === this.history.length ? "" : this.history[idx];
    },

    autoComplete() {
        const input = this.inputEl.value.trim();
        if (!input) return;

        const words = input.split(" ");
        const last = words[words.length - 1].toLowerCase();

        if (this.autoCompleteMatches.length === 0) {
            // Получить все доступные команды
            const allVerbs = Object.keys(VerbMap);
            // Фильтровать по началу введённого текста
            this.autoCompleteMatches = allVerbs.filter(v => 
                v.startsWith(last) && v !== last
            );
            this.autoCompleteIndex = 0;
        }

        if (this.autoCompleteMatches.length === 0) return;

        // Найти совпадение и вставить его
        const matched = this.autoCompleteMatches[this.autoCompleteIndex % this.autoCompleteMatches.length];
        words[words.length - 1] = matched;
        this.autoCompleteIndex++;
        this.inputEl.value = words.join(" ");
    },

    renderWelcome() {
        let html = `<div class="welcome-screen">`;
        html += `<p class="game-title">V E R M I S</p>`;
        html += `<p class="game-subtitle">M I S T   &   M I R R O R S</p>`;
        html += `<p class="game-version">Text-RPG Prototype v3.2 — Enhanced</p>`;
        html += `<br>`;
        html += `<p class="welcome-text">Стеклянное Чистилище ждёт.</p>`;
        html += `<p class="welcome-text">Здесь отражения лгут, а туман хранит секреты.</p>`;
        html += `<br>`;
        html += `<p class="system-msg">═══ ПРОБУЖДЕНИЕ ═══</p>`;
        html += `<p>Темнота. Холод. Звон стекла.</p>`;
        html += `<p>Ты открываешь глаза. Бесконечные коридоры из зеркал и тумана.</p>`;
        html += `<p class="prompt-text">Ты не помнишь своего имени. Но ты должен его назвать.</p>`;
        html += `<p class="hint-msg">🎮 Совет: Используй сокращения (о, ж, и, с, к), нажимай ↑↓ для истории, Tab для автодополнения, кликай по словам!</p>`;
        html += `<p class="hint-msg">Введи имя персонажа:</p>`;
        html += `</div>`;

        Renderer.print(html);
    },

    // Для кнопок и кликабельных слов
    executeCommand(cmd) {
        this.inputEl.value = cmd;
        this.dispatch(cmd);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// РАЗДЕЛ 10: ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    const inputEl = document.getElementById("terminal-input");
    const outputEl = document.getElementById("terminal-output");
    const sidebarEl = document.getElementById("game-sidebar");
    const toggleBtn = document.getElementById("sidebar-toggle");

    if (!inputEl || !outputEl) {
        console.error("DOM elements not found");
        return;
    }

    // Toggle боковой панели на мобильных
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            if (sidebarEl) {
                sidebarEl.classList.toggle("hidden");
            }
        });
    }

    // Закрыть боковую панель при клике на контент на мобильных
    if (outputEl) {
        outputEl.addEventListener("click", () => {
            if (sidebarEl && window.innerWidth <= 900) {
                sidebarEl.classList.add("hidden");
            }
        });
    }

    // Инициализация аудио при первом клике
    document.addEventListener("click", () => {
        if (!Audio.context) Audio.init();
    }, { once: true });

    // Делегирование кликов по интерактивным словам (.clickable)
    document.addEventListener("click", (e) => {
        const target = e.target.closest(".clickable");
        if (target) {
            const cmd = target.getAttribute("data-cmd");
            if (cmd) {
                Audio.click();
                Game.executeCommand(cmd);
                // Закрыть боковую панель на мобильных
                if (sidebarEl && window.innerWidth <= 900) {
                    sidebarEl.classList.add("hidden");
                }
            }
        }
    });

    // Инициализация игры
    Game.init(inputEl, outputEl);

    // Инициализация кнопок быстрых команд
    document.querySelectorAll(".cmd-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            Audio.click();
            const cmd = btn.getAttribute("data-cmd");
            if (cmd) {
                Game.executeCommand(cmd);
                // Закрыть боковую панель на мобильных
                if (sidebarEl && window.innerWidth <= 900) {
                    sidebarEl.classList.add("hidden");
                }
            }
        });

        btn.addEventListener("mouseenter", () => {
            Audio.hover();
        });
    });

    // Фокус на ввод
    inputEl.focus();
});

// Фокус при клике на терминал (игнорируем кнопки и кликабельные слова)
document.addEventListener("click", (e) => {
    const inputEl = document.getElementById("terminal-input");
    if (!inputEl) return;
    if (e.target === inputEl) return;
    if (e.target.classList.contains("cmd-btn")) return;
    if (e.target.closest && e.target.closest(".clickable")) return;
    inputEl.focus();
});