tools/protocol — описание и руководство


# Кратко


Назначение: единый источник истины для сетевого бинарного протокола движка (сервер ↔ клиент ↔ гейтвей), основанный на FlatBuffers.
Что внутри: схема FlatBuffers (messages.fbs), скрипты генерации, правила версионирования, рекомендации по расширению.
Результат генерации: типы и билдеры доступны в packages/net/src/protocol/generated, а удобные кодеки — в packages/net/src/protocol/codec.ts.

# Состав пакета


schema/messages.fbs — главная схема протокола FlatBuffers. Содержит все публичные сообщения и Envelope.
(опционально) scripts/ — скрипты генерации (в проекте обычно вызываются через bun run gen:protocol).
README.md — этот документ.

# Быстрый старт


Установите flatc (FlatBuffers Compiler):

macOS: brew install flatbuffers
Linux: скачайте релиз flatc с GitHub и положите в PATH
Windows: скачайте flatc.exe и добавьте в PATH

Сгенерируйте код протокола:

bun run gen:protocol

Используйте кодеки в runtime:

Импорты: import { decodeEnvelope, encodeServerHello, encodeServerSnapshot, encodeCommand } from "@iamtoxa/md-engine-net"

# Структура схемы (messages.fbs)


Идентификатор файла: file_identifier "MDE0" — защита от неверного типа сообщения при декодировании.

# Базовые типы (struct)


Vec3f { x:float; y:float; z:float } — 3D-вектор
Quatf { x:float; y:float; z:float; w:float } — кватернион
EntityId { id_lo:uint32; gen_hi:uint32 } — 64-битный ID как два u32 (младшая часть id, старшая — поколение)

# Служебные сообщения


Ping { client_time_ms:uint64 }
Pong { server_time_ms:uint64; echo_client_time_ms:uint64 }
Error { code:uint16; message:string }

# Handshake и сервисная информация


ClientHello { client_version:string; protocol_major:uint16; protocol_minor:uint16; capabilities:uint32 }
ServerHello { server_version:string; protocol_major:uint16; protocol_minor:uint16; world_id:uint32; tick_rate:uint16; time_ms:uint64 }
ServerInfo { world_id:uint32 } — уведомление о смене мира/зоны (например, при миграции)

# Игровой ввод и команды


ClientInput { seq:uint32; client_tick:uint32; move:Vec3f; view_dir:Vec3f; buttons:uint32; analog1:float; analog2:float }
Command { type:uint16; payload:[ubyte] } — универсальный расширяемый канал для плагинов. Правила:
Диапазоны type: 0–999 — зарезервировано ядром; 1000–9999 — общие расширения; 10000+ — модули.
payload — произвольный бинарный формат (можно отправлять вложенные FlatBuffers, msgpack, CBOR и т. п.).

# Снапшоты мира


EntitySnapshot { id:EntityId; mask:uint32; // bit0=Transform, bit1=Velocity, bit2=Health, bit3=Owner pos:Vec3f; rot:Quatf; vel:Vec3f; hp:uint32; owner:uint32; }
ServerSnapshot { full:bool; // true — ключевой кадр; false — дельта server_tick:uint32; last_input_seq_acked:uint32; entities:[EntitySnapshot]; // видимые/изменённые entity removed:[EntityId]; // вышедшие из AOI }

# Конверт Envelope


union Body { Ping, Pong, ClientHello, ServerHello, ServerInfo, ClientInput, Command, ServerSnapshot, Error }
Envelope { seq:uint32; sent_at_ms:uint64; body:Body }
seq — номер сообщения (может использоваться отправителем произвольно)
sent_at_ms — время отправки отправителя (ms since epoch, uint64)

# Генерация кода


Команда: bun run gen:protocol
Что делает:
Вызывает flatc для TypeScript, генерирует messages_generated.js и d.ts (если включено) в packages/net/src/protocol/generated
Не редактируйте сгенерированные файлы вручную

# Импорт и использование


Декодирование: const env = decodeEnvelope(bytes)
Кодирование:
Ping/Pong/Hello/Info: encodePing/encodePong/encodeServerHello/encodeServerInfo
Снапшоты: encodeServerSnapshot(full, tick, lastInputSeqAck, entities, removed)
Команды: encodeCommand(seq, type, payload)

# Примеры использования


Отправка ServerHello const buf = encodeServerHello(1, "1.0.0", PROTOCOL_MAJOR, PROTOCOL_MINOR, worldId, 30, BigInt(Date.now())) ws.send(buf)

Декодирование входящего сообщения const env = decodeEnvelope(message) if (!env) return switch (env.bodyType) { case "Ping": /* ... / break case "ClientInput": / читать поля, переносить в ECS */ break case "Command": { const type = env.body.type() const payload = env.body.payloadArray() ?? new Uint8Array(0) // Передать в зарегистрированный обработчик по type break } }

Формирование ServerSnapshot вручную: import { encodeServerSnapshot } from "@iamtoxa/md-engine-net" const entities = [ { id_lo: 123, gen_hi: 0, mask: (1<<0)|(1<<1), pos: [0,0,0], rot: [0,0,0,1], vel: [1,0,0] } ] const removed = [{ id_lo: 456, gen_hi: 0 }] const snapBuf = encodeServerSnapshot(false, serverTick, lastSeqAck, entities, removed)


# Правила эволюции протокола


Версионирование
PROTOCOL_MAJOR — меняется при несовместимых изменениях (удаление/переименование полей/таблиц, изменение семантики)
PROTOCOL_MINOR — при обратносуместимых (добавление новых сообщений, полей с дефолтами)
Совместимость
Добавляйте новые поля в конец таблиц с безопасными дефолтами
Не меняйте существующие поля и их типы
Для экспериментов используйте Command вместо изменений базовой схемы
Процесс изменения
Измените messages.fbs
Пересоберите протокол: bun run gen:protocol
Обновите кодеки (packages/net/src/protocol/codec.ts): добавьте новые encode*/decode ветки
При необходимости обновите PROTOCOL_MAJOR/MINOR
Прогоните сборку и тесты

# Рекомендации по моделированию (FlatBuffers)


Используйте struct для маленьких POD (Vec3f, Quatf, EntityId) — без накладных расходов
Используйте table для сообщений и энтити-снимков
Изменяемость: вместо optional полей используйте битовую mask (как в EntitySnapshot), это уменьшает двусмысленность
Вектора структур дешевле вектора таблиц
Для vectors of structs используйте start<Field>Vector/endVector и создавайте элементы в обратном порядке при сборке
В TypeScript-генерации не всегда есть методы createXxx: используйте универсальный путь startXxx/addField/endXxx. Пример: MDE.ServerSnapshot.startRemovedVector(b, removed.length) for (let i = removed.length - 1; i >= 0; i--) MDE.EntityId.createEntityId(b, ...) const remVec = b.endVector() MDE.ServerSnapshot.startServerSnapshot(b) ... const snap = MDE.ServerSnapshot.endServerSnapshot(b)

# Производительность и ограничения


Сообщения должны быть как можно компактнее: используйте float32, uint32 и маски изменений
Бюджеты сети:
Размер кадра WebSocket ограничивается на уровне gateway (см. protocolLimits в конфиге)
Для снапшотов используйте maxEntitiesPerSnapshot и maxBytesPerSnapshot (реализация — на стороне runtime)
Отправитель обязан не превышать бюджет; при переполнении — обрезайте сущности по приоритету (self → ближние → дальние)

# Расширение через Command (рекомендуемый путь для модулей)


type: uint16 диапазоны:
0–999 — ядро (зарезервировано)
1000–9999 — общие расширения/официальные модули
10000–65535 — кастомные модули/игры
payload: любые байты. Практичные варианты:
вложенные FlatBuffers (собственная схема модуля)
MessagePack/CBOR/Protobuf
простой фиксированный бинарный формат
Регистрация обработчиков:
На сервере (world worker) через WorldContext.registerMessage(type, handler)
На стороне gateway можно перехватывать входящие кадры (registerWsHandler) для кастомных команд до передачи в мир

# Расширение схемы (когда нужно менять базовый протокол)


Добавление нового сообщения:
Добавьте table NewMsg в messages.fbs
Добавьте в union Body NewMsg
Сгенерируйте код (gen:protocol)
Добавьте ветку decodeEnvelope в codec.ts
При необходимости — функцию encodeNewMsg
Обновите PROTOCOL_MINOR (или MAJOR, если breaking)
Добавление поля:
Добавляйте в конец таблицы
Устанавливайте безопасные дефолты (0, пустые структуры)
Изменение/удаление поля — breaking, увеличивайте PROTOCOL_MAJOR

# Безопасность и валидация


Envelope.file_identifier защищает от неверной укладки
Gateway проверяет размеры сообщений (maxWsFrameBytes, maxMessageBytes)
Для неизвестных Body типов — decoder возвращает null (см. decodeEnvelope)

# Отладка и распространённые ошибки


Ошибка TS: property 'createXxx' does not exist — используйте последовательность start/add/end вместо createXxx
Несоответствие версий: клиент и сервер должны совпадать по PROTOCOL_MAJOR/PROTOCOL_MINOR. При несовпадении ожидайте отказ на уровне handshake
Не забывайте регенерировать код после изменений схемы

# Тестирование


Покройте кодеки простыми тестами:
encode→decode для Ping/Pong/Hello/Info
сборка ServerSnapshot с несколькими entities и removed
Command: шифр/декодирование произвольной полезной нагрузки
Проверяйте, что decodeEnvelope корректно различает Body типы

# Процесс работы с протоколом в проекте


Все изменения схемы происходят в tools/protocol/schema/messages.fbs
Генерация — единая команда bun run gen:protocol
Пакет packages/net экспортирует:
версии протокола (PROTOCOL_MAJOR/MINOR)
кодеки encode*/decodeEnvelope
типы для снапшотов (EntitySnapInput)

# FAQ


Можно ли расширять схему из модулей? Да, но это требует общей регенерации протокола и синхронизации версий. Для независимости используйте Command.
Почему FlatBuffers? Нулевая (почти) аллокация при декодировании, компактность, кросс-языковая совместимость, стабильный бинарный формат.
Нужно ли квантовать координаты? На первом этапе нет (float32). Позже можно ввести квантование/пакетные дельты для трафика.

# Команды


Генерация: bun run gen:protocol
Пересборка сервера: bun run build
Запуск сервера: bun run apps/server/src/index.ts

# Контакты и поддержка


Вопросы по протоколу поднимайте в репозитории, раздел issues, метка protocol.
Все изменения схемы сопровождайте заметками в CHANGELOG и bump версии протокола.