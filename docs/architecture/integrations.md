---
id: integrations
title: Внешние интеграции
sidebar_label: Интеграции
---

# Внешние интеграции

Для каждой интеграции описаны: флоу, обработка ошибок, fallback стратегия и важные edge cases.

---

## OpenAI API

**Использует:** speaking-service (AI тренер), vocab-service (автоперевод), cefr-service (анализ эссе)

### AI Speaking тренер

Три компонента OpenAI работают в связке:

| Компонент | Модель | Назначение |
|---|---|---|
| Whisper STT | `whisper-1` | Транскрипция аудио студента в текст |
| GPT диалог | `gpt-4o-mini` | Ведение разговора + анализ ошибок |
| TTS | `tts-1` | Синтез аудио ответа AI |

**Системный промпт для GPT:**
```
You are an English conversation partner helping a student practice speaking.
Student level: {cefr_level}
Topic: {topic}
Session history: {last_5_exchanges}

Rules:
- Respond naturally and conversationally
- Keep responses to 2-3 sentences
- After each student message, add a JSON block with grammar corrections:
{"errors": [{"original": "...", "corrected": "...", "rule": "..."}]}
- If no errors, return {"errors": []}
```

**Обработка ошибок OpenAI:**

| Ошибка | Действие |
|---|---|
| 429 Rate Limit | Retry с exponential backoff (1s → 2s → 4s) |
| 500/503 OpenAI | Retry 3 раза, затем сообщить пользователю "Сервис временно недоступен" |
| Timeout (>10s) | Прервать запрос, retry один раз, fallback → текстовый ответ без аудио |
| Whisper не распознал | Попросить студента повторить ("Sorry, I didn't catch that. Could you repeat?") |

**Контроль расходов:**
- Каждая AI сессия ограничена: максимум 30 обменов или 60 минут
- Токены и стоимость сохраняются в `ai_sessions.openai_tokens_used` и `openai_cost_usd`
- При достижении лимита сессия автоматически завершается с итоговым анализом

### Автоперевод слов (vocab-service)

```mermaid
sequenceDiagram
    Student->>vocab-service: POST /vocabulary { word: "ubiquitous" }
    vocab-service->>DB: SELECT * FROM vocabulary_words WHERE word_normalized = 'ubiquitous'

    alt Слово есть в базе
        DB-->>vocab-service: Данные слова
        vocab-service-->>Student: 200 { word данные }
    else Слова нет
        vocab-service->>OpenAI GPT: Запросить перевод/определение/пример
        alt OpenAI доступен
            OpenAI-->>vocab-service: JSON с данными слова
            vocab-service->>DB: INSERT INTO vocabulary_words (is_approved=false)
            vocab-service->>OpenAI TTS: Сгенерировать произношение (async)
            vocab-service-->>Student: 200 { word данные }
        else OpenAI недоступен
            vocab-service-->>Student: 200 { word: "ubiquitous", translation: null, needs_manual_fill: true }
            Note over Student: Студент видит слово без перевода,<br/>может заполнить вручную
        end
    end
```

---

## Google Calendar API + Google Meet

**Использует:** calendar-service, speaking-service

### Аутентификация
Используется **Service Account** (не OAuth per user). Один Google аккаунт платформы, service account имеет доступ к его Google Calendar.

```json
// Конфиг service account (хранится в секретах, не в коде)
{
  "type": "service_account",
  "project_id": "1bilim-platform",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "client_email": "calendar@1bilim-platform.iam.gserviceaccount.com"
}
```

### Создание Live урока с Meet ссылкой

```mermaid
sequenceDiagram
    Curator->>calendar-service: POST /live-lessons { title, scheduled_at, marathon_id }
    calendar-service->>DB: INSERT live_lesson (status=scheduled, meet_link=null)
    calendar-service->>Google Calendar API: events.insert
    Note over calendar-service,Google Calendar API: conferenceData.createRequest<br/>generateConferenceData.conferenceSolutionKey=hangoutsMeet
    Google Calendar API-->>calendar-service: { id: event_id, hangoutLink: meet_url }
    calendar-service->>DB: UPDATE live_lesson SET google_event_id, meet_link
    calendar-service-->>Curator: { lesson со meet_link }
    Google Calendar API->>Students: Email с приглашением (автоматически)
```

**Если Google Calendar API недоступен при создании:**
```
1. live_lesson сохраняется в БД (meet_link = null)
2. Куратор получает ответ с предупреждением "Meet ссылка будет добавлена позже"
3. Scheduler каждые 5 минут ищет уроки с meet_link = null и повторяет запрос к Google
4. Как только ссылка получена — уведомление куратору и студентам
```

### Добавление студента при бронировании Speaking Room

```
POST /student/speaking/rooms/:id/book

1. Проверить max_participants через Redis атомарный счётчик
2. Google Calendar API: events.patch (добавить студента как attendee)
3. Google Calendar автоматически отправляет email студенту
4. Сохранить speaking_booking в БД
5. Scheduler за 1ч и 15мин: PUBLISH speaking_room.reminder
```

### Rate Limits Google Calendar API
- 1 million queries/day (достаточно для текущего масштаба)
- 500 queries/100 seconds per user
- При превышении: 429 → retry с backoff 30s → 60s → 120s

---

## Kaspi.kz API

**Использует:** payment-service

### Флоу оплаты

```mermaid
sequenceDiagram
    Student->>payment-service: POST /student/payments/initiate
    payment-service->>DB: INSERT payment (status=pending, provider=kaspi)
    payment-service->>Kaspi API: Создать счёт (amount, order_id, description)
    Kaspi API-->>payment-service: { payment_url, kaspi_payment_id }
    payment-service->>DB: UPDATE payment SET external_id=kaspi_payment_id
    payment-service-->>Student: { payment_url } → редирект в Kaspi
    Student->>Kaspi: Оплачивает через Kaspi.kz
    Kaspi->>payment-service: POST /webhooks/kaspi { order_id, status, amount }
    Note over payment-service: 1. Проверить HMAC подпись
    Note over payment-service: 2. Найти payment по external_id
    Note over payment-service: 3. Idempotency check
    payment-service->>DB: UPDATE payment SET status=success, paid_at=now()
    payment-service->>Redis: PUBLISH payment.success
    payment-service-->>Kaspi: 200 OK (важно! иначе Kaspi повторит webhook)
```

### Проверка подписи webhook
```go
func verifyKaspiSignature(body []byte, signature string, secret string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(body)
    expected := hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(expected), []byte(signature))
}
```

### Polling как fallback
Если webhook не пришёл в течение 5 минут (сетевой сбой):
```
Scheduler каждые 2 минуты проверяет payments со status=pending AND initiated_at < now() - 5min
→ Запрашивает статус у Kaspi API по external_id
→ Если success → обновляет статус, публикует payment.success
→ Если expired → ставит status=cancelled
```

---

## TipTopPay

**Использует:** payment-service

Аналогичный Kaspi флоу для оплаты Visa/Mastercard. Особенности:

- 3D Secure поддерживается автоматически на стороне TipTopPay
- Возвраты через `POST /refund` с amount и transaction_id
- Webhook подпись проверяется аналогично Kaspi (HMAC-SHA256)

---

## AWS S3 / MinIO

**Использует:** courses-service, speaking-service, chat-service, vocab-service, files-service

### Pre-signed Upload URLs

Клиент загружает файлы **напрямую в S3** через pre-signed URL — файл не проходит через сервер платформы. Это снимает нагрузку с backend и ускоряет загрузку.

```mermaid
sequenceDiagram
    Client->>files-service: POST /uploads/presign { filename, content_type, purpose }
    files-service->>files-service: Проверить mime_type и size limit
    files-service->>S3: GeneratePresignedPutObjectURL (TTL 5min)
    S3-->>files-service: presigned_url
    files-service->>DB: INSERT file_uploads (processing_status=pending)
    files-service-->>Client: { presigned_url, file_id }
    Client->>S3: PUT presigned_url (файл напрямую)
    S3-->>Client: 200 OK
    Client->>files-service: POST /uploads/:id/confirm
    files-service->>DB: UPDATE file_uploads SET processing_status=completed
```

### Обработка медиафайлов после загрузки

После подтверждения загрузки files-service запускает асинхронную обработку:

| Тип файла | Обработка |
|---|---|
| Изображение | Генерация thumbnail (400x210px для обложек, 100x100px для аватаров) |
| Видео (upload) | Транскодирование в HLS через ffmpeg, генерация thumbnail |
| Аудио | Извлечение duration, генерация waveform данных для UI |
| Голосовое ДЗ | Сохранение, duration check (max 3 минуты) |

### Signed URLs для защищённого контента

```go
// Генерация Signed URL для видео урока (TTL 30 минут)
func generateSignedURL(s3Key string) (string, error) {
    presignClient := s3.NewPresignClient(s3Client)
    req, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
        Bucket: aws.String(bucketName),
        Key:    aws.String(s3Key),
    }, s3.WithPresignExpires(30*time.Minute))
    return req.URL, err
}
```

---

## FCM / APNs

**Использует:** notification-service

### Архитектура доставки push

```mermaid
graph LR
    NS["notification-service"] --> FAS["Firebase Admin SDK"]
    FAS --> FCM["FCM\n(Android)"]
    FAS --> APNS["APNs\n(iOS)"]
    FCM --> AND["Android устройство"]
    APNS --> IOS["iOS устройство"]
```

Firebase Admin SDK используется как единый клиент для обоих платформ. APNs вызывается через FCM — не напрямую.

### Структура push-сообщения
```json
{
  "token": "{device_fcm_token}",
  "notification": {
    "title": "ДЗ проверено ✅",
    "body": "Куратор принял ваше домашнее задание"
  },
  "data": {
    "type": "homework_reviewed",
    "homework_id": "uuid",
    "section_id": "uuid",
    "marathon_id": "uuid"
  },
  "android": {
    "priority": "high",
    "notification": { "sound": "default", "channel_id": "homework" }
  },
  "apns": {
    "payload": { "aps": { "sound": "default", "badge": 1 } }
  }
}
```

`data` payload позволяет Flutter приложению открыть нужный экран при тапе на уведомление (deep link).

### Обработка невалидных токенов
```
При отправке push: FCM вернул "registration-token-not-registered"
→ UPDATE device_tokens SET is_active = false WHERE token = $1
→ Следующая отправка пропустит этот токен
```

Токен обновляется при каждом запуске приложения — устаревший автоматически заменяется актуальным.

### Тихие часы
notification-service проверяет `notification_settings.quiet_hours_*` перед отправкой push. Если текущее время попадает в тихие часы (с учётом `users.timezone`) — push откладывается до окончания тихих часов. Email в тихие часы не задерживается.

---

## SendGrid / AWS SES

**Использует:** notification-service, auth-service

### Шаблоны писем

| Событие | Шаблон | Кому |
|---|---|---|
| Регистрация | `welcome` | Студент |
| Приглашение | `invite` | Студент (логин + временный пароль) |
| Сброс пароля | `password_reset` | Любой пользователь |
| ДЗ проверено | `homework_reviewed` | Студент |
| Оплата прошла | `payment_success` | Студент |
| Истечение доступа | `access_expiring` | Студент |
| Напоминание о Live уроке | `live_lesson_reminder` | Студент |
| Напоминание о Speaking Room | `speaking_reminder` | Студент |

Шаблоны хранятся в SendGrid / SES. Язык письма определяется по `users.lang`.

### Условие отправки email
Email отправляется только при выполнении одного из условий:
- Событие является **критическим** (оплата, приглашение, сброс пароля, истечение доступа)
- Пользователь **неактивен более 24 часов** (`users.last_seen_at < now() - interval '24 hours'`)

Это предотвращает спам активным пользователям — они получают только push.

---

## YouTube oEmbed

**Использует:** courses-service (блок типа `video` с `source=youtube`)

При добавлении YouTube ссылки в конструкторе уроков:
```
POST /admin/sections/:id/blocks { type: "video", content: { url: "https://youtu.be/abc123" } }

1. Извлечь video_id из URL (regex)
2. GET https://www.youtube.com/oembed?url={url}&format=json
3. Получить: thumbnail_url, title, embed_html, duration
4. Сохранить в content.embed_id, content.thumbnail_url
```

Видео воспроизводится через YouTube iframe. Студент не может скачать видео — только смотреть в плеере.

**Edge case:** YouTube видео удалено / приватное → при открытии урока студент видит сообщение "Видео недоступно". Куратор должен заменить ссылку.

---

## Сводная таблица интеграций

| Сервис | Провайдер | Критичность | Fallback |
|---|---|---|---|
| AI Speaking | OpenAI GPT + Whisper + TTS | Высокая | Показать ошибку пользователю, retry 3 раза |
| Автоперевод слов | OpenAI GPT | Низкая | Сохранить слово без перевода |
| Live уроки / Speaking Rooms | Google Calendar API + Meet | Высокая | Сохранить урок без meet_link, добавить через retry cron |
| Оплата Kaspi | Kaspi.kz API | Критическая | Polling статуса каждые 2 минуты |
| Оплата картой | TipTopPay | Критическая | Polling статуса каждые 2 минуты |
| Хранение файлов | AWS S3 / MinIO | Критическая | Нет fallback — недоступность S3 блокирует загрузку |
| Push Android | FCM | Средняя | Email fallback (если неактивен 24ч) |
| Push iOS | APNs (через FCM) | Средняя | Email fallback |
| Email | SendGrid / AWS SES | Средняя | Retry 3 раза, затем лог |
| Видео в уроках | YouTube oEmbed | Низкая | Показать ссылку вместо embed |
