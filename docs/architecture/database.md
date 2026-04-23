---
id: database
title: Схема базы данных
sidebar_label: Схема БД
---

# База данных

PostgreSQL 15+. Полная production-схема для передачи разработчикам.

## Глобальные принципы

| Принцип | Реализация |
|---|---|
| Primary Keys | UUID v4 через `gen_random_uuid()`. Никаких SERIAL/BIGINT для публичных ID — UUID не раскрывает количество записей и безопасен в URL |
| Soft Delete | Поле `deleted_at TIMESTAMPTZ` на всех основных таблицах. Физическое удаление только через отдельные cron-задачи после N дней |
| Аудит | `created_at`, `updated_at` на каждой таблице. `created_by`, `updated_by` (UUID → users) на критичных таблицах |
| Временные зоны | Все timestamp поля в `TIMESTAMPTZ` (с timezone). Хранение в UTC, отображение конвертируется на фронте по `users.timezone` |
| JSONB | Для гибких структур: контент блоков, attachments, настройки, метаданные. Индексируется через GIN |
| Именование | snake_case. Таблицы во множественном числе. FK = `{table_singular}_id` |
| Индексы | На все FK-поля. Составные индексы на типичные WHERE-комбинации. Частичные индексы где `deleted_at IS NULL` |
| Constraints | CHECK constraints на enum-поля прямо в DDL — дополнительный уровень защиты помимо application layer |
| Версионирование | Поле `version INTEGER` на таблицах с optimistic locking (homework_submissions) |
| Database per service | Каждый микросервис имеет свою PostgreSQL схему (schema). Межсервисные JOIN'ы запрещены — только через API |

---

## auth-service

### users

Центральная таблица всех пользователей платформы. Хранится в auth-service, остальные сервисы получают данные пользователя через API, не через прямой JOIN.

```sql
CREATE TABLE users (
    -- Идентификация
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Уникальный идентификатор пользователя. UUID v4, генерируется автоматически.
    -- Используется как sub в JWT токене.

    email               VARCHAR(255) NOT NULL,
    -- Email пользователя. Уникальный в рамках платформы.
    -- Используется для входа, отправки приглашений и уведомлений.
    -- Хранится в нижнем регистре (приводится при сохранении).

    email_normalized    VARCHAR(255) GENERATED ALWAYS AS (lower(trim(email))) STORED,
    -- Нормализованный email для поиска без учёта регистра.
    -- Вычисляемое поле — не нужно заботиться на уровне приложения.

    phone               VARCHAR(30),
    -- Номер телефона в международном формате (+7XXXXXXXXXX).
    -- Опциональный. Используется для связи и в будущем для SMS-уведомлений.

    phone_normalized    VARCHAR(30),
    -- Нормализованный телефон (только цифры, без +, пробелов).
    -- Нужен для поиска по частичному совпадению.

    -- Аутентификация
    password_hash       VARCHAR(255) NOT NULL,
    -- Хэш пароля. Алгоритм: bcrypt cost=12.
    -- Никогда не возвращается в API ответах.

    password_changed_at TIMESTAMPTZ,
    -- Дата последней смены пароля.
    -- Используется для инвалидации старых токенов после смены пароля:
    -- если токен выдан раньше этой даты — он невалиден.

    -- Роль и статус
    role                VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'curator', 'student')),
    -- Роль пользователя в системе.
    -- admin    — полный доступ, управление платформой
    -- curator  — ведёт учеников, проверяет ДЗ, чат
    -- student  — проходит уроки, отправляет ДЗ

    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'deactivated', 'blocked', 'deleted')),
    -- Статус аккаунта.
    -- active       — нормальная работа
    -- deactivated  — временно отключён (напр. истёк доступ), может быть реактивирован
    -- blocked      — заблокирован администратором (подозрение в нарушениях)
    -- deleted      — помечен как удалённый (soft delete). Физически запись остаётся.

    status_reason       TEXT,
    -- Причина блокировки или деактивации.
    -- Заполняется администратором при смене статуса. Видна только в Adminке.

    status_changed_at   TIMESTAMPTZ,
    -- Дата последнего изменения статуса.

    status_changed_by   UUID REFERENCES users(id),
    -- Кто изменил статус (UUID администратора).

    -- Профиль
    first_name          VARCHAR(100),
    -- Имя пользователя.

    last_name           VARCHAR(100),
    -- Фамилия пользователя.

    display_name        VARCHAR(200) GENERATED ALWAYS AS (
                            COALESCE(first_name || ' ' || last_name, first_name, last_name, email)
                        ) STORED,
    -- Отображаемое имя: "Имя Фамилия". Если не заполнены — email.
    -- Вычисляемое поле, используется в UI и уведомлениях.

    avatar_url          VARCHAR(500),
    -- URL аватара пользователя в S3/MinIO.
    -- Формат: https://cdn.1bilim.kz/avatars/{user_id}.jpg

    avatar_thumbnail_url VARCHAR(500),
    -- URL уменьшенной версии аватара (100x100px).
    -- Генерируется автоматически при загрузке оригинала.

    bio                 TEXT,
    -- Краткое описание / биография.
    -- Используется для кураторов (отображается студентам).

    -- Локализация
    timezone            VARCHAR(100) NOT NULL DEFAULT 'Asia/Almaty',
    -- Часовой пояс пользователя в формате IANA (напр. "Asia/Almaty", "Europe/Moscow").
    -- Используется для корректного отображения времени уроков и дедлайнов.

    lang                VARCHAR(5) NOT NULL DEFAULT 'ru'
                        CHECK (lang IN ('ru', 'kz', 'en')),
    -- Язык интерфейса.
    -- ru — русский (по умолчанию)
    -- kz — казахский
    -- en — английский

    -- Мобильное приложение
    fcm_token           VARCHAR(500),
    -- FCM токен устройства для Android push-уведомлений.
    -- Обновляется при каждом запуске мобильного приложения.

    apns_token          VARCHAR(500),
    -- APNs токен устройства для iOS push-уведомлений.
    -- Обновляется при каждом запуске мобильного приложения.

    last_device_platform VARCHAR(20) CHECK (last_device_platform IN ('web', 'ios', 'android')),
    -- Последняя платформа с которой заходил пользователь.
    -- Используется для выбора канала push-уведомлений.

    -- Активность
    last_seen_at        TIMESTAMPTZ,
    -- Дата последней активности пользователя.
    -- Обновляется при каждом API-запросе (через middleware).
    -- Используется для: определения неактивных студентов (3+ дней),
    -- задержки email (если неактивен 24ч → отправить email вместо push).

    last_login_at       TIMESTAMPTZ,
    -- Дата последнего успешного входа в систему.

    login_count         INTEGER NOT NULL DEFAULT 0,
    -- Суммарное количество входов. Полезно для аналитики вовлечённости.

    -- Безопасность
    failed_login_count  INTEGER NOT NULL DEFAULT 0,
    -- Количество неудачных попыток входа подряд.
    -- При достижении 5 — аккаунт временно блокируется на 15 минут.

    locked_until        TIMESTAMPTZ,
    -- До какого времени аккаунт заблокирован после превышения failed_login_count.
    -- NULL — не заблокирован.

    two_factor_enabled  BOOLEAN NOT NULL DEFAULT false,
    -- Включена ли двухфакторная аутентификация (для будущего использования).

    -- Метаданные
    invited_by          UUID REFERENCES users(id),
    -- Кто пригласил пользователя (UUID куратора или админа).
    -- NULL для самостоятельно зарегистрировавшихся.

    invited_at          TIMESTAMPTZ,
    -- Дата отправки приглашения.

    registration_source VARCHAR(100),
    -- Источник регистрации: "invite", "organic", "kaspi_payment", "admin_import".
    -- Используется для аналитики воронки.

    utm_source          VARCHAR(255),
    -- UTM source при первой регистрации (откуда пришёл пользователь).

    utm_medium          VARCHAR(255),
    -- UTM medium при первой регистрации.

    utm_campaign        VARCHAR(255),
    -- UTM campaign при первой регистрации.

    notes               TEXT,
    -- Внутренние заметки администратора о пользователе.
    -- Видны только в Adminке, не показываются пользователю.

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    -- Soft delete. При удалении ставится timestamp, запись физически остаётся.
    -- Все запросы должны добавлять WHERE deleted_at IS NULL.

    CONSTRAINT users_email_unique UNIQUE (email_normalized)
    -- Уникальность по нормализованному email.
);

-- Индексы
CREATE INDEX idx_users_email_normalized ON users(email_normalized) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_last_seen_at ON users(last_seen_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role_status ON users(role, status) WHERE deleted_at IS NULL;
```

---

### refresh_tokens

JWT refresh-токены для продления сессий без повторного ввода пароля.

```sql
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Уникальный ID токена.

    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Владелец токена.

    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    -- SHA-256 хэш токена. Сам токен (случайная строка) хранится только у клиента.
    -- В БД хранится хэш — чтобы даже при утечке БД токены были бесполезны.

    device_name     VARCHAR(255),
    -- Описание устройства: "iPhone 15 Pro", "Chrome on macOS".
    -- Парсится из User-Agent при создании токена.

    device_platform VARCHAR(20) CHECK (device_platform IN ('web', 'ios', 'android')),
    -- Платформа устройства.

    ip_address      INET,
    -- IP-адрес при создании токена.
    -- Используется для аудита и обнаружения подозрительной активности.

    user_agent      TEXT,
    -- Полный User-Agent строка при создании токена.

    expires_at      TIMESTAMPTZ NOT NULL,
    -- Дата истечения. Токены старше этой даты невалидны.
    -- Стандартное значение: now() + 7 days.

    last_used_at    TIMESTAMPTZ,
    -- Последнее использование токена для обновления access-токена.
    -- Если токен не использовался 30+ дней — можно удалить.

    revoked_at      TIMESTAMPTZ,
    -- Дата отзыва токена (logout, смена пароля, блокировка аккаунта).
    -- NULL — токен активен.

    revoke_reason   VARCHAR(100),
    -- Причина отзыва: "logout", "password_changed", "account_blocked", "suspicious_activity".

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
```

---

### password_reset_tokens

Токены для сброса пароля через email.

```sql
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Для кого создан токен.

    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    -- SHA-256 хэш одноразового токена из письма.

    expires_at  TIMESTAMPTZ NOT NULL,
    -- Срок действия. Стандартно: now() + 1 hour.

    used_at     TIMESTAMPTZ,
    -- Дата использования токена. NULL — ещё не использован.
    -- После использования токен нельзя применить повторно.

    ip_address  INET,
    -- IP с которого запрошен сброс. Для аудита.

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
```

---

## users-service

### marathon_enrollments

Записи студентов на марафоны. Содержит всю информацию о доступе конкретного студента к конкретному марафону.

```sql
CREATE TABLE marathon_enrollments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Участники
    student_id          UUID NOT NULL,
    -- UUID студента (из users). Не FK — cross-service reference.

    marathon_id         UUID NOT NULL,
    -- UUID марафона (из courses-service). Не FK — cross-service reference.

    curator_id          UUID,
    -- UUID назначенного куратора. NULL — куратор ещё не назначен.
    -- При назначении отправляется push куратору.

    tariff_plan_id      UUID,
    -- UUID тарифного плана (из courses-service).
    -- Определяет набор доступных функций: Live уроки, Speaking Rooms и т.д.

    tariff_name         VARCHAR(100),
    -- Снапшот названия тарифа на момент покупки.
    -- Хранится отдельно — тариф может измениться, но историческое название должно остаться.

    -- Доступ
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
    -- Статус доступа к марафону.
    -- active    — доступ открыт, студент может проходить уроки
    -- expired   — срок доступа истёк. Марафон некликабелен, показывается кнопка "Продлить"
    -- cancelled — отменён вручную администратором
    -- pending   — ожидание подтверждения оплаты (временный статус)

    access_from         TIMESTAMPTZ NOT NULL,
    -- Дата начала доступа к марафону.

    access_until        TIMESTAMPTZ NOT NULL,
    -- Дата окончания доступа. После этой даты статус меняется на expired.
    -- Cron-задача проверяет это поле каждые 10 минут.

    -- Продления
    original_access_until TIMESTAMPTZ NOT NULL,
    -- Исходная дата окончания доступа (до продлений).
    -- Нужна для аналитики: сколько студентов продлевают курс.

    extension_count     INTEGER NOT NULL DEFAULT 0,
    -- Количество продлений доступа. Каждое продление инкрементирует счётчик.

    last_extended_at    TIMESTAMPTZ,
    -- Дата последнего продления доступа.

    last_extended_by    UUID,
    -- Кто продлил: UUID администратора (при ручном продлении) или NULL (при автопродлении).

    -- Прогресс и баллы
    total_points        INTEGER NOT NULL DEFAULT 0,
    -- Суммарные баллы студента за этот марафон.
    -- Денормализовано для быстрого построения рейтинга без JOIN с points_log.

    completed_lessons   INTEGER NOT NULL DEFAULT 0,
    -- Количество завершённых уроков. Денормализовано для быстрого отображения прогресса.

    total_lessons       INTEGER NOT NULL DEFAULT 0,
    -- Общее количество уроков в марафоне на момент зачисления.
    -- Снапшот — если добавят новые уроки, прогресс пересчитается.

    completion_percent  NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Процент завершения марафона (0.00 — 100.00).
    -- Вычисляется как completed_lessons / total_lessons * 100.
    -- Обновляется при каждом завершении урока.

    completed_at        TIMESTAMPTZ,
    -- Дата завершения марафона (когда completion_percent достиг 100%).
    -- NULL — марафон ещё не завершён.

    -- Уведомления
    expiry_notified_3d  BOOLEAN NOT NULL DEFAULT false,
    -- Флаг: отправлено ли уведомление об истечении за 3 дня.
    -- Предотвращает повторную отправку при повторном запуске cron.

    expiry_notified_1d  BOOLEAN NOT NULL DEFAULT false,
    -- Флаг: отправлено ли уведомление об истечении за 1 день.

    expiry_notified_0d  BOOLEAN NOT NULL DEFAULT false,
    -- Флаг: отправлено ли уведомление в день истечения.

    -- Метаданные
    enrolled_by         UUID,
    -- Кто записал студента: UUID администратора или NULL (сам купил).

    enrollment_source   VARCHAR(100),
    -- Источник зачисления: "payment", "admin_manual", "admin_import", "promo".

    payment_id          UUID,
    -- UUID платежа (из payment-service), если зачисление через оплату.

    notes               TEXT,
    -- Внутренние заметки администратора по этому зачислению.

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT enrollment_unique UNIQUE (student_id, marathon_id)
    -- Студент может быть записан на один марафон только один раз.
    -- При продлении обновляется access_until, новая запись не создаётся.
);

CREATE INDEX idx_enrollments_student_id ON marathon_enrollments(student_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_enrollments_marathon_id ON marathon_enrollments(marathon_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_enrollments_curator_id ON marathon_enrollments(curator_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_enrollments_access_until ON marathon_enrollments(access_until) WHERE status = 'active';
CREATE INDEX idx_enrollments_status ON marathon_enrollments(status) WHERE deleted_at IS NULL;
```

---

### curator_marathon_assignments

Привязка кураторов к марафонам. Определяет какие кураторы могут быть назначены на студентов в данном марафоне.

```sql
CREATE TABLE curator_marathon_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    curator_id          UUID NOT NULL,
    -- UUID куратора.

    marathon_id         UUID NOT NULL,
    -- UUID марафона.

    -- Лимиты
    student_limit       INTEGER,
    -- Максимальное количество студентов для этого куратора в данном марафоне.
    -- NULL — без ограничений.

    current_student_count INTEGER NOT NULL DEFAULT 0,
    -- Текущее количество студентов у куратора в этом марафоне.
    -- Денормализовано для быстрой проверки лимита без COUNT запроса.

    -- Статус
    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- Активен ли куратор в этом марафоне.
    -- false — куратор временно снят с марафона (студенты остаются назначенными).

    deactivated_at      TIMESTAMPTZ,
    -- Дата деактивации назначения.

    deactivated_by      UUID,
    -- Кто деактивировал.

    -- Аналитика (денормализовано для дашборда)
    avg_response_time_minutes INTEGER,
    -- Среднее время ответа куратора в чате (в минутах).
    -- Обновляется периодически scheduler-ом.

    total_homeworks_reviewed INTEGER NOT NULL DEFAULT 0,
    -- Общее количество проверенных ДЗ в этом марафоне.

    total_homeworks_pending INTEGER NOT NULL DEFAULT 0,
    -- Текущее количество ДЗ ожидающих проверки.

    last_activity_at    TIMESTAMPTZ,
    -- Последняя активность куратора в рамках этого марафона.

    -- Аудит
    assigned_by         UUID,
    -- Кто назначил куратора на марафон.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT curator_marathon_unique UNIQUE (curator_id, marathon_id)
);

CREATE INDEX idx_cma_curator_id ON curator_marathon_assignments(curator_id);
CREATE INDEX idx_cma_marathon_id ON curator_marathon_assignments(marathon_id);
```

---

## courses-service

### marathons

Основная учебная единица платформы. Содержит настройки курса, режим прохождения, настройки рейтинга.

```sql
CREATE TABLE marathons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Идентификация
    title               VARCHAR(255) NOT NULL,
    -- Название марафона. Отображается в списке курсов и карточке.

    slug                VARCHAR(255) NOT NULL UNIQUE,
    -- URL-friendly идентификатор. Пример: "ielts-2024", "pre-upper-beginner".
    -- Используется в публичных URL страниц курса.
    -- Автогенерируется из title при создании, может быть изменён вручную.

    short_description   VARCHAR(500),
    -- Короткое описание для карточки курса на публичной странице (1-2 предложения).

    full_description    TEXT,
    -- Полное описание курса для страницы курса. Поддерживает Markdown.

    -- Медиа
    cover_url           VARCHAR(500),
    -- URL обложки марафона (изображение). Отображается в карточке.
    -- Рекомендуемый размер: 1200x630px.

    cover_thumbnail_url VARCHAR(500),
    -- URL уменьшенной обложки (400x210px) для списков.

    background_url      VARCHAR(500),
    -- URL фонового изображения (отдельное поле для дизайна страницы курса).

    background_color    VARCHAR(7),
    -- Цвет фона в HEX (#1A2B3C). Используется если background_url не задан.
    -- Нужен для брендирования каждого курса в своём цвете.

    promo_video_url     VARCHAR(500),
    -- URL промо-видео курса (YouTube/Vimeo). Показывается на публичной странице.

    -- Категоризация
    category            VARCHAR(50) NOT NULL
                        CHECK (category IN ('languages', 'business', 'exam_prep', 'other')),
    -- Категория курса.
    -- languages   — изучение языков
    -- business    — бизнес-английский
    -- exam_prep   — подготовка к экзаменам (IELTS, TOEFL и т.д.)
    -- other       — прочее

    language            VARCHAR(10) NOT NULL CHECK (language IN ('kz', 'ru', 'en')),
    -- Язык преподавания курса (не интерфейса).

    target_language     VARCHAR(10),
    -- Изучаемый язык. Например, язык курса "ru" (преподавание на русском),
    -- target_language "en" (учим английский).

    tags                TEXT[],
    -- Массив тегов для поиска и фильтрации. Пример: ["IELTS", "B2", "Academic"].

    -- Уровни CEFR
    level_start         VARCHAR(5) CHECK (level_start IN ('A1','A2','B1','B2','C1','C2')),
    -- Минимальный уровень владения языком для записи на курс.

    level_end           VARCHAR(5) CHECK (level_end IN ('A1','A2','B1','B2','C1','C2')),
    -- Целевой уровень по завершении курса.

    -- Режим прохождения
    access_mode         VARCHAR(20) NOT NULL DEFAULT 'open'
                        CHECK (access_mode IN ('open', 'sequential', 'with_review')),
    -- Определяет порядок открытия уроков.
    -- open         — все уроки доступны сразу после записи
    -- sequential   — следующий урок открывается после завершения предыдущего
    -- with_review  — следующий урок открывается только после одобрения ДЗ куратором

    -- Рейтинг
    show_rating         BOOLEAN NOT NULL DEFAULT true,
    -- Показывать ли таблицу рейтинга студентам этого марафона.

    rating_scope        VARCHAR(10) NOT NULL DEFAULT 'all'
                        CHECK (rating_scope IN ('all', 'top_5', 'top_10')),
    -- Сколько участников показывать в рейтинге.
    -- all    — все студенты
    -- top_5  — только топ-5
    -- top_10 — только топ-10

    show_student_rank   BOOLEAN NOT NULL DEFAULT true,
    -- Показывать ли студенту его место в рейтинге (даже если он не в топе).

    -- Публичная страница
    is_public           BOOLEAN NOT NULL DEFAULT false,
    -- Отображается ли курс на публичной странице для неавторизованных пользователей.

    public_page_order   INTEGER,
    -- Порядок отображения на публичной странице (ASC).
    -- NULL — не отображается или порядок не задан.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
    -- draft      — в разработке, не виден студентам
    -- published  — активный курс, доступен студентам
    -- archived   — архивный, недоступен для новых записей

    published_at        TIMESTAMPTZ,
    -- Дата первой публикации.

    archived_at         TIMESTAMPTZ,
    -- Дата архивации.

    -- Статистика (денормализовано)
    total_lessons_count INTEGER NOT NULL DEFAULT 0,
    -- Общее количество опубликованных уроков в марафоне.
    -- Обновляется при добавлении/удалении уроков.

    total_students_count INTEGER NOT NULL DEFAULT 0,
    -- Текущее количество активных студентов.

    total_completions_count INTEGER NOT NULL DEFAULT 0,
    -- Количество студентов завершивших марафон.

    avg_completion_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Средний процент прохождения по всем студентам.

    -- Аудит
    created_by          UUID,
    -- UUID администратора создавшего марафон.

    updated_by          UUID,
    -- UUID пользователя последнего обновления.

    duplicated_from     UUID REFERENCES marathons(id),
    -- Если марафон создан дублированием — UUID исходного марафона.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_marathons_status ON marathons(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_marathons_category ON marathons(category) WHERE deleted_at IS NULL;
CREATE INDEX idx_marathons_language ON marathons(language) WHERE deleted_at IS NULL;
CREATE INDEX idx_marathons_slug ON marathons(slug);
CREATE INDEX idx_marathons_is_public ON marathons(is_public, public_page_order) WHERE deleted_at IS NULL;
```

---

### modules

Модули (разделы) внутри марафона. Группируют уроки по темам.

```sql
CREATE TABLE modules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    marathon_id         UUID NOT NULL,
    -- UUID марафона которому принадлежит модуль.

    -- Контент
    title               VARCHAR(255) NOT NULL,
    -- Название модуля. Например: "Грамматика", "Listening", "Словарный запас".

    description         TEXT,
    -- Описание модуля. Показывается при раскрытии аккордеона.

    cover_url           VARCHAR(500),
    -- Необязательная обложка модуля.

    -- Порядок и доступность
    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок отображения модуля в списке (ASC).
    -- При drag-and-drop обновляются position всех затронутых модулей.

    is_free_preview     BOOLEAN NOT NULL DEFAULT false,
    -- Доступен ли модуль бесплатно (preview для незаписанных студентов).
    -- Позволяет показать первый модуль как демо.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
    -- Статус модуля. draft — не виден студентам.

    -- Статистика (денормализовано)
    total_lessons_count INTEGER NOT NULL DEFAULT 0,
    -- Количество уроков в модуле.

    -- Аудит
    created_by          UUID,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_modules_marathon_id ON modules(marathon_id, position) WHERE deleted_at IS NULL;
```

---

### lessons

Уроки внутри модуля.

```sql
CREATE TABLE lessons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    module_id           UUID NOT NULL,
    -- UUID модуля.

    -- Контент
    title               VARCHAR(255) NOT NULL,
    -- Название урока. Например: "Present Perfect — введение".

    description         TEXT,
    -- Краткое описание содержания урока.

    cover_url           VARCHAR(500),
    -- Обложка урока (показывается в списке).

    estimated_duration_minutes INTEGER,
    -- Ориентировочное время прохождения в минутах.
    -- Устанавливается куратором/администратором вручную.

    -- Баллы
    completion_points   INTEGER NOT NULL DEFAULT 10,
    -- Баллы за завершение урока. По умолчанию 10.
    -- Настраивается отдельно для каждого урока.

    -- Порядок
    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок урока в модуле (ASC).

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),

    published_at        TIMESTAMPTZ,
    -- Дата публикации урока.

    -- Статистика (денормализовано)
    total_sections_count INTEGER NOT NULL DEFAULT 0,
    -- Количество разделов в уроке.

    total_blocks_count  INTEGER NOT NULL DEFAULT 0,
    -- Общее количество блоков контента в уроке.

    -- Аудит
    created_by          UUID,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_lessons_module_id ON lessons(module_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_status ON lessons(status) WHERE deleted_at IS NULL;
```

---

### sections

Разделы внутри урока. На каждый раздел может быть свой дедлайн и домашнее задание.

```sql
CREATE TABLE sections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    lesson_id           UUID NOT NULL,
    -- UUID урока.

    -- Контент
    title               VARCHAR(255) NOT NULL,
    -- Название раздела. Например: "Теория", "Практика", "Домашнее задание".

    description         TEXT,
    -- Описание раздела.

    -- Порядок
    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок раздела в уроке (ASC).

    -- Дедлайн
    deadline_days       INTEGER,
    -- Через сколько дней после начала доступа к уроку наступает дедлайн.
    -- NULL — без дедлайна.

    deadline_at         TIMESTAMPTZ,
    -- Абсолютный дедлайн (альтернатива deadline_days).
    -- Если задан — используется он. Если нет — высчитывается из deadline_days.

    -- Домашнее задание
    has_homework        BOOLEAN NOT NULL DEFAULT false,
    -- Требуется ли домашнее задание для завершения раздела.

    homework_description TEXT,
    -- Описание/инструкция к домашнему заданию.
    -- Поддерживает Markdown.

    homework_max_file_size_mb INTEGER NOT NULL DEFAULT 50,
    -- Максимальный размер одного файла ДЗ в МБ.

    homework_max_audio_seconds INTEGER NOT NULL DEFAULT 180,
    -- Максимальная длина аудио-записи ДЗ в секундах (180 = 3 минуты).

    homework_allowed_attempts INTEGER,
    -- Максимальное количество попыток отправки ДЗ.
    -- NULL — без ограничений.

    -- Статистика (денормализовано)
    total_blocks_count  INTEGER NOT NULL DEFAULT 0,
    -- Количество блоков в разделе.

    -- Аудит
    created_by          UUID,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_sections_lesson_id ON sections(lesson_id, position) WHERE deleted_at IS NULL;
```

---

### blocks

Блоки контента внутри раздела. Основная единица учебного контента.

```sql
CREATE TABLE blocks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    section_id          UUID NOT NULL,
    -- UUID раздела.

    -- Тип блока
    type                VARCHAR(50) NOT NULL CHECK (type IN (
                            -- Изображения
                            'image', 'image_carousel', 'gif',
                            -- Аудио и видео
                            'video', 'audio', 'audio_record',
                            -- Слова и пропуски
                            'fill_drag', 'fill_input', 'fill_select',
                            'word_to_image_drag', 'word_to_image_input', 'word_to_image_select',
                            -- Тесты
                            'quiz', 'quiz_timed',
                            -- Выбор ответа
                            'true_false_notgiven',
                            -- Порядок
                            'sentence_builder', 'sort_columns', 'sort_text', 'anagram', 'matching',
                            -- Работа с текстом
                            'article', 'text', 'essay',
                            -- Прочее
                            'vocabulary_word', 'callout', 'link', 'divider'
                        )),
    -- Тип блока контента. Определяет структуру поля content (JSONB).
    -- Полное описание структуры content для каждого типа — в разделе "Типы блоков" ниже.

    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок блока в разделе (ASC). Изменяется через drag-and-drop в конструкторе.

    -- Контент блока
    content             JSONB NOT NULL DEFAULT '{}',
    -- Всё содержимое блока в зависимости от type.
    -- Структура различается для каждого типа. Примеры ниже.

    -- Проверка
    is_gradable         BOOLEAN NOT NULL DEFAULT false,
    -- Оценивается ли блок автоматически (тесты, drag-drop с правильным ответом).
    -- false — информационный блок (текст, видео, изображение).

    requires_curator_review BOOLEAN NOT NULL DEFAULT false,
    -- Требует ли блок ручной проверки куратором.
    -- true для: audio_record, fill_input, word_to_image_input, essay.

    points              INTEGER NOT NULL DEFAULT 0,
    -- Баллы за правильное выполнение блока.
    -- 0 для информационных блоков.

    -- Настройки доступности
    is_visible          BOOLEAN NOT NULL DEFAULT true,
    -- Виден ли блок студентам.
    -- false — скрытый блок (используется при подготовке контента).

    available_from      TIMESTAMPTZ,
    -- Дата с которой блок становится доступен (для тайм-зависимого контента).
    -- NULL — доступен сразу.

    available_until     TIMESTAMPTZ,
    -- Дата до которой блок доступен.
    -- NULL — без ограничения.

    -- Аудит
    created_by          UUID,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blocks_section_id ON blocks(section_id, position);
CREATE INDEX idx_blocks_type ON blocks(type);
CREATE INDEX idx_blocks_content_gin ON blocks USING GIN(content);
-- GIN индекс позволяет быстро искать по содержимому JSONB.
-- Например: найти все блоки где content->>'word' = 'ubiquitous'.
```

#### Структура content по типам блоков

```jsonc
// --- image ---
{
  "url": "https://cdn.1bilim.kz/...",       // URL изображения в S3
  "alt": "Описание изображения",            // Alt-текст для accessibility
  "caption": "Подпись под изображением",   // Отображается под фото
  "width": 800,                             // Оригинальная ширина в px
  "height": 600                             // Оригинальная высота в px
}

// --- image_carousel ---
{
  "slides": [
    { "url": "...", "caption": "Слайд 1", "alt": "..." },
    { "url": "...", "caption": "Слайд 2", "alt": "..." }
  ]
}

// --- video ---
{
  "source": "youtube",          // "youtube" | "vimeo" | "upload"
  "url": "https://youtu.be/...",
  "embed_id": "dQw4w9WgXcQ",   // YouTube/Vimeo ID для embed
  "upload_url": null,           // S3 URL если source="upload"
  "hls_url": null,              // HLS манифест для S3 видео
  "thumbnail_url": "...",       // Превью видео
  "duration_seconds": 342,      // Длительность
  "caption": "Описание видео"
}

// --- audio ---
{
  "url": "https://cdn.1bilim.kz/...",   // S3 URL аудиофайла
  "duration_seconds": 120,
  "caption": "Диалог A и B",
  "transcript": "A: Hello!\nB: Hi there!"  // Опциональная транскрипция
}

// --- audio_record ---
{
  "instruction": "Прочитайте следующее предложение:",
  "prompt_text": "The weather is nice today.",
  "max_duration_seconds": 180,
  "sample_audio_url": null   // Опциональный образец произношения
}

// --- fill_drag (перенести слово в пропуск) ---
{
  "text": "She ___ to school every ___.",
  "blanks": [
    { "id": "b1", "correct": "goes" },
    { "id": "b2", "correct": "day" }
  ],
  "word_bank": ["goes", "go", "day", "week", "came"],
  "shuffle": true   // Перемешивать ли слова при каждом показе
}

// --- quiz (тест) ---
{
  "question": "Which tense is used for habits?",
  "question_image_url": null,       // Опциональное изображение к вопросу
  "options": [
    { "id": "o1", "text": "Present Simple", "is_correct": true },
    { "id": "o2", "text": "Present Continuous", "is_correct": false },
    { "id": "o3", "text": "Past Simple", "is_correct": false },
    { "id": "o4", "text": "Future Simple", "is_correct": false }
  ],
  "multiple_correct": false,        // true — можно выбрать несколько правильных
  "explanation": "Present Simple используется для...",  // Объяснение после ответа
  "shuffle_options": true
}

// --- quiz_timed ---
{
  // всё то же что quiz, плюс:
  "timer_seconds": 30
}

// --- matching ---
{
  "pairs": [
    { "id": "p1", "left": "cat",  "right": "кот" },
    { "id": "p2", "left": "dog",  "right": "собака" },
    { "id": "p3", "left": "bird", "right": "птица" }
  ],
  "shuffle": true
}

// --- sentence_builder (собрать предложение из слов) ---
{
  "words": ["she", "every", "goes", "school", "to", "day"],
  "correct_sentence": "she goes to school every day",
  "case_sensitive": false
}

// --- essay ---
{
  "prompt": "Опишите своё любимое место для отдыха (150-200 слов)",
  "min_words": 150,
  "max_words": 200,
  "placeholder": "Начните писать здесь..."
}

// --- vocabulary_word ---
{
  "word": "ubiquitous",
  "cefr_level": "C1",
  "part_of_speech": "adjective",
  "pronunciation_ipa": "/juːˈbɪk.wɪ.t̬əs/",
  "audio_url": "https://cdn.1bilim.kz/vocab/ubiquitous.mp3",
  "translations": {
    "ru": "вездесущий, повсеместный",
    "kz": "..."
  },
  "definition_en": "present or found everywhere",
  "example": "Smartphones have become ubiquitous in modern society.",
  "example_translation": {
    "ru": "Смартфоны стали повсеместными в современном обществе."
  },
  "image_url": null   // Опциональная иллюстрация слова
}

// --- callout ---
{
  "variant": "info",    // "info" | "warning" | "tip" | "danger"
  "title": "Обрати внимание",
  "text": "Это правило применяется только в формальной речи.",
  "icon": "💡"          // Опциональная эмодзи-иконка
}

// --- link ---
{
  "url": "https://example.com",
  "label": "Читать статью",
  "description": "Дополнительный материал по теме",
  "open_in_new_tab": true
}
```

---

### tariff_plans

Тарифные планы. Управляются в Adminке без участия разработчиков.

```sql
CREATE TABLE tariff_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    marathon_id         UUID,
    -- UUID марафона, к которому привязан тариф.
    -- NULL — тариф для всей платформы (глобальный).

    -- Основные поля
    name                VARCHAR(100) NOT NULL,
    -- Название тарифа. Например: "Standard", "Premium", "Individual".

    internal_code       VARCHAR(50),
    -- Внутренний код тарифа для программного использования.
    -- Пример: "ielts_premium", "pre_upper_individual".
    -- Не меняется даже если изменилось название.

    description         TEXT,
    -- Описание тарифа для публичной страницы.
    -- Поддерживает Markdown.

    -- Цены
    price               NUMERIC(10,2) NOT NULL,
    -- Актуальная цена продажи в валюте currency.

    original_price      NUMERIC(10,2),
    -- "Зачёркнутая" цена. Два сценария:
    -- Реальная скидка: original_price=15000, price=9990 — реальное снижение.
    -- Фантомная скидка: original_price=15000, price=15000 — маркетинговый приём.
    -- NULL — скидка не показывается.

    discount_percent    NUMERIC(5,2) GENERATED ALWAYS AS (
                            CASE WHEN original_price > 0 AND original_price > price
                            THEN ROUND((original_price - price) / original_price * 100, 2)
                            ELSE 0 END
                        ) STORED,
    -- Процент скидки. Вычисляется автоматически из price и original_price.

    currency            VARCHAR(5) NOT NULL DEFAULT 'KZT',
    -- Валюта цены. KZT — тенге (основная).

    discount_starts_at  TIMESTAMPTZ,
    -- Начало периода действия скидки (original_price → price).
    -- NULL — скидка действует постоянно.

    discount_ends_at    TIMESTAMPTZ,
    -- Конец периода скидки. После этой даты показывается полная цена.

    -- Доступ
    duration_type       VARCHAR(20) NOT NULL DEFAULT 'course'
                        CHECK (duration_type IN ('monthly', 'course', 'lifetime')),
    -- monthly   — помесячный доступ
    -- course    — доступ на весь курс (фиксированный период)
    -- lifetime  — бессрочный доступ

    duration_days       INTEGER,
    -- Количество дней доступа (для duration_type = 'monthly' или 'course').
    -- NULL для lifetime.

    auto_renewal        BOOLEAN NOT NULL DEFAULT false,
    -- Автопродление тарифа (для monthly).

    -- Состав тарифа (что входит)
    has_lessons         BOOLEAN NOT NULL DEFAULT true,
    -- Доступ к урокам марафона. Базовая функция, всегда true.

    has_homework_review BOOLEAN NOT NULL DEFAULT true,
    -- Проверка ДЗ куратором.

    has_curator_chat    BOOLEAN NOT NULL DEFAULT true,
    -- Личный чат с куратором.

    has_cefr_analysis   BOOLEAN NOT NULL DEFAULT true,
    -- Модуль CEFR-анализа уровня.

    has_vocabulary      BOOLEAN NOT NULL DEFAULT true,
    -- Модуль Vocabulary (словарь).

    has_live_lessons    BOOLEAN NOT NULL DEFAULT false,
    -- Live уроки через Google Meet (групповые).

    has_speaking_rooms  BOOLEAN NOT NULL DEFAULT false,
    -- Speaking Rooms (со студентами и с AI-ботом).

    has_attendance      BOOLEAN NOT NULL DEFAULT false,
    -- Attendance-трекер (посещаемость).

    has_individual_lessons BOOLEAN NOT NULL DEFAULT false,
    -- Индивидуальные Live уроки 1:1 с куратором (только Individual тариф).

    -- Лимиты
    live_lessons_per_month INTEGER,
    -- Максимальное количество Live уроков в месяц.
    -- NULL — без ограничений.

    speaking_rooms_per_month INTEGER,
    -- Максимальное количество Speaking Room сессий в месяц.
    -- NULL — без ограничений.

    -- Отображение
    display_order       INTEGER NOT NULL DEFAULT 0,
    -- Порядок отображения тарифов на странице оплаты (ASC).

    is_featured         BOOLEAN NOT NULL DEFAULT false,
    -- Выделить тариф как рекомендуемый (значок "Популярный").

    badge_text          VARCHAR(50),
    -- Текст бейджа на карточке тарифа. Пример: "Хит продаж", "Лучшая ценность".
    -- NULL — без бейджа.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived', 'hidden')),
    -- active   — тариф активен, отображается на странице оплаты
    -- archived — устаревший, недоступен для новых покупок
    -- hidden   — скрыт из публичного списка (например, для особых клиентов)

    -- Аудит
    created_by          UUID,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_tariff_plans_marathon_id ON tariff_plans(marathon_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tariff_plans_status ON tariff_plans(status, display_order) WHERE deleted_at IS NULL;
```

---

## progress-service

### lesson_progress

Прогресс студента по урокам.

```sql
CREATE TABLE lesson_progress (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    lesson_id           UUID NOT NULL,
    marathon_id         UUID NOT NULL,
    -- UUID марафона — для быстрой фильтрации без JOIN через courses-service.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'completed')),
    -- not_started — студент ещё не открывал урок
    -- in_progress — урок начат, не завершён
    -- completed   — урок полностью завершён, баллы начислены

    -- Временные метки
    started_at          TIMESTAMPTZ,
    -- Когда студент впервые открыл урок.

    completed_at        TIMESTAMPTZ,
    -- Когда студент нажал "Завершить урок".

    last_activity_at    TIMESTAMPTZ,
    -- Последняя активность внутри урока.

    -- Детали прохождения
    time_spent_seconds  INTEGER NOT NULL DEFAULT 0,
    -- Суммарное время в уроке в секундах.
    -- Инкрементируется через heartbeat каждые 30 секунд.

    sections_total      INTEGER NOT NULL DEFAULT 0,
    -- Общее количество разделов в уроке (снапшот на момент начала).

    sections_completed  INTEGER NOT NULL DEFAULT 0,
    -- Количество завершённых разделов.

    -- Баллы
    points_earned       INTEGER NOT NULL DEFAULT 0,
    -- Баллы заработанные в этом уроке (тесты + завершение).

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT lesson_progress_unique UNIQUE (student_id, lesson_id)
);

CREATE INDEX idx_lesson_progress_student_marathon ON lesson_progress(student_id, marathon_id);
CREATE INDEX idx_lesson_progress_status ON lesson_progress(status) WHERE status != 'completed';
```

---

### section_progress

Прогресс по разделам внутри урока.

```sql
CREATE TABLE section_progress (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    section_id          UUID NOT NULL,
    lesson_id           UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    status              VARCHAR(20) NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'completed', 'pending_review')),
    -- pending_review — раздел завершён, ДЗ отправлено, ожидает проверки куратором

    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    last_block_id       UUID,
    -- UUID последнего просмотренного блока.
    -- Используется для resume — восстановление позиции в разделе.

    blocks_completed    INTEGER NOT NULL DEFAULT 0,
    -- Количество взаимодействий с блоками (не только правильных ответов).

    correct_answers     INTEGER NOT NULL DEFAULT 0,
    -- Количество правильных ответов в интерактивных блоках.

    total_gradable_blocks INTEGER NOT NULL DEFAULT 0,
    -- Количество оцениваемых блоков в разделе.

    points_earned       INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT section_progress_unique UNIQUE (student_id, section_id)
);

CREATE INDEX idx_section_progress_student ON section_progress(student_id, lesson_id);
```

---

### homework_submissions

Отправки домашних заданий студентами.

```sql
CREATE TABLE homework_submissions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    section_id          UUID NOT NULL,
    lesson_id           UUID NOT NULL,
    marathon_id         UUID NOT NULL,
    enrollment_id       UUID NOT NULL,
    -- UUID записи студента на марафон. Для быстрой фильтрации по куратору.

    -- Версионирование
    version             INTEGER NOT NULL DEFAULT 1,
    -- Номер попытки. При отправке на доработку и повторной отправке версия инкрементируется.
    -- Хранятся все версии — история попыток.

    is_latest           BOOLEAN NOT NULL DEFAULT true,
    -- Является ли эта запись последней версией.
    -- При новой отправке у предыдущей версии ставится false.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'revision', 'rejected')),
    -- pending  — отправлено, ожидает проверки куратором
    -- approved — принято куратором, баллы начислены
    -- revision — отправлено на доработку
    -- rejected — отклонено

    -- Контент ДЗ
    content_type        VARCHAR(30) NOT NULL
                        CHECK (content_type IN ('text', 'files', 'audio', 'mixed')),
    -- Тип контента домашнего задания.

    text_content        TEXT,
    -- Текстовый ответ студента (для essay-блоков).

    word_count          INTEGER,
    -- Количество слов в text_content. Вычисляется при сохранении.

    audio_duration_seconds INTEGER,
    -- Длительность аудио-записи если content_type = 'audio'.

    -- Проверка
    reviewer_id         UUID,
    -- UUID куратора проверившего ДЗ.

    reviewer_comment    TEXT,
    -- Текстовый комментарий куратора.

    reviewer_audio_url  VARCHAR(500),
    -- URL голосового комментария куратора (S3).

    reviewer_audio_duration_seconds INTEGER,
    -- Длительность голосового комментария куратора.

    bonus_points        INTEGER NOT NULL DEFAULT 0,
    -- Бонусные баллы назначенные куратором дополнительно к стандартным.

    reviewed_at         TIMESTAMPTZ,
    -- Дата проверки.

    review_duration_seconds INTEGER,
    -- Сколько времени куратор потратил на проверку.
    -- Используется для аналитики эффективности кураторов.

    -- Уведомления
    student_notified_at TIMESTAMPTZ,
    -- Когда студент был уведомлён о результате проверки.

    -- Аудит
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Дата отправки (дублирует created_at, но более семантически понятна).

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hw_student_section ON homework_submissions(student_id, section_id, is_latest);
CREATE INDEX idx_hw_status ON homework_submissions(status, marathon_id) WHERE is_latest = true;
CREATE INDEX idx_hw_reviewer ON homework_submissions(reviewer_id, status) WHERE is_latest = true;
CREATE INDEX idx_hw_enrollment ON homework_submissions(enrollment_id, status);
```

---

### homework_files

Файлы прикреплённые к домашним заданиям.

```sql
CREATE TABLE homework_files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    submission_id       UUID NOT NULL REFERENCES homework_submissions(id) ON DELETE CASCADE,

    file_url            VARCHAR(500) NOT NULL,
    -- S3 URL файла.

    file_name           VARCHAR(255) NOT NULL,
    -- Оригинальное имя файла (как назвал пользователь).

    file_size_bytes     BIGINT NOT NULL,
    -- Размер файла в байтах. Для проверки лимита 50MB.

    mime_type           VARCHAR(100),
    -- MIME тип файла. Пример: "image/jpeg", "audio/mpeg", "application/pdf".

    file_type           VARCHAR(20) CHECK (file_type IN ('image', 'audio', 'video', 'document', 'other')),
    -- Обобщённый тип файла для UI (иконка и превью).

    thumbnail_url       VARCHAR(500),
    -- URL превью (для изображений и видео).

    duration_seconds    INTEGER,
    -- Длительность (для аудио и видео).

    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок файла в списке вложений.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hw_files_submission ON homework_files(submission_id);
```

---

### quiz_attempts

Попытки прохождения тестов (blocks типа quiz / quiz_timed).

```sql
CREATE TABLE quiz_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    block_id            UUID NOT NULL,
    section_id          UUID NOT NULL,
    lesson_id           UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    attempt_number      INTEGER NOT NULL DEFAULT 1,
    -- Номер попытки (если разрешено несколько попыток).

    -- Результат
    is_correct          BOOLEAN NOT NULL,
    -- Правильный ли ответ.

    score               INTEGER NOT NULL DEFAULT 0,
    -- Баллы за эту попытку.

    max_score           INTEGER NOT NULL DEFAULT 0,
    -- Максимально возможные баллы за этот блок.

    time_spent_seconds  INTEGER,
    -- Сколько секунд потрачено на ответ (для quiz_timed).

    time_limit_seconds  INTEGER,
    -- Лимит времени (снапшот из блока).

    -- Ответ
    selected_option_ids JSONB,
    -- Массив ID выбранных вариантов ответа.
    -- Пример: ["o2"] или ["o1", "o3"] для multiple_correct.

    text_answer         TEXT,
    -- Текстовый ответ (для fill_input, essay).

    -- Аудит
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quiz_attempts_student_block ON quiz_attempts(student_id, block_id);
CREATE INDEX idx_quiz_attempts_student_marathon ON quiz_attempts(student_id, marathon_id);
```

---

### points_log

Полный журнал начисления и списания баллов.

```sql
CREATE TABLE points_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    enrollment_id       UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    -- Транзакция
    points              INTEGER NOT NULL,
    -- Количество баллов. Положительное — начисление, отрицательное — списание.

    balance_before      INTEGER NOT NULL,
    -- Баланс до этой транзакции (для аудита).

    balance_after       INTEGER NOT NULL,
    -- Баланс после транзакции.

    -- Причина
    source              VARCHAR(50) NOT NULL CHECK (source IN (
                            'lesson_completed',
                            'homework_approved',
                            'homework_bonus',
                            'quiz_correct',
                            'live_lesson_attended',
                            'streak_7_days',
                            'streak_30_days',
                            'admin_manual',
                            'admin_deduction'
                        )),
    -- Источник начисления баллов.

    reference_id        UUID,
    -- UUID связанной записи (lesson_id, homework_submission_id, etc.).
    -- Позволяет отследить откуда именно пришли баллы.

    reference_type      VARCHAR(50),
    -- Тип связанной записи: "lesson", "homework_submission", "quiz_attempt", etc.

    description         TEXT,
    -- Человекочитаемое описание транзакции.
    -- Пример: "Урок 'Present Perfect' завершён", "ДЗ раздела 3 принято куратором".

    created_by          UUID,
    -- NULL — автоматическое начисление системой.
    -- UUID — ручное начисление/списание администратором.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_points_log_student_marathon ON points_log(student_id, marathon_id, created_at DESC);
CREATE INDEX idx_points_log_enrollment ON points_log(enrollment_id);
```

---

### streaks

Серии активных дней для начисления streak-бонусов.

```sql
CREATE TABLE streaks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL UNIQUE,
    -- Уникально: один streak-трекер на студента.

    current_streak      INTEGER NOT NULL DEFAULT 0,
    -- Текущая серия активных дней подряд.

    longest_streak      INTEGER NOT NULL DEFAULT 0,
    -- Рекордная серия за всё время.

    last_activity_date  DATE,
    -- Дата последней активности (DATE без времени для корректного подсчёта дней).

    streak_started_at   DATE,
    -- Дата начала текущей серии.

    -- Бонусы
    last_bonus_streak   INTEGER NOT NULL DEFAULT 0,
    -- За какую серию последний раз начислен бонус (7, 30, ...).
    -- Предотвращает двойное начисление.

    total_bonuses_earned INTEGER NOT NULL DEFAULT 0,
    -- Суммарное количество streak-бонусов.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## chat-service

### chats

Чаты между куратором и студентом. Всегда 1:1.

```sql
CREATE TABLE chats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    curator_id          UUID NOT NULL,
    enrollment_id       UUID,
    -- UUID записи на марафон. Если NULL — общий чат не привязанный к марафону.

    marathon_id         UUID,
    -- Денормализовано для фильтрации.

    -- Статус
    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- false — чат закрыт (например, куратор снят с ученика).

    -- Последнее сообщение (денормализовано для списка чатов)
    last_message_id     UUID,
    -- UUID последнего сообщения.

    last_message_text   VARCHAR(500),
    -- Превью последнего сообщения (первые 500 символов).

    last_message_at     TIMESTAMPTZ,
    -- Дата последнего сообщения.

    last_message_sender_id UUID,
    -- Кто отправил последнее сообщение.

    -- Счётчики непрочитанных
    student_unread_count INTEGER NOT NULL DEFAULT 0,
    -- Количество непрочитанных сообщений для студента.

    curator_unread_count INTEGER NOT NULL DEFAULT 0,
    -- Количество непрочитанных сообщений для куратора.

    -- Статистика куратора
    avg_response_time_minutes INTEGER,
    -- Среднее время ответа куратора в этом чате (в минутах).

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chats_student_curator_unique UNIQUE (student_id, curator_id, enrollment_id)
);

CREATE INDEX idx_chats_student_id ON chats(student_id) WHERE is_active = true;
CREATE INDEX idx_chats_curator_id ON chats(curator_id, last_message_at DESC) WHERE is_active = true;
```

---

### messages

Сообщения в чатах.

```sql
CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    chat_id             UUID NOT NULL REFERENCES chats(id),
    sender_id           UUID NOT NULL,

    -- Тип
    type                VARCHAR(20) NOT NULL CHECK (type IN ('text', 'image', 'file', 'voice', 'system')),
    -- text   — текстовое сообщение
    -- image  — изображение
    -- file   — произвольный файл
    -- voice  — голосовое сообщение
    -- system — системное сообщение (напр. "Куратор назначен")

    -- Контент
    text                TEXT,
    -- Текст сообщения. NULL для voice/file без подписи.

    -- Голосовое сообщение
    voice_url           VARCHAR(500),
    -- S3 URL голосового сообщения.

    voice_duration_seconds INTEGER,
    -- Длительность голосового сообщения.

    voice_waveform      JSONB,
    -- Данные для отображения waveform (массив амплитуд).
    -- Пример: [0.1, 0.4, 0.8, 0.5, ...] (64 значения).

    -- Файл
    file_url            VARCHAR(500),
    -- S3 URL прикреплённого файла.

    file_name           VARCHAR(255),
    -- Оригинальное имя файла.

    file_size_bytes     BIGINT,
    -- Размер файла.

    file_mime_type      VARCHAR(100),
    -- MIME тип.

    -- Изображение
    image_url           VARCHAR(500),
    -- S3 URL изображения.

    image_thumbnail_url VARCHAR(500),
    -- URL превью.

    image_width         INTEGER,
    image_height        INTEGER,

    -- Статус доставки
    delivered_at        TIMESTAMPTZ,
    -- Когда сообщение доставлено получателю (WebSocket).

    read_at             TIMESTAMPTZ,
    -- Когда получатель прочитал сообщение.

    -- Редактирование
    edited_at           TIMESTAMPTZ,
    -- Дата редактирования. NULL — не редактировалось.

    original_text       TEXT,
    -- Исходный текст до редактирования (для истории).

    -- Ответ на сообщение
    reply_to_message_id UUID REFERENCES messages(id),
    -- UUID сообщения на которое это является ответом.

    reply_to_text       VARCHAR(200),
    -- Превью текста цитируемого сообщения (снапшот).

    -- Модерация
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    -- Сообщение удалено. Текст заменяется на "Сообщение удалено".

    deleted_at          TIMESTAMPTZ,
    deleted_by          UUID,
    delete_reason       VARCHAR(100),
    -- Причина удаления при модерации администратором.

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_unread ON messages(chat_id, read_at) WHERE read_at IS NULL;
```

---

## payment-service

### payments

Все транзакции платформы.

```sql
CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Участники
    student_id          UUID NOT NULL,
    tariff_plan_id      UUID NOT NULL,
    marathon_id         UUID,

    -- Снапшоты (данные могут измениться, фиксируем на момент покупки)
    tariff_name_snapshot    VARCHAR(100),
    tariff_price_snapshot   NUMERIC(10,2),
    marathon_title_snapshot VARCHAR(255),

    -- Платёж
    provider            VARCHAR(30) NOT NULL CHECK (provider IN ('kaspi', 'tiptoppay', 'manual', 'promo')),
    -- kaspi      — оплата через Kaspi.kz
    -- tiptoppay  — оплата картой Visa/Mastercard
    -- manual     — ручное предоставление доступа администратором
    -- promo      — промо-доступ (бесплатно)

    amount              NUMERIC(10,2) NOT NULL,
    -- Сумма к оплате.

    amount_paid         NUMERIC(10,2),
    -- Фактически оплаченная сумма (может отличаться при частичной оплате / roundoff у провайдера).

    currency            VARCHAR(5) NOT NULL DEFAULT 'KZT',

    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'success', 'failed', 'refunded', 'cancelled')),
    -- pending    — инициирован, ожидаем редиректа
    -- processing — студент на странице оплаты
    -- success    — оплачено, доступ открыт
    -- failed     — ошибка оплаты
    -- refunded   — возврат
    -- cancelled  — отменён

    -- Провайдер
    external_id         VARCHAR(255),
    -- ID транзакции в системе провайдера (Kaspi order ID, TipTopPay transaction ID).

    external_status     VARCHAR(100),
    -- Сырой статус от провайдера (для дебага). Пример: "PAYMENT_APPROVED".

    provider_response   JSONB,
    -- Полный ответ от провайдера (webhook payload). Для аудита и дебага.

    -- Временные метки
    initiated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Когда студент нажал "Оплатить".

    paid_at             TIMESTAMPTZ,
    -- Когда пришёл webhook об успешной оплате.

    failed_at           TIMESTAMPTZ,
    -- Когда пришёл webhook об ошибке.

    -- Атрибуция
    utm_source          VARCHAR(255),
    utm_medium          VARCHAR(255),
    utm_campaign        VARCHAR(255),
    utm_content         VARCHAR(255),
    utm_term            VARCHAR(255),
    -- UTM-параметры сохранённые при первом визите пользователя.
    -- Позволяют понять откуда пришёл покупатель (Instagram, реклама, реферал и т.д.).

    referrer_url        VARCHAR(500),
    -- URL страницы с которой пользователь перешёл на платформу.

    -- Аудит
    created_by          UUID,
    -- NULL — самостоятельная покупка. UUID — ручное создание администратором.

    notes               TEXT,
    -- Внутренние заметки (для manual платежей).

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_student_id ON payments(student_id);
CREATE INDEX idx_payments_status ON payments(status, created_at DESC);
CREATE INDEX idx_payments_utm ON payments(utm_source, utm_campaign);
CREATE INDEX idx_payments_external_id ON payments(external_id) WHERE external_id IS NOT NULL;
```

---

### payment_refunds

Возвраты по платежам.

```sql
CREATE TABLE payment_refunds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    payment_id          UUID NOT NULL REFERENCES payments(id),

    amount              NUMERIC(10,2) NOT NULL,
    -- Сумма возврата.

    reason              TEXT,
    -- Причина возврата.

    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'success', 'failed')),

    external_refund_id  VARCHAR(255),
    -- ID возврата у провайдера.

    processed_at        TIMESTAMPTZ,

    created_by          UUID NOT NULL,
    -- UUID администратора инициировавшего возврат.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## speaking-service

### speaking_rooms

Комнаты для Speaking практики (студент-студент через Google Meet).

```sql
CREATE TABLE speaking_rooms (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Организатор
    host_id             UUID NOT NULL,
    -- UUID создателя комнаты (студент, куратор или Admin).

    host_type           VARCHAR(20) NOT NULL CHECK (host_type IN ('student', 'curator', 'admin')),

    -- Описание
    title               VARCHAR(255) NOT NULL,
    -- Название комнаты. Пример: "IELTS Speaking Part 2 Practice".

    topic               VARCHAR(255),
    -- Тема разговора. Пример: "Describe a place you'd like to visit".

    topic_description   TEXT,
    -- Расширенное описание темы, вопросы для обсуждения.

    level               VARCHAR(5) CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
    -- Рекомендуемый CEFR уровень участников.

    language            VARCHAR(10) NOT NULL DEFAULT 'en',
    -- Язык сессии.

    -- Расписание
    scheduled_at        TIMESTAMPTZ NOT NULL,
    -- Дата и время начала сессии.

    duration_minutes    INTEGER NOT NULL CHECK (duration_minutes IN (30, 45, 60)),
    -- Длительность сессии.

    ends_at             TIMESTAMPTZ GENERATED ALWAYS AS (
                            scheduled_at + (duration_minutes || ' minutes')::INTERVAL
                        ) STORED,
    -- Вычисляемое время окончания.

    -- Участники
    max_participants    INTEGER NOT NULL DEFAULT 4,
    -- Максимальное количество участников (включая организатора).

    current_participants INTEGER NOT NULL DEFAULT 0,
    -- Текущее количество забронировавших. Денормализовано для быстрой проверки.

    -- Google Meet
    google_event_id     VARCHAR(255),
    -- ID события в Google Calendar.

    meet_link           VARCHAR(500),
    -- Ссылка на Google Meet.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'active', 'finished', 'cancelled')),

    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID,
    cancellation_reason TEXT,

    -- Видимость
    visibility          VARCHAR(20) NOT NULL DEFAULT 'platform'
                        CHECK (visibility IN ('platform', 'marathon', 'private')),
    -- platform  — видна всем студентам платформы
    -- marathon  — только студентам конкретного марафона
    -- private   — только по прямой ссылке

    marathon_id         UUID,
    -- UUID марафона (если visibility = 'marathon').

    -- Статистика
    avg_rating          NUMERIC(3,2),
    -- Средний рейтинг сессии (1.00-5.00). Вычисляется после завершения.

    ratings_count       INTEGER NOT NULL DEFAULT 0,

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_speaking_rooms_scheduled ON speaking_rooms(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_speaking_rooms_host ON speaking_rooms(host_id);
CREATE INDEX idx_speaking_rooms_marathon ON speaking_rooms(marathon_id) WHERE deleted_at IS NULL;
```

---

### speaking_bookings

Брони студентов на Speaking Rooms.

```sql
CREATE TABLE speaking_bookings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    room_id             UUID NOT NULL REFERENCES speaking_rooms(id),
    student_id          UUID NOT NULL,

    status              VARCHAR(20) NOT NULL DEFAULT 'booked'
                        CHECK (status IN ('booked', 'attended', 'no_show', 'cancelled')),
    -- booked    — забронировано
    -- attended  — студент присутствовал
    -- no_show   — не пришёл (проставляется автоматически после окончания)
    -- cancelled — отменил бронь

    cancelled_at        TIMESTAMPTZ,
    cancel_reason       TEXT,
    -- Причина отмены (если отменил сам студент).

    -- Напоминания
    reminder_1h_sent_at  TIMESTAMPTZ,
    -- Когда отправлено напоминание за 1 час.

    reminder_15m_sent_at TIMESTAMPTZ,
    -- Когда отправлено напоминание за 15 минут.

    -- Участие
    joined_at           TIMESTAMPTZ,
    -- Когда студент перешёл по Meet-ссылке (если можно отследить).

    left_at             TIMESTAMPTZ,

    -- Аудит
    booked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT speaking_booking_unique UNIQUE (room_id, student_id)
);

CREATE INDEX idx_speaking_bookings_student ON speaking_bookings(student_id, status);
CREATE INDEX idx_speaking_bookings_room ON speaking_bookings(room_id);
```

---

### ai_sessions

Сессии с AI Speaking тренером.

```sql
CREATE TABLE ai_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    enrollment_id       UUID,

    -- Тема
    topic               VARCHAR(255),
    -- Тема выбранная студентом.

    topic_category      VARCHAR(100),
    -- Категория темы: "IELTS Part 1", "Daily Life", "Business English" и т.д.

    difficulty_level    VARCHAR(5) CHECK (difficulty_level IN ('A1','A2','B1','B2','C1','C2')),
    -- Уровень сложности выбранный студентом.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'abandoned')),

    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,

    duration_seconds    INTEGER,
    -- Фактическая длительность сессии в секундах.

    -- Статистика сессии
    message_count       INTEGER NOT NULL DEFAULT 0,
    -- Количество обменов (студент → AI → студент = 1 обмен).

    total_words_spoken  INTEGER NOT NULL DEFAULT 0,
    -- Количество слов произнесённых студентом (из транскрипций).

    -- AI-анализ (заполняется после завершения)
    fluency_score       NUMERIC(3,1),
    -- Оценка беглости речи (0.0 — 10.0).

    grammar_score       NUMERIC(3,1),
    -- Оценка грамматики.

    vocabulary_score    NUMERIC(3,1),
    -- Оценка словарного запаса.

    pronunciation_score NUMERIC(3,1),
    -- Оценка произношения.

    overall_score       NUMERIC(3,1),
    -- Итоговая оценка.

    errors_summary      JSONB,
    -- Сводка ошибок по категориям.
    -- Пример: {"grammar": ["Article errors", "Verb tense"], "vocabulary": ["Limited range"]}

    feedback_text       TEXT,
    -- Развёрнутая текстовая обратная связь от AI.

    recommended_topics  TEXT[],
    -- Рекомендованные темы для следующей практики.

    -- Стоимость API
    openai_tokens_used  INTEGER,
    -- Количество токенов использованных в сессии (для мониторинга расходов).

    openai_cost_usd     NUMERIC(8,6),
    -- Стоимость API вызовов в USD.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_sessions_student ON ai_sessions(student_id, started_at DESC);
CREATE INDEX idx_ai_sessions_active ON ai_sessions(student_id, status) WHERE status = 'active';
-- Этот индекс используется для проверки: нет ли уже активной сессии у студента.
```

---

### ai_session_messages

История диалога в AI-сессии.

```sql
CREATE TABLE ai_session_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id          UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,

    role                VARCHAR(20) NOT NULL CHECK (role IN ('student', 'assistant')),
    -- student   — сообщение студента
    -- assistant — ответ AI

    -- Аудио (от студента)
    audio_url           VARCHAR(500),
    -- S3 URL аудио-записи студента.

    audio_duration_seconds INTEGER,

    -- Транскрипция
    transcription       TEXT,
    -- Текст транскрипции аудио студента (Whisper STT).

    transcription_confidence NUMERIC(4,3),
    -- Уверенность Whisper в транскрипции (0.000 — 1.000).

    -- Ответ AI
    response_text       TEXT,
    -- Текст ответа AI.

    response_audio_url  VARCHAR(500),
    -- S3 URL синтезированного аудио ответа AI (TTS).

    response_audio_duration_seconds INTEGER,

    -- Анализ ошибок (заполняется AI)
    grammar_errors      JSONB,
    -- Грамматические ошибки в тексте студента.
    -- Пример: [{"original": "She go", "corrected": "She goes", "rule": "Subject-verb agreement"}]

    vocabulary_suggestions JSONB,
    -- Предложения по улучшению словарного запаса.

    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок сообщения в диалоге.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_messages_session ON ai_session_messages(session_id, position);
```

---

## vocab-service

### vocabulary_words

Глобальная база слов платформы.

```sql
CREATE TABLE vocabulary_words (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Слово
    word                VARCHAR(255) NOT NULL,
    -- Само слово или фраза (на изучаемом языке).

    word_normalized     VARCHAR(255) GENERATED ALWAYS AS (lower(trim(word))) STORED,
    -- Нормализованное слово для поиска.

    language            VARCHAR(10) NOT NULL DEFAULT 'en',
    -- Язык слова.

    part_of_speech      VARCHAR(30) CHECK (part_of_speech IN (
                            'noun', 'verb', 'adjective', 'adverb',
                            'pronoun', 'preposition', 'conjunction',
                            'interjection', 'phrasal_verb', 'idiom', 'phrase'
                        )),

    -- Произношение
    pronunciation_ipa   VARCHAR(255),
    -- Транскрипция в IPA. Пример: /juːˈbɪk.wɪ.t̬əs/.

    pronunciation_simplified VARCHAR(255),
    -- Упрощённая транскрипция для русскоязычных. Пример: "ю-БИК-уи-тас".

    audio_url           VARCHAR(500),
    -- S3 URL TTS-произношения.

    audio_us_url        VARCHAR(500),
    -- US произношение (American English).

    audio_uk_url        VARCHAR(500),
    -- UK произношение (British English).

    -- Уровень
    cefr_level          VARCHAR(5) CHECK (cefr_level IN ('A1','A2','B1','B2','C1','C2')),
    -- CEFR уровень сложности слова.

    frequency_rank      INTEGER,
    -- Ранг частотности слова в языке (1 = самое частое).
    -- Используется для приоритизации изучения.

    -- Определение
    definition_en       TEXT,
    -- Определение на английском.

    -- Изображение
    image_url           VARCHAR(500),
    -- Иллюстрация слова.

    -- Метаданные
    is_approved         BOOLEAN NOT NULL DEFAULT false,
    -- Проверено ли слово модератором.
    -- false — добавлено автоматически (из API), требует проверки.

    source              VARCHAR(30) CHECK (source IN ('admin', 'openai', 'dictionary_api', 'import')),
    -- Источник добавления слова.

    -- Аудит
    created_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT vocabulary_words_unique UNIQUE (word_normalized, language)
);

CREATE INDEX idx_vocab_words_level ON vocabulary_words(cefr_level, language) WHERE deleted_at IS NULL;
CREATE INDEX idx_vocab_words_normalized ON vocabulary_words(word_normalized);
```

---

### word_translations

Переводы слов на разные языки (отдельная таблица для масштабируемости).

```sql
CREATE TABLE word_translations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    word_id             UUID NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,

    language            VARCHAR(5) NOT NULL CHECK (language IN ('ru', 'kz')),
    -- Язык перевода.

    translation         TEXT NOT NULL,
    -- Перевод слова.

    synonyms            TEXT[],
    -- Синонимы перевода.

    is_primary          BOOLEAN NOT NULL DEFAULT true,
    -- Основной перевод (показывается первым).

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT word_translation_unique UNIQUE (word_id, language)
);

CREATE INDEX idx_word_translations_word ON word_translations(word_id);
```

---

### word_examples

Примеры использования слова в предложениях.

```sql
CREATE TABLE word_examples (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    word_id             UUID NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,

    example_text        TEXT NOT NULL,
    -- Пример предложения с использованием слова.

    translation_ru      TEXT,
    translation_kz      TEXT,

    audio_url           VARCHAR(500),
    -- TTS аудио примера.

    cefr_level          VARCHAR(5),
    -- Уровень сложности примера (может отличаться от слова).

    is_primary          BOOLEAN NOT NULL DEFAULT false,
    -- Основной пример (показывается первым).

    position            INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_word_examples_word ON word_examples(word_id, position);
```

---

### user_vocabulary

Личный словарь студента.

```sql
CREATE TABLE user_vocabulary (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    word_id             UUID REFERENCES vocabulary_words(id),
    -- NULL если слово кастомное (добавлено вручную, не из глобальной базы).

    -- Кастомное слово (если word_id = NULL)
    custom_word         VARCHAR(255),
    custom_translation  TEXT,
    custom_example      TEXT,
    -- Поля для слов добавленных вручную студентом.

    -- Источник добавления
    source              VARCHAR(30) CHECK (source IN ('lesson_block', 'manual', 'ai_session')),
    -- lesson_block — добавлено из блока урока
    -- manual       — добавлено студентом вручную
    -- ai_session   — рекомендовано после AI-сессии

    source_lesson_id    UUID,
    -- UUID урока из которого добавлено слово (если source = 'lesson_block').

    -- Статус изучения
    status              VARCHAR(20) NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'learning', 'learned', 'forgotten')),
    -- new       — только добавлено
    -- learning  — в процессе изучения
    -- learned   — отмечено как изученное
    -- forgotten — студент отметил как забытое (для повторения)

    is_favourite        BOOLEAN NOT NULL DEFAULT false,
    -- Добавлено в избранное.

    -- Повторение (Spaced Repetition — для будущей реализации)
    next_review_at      TIMESTAMPTZ,
    -- Дата следующего повторения.

    review_count        INTEGER NOT NULL DEFAULT 0,
    -- Количество повторений.

    ease_factor         NUMERIC(4,2) NOT NULL DEFAULT 2.50,
    -- Фактор лёгкости для алгоритма SM-2 (Spaced Repetition).

    -- Аудит
    learned_at          TIMESTAMPTZ,
    -- Когда отмечено как изученное.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT user_vocab_unique UNIQUE (student_id, word_id)
);

CREATE INDEX idx_user_vocab_student ON user_vocabulary(student_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_vocab_favourite ON user_vocabulary(student_id, is_favourite) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_vocab_review ON user_vocabulary(student_id, next_review_at) WHERE status != 'learned';
```

---

## cefr-service

### cefr_scores

Текущий CEFR уровень студента по каждому марафону.

```sql
CREATE TABLE cefr_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    -- Текущий уровень
    current_level       VARCHAR(5) NOT NULL CHECK (current_level IN ('A1','A2','B1','B2','C1','C2')),
    -- Текущий рассчитанный уровень.

    level_progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Прогресс внутри текущего уровня (0.00 — 100.00%).
    -- При достижении 100% уровень повышается.

    -- Составляющие оценки
    quiz_score          NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Средний процент правильных ответов на тесты.

    lessons_score       NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Оценка на основе количества завершённых уроков.

    activity_score      NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Оценка активности (streak, время в системе).

    ai_session_score    NUMERIC(5,2),
    -- Средняя оценка из AI speaking сессий (если есть).

    -- Прогноз
    estimated_lessons_to_next_level INTEGER,
    -- Прогноз: сколько уроков осталось до следующего уровня.

    -- История
    previous_level      VARCHAR(5),
    -- Предыдущий уровень (до последнего повышения).

    level_upgraded_at   TIMESTAMPTZ,
    -- Когда последний раз повысился уровень.

    -- Мета
    last_calculated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Когда последний раз пересчитывался уровень.

    calculation_version INTEGER NOT NULL DEFAULT 1,
    -- Версия алгоритма расчёта. При изменении алгоритма инкрементируется,
    -- все оценки пересчитываются в фоне.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cefr_scores_unique UNIQUE (student_id, marathon_id)
);

CREATE INDEX idx_cefr_student ON cefr_scores(student_id);
```

---

### cefr_history

История изменений CEFR уровня для графика прогресса.

```sql
CREATE TABLE cefr_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    level               VARCHAR(5) NOT NULL,
    level_progress      NUMERIC(5,2) NOT NULL,
    quiz_score          NUMERIC(5,2),
    lessons_score       NUMERIC(5,2),
    activity_score      NUMERIC(5,2),

    trigger_event       VARCHAR(50),
    -- Что спровоцировало пересчёт: "lesson_completed", "quiz_submitted", "daily_recalc".

    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cefr_history_student_marathon ON cefr_history(student_id, marathon_id, recorded_at DESC);
```

---

## notification-service

### notifications

Все уведомления платформы.

```sql
CREATE TABLE notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    recipient_id        UUID NOT NULL,
    -- UUID получателя.

    -- Тип
    type                VARCHAR(60) NOT NULL CHECK (type IN (
                            'homework_reviewed',
                            'lesson_unlocked',
                            'new_message',
                            'live_lesson_reminder',
                            'attendance_code',
                            'speaking_room_reminder',
                            'access_expiring_3d',
                            'access_expiring_1d',
                            'access_expired',
                            'payment_success',
                            'payment_failed',
                            'curator_assigned',
                            'new_homework_pending',
                            'student_inactive',
                            'system'
                        )),

    title               VARCHAR(255) NOT NULL,
    -- Заголовок уведомления.

    body                TEXT NOT NULL,
    -- Текст уведомления.

    -- Действие при нажатии
    action_type         VARCHAR(50),
    -- Тип действия: "open_lesson", "open_chat", "open_homework", "open_payment".

    action_payload      JSONB,
    -- Данные для действия. Пример: {"lesson_id": "uuid", "marathon_id": "uuid"}.

    -- Каналы
    sent_via_push       BOOLEAN NOT NULL DEFAULT false,
    -- Отправлено через push-уведомление.

    sent_via_email      BOOLEAN NOT NULL DEFAULT false,
    -- Отправлено через email.

    push_sent_at        TIMESTAMPTZ,
    email_sent_at       TIMESTAMPTZ,

    push_error          TEXT,
    -- Ошибка отправки push (для дебага).

    email_error         TEXT,

    -- Статус прочтения
    read_at             TIMESTAMPTZ,
    -- NULL — не прочитано.

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id, read_at) WHERE read_at IS NULL;
```

---

### notification_settings

Настройки уведомлений пользователя.

```sql
CREATE TABLE notification_settings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id             UUID NOT NULL UNIQUE,

    -- Уведомления которые НЕЛЬЗЯ отключить
    -- (homework_reviewed, payment_success, access_expiring, access_expired)
    -- Они не хранятся здесь — всегда отправляются.

    -- Уведомления которые можно отключить
    lesson_unlocked_push    BOOLEAN NOT NULL DEFAULT true,
    lesson_unlocked_email   BOOLEAN NOT NULL DEFAULT false,

    new_message_push        BOOLEAN NOT NULL DEFAULT true,
    new_message_email       BOOLEAN NOT NULL DEFAULT true,

    live_reminder_push      BOOLEAN NOT NULL DEFAULT true,
    live_reminder_email     BOOLEAN NOT NULL DEFAULT true,

    speaking_reminder_push  BOOLEAN NOT NULL DEFAULT true,
    speaking_reminder_email BOOLEAN NOT NULL DEFAULT true,

    -- Тихие часы (Do Not Disturb)
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
    quiet_hours_start   TIME,
    -- Начало тихих часов. Пример: '23:00'.

    quiet_hours_end     TIME,
    -- Конец тихих часов. Пример: '08:00'.

    quiet_hours_timezone VARCHAR(100),
    -- Timezone для тихих часов.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### device_tokens

Токены устройств для push-уведомлений.

```sql
CREATE TABLE device_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id             UUID NOT NULL,

    platform            VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android')),

    token               VARCHAR(500) NOT NULL,
    -- FCM token (Android) или APNs token (iOS).

    device_name         VARCHAR(255),
    -- Название устройства. Пример: "iPhone 15 Pro", "Samsung Galaxy S24".

    app_version         VARCHAR(50),
    -- Версия приложения. Нужна для поддержки разных версий API уведомлений.

    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- false — токен стал невалидным (пришла ошибка при отправке).

    last_used_at        TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT device_tokens_unique UNIQUE (user_id, token)
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id) WHERE is_active = true;
```

---

## attendance-service

### attendance_codes

Коды для отметки посещаемости на Live уроках.

```sql
CREATE TABLE attendance_codes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    live_lesson_id      UUID NOT NULL,
    -- UUID Live урока.

    code                CHAR(4) NOT NULL,
    -- 4-значный числовой код. Пример: "7392".
    -- Генерируется случайно при каждой отметке.

    created_by          UUID NOT NULL,
    -- UUID куратора запустившего отметку.

    -- Время действия
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Начало действия кода.

    expires_at          TIMESTAMPTZ NOT NULL,
    -- Конец действия. Устанавливается куратором при создании.

    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- false — код деактивирован вручную до истечения.

    deactivated_at      TIMESTAMPTZ,

    -- Статистика
    submissions_count   INTEGER NOT NULL DEFAULT 0,
    -- Сколько студентов успело ввести код.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendance_codes_lesson ON attendance_codes(live_lesson_id, is_active);
```

---

### attendance_logs

Журнал посещаемости студентов.

```sql
CREATE TABLE attendance_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,
    live_lesson_id      UUID NOT NULL,
    enrollment_id       UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    -- Статус
    status              VARCHAR(30) NOT NULL DEFAULT 'absent'
                        CHECK (status IN ('present', 'absent', 'late', 'excused')),
    -- present — присутствовал
    -- absent  — отсутствовал
    -- late    — опоздал
    -- excused — уважительная причина

    -- Метод отметки
    method              VARCHAR(20) NOT NULL CHECK (method IN ('code', 'manual', 'auto')),
    -- code   — ввёл код в срок
    -- manual — куратор отметил вручную
    -- auto   — автоматически (code истёк → absent)

    attendance_code_id  UUID REFERENCES attendance_codes(id),
    -- UUID кода через который отметился студент.

    code_submitted_at   TIMESTAMPTZ,
    -- Точное время ввода кода студентом.

    -- Ручная отметка
    marked_by           UUID,
    -- UUID куратора при ручной отметке.

    marked_at           TIMESTAMPTZ,

    excused_reason      TEXT,
    -- Причина уважительного отсутствия.

    excused_document_url VARCHAR(500),
    -- Ссылка на подтверждающий документ (если требуется).

    -- Комментарий куратора
    curator_note        TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT attendance_unique UNIQUE (student_id, live_lesson_id)
);

CREATE INDEX idx_attendance_student ON attendance_logs(student_id, marathon_id);
CREATE INDEX idx_attendance_lesson ON attendance_logs(live_lesson_id, status);
```

---

## calendar-service

### live_lessons

Live уроки создаваемые кураторами.

```sql
CREATE TABLE live_lessons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    curator_id          UUID NOT NULL,
    marathon_id         UUID NOT NULL,

    -- Контент
    title               VARCHAR(255) NOT NULL,
    -- Название урока.

    description         TEXT,
    -- Описание, план урока.

    topic               VARCHAR(255),
    -- Тема урока.

    -- Расписание
    scheduled_at        TIMESTAMPTZ NOT NULL,

    duration_minutes    INTEGER NOT NULL,

    ends_at             TIMESTAMPTZ GENERATED ALWAYS AS (
                            scheduled_at + (duration_minutes || ' minutes')::INTERVAL
                        ) STORED,

    -- Группа
    group_name          VARCHAR(100),
    -- Название группы (если у куратора несколько групп в одном марафоне).

    max_participants    INTEGER,
    -- Максимальное количество участников. NULL — без ограничений.

    -- Google Meet
    google_event_id     VARCHAR(255),
    google_calendar_id  VARCHAR(255),
    meet_link           VARCHAR(500),

    google_event_created_at TIMESTAMPTZ,
    -- Когда было создано событие в Google Calendar.

    -- Bulk создание
    bulk_id             UUID,
    -- UUID пакета если урок создан через bulk create.
    -- Все уроки одного пакета имеют один bulk_id.

    bulk_position       INTEGER,
    -- Порядковый номер в пакете (1, 2, 3...).

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),

    started_at          TIMESTAMPTZ,
    -- Фактическое время начала.

    completed_at        TIMESTAMPTZ,
    -- Фактическое время завершения.

    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID,
    cancellation_reason TEXT,

    -- Напоминания
    reminder_1h_sent    BOOLEAN NOT NULL DEFAULT false,
    reminder_15m_sent   BOOLEAN NOT NULL DEFAULT false,

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_live_lessons_curator ON live_lessons(curator_id, scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_live_lessons_marathon ON live_lessons(marathon_id, scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_live_lessons_bulk ON live_lessons(bulk_id) WHERE bulk_id IS NOT NULL;
```

---

### calendar_events

События платформы (вебинары, дедлайны, экзамены, объявления).

```sql
CREATE TABLE calendar_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Создатель
    created_by          UUID NOT NULL,
    creator_role        VARCHAR(20) NOT NULL CHECK (creator_role IN ('admin', 'curator')),

    -- Контент
    title               VARCHAR(255) NOT NULL,

    description         TEXT,

    event_type          VARCHAR(30) NOT NULL CHECK (event_type IN ('webinar', 'deadline', 'exam', 'announcement', 'other')),

    color               VARCHAR(7),
    -- HEX цвет для отображения в календаре. NULL — используется цвет по умолчанию для типа.

    -- Время
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ,
    -- NULL для событий без фиксированного времени окончания (deadline).

    is_all_day          BOOLEAN NOT NULL DEFAULT false,
    -- Событие на весь день (без времени).

    -- Ссылка
    link_url            VARCHAR(500),
    -- URL для перехода при нажатии на событие.

    link_label          VARCHAR(100),
    -- Текст кнопки ссылки.

    -- Таргетинг
    target_type         VARCHAR(20) NOT NULL DEFAULT 'all'
                        CHECK (target_type IN ('all', 'marathon', 'group', 'tariff', 'specific_users')),
    -- all            — все студенты платформы
    -- marathon       — студенты конкретного марафона
    -- group          — конкретная группа (по group_name в live_lessons)
    -- tariff         — студенты с конкретным тарифом
    -- specific_users — конкретные пользователи

    target_marathon_id  UUID,
    target_tariff_code  VARCHAR(50),
    target_group_name   VARCHAR(100),
    target_user_ids     UUID[],
    -- Массив UUID для specific_users таргетинга.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'cancelled', 'draft')),

    -- Уведомление
    send_notification   BOOLEAN NOT NULL DEFAULT false,
    -- Отправить push при публикации события.

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_calendar_events_starts ON calendar_events(starts_at) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_calendar_events_marathon ON calendar_events(target_marathon_id) WHERE deleted_at IS NULL;
```

---

### calendar_personal

Личные события студентов (видны только им).

```sql
CREATE TABLE calendar_personal (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id          UUID NOT NULL,

    title               VARCHAR(255) NOT NULL,

    note                TEXT,

    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ,

    is_all_day          BOOLEAN NOT NULL DEFAULT false,

    color               VARCHAR(7),
    -- HEX цвет события (студент выбирает сам).

    reminder_minutes    INTEGER,
    -- За сколько минут напомнить. NULL — без напоминания.

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_calendar_personal_student ON calendar_personal(student_id, starts_at) WHERE deleted_at IS NULL;
```

---

## stories-service

### stories

Объявления в формате Stories.

```sql
CREATE TABLE stories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Таргетинг
    marathon_id         UUID,
    -- NULL — глобальная сторис для всех студентов платформы.
    -- UUID — только для студентов этого марафона.

    -- Метаданные
    title               VARCHAR(255),
    -- Внутреннее название для Admin (не отображается студентам).

    -- Настройки отображения
    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок отображения в карусели (ASC).

    -- Период активности
    active_from         TIMESTAMPTZ NOT NULL,
    -- Начало показа сторис.

    active_until        TIMESTAMPTZ,
    -- Конец показа. NULL — без ограничения.

    -- Ссылка
    link_url            VARCHAR(500),
    -- URL для перехода при клике на сторис.

    link_label          VARCHAR(100),
    -- Текст кнопки. Пример: "Подробнее", "Купить".

    -- Статистика
    total_views         INTEGER NOT NULL DEFAULT 0,
    -- Общее количество просмотров.

    unique_views        INTEGER NOT NULL DEFAULT 0,
    -- Количество уникальных просмотрщиков.

    -- Статус
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'archived')),

    -- Аудит
    created_by          UUID NOT NULL,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_stories_active ON stories(active_from, active_until, position)
    WHERE status = 'active' AND deleted_at IS NULL;
```

---

### story_slides

Слайды внутри одной сторис (одна сторис может содержать несколько слайдов).

```sql
CREATE TABLE story_slides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    story_id            UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,

    position            INTEGER NOT NULL DEFAULT 0,
    -- Порядок слайда.

    media_type          VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'video')),
    -- image — статичное изображение
    -- video — видео до 60 секунд

    media_url           VARCHAR(500) NOT NULL,
    -- S3 URL медиафайла.

    thumbnail_url       VARCHAR(500),
    -- Превью слайда.

    duration_seconds    INTEGER NOT NULL DEFAULT 5,
    -- Длительность показа слайда.
    -- Для image: обычно 5-7 секунд.
    -- Для video: длительность видео.

    -- Текст поверх медиа
    overlay_text        VARCHAR(500),
    -- Текст отображаемый поверх изображения/видео.

    overlay_text_position VARCHAR(20) DEFAULT 'bottom'
                        CHECK (overlay_text_position IN ('top', 'center', 'bottom')),

    overlay_text_color  VARCHAR(7) DEFAULT '#FFFFFF',
    -- HEX цвет текста.

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_story_slides_story ON story_slides(story_id, position);
```

---

### story_views

Просмотры сторисов (для статистики и отметки "просмотрено").

```sql
CREATE TABLE story_views (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    story_id            UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL,

    viewed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Когда студент открыл сторис.

    completed_at        TIMESTAMPTZ,
    -- Когда досмотрел до конца. NULL — закрыл до конца.

    last_slide_seen     INTEGER NOT NULL DEFAULT 0,
    -- Индекс последнего просмотренного слайда.

    CONSTRAINT story_views_unique UNIQUE (story_id, student_id)
);

CREATE INDEX idx_story_views_student ON story_views(student_id);
```

---

## files-service

### file_uploads

Реестр всех загруженных файлов.

```sql
CREATE TABLE file_uploads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Владелец
    uploader_id         UUID NOT NULL,
    -- UUID пользователя загрузившего файл.

    uploader_role       VARCHAR(20) CHECK (uploader_role IN ('admin', 'curator', 'student')),

    -- Файл
    original_name       VARCHAR(255) NOT NULL,
    -- Оригинальное имя файла.

    stored_name         VARCHAR(255) NOT NULL,
    -- Имя файла в S3 (UUID-based для уникальности).

    s3_bucket           VARCHAR(100) NOT NULL,
    -- Имя S3 бакета.

    s3_key              VARCHAR(500) NOT NULL UNIQUE,
    -- Полный путь в S3. Пример: "homework/student_uuid/file_uuid.pdf".

    cdn_url             VARCHAR(500),
    -- CDN URL для публичного доступа.

    signed_url          VARCHAR(1000),
    -- Актуальный signed URL (кэшируется, пересоздаётся по TTL).

    signed_url_expires_at TIMESTAMPTZ,

    -- Метаданные
    mime_type           VARCHAR(100),
    file_size_bytes     BIGINT NOT NULL,
    file_extension      VARCHAR(20),

    -- Тип использования
    purpose             VARCHAR(50) CHECK (purpose IN (
                            'homework', 'lesson_content', 'avatar',
                            'story', 'chat_attachment', 'vocab_audio', 'ai_session'
                        )),

    reference_id        UUID,
    -- UUID связанной записи (homework_submission_id, block_id и т.д.).

    -- Медиа метаданные
    width               INTEGER,    -- для изображений и видео
    height              INTEGER,
    duration_seconds    INTEGER,    -- для аудио и видео

    -- Обработка
    processing_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    -- pending    — загружен, ожидает обработки
    -- processing — генерируются превью, транскодируется видео
    -- completed  — готов к использованию
    -- failed     — ошибка обработки

    thumbnail_url       VARCHAR(500),
    -- URL превью (для изображений и видео).

    hls_url             VARCHAR(500),
    -- URL HLS манифеста (для видео после транскодирования).

    -- Безопасность
    is_public           BOOLEAN NOT NULL DEFAULT false,
    -- Публично ли доступен файл без авторизации.

    virus_scan_status   VARCHAR(20) DEFAULT 'pending'
                        CHECK (virus_scan_status IN ('pending', 'clean', 'infected', 'error')),
    -- Статус антивирусной проверки.

    virus_scan_at       TIMESTAMPTZ,

    -- Аудит
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_file_uploads_uploader ON file_uploads(uploader_id);
CREATE INDEX idx_file_uploads_reference ON file_uploads(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX idx_file_uploads_purpose ON file_uploads(purpose);
```

---

## Общие индексы и оптимизации

```sql
-- Частичные индексы для soft-delete (экономят место и ускоряют запросы)
-- Уже включены в каждую таблицу выше через WHERE deleted_at IS NULL

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Применить на все таблицы с updated_at:
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ... аналогично для всех таблиц

-- Партиционирование для высоконагруженных таблиц (после MVP)
-- points_log       — партиционировать по created_at (RANGE, по месяцам)
-- notifications    — партиционировать по created_at (RANGE, по месяцам)
-- quiz_attempts    — партиционировать по created_at (RANGE, по месяцам)
-- ai_session_messages — партиционировать по created_at

-- Материализованные представления для тяжёлых аналитических запросов
CREATE MATERIALIZED VIEW marathon_leaderboard AS
SELECT
    e.marathon_id,
    e.student_id,
    e.total_points,
    RANK() OVER (PARTITION BY e.marathon_id ORDER BY e.total_points DESC) as rank
FROM marathon_enrollments e
WHERE e.status = 'active' AND e.deleted_at IS NULL;

CREATE UNIQUE INDEX ON marathon_leaderboard(marathon_id, student_id);
-- REFRESH MATERIALIZED VIEW CONCURRENTLY marathon_leaderboard;
-- Обновлять каждые 5 минут через cron.
```
