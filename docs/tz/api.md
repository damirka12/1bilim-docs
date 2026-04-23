---
id: api
title: API Эндпоинты
sidebar_label: API
---

# API Эндпоинты

RESTful API, base URL: `/api/v1`. JWT-аутентификация. WebSocket для real-time.

## Аутентификация

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | /auth/login | Вход |
| POST | /auth/refresh | Обновить токен |
| POST | /auth/logout | Выход |
| POST | /auth/forgot-password | Сброс пароля |
| GET | /auth/me | Текущий пользователь |

## Admin — Марафоны

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET/POST | /admin/marathons | Список / Создать |
| GET/PUT/DELETE | /admin/marathons/:id | CRUD |
| POST | /admin/marathons/:id/publish | Опубликовать |
| POST | /admin/marathons/:id/duplicate | Дублировать |
| GET/POST | /admin/marathons/:id/modules | Модули |
| GET/POST | /admin/modules/:id/lessons | Уроки |
| GET/POST | /admin/lessons/:id/sections | Разделы |
| GET/POST | /admin/sections/:id/blocks | Блоки |

## Admin — Пользователи

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET/POST | /admin/users | Список / Создать |
| GET/PUT/DELETE | /admin/users/:id | CRUD |
| POST | /admin/users/:id/block | Блокировать |
| POST | /admin/users/import | Импорт из CSV |
| POST | /admin/enrollments/:id/assign-curator | Назначить куратора |
| POST | /admin/enrollments/:id/extend | Продлить доступ |

## Куратор

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | /curator/dashboard | Дашборд |
| GET | /curator/students | Мои ученики |
| GET/POST | /curator/homework | ҮТ / Проверить |
| POST | /curator/homework/:id/review | Принять / Отклонить |
| GET/POST | /curator/chats/:id/messages | Сообщения чата |
| GET | /curator/schedule | Расписание |

## Оқушы

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | /student/dashboard | Главная |
| GET | /student/marathons | Мои марафоны |
| GET | /student/lessons/:id | Урок с блоками |
| POST | /student/lessons/:id/complete | Завершить урок |
| POST | /student/lessons/:id/homework | Отправить ҮТ |
| GET | /student/cefr | Текущий уровень CEFR |
| GET | /student/vocabulary | Словарь |
| GET | /student/speaking/rooms | Список комнат |
| POST | /student/speaking/rooms/:id/book | Забронировать |
| POST | /student/speaking/ai-session | AI-сессия |
| POST | /student/payments/initiate | Начать оплату |

## WebSocket события

| Событие | Источник | Описание |
|---------|----------|----------|
| new_message | Server | Новое сообщение в чате |
| homework_reviewed | Server | ҮТ проверено |
| typing | Server | Собеседник печатает |
| lesson_unlocked | Server | Следующий урок открыт |
