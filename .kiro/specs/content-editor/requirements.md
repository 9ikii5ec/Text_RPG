# Requirements Document

**Feature:** Content Editor for Text RPG

## Introduction

Content Editor — это десктоп-приложение на Electron для создания и редактирования игрового контента текстовой RPG (локации, монстры, предметы, NPC, действия). Приложение лежит в репозитории проекта и запускается командой `npm run editor` без установки. Приложение имеет прямой доступ к файловой системе — сохранение происходит мгновенно в нужные папки без дополнительных действий пользователя.

## Glossary

- **Content_Editor**: Десктоп-приложение на Electron для управления игровым контентом
- **Entity**: Игровая сущность (monster, item, npc) с уникальным идентификатором
- **Location**: Игровая локация с описанием, выходами и связанными сущностями
- **Action**: Действие игрока с глаголами, правилами и fallback-ответами
- **Manifest**: Реестр всех файлов контента в world/manifest.json
- **Fate**: Игровой класс персонажа (предыстория) со стартовыми характеристиками и предметами
- **JSON_Schema**: Схема валидации структуры JSON-файлов

## Requirements

### Requirement 1: Location Management

**User Story:** Как гейм-дизайнер, я хочу создавать и редактировать локации, чтобы наполнять мир игры новыми местами.

#### Acceptance Criteria

1. WHEN пользователь открывает форму создания локации, THE Content_Editor SHALL отобразить поля: id, title, titleEn, tags, description, atmosphere, exits, entities, difficultyModifier
2. WHEN пользователь заполняет поле exits, THE Content_Editor SHALL предоставить интерфейс для добавления выходов с полями: target, label, direction, durationSeconds
3. WHEN пользователь заполняет поле entities, THE Content_Editor SHALL предоставить мультиселект с существующими сущностями из world/entities/
4. WHEN пользователь сохраняет локацию, THE Content_Editor SHALL создать JSON-файл в директории world/locations/ с именем {id}.json
5. WHEN локация сохранена, THE Content_Editor SHALL добавить путь к файлу в world/manifest.json в массив locations
6. IF JSON-файл с таким id уже существует, THEN THE Content_Editor SHALL запросить подтверждение на перезапись
7. WHILE пользователь редактирует локацию, THE Content_Editor SHALL отображать предпросмотр JSON-структуры в реальном времени

### Requirement 2: Monster Management

**User Story:** Как гейм-дизайнер, я хочу создавать и редактировать монстров, чтобы добавлять новых противников в игру.

#### Acceptance Criteria

1. WHEN пользователь открывает форму создания монстра, THE Content_Editor SHALL отобразить поля: id, kind (monster), name, aliases, tags, hp, maxHp, damage, loot, description, dialogue
2. WHEN пользователь заполняет поле loot, THE Content_Editor SHALL предоставить мультиселект с предметами из world/entities/items.json
3. WHEN пользователь заполняет поле dialogue, THE Content_Editor SHALL предоставить интерфейс для добавления диалогов с ключами: closed, warm, hostile
4. WHEN пользователь сохраняет монстра, THE Content_Editor SHALL добавить сущность в файл world/entities/monsters.json в массив entities
5. IF монстр с таким id уже существует, THEN THE Content_Editor SHALL обновить существующую запись
6. WHEN монстр сохранён, THE Content_Editor SHALL проверить наличие файла world/entities/monsters.json в manifest.json

### Requirement 3: Item Management

**User Story:** Как гейм-дизайнер, я хочу создавать и редактировать предметы, чтобы расширять инвентарь игры.

#### Acceptance Criteria

1. WHEN пользователь открывает форму создания предмета, THE Content_Editor SHALL отобразить поля: id, kind (item), name, aliases, tags, description, statBonuses (опционально), damageType (опционально)
2. WHEN пользователь заполняет поле statBonuses, THE Content_Editor SHALL предоставить интерфейс для указания бонусов к характеристикам: strength, agility, luck, wisdom, constitution, charisma, perception, intelligence
3. WHEN пользователь заполняет поле damageType, THE Content_Editor SHALL предоставить выбор из предопределённых типов урона: fire, ice, poison, holy, physical
4. WHEN пользователь сохраняет предмет, THE Content_Editor SHALL добавить сущность в файл world/entities/items.json в массив entities
5. IF предмет с таким id уже существует, THEN THE Content_Editor SHALL обновить существующую запись

### Requirement 4: NPC Management

**User Story:** Как гейм-дизайнер, я хочу создавать и редактировать NPC, чтобы населить мир игры персонажами.

#### Acceptance Criteria

1. WHEN пользователь открывает форму создания NPC, THE Content_Editor SHALL отобразить поля: id, kind (npc), name, aliases, tags, hp, maxHp, damage, loot, description, dialogue, attitudeByFate
2. WHEN пользователь заполняет поле attitudeByFate, THE Content_Editor SHALL предоставить интерфейс для указания отношений с каждой Fate из world.json
3. WHEN пользователь заполняет поле tags, THE Content_Editor SHALL предложить автодополнение из существующих тегов NPC: humanoid, merchant, guard, peaceful_npc, hostile, mystic
4. WHEN пользователь сохраняет NPC, THE Content_Editor SHALL определить целевой файл на основе тегов или создать новый файл для группы NPC
5. IF NPC относится к существующей группе (например, agerut_npcs), THEN THE Content_Editor SHALL добавить сущность в соответствующий файл

### Requirement 5: Action Management

**User Story:** Как гейм-дизайнер, я хочу создавать и редактировать действия игрока, чтобы расширять интерактивность игры.

#### Acceptance Criteria

1. WHEN пользователь открывает форму создания действия, THE Content_Editor SHALL отобразить поля для verbs (id, words, tags, defaultTarget) и rules (id, verb, targetKind, stat, difficulty, dice, successText, failureText, criticalFailureText)
2. WHEN пользователь заполняет поле verbs, THE Content_Editor SHALL предоставить интерфейс для добавления нескольких глаголов-синонимов
3. WHEN пользователь заполняет поле rules, THE Content_Editor SHALL предоставить форму для создания правил с проверкой что verb существует в verbs
4. WHEN пользователь заполняет поле fallbacks, THE Content_Editor SHALL предоставить интерфейс для создания контекстных ответов на основе verbTags и targetTags
5. WHEN пользователь сохраняет действия, THE Content_Editor SHALL создать или обновить JSON-файл в директории world/actions/

### Requirement 6: Fate Management

**User Story:** Как гейм-дизайнер, я хочу создавать и редактировать классы персонажей (Fate), чтобы предлагать игрокам разные стили игры.

#### Acceptance Criteria

1. WHEN пользователь открывает форму создания Fate, THE Content_Editor SHALL отобразить поля: id, name, nameEn, epithet, description, stats, startingItems, reputation, quote
2. WHEN пользователь заполняет поле stats, THE Content_Editor SHALL предоставить интерфейс для указания всех характеристик: hp, maxHp, strength, agility, luck, wisdom, constitution, charisma, perception, intelligence
3. WHEN пользователь заполняет поле startingItems, THE Content_Editor SHALL предоставить мультиселект с предметами из world/entities/items.json
4. WHEN пользователь сохраняет Fate, THE Content_Editor SHALL обновить объект fates в файле world/world.json
5. IF Fate с таким id уже существует, THEN THE Content_Editor SHALL обновить существующую запись

### Requirement 7: Manifest Synchronization

**User Story:** Как гейм-дизайнер, я хочу чтобы манифест автоматически обновлялся, чтобы игра корректно загружала весь контент.

#### Acceptance Criteria

1. WHEN создаётся новый файл контента, THE Content_Editor SHALL добавить путь к файлу в соответствующий массив manifest.json
2. WHEN файл контента удаляется, THE Content_Editor SHALL удалить путь из manifest.json
3. WHEN путь уже существует в манифесте, THE Content_Editor SHALL пропустить добавление дубликата
4. THE Content_Editor SHALL сохранять manifest.json с отсортированными массивами для удобства чтения
5. IF manifest.json не существует, THEN THE Content_Editor SHALL создать его с базовой структурой

### Requirement 8: JSON Validation

**User Story:** Как гейм-дизайнер, я хочу валидацию данных перед сохранением, чтобы избежать ошибок в игре.

#### Acceptance Criteria

1. WHEN пользователь пытается сохранить сущность, THE Content_Editor SHALL проверить что все обязательные поля заполнены
2. WHEN проверяется поле id, THE Content_Editor SHALL убедиться что оно соответствует формату snake_case
3. WHEN проверяются числовые поля (hp, damage, difficulty), THE Content_Editor SHALL убедиться что значения положительные
4. IF валидация не пройдена, THEN THE Content_Editor SHALL отобразить список ошибок с указанием полей
5. WHEN валидация пройдена успешно, THE Content_Editor SHALL разрешить сохранение

### Requirement 9: User Interface

**User Story:** Как гейм-дизайнер, я хочу удобный интерфейс, чтобы быстро создавать контент без ошибок.

#### Acceptance Criteria

1. WHEN пользователь открывает приложение, THE Content_Editor SHALL отобразить главную страницу с навигацией по типам контента: Locations, Entities (Monsters, Items, NPCs), Actions, Fates
2. WHEN пользователь выбирает тип контента, THE Content_Editor SHALL отобразить список существующих записей с возможностью редактирования и удаления
3. WHEN пользователь редактирует сущность с текстовыми полями, THE Content_Editor SHALL предоставить многострочные текстовые поля для description, atmosphere, dialogue
4. WHILE пользователь работает с контентом, THE Content_Editor SHALL автоматически сохранять черновик в localStorage каждые 30 секунд
5. WHEN пользователь возвращается к редактированию, THE Content_Editor SHALL предложить восстановить черновик если он существует

### Requirement 9.1: Direct File System Access

**User Story:** Как гейм-дизайнер, я хочу чтобы файлы сохранялись напрямую в папки проекта без дополнительных действий, чтобы не тратить время на выбор пути сохранения.

#### Acceptance Criteria

1. WHEN пользователь запускает приложение командой `npm run editor`, THE Content_Editor SHALL автоматически определить корневую папку проекта относительно своего расположения
2. WHEN пользователь создаёт новую сущность любого типа, THE Content_Editor SHALL сохранить её в соответствующий JSON-файл без запроса пути
3. WHEN сохраняется монстр, THE Content_Editor SHALL добавить запись в `world/entities/monsters.json`
4. WHEN сохраняется предмет, THE Content_Editor SHALL добавить запись в `world/entities/items.json`
5. WHEN сохраняется локация, THE Content_Editor SHALL создать файл `world/locations/{id}.json`
6. WHEN сохраняется NPC, THE Content_Editor SHALL определить целевой файл на основе тегов или создать новый файл в `world/entities/`
7. WHEN сохраняется действие, THE Content_Editor SHALL создать или обновить файл в `world/actions/`
8. WHEN сохраняется Fate, THE Content_Editor SHALL обновить объект fates в `world/world.json`
9. WHEN происходит сохранение, THE Content_Editor SHALL отобразить уведомление "Сохранено в {путь_к_файлу}"
10. IF файл не существует, THEN THE Content_Editor SHALL создать его с правильной структурой

### Requirement 10: Application Launch

**User Story:** Как гейм-дизайнер, я хочу запускать редактор двойным кликом по exe-файлу, чтобы быстро начать работу без командной строки.

#### Acceptance Criteria

1. WHEN пользователь запускает `editor.exe`, THE Content_Editor SHALL открыть окно приложения
2. WHEN приложение запускается, THE Content_Editor SHALL автоматически определить папку проекта относительно расположения exe-файла (на один уровень выше)
3. WHEN приложение запускается, THE Content_Editor SHALL автоматически загрузить все существующие JSON-файлы из папки world/
4. WHEN приложение запускается впервые, THE Content_Editor SHALL создать конфигурационный файл если он не существует
5. THE Content_Editor SHALL хранить exe-файл в папке `editor/` в корне репозитория
6. THE Content_Editor SHALL также поддерживать запуск через `npm run editor` для разработчиков
7. WHEN создаётся exe-файл, THE Content_Editor SHALL использовать electron-builder для упаковки

### Requirement 11: Content Export

**User Story:** Как гейм-дизайнер, я хочу экспортировать контент в файлы, чтобы использовать их в игре.

#### Acceptance Criteria

1. WHEN пользователь нажимает кнопку экспорта, THE Content_Editor SHALL скачать все изменения как JSON-файлы с правильной структурой
2. WHEN экспортируется сущность, THE Content_Editor SHALL включить её в правильный JSON-файл с сохранением формата (entities обёрнуты в объект с ключом entities)
3. WHEN экспортируется локация, THE Content_Editor SHALL сохранить её как отдельный файл с именем {id}.json
4. THE Content_Editor SHALL предоставить возможность скачать все файлы разом в ZIP-архиве
5. WHEN скачивается ZIP-архив, THE Content_Editor SHALL сохранить структуру директорий: world/locations/, world/entities/, world/actions/, world/world.json, world/manifest.json

### Requirement 12: Content Browser

**User Story:** Как гейм-дизайнер, я хочу просматривать существующий контент, чтобы понимать что уже создано.

#### Acceptance Criteria

1. WHEN пользователь открывает браузер контента, THE Content_Editor SHALL загрузить и отобразить все сущности из существующих JSON-файлов
2. WHEN пользователь ищет контент, THE Content_Editor SHALL предоставить фильтрацию по типу, тегам и текстовому поиску по name и description
3. WHEN пользователь выбирает сущность в браузере, THE Content_Editor SHALL отобразить её детали и предложить редактирование
4. WHEN пользователь удаляет сущность, THE Content_Editor SHALL запросить подтверждение и удалить запись из JSON-файла
5. IF удаляемая сущность связана с локациями (в поле entities), THEN THE Content_Editor SHALL предупредить о нарушении связей

### Requirement 13: Reference Integrity

**User Story:** Как гейм-дизайнер, я хочу видеть предупреждения о нарушении связей, чтобы избегать битых ссылок в игре.

#### Acceptance Criteria

1. WHEN пользователь указывает target в exit локации, THE Content_Editor SHALL проверить существование локации с таким id
2. WHEN пользователь указывает entity в локации, THE Content_Editor SHALL проверить существование сущности с таким id
3. WHEN пользователь указывает loot или startingItems, THE Content_Editor SHALL проверить существование предметов
4. IF связанная сущность не найдена, THEN THE Content_Editor SHALL отобразить предупреждение с предложением создать или выбрать существующую
5. WHILE пользователь редактирует id сущности, THE Content_Editor SHALL предупредить что изменение id может нарушить существующие связи
