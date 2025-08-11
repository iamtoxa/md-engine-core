packages/net — сетевая библиотека (протокол + IPC)


# Кратко


Назначение: общие сетевые примитивы для всех подсистем движка.
Что внутри:
Codec протокола FlatBuffers: encode*/decodeEnvelope для всех сообщений.
IPC поверх SharedArrayBuffer: высокопроизводительная очередь сообщений между воркерами (gateway ↔ world).
Версии протокола и полезные типы.
Для кого: runtime workers (gateway/world/job), клиентские тулзы, тесты.

# Структура пакета


src/protocol/generated — сгенерированные FlatBuffers-типы (messages_generated.js).
src/protocol/codec.ts — кодеки высокого уровня (encode*/decodeEnvelope).
src/protocol/version.ts — константы PROTOCOL_MAJOR/PROTOCOL_MINOR.
src/ipc/ring.ts — однописатель/одночитатель кольцевая очередь на SAB.
src/index.ts — публичные экспорты пакета.

# Экспорты


Протокол:
decodeEnvelope(bytes) → EnvelopeDecoded | null
encodePing, encodePong
encodeServerHello, encodeServerInfo
encodeCommand(type, payload)
encodeServerSnapshot(full, tick, lastInputSeqAck, entities, removed)
EntitySnapInput тип для сборки снапшотов
PROTOCOL_MAJOR, PROTOCOL_MINOR
IPC:
createRing(bytes)
attachRing(sab)
writerEnqueue(ring, type, flags, payload)
readerDequeue(ring) → { type, flags, payload } | null
ringStats(ring)
RingFlags (например, Droppable)

# Протокол (FlatBuffers)


Единый Envelope с union Body. Схема хранится в tools/protocol/schema/messages.fbs и генерируется в этот пакет командой bun run gen:protocol.
Поддерживаемые сообщения:
Ping/Pong — поддержка latency/ping.
ClientHello/ServerHello — рукопожатие, версия протокола, мир, тикрейт, текущее время.
ServerInfo — уведомление о смене world_id (миграция зон).
ClientInput — вход клиента (seq, client_tick, move, view_dir, buttons, analog1/2).
Command — универсальный канал расширений (type:uint16, payload:[ubyte]).
ServerSnapshot — снимок мира (full/дельта, server_tick, last_input_seq_acked, entities[], removed[]).
Error — код/сообщение ошибки по каналу протокола.
Версионирование:
PROTOCOL_MAJOR меняется при несовместимых правках схемы.
PROTOCOL_MINOR — при добавлении назад совместимых сообщений/полей.
Расширения:
Рекомендуется использовать Command для модульных/кастомных сообщений. Диапазоны type: 0–999 ядро; 1000–9999 общие расширения; 10000+ кастом.

# Codec: encode*/decodeEnvelope


decodeEnvelope(bytes) возвращает объект { bodyType, env, body } или null при ошибке/неизвестном типе.
encode* функции формируют Envelope и тело сообщения, уделяя внимание оптимальной сборке структур и векторов FlatBuffers.
Пример:
const hello = encodeServerHello(1, version, PROTOCOL_MAJOR, PROTOCOL_MINOR, worldId, tickRate, BigInt(Date.now()))
const env = decodeEnvelope(message); if (env?.bodyType === "ClientInput") { /* ... */ }

# Сборка ServerSnapshot


encodeServerSnapshot(full, serverTick, lastInputSeqAck, entities, removed)
EntitySnapInput включает:
id_lo, gen_hi, mask (битовая маска включённых компонентов)
pos, rot, vel, hp, owner — опциональные поля
Внутри codec используются оптимальные последовательности FlatBuffers (vector в обратном порядке, struct где возможно).

# IPC: кольцевая очередь SAB


Модель: один писатель, один читатель. Сообщения бинарные (Uint8Array).
Применение: обмен между воркерами в одном процессе без копирования данных, минимальная задержка.
API:
createRing(totalBytes) → { sab, view } — создаёт новую очередь и возвращает SharedArrayBuffer.
attachRing(sab) → ring — подключение к существующей очереди.
writerEnqueue(ring, type, flags, payload) → boolean — неблокирующая попытка записи.
readerDequeue(ring) → { type, flags, payload } | null — чтение одного сообщения, либо null если очередь пуста.
ringStats(ring) → { sizeBytes, usedBytes, freeBytes, dropped, enq, deq } — диагностические счётчики.
RingFlags:
0 — без флагов (на переполнение writerEnqueue вернёт false; вызывающая сторона сама решает, что делать).
Droppable — допускается сбрасывать при переполнении входного буфера получателя (используйте для снапшотов/низкоприоритетных сообщений).
Формат слота:
Заголовок: type:uint16, flags:uint16, len:uint32
Тело: len байт полезной нагрузки
Поведение:
Неблокирующее. При отсутствии места writerEnqueue вернёт false; для Droppable вы можете перезапустить отправку позже или молча проигнорировать.
Предназначено для высокочастотных потоков: world → gateway снапшоты; gateway → world входящие WS кадры.
Паттерны:
Gateway:
toWorld = attachRing(inputSab); writerEnqueue(toWorld, 1, 0, wsMessage)
fromWorld = attachRing(outputSab); readerDequeue в таймере и ws.send(payload)
World:
inRing = attachRing(inputSab); читать readerDequeue и применять вход/команды
outRing = attachRing(outputSab); writerEnqueue с собранными снапшотами (RingFlags.Droppable)

# Интеграция с gateway


После апгрейда WS:
Создать пары колец createRing для клиента
Отправить их SAB в Supervisor → World
Отправить клиенту ServerHello
Для входящих WS:
decodeEnvelope; Ping → отдать Pong
Остальное — writerEnqueue в toWorld
Для исходящих:
читать из fromWorld и ws.send(payload)
Отправка ServerInfo при смене зоны:
По команде Supervisor собрать encodeServerInfo и ws.send(buf)

# Интеграция с world


На init:
attachRing к SAB, пришедшим из Supervisor
setupGameKit и тики ECS
На каждом тике:
Считать вход: readerDequeue(inRing), decodeEnvelope:
ClientInput → применить к InputState
Command → передать обработчику плагина по type
Сформировать снапшот encodeServerSnapshot и writerEnqueue(outRing, Droppable)

# Размеры и лимиты


Размеры кадров WS контролируются на уровне gateway конфигурацией protocolLimits (maxWsFrameBytes, maxMessageBytes).
Для IPC кольца выбирайте объём с запасом:
inputSabBytes — поток входящих сообщений (обычно десятки КБ).
outputSabBytes — поток снапшотов (сотни КБ–МБ, зависит от AOI и частоты).
При переполнении входного буфера:
writerEnqueue вернёт false; инициатор должен считать это backpressure и реагировать (например, закрыть соединение или увеличить буфер).
Для снапшотов используйте Droppable, чтобы старые кадры не блокировали новые.

# Версии протокола


Импортируйте PROTOCOL_MAJOR/MINOR в gateway при формировании ServerHello и на клиенте при проверке совместимости.
При несовместимости ожидайте отказ на уровне handshake.

# Расширение протокола


Стандартный путь — через Command:
На клиенте/сервере формируйте encodeCommand(seq, type, payload)
В world регистрируйте обработчики по type (через плагин API runtime)
Если нужно добавить новое базовое сообщение:
Меняйте tools/protocol/schema/messages.fbs
Выполняйте bun run gen:protocol
Обновляйте codec.ts (decodeEnvelope ветка + свой encode*)
При необходимости увеличьте PROTOCOL_MINOR/MAJOR

# Тестирование


Рекомендуется покрыть:
encode→decode для Ping/Pong/Hello/Info
Command с произвольной полезной нагрузкой
Сборку ServerSnapshot с несколькими сущностями и removed
IPC ring: сценарии очереди на грани заполнения, корректность чтения/записи, Droppable

# Производительность и рекомендации


FlatBuffers минимизирует аллокации при декодировании; старайтесь переиспользовать буферы в горячем пути.
Для снапшотов:
Квантовать/сжимать полезную нагрузку можно на уровне игры, но избегайте тяжелой сериализации.
Соблюдайте бюджеты: maxEntitiesPerSnapshot и maxBytesPerSnapshot на стороне runtime.
IPC кольца:
Обновляйте из одного потока на запись и одном на чтение; не используйте одно кольцо из нескольких писателей одновременно.
Снижайте частоту поллинга (batched read: читать до N сообщений за итерацию).

# Распространённые ошибки


Забыли пересгенерировать протокол после правок схемы — не совпадают типы/offset в рантайме.
Использование одного SAB кольца из нескольких писателей — гонки и порча очереди.
Отправка слишком больших кадров WS — gateway закроет соединение по лимиту размера.

# Пример кода (минимум)


Gateway, обработка Ping/Pong и форвард: const env = decodeEnvelope(message) if (env?.bodyType === "Ping") { const now = BigInt(Date.now()) const echo = BigInt(env.body.clientTimeMs()) ws.send(encodePong((env.env.seq()>>>0)+1, now, echo)) } else { writerEnqueue(client.toWorld, 1, 0, message) }

World, чтение инпута и отправка снапшота: let msg; let it=0 while ((msg = readerDequeue(inRing)) && it++<256) applyClientInput(msg.payload) const buf = encodeServerSnapshot(full, tick, lastSeq, entities, removed) writerEnqueue(outRing, 2, RingFlags.Droppable, buf)


# Поддержка и вклад


Ошибки и улучшения по кодекам и IPC — через issues/PR.
Изменения схемы протокола инициируются в tools/protocol и сопровождаются bump версии PROTOCOL_MINOR/MAJOR.