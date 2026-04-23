---
id: tech-stack
title: Технологический стек
sidebar_label: Стек
---

# Технологический стек

Для каждой технологии указано **почему** она выбрана, а не просто что выбрано — это важно при онбординге новых разработчиков и при принятии решений о замене.

---

## Frontend (Web)

### React 18+ с TypeScript

**Почему React:** зрелая экосистема, огромный пул разработчиков, отлично работает с TypeScript. Concurrent features (Suspense, transitions) нужны для плавного UX в drag-and-drop конструкторе блоков.

**Почему TypeScript:** платформа сложная — 3 роли, 30+ типов блоков, JSONB контент. Без типов поддерживать это невозможно.

### TanStack Query v5

Управляет **серверным стейтом**: запросы, мутации, кэширование, инвалидация, оптимистичные обновления.

```typescript
// Пример: загрузка урока с кэшированием
const { data: lesson } = useQuery({
  queryKey: ['lesson', lessonId],
  queryFn: () => api.getLesson(lessonId),
  staleTime: 5 * 60 * 1000,  // считать свежим 5 минут
})

// Пример: мутация с инвалидацией кэша
const { mutate: completeLesson } = useMutation({
  mutationFn: api.completeLesson,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['lesson', lessonId] })
    queryClient.invalidateQueries({ queryKey: ['progress', marathonId] })
  }
})
```

**Почему не Redux/Zustand для серверного стейта:** TanStack Query решает задачу кэширования и синхронизации с сервером значительно лучше — меньше boilerplate, встроенная дедупликация запросов, background refetch.

### Zustand

Управляет **клиентским стейтом** — тем что не нужно синхронизировать с сервером:

```typescript
// Что хранится в Zustand:
const useStore = create((set) => ({
  currentUser: null,        // данные текущего пользователя (из JWT)
  wsConnection: null,       // WebSocket соединение
  builderDragState: null,   // состояние drag-and-drop в конструкторе блоков
  unreadCount: 0,           // счётчик непрочитанных (обновляется через WS)
}))
```

**Правило:** если данные пришли с сервера — TanStack Query. Если это UI-стейт — Zustand.

### Tailwind CSS

Utility-first CSS. Нет проблемы именования классов, нет неиспользуемых стилей в продакшне (purge), легко поддерживать консистентный дизайн через конфиг токенов.

### React Hook Form

Управление формами. Минимальные ре-рендеры (uncontrolled approach). Важно для конструктора уроков — форма с 30+ полями не должна лагать.

---

## Структура фронтенда

```
src/
├── app/
│   ├── router.tsx              # React Router v6, ленивая загрузка страниц
│   ├── providers.tsx           # QueryClientProvider, etc.
│   └── App.tsx
│
├── pages/                      # Страницы по ролям
│   ├── admin/
│   │   ├── marathons/          # Управление марафонами
│   │   ├── students/           # Управление студентами
│   │   ├── analytics/          # Аналитика
│   │   └── payments/           # Транзакции
│   ├── curator/
│   │   ├── dashboard/
│   │   ├── homework/
│   │   ├── chat/
│   │   └── schedule/
│   └── student/
│       ├── home/
│       ├── lesson/             # Прохождение урока
│       ├── homework/
│       ├── speaking/
│       ├── vocabulary/
│       └── profile/
│
├── features/                   # Бизнес-фичи
│   ├── lesson-builder/         # Drag-and-drop конструктор уроков
│   │   ├── blocks/             # Компоненты для каждого типа блока
│   │   └── DragDropCanvas.tsx
│   ├── lesson-player/          # Прохождение урока студентом
│   │   └── blocks/             # Рендеринг блоков для студента
│   ├── chat/
│   │   ├── ChatWindow.tsx
│   │   └── useWebSocket.ts     # WebSocket хук
│   ├── speaking/
│   ├── vocabulary/
│   └── payment/
│
├── shared/
│   ├── ui/                     # Переиспользуемые UI компоненты
│   │   ├── Button/
│   │   ├── Modal/
│   │   ├── Table/
│   │   └── ...
│   ├── api/                    # Axios instance, interceptors
│   │   └── client.ts
│   ├── hooks/                  # Общие хуки
│   └── types/                  # Общие TypeScript типы
│
└── i18n/                       # Переводы (kz / ru / en)
    ├── ru.json
    ├── kz.json
    └── en.json
```

### Разделение кода (Code Splitting)
Страницы загружаются лениво через `React.lazy`. Студент не скачивает код Admin-панели:
```typescript
const AdminMarathons = lazy(() => import('./pages/admin/marathons'))
const StudentHome = lazy(() => import('./pages/student/home'))
```

---

## Backend (Go микросервисы)

### Go 1.21+

**Почему Go:** компилируемый, низкое потребление памяти (важно при 13 сервисах), отличная конкуренция через goroutines (критично для WebSocket в chat-service), быстрый cold start в Docker.

**Сравнение с альтернативами для этого проекта:**
- Node.js — хуже для CPU-bound задач (CEFR расчёт), сложнее контролировать concurrency
- Python — медленнее, тяжелее деплоить микросервисы
- Java/Kotlin — избыточно тяжёлый runtime для текущего масштаба

### Gin Framework

Минималистичный HTTP роутер. Производительность близка к нативному `net/http`. Middleware система удобна для RBAC и request_id.

### GORM v2

ORM для PostgreSQL. Автомиграции в dev-окружении, SQL-миграции (golang-migrate) в production. Для сложных запросов (аналитика, рейтинг) — сырой SQL через `db.Raw()`.

### Ключевые Go библиотеки

| Библиотека | Назначение |
|---|---|
| `gin-gonic/gin` | HTTP роутер |
| `gorm.io/gorm` | ORM |
| `golang-jwt/jwt/v5` | JWT токены |
| `gorilla/websocket` | WebSocket (chat-service) |
| `go-redis/redis/v9` | Redis клиент |
| `aws/aws-sdk-go-v2/s3` | S3 / MinIO |
| `golang-migrate/migrate` | SQL миграции |
| `uber-go/zap` | Структурированное логирование |
| `spf13/viper` | Конфигурация из env / файлов |
| `google/uuid` | UUID генерация |
| `stretchr/testify` | Unit тесты |

---

## Mobile (Flutter WebView)

**Архитектурное решение:** мобильные приложения — тонкая нативная оболочка вокруг веб-приложения.

**Почему WebView а не полноценный Flutter:**
- Единая кодовая база → половина затрат на разработку и поддержку
- Обновления фич без релиза в App Store / Google Play (обновляется веб-слой)
- Один QA-цикл вместо трёх (web + ios + android)

**Что делает нативный Flutter слой:**
- Инициализирует WebView с URL платформы
- Регистрирует FCM token (Android) / APNs token (iOS) и передаёт в WebView через JavaScript bridge
- Обрабатывает deep links (push-уведомление → открыть конкретный экран)
- Управляет permissions: микрофон (для AI Speaking), уведомления

**JavaScript Bridge — как push работает:**
```dart
// Flutter → WebView: сообщить о новом push токене
webViewController.runJavaScript(
  'window.onPushToken("$fcmToken")'
);

// WebView → Flutter: запросить разрешение на уведомления
// Через JavascriptChannel
```

**Сессия:** 7 дней, повторная авторизация после истечения refresh-токена.

---

## База данных

### PostgreSQL 15+

**Почему PostgreSQL:**
- JSONB с GIN индексами — идеально для хранения контента блоков (30+ типов, разная структура)
- Генерируемые колонки (GENERATED ALWAYS AS) — для нормализованных полей и вычислений
- `gen_random_uuid()` — встроенная генерация UUID без расширений
- Зрелые инструменты: pg_dump, pgBouncer, read replicas

**Схема на сервис:** в рамках MVP — один PostgreSQL инстанс с несколькими схемами (не отдельными БД). При росте нагрузки каждая схема переносится в свой инстанс без изменений кода сервиса.

```sql
-- Каждый сервис работает в своей схеме
SET search_path TO auth;     -- auth-service
SET search_path TO courses;  -- courses-service
SET search_path TO progress; -- progress-service
```

### Redis 7+

| Использование | Ключ | TTL |
|---|---|---|
| Refresh токены | `auth:refresh:{token_hash}` | 7 дней |
| Коды присутствия | `attendance:code:{lesson_id}` | задаёт куратор |
| Защита AI-сессии | `speaking:ai_lock:{user_id}` | 2 часа |
| Typing индикатор | `chat:typing:{chat_id}:{user_id}` | 5 секунд |
| Бронирование (атомарный счётчик) | `speaking:bookings:{room_id}` | до окончания комнаты |
| Кэш leaderboard | `cache:leaderboard:{marathon_id}` | 5 минут |
| Кэш CEFR уровня | `cache:cefr:{user_id}:{marathon_id}` | 1 час |
| Pub/Sub каналы | `events:{channel_name}` | без TTL |
| Счётчик неудачных логинов | `auth:failed_logins:{user_id}` | 15 минут |

**Почему Redis а не Kafka/RabbitMQ для Pub/Sub:** на текущем масштабе Redis Pub/Sub достаточен. Kafka избыточна — требует отдельной инфраструктуры, сложнее в поддержке. При росте до 100k+ пользователей — миграция на Kafka без изменения контрактов событий.

---

## Хранилище файлов

### AWS S3 / MinIO

MinIO — S3-совместимый self-hosted вариант. Одинаковое API, можно переключаться без изменений кода.

**Структура бакетов:**

```
media/
├── lessons/
│   ├── video/{lesson_id}/
│   ├── audio/{lesson_id}/
│   └── images/{lesson_id}/
├── homework/
│   └── {student_id}/{section_id}/
├── avatars/
│   └── {user_id}/
├── stories/
│   └── {story_id}/
├── vocab/
│   └── audio/{word_id}/
├── chat/
│   └── {chat_id}/
└── ai-sessions/
    └── {session_id}/
```

### Защита видео

Видеоконтент уроков защищён от скачивания:

1. **HLS стриминг** — видео нарезается на `.ts` сегменты + `.m3u8` манифест. Нельзя скачать одним файлом.
2. **Signed URLs** — каждый URL подписан и имеет TTL (15–30 минут). Прямая ссылка истекает.
3. **Watermark** — имя и ID студента отображается поверх видео через CSS/canvas overlay.
4. **CSS защита** — `user-select: none`, `pointer-events: none` на контентных блоках.
5. **Page Visibility API** — вкладка скрыта → видео автоматически на паузе.

### CDN (CloudFlare)

Весь статичный контент и медиафайлы раздаются через CloudFlare CDN. S3 не открыт напрямую — только через CDN или Signed URLs.

```
Студент в Алматы → CloudFlare Edge (ближайший) → кэш → S3 (только при cache miss)
```

---

## Инфраструктура

### Docker

Каждый сервис — отдельный Docker образ. Multi-stage build: компиляция Go в builder-stage, минимальный `alpine` или `scratch` в итоговом образе.

```dockerfile
# Пример Dockerfile для Go сервиса
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o service ./cmd/main.go

FROM alpine:3.19
RUN adduser -D -g '' appuser
COPY --from=builder /app/service /service
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:8080/health/live || exit 1
CMD ["/service"]
```

Итоговый образ ~15–20MB. Быстрый старт, минимальная attack surface.

### GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml (упрощённо)

on:
  push:
    branches: [main]
    paths:
      - 'services/auth-service/**'   # Деплоится только изменённый сервис

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: go test ./...
      - run: npm test  # если затронут фронтенд

  build:
    needs: test
    steps:
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/1bilim/auth-service:${{ github.sha }}

  deploy:
    needs: build
    steps:
      - run: |
          docker pull ghcr.io/1bilim/auth-service:${{ github.sha }}
          docker-compose up -d auth-service
```

Каждый сервис деплоится независимо — изменение в `chat-service` не затрагивает остальные.

### Окружения

| Окружение | Назначение | БД |
|---|---|---|
| local | Разработка на ноутбуке | Docker Compose, MinIO вместо S3 |
| staging | Тестирование перед релизом | Отдельный сервер, реальные интеграции в sandbox режиме |
| production | Боевой сервер | Полная конфигурация |

---

## Безопасность

### Аутентификация
- JWT access-токен TTL 15 минут
- Refresh-токен TTL 7 дней, хранится в Redis
- При смене пароля — все refresh-токены отзываются
- Хэш паролей: bcrypt cost=12

### Авторизация
- RBAC на уровне API Gateway (JWT роль) + на уровне каждого сервиса (middleware)
- Студент не может получить данные другого студента — все запросы фильтруются по `X-User-ID`
- Куратор видит только своих студентов — фильтрация через `curator_marathon_assignments`

### Транспорт
- HTTPS everywhere (TLS termination на API Gateway)
- WebSocket через WSS
- Внутренние вызовы между сервисами — HTTP внутри Docker network (изолированы от внешнего мира)

### Входные данные
- Валидация всех входных данных на уровне хендлера (go-playground/validator)
- Параметризованные SQL запросы через GORM (защита от SQL injection)
- Лимиты размеров файлов проверяются до загрузки в S3

### Секреты
- Никаких секретов в коде или Docker образах
- `.env` файлы только для local окружения (в `.gitignore`)
- Production: переменные окружения через Docker Compose secrets или platform secrets

---

## Производительность

### Цели (SLA)
- Время загрузки первой страницы (LCP): < 3 секунды
- API ответы (p95): < 500ms
- WebSocket: доставка сообщения < 100ms

### Оптимизации
- Пагинация cursor-based везде где список > 20 элементов (не offset — offset деградирует на больших таблицах)
- Lazy loading изображений и видео
- Денормализованные счётчики (total_points, completed_lessons, unread_count) — не COUNT(*) на каждый запрос
- Материализованный вью для leaderboard — REFRESH каждые 5 минут
- Redis кэш для CEFR уровня (TTL 1 час) и leaderboard (TTL 5 минут)
- CDN для всех медиафайлов — снимает нагрузку с origin сервера

### Cursor-based пагинация
```typescript
// Вместо ?page=5&per_page=20 (offset деградирует)
// Используется: ?cursor={last_item_id}&limit=20
GET /student/vocabulary?cursor=uuid&limit=20&order=created_at_desc
```
