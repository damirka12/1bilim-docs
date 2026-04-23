---
id: database
title: База данных
sidebar_label: База данных
---

# База данных

PostgreSQL 15+, UUID первичные ключи, JSONB для гибких структур, soft delete через `deleted_at`.

## Основные таблицы

| Таблица | Назначение |
|---------|-----------|
| users | Все пользователи: admin, curator, student |
| marathons | Марафоны / курсы |
| modules | Модули внутри марафона |
| lessons | Уроки внутри модулей |
| sections | Разделы внутри урока (с дедлайнами) |
| blocks | Блоки контента (JSONB content) |
| marathon_enrollments | Записи учеников на марафоны |
| lesson_progress | Прогресс ученика |
| homework_submissions | Отправленные ҮТ |
| chats | Чаты куратор ↔ ученик |
| messages | Сообщения в чатах (JSONB attachments) |
| stories | Сторисы |
| story_views | Просмотры сторисов |
| notifications | Уведомления пользователей |
| refresh_tokens | JWT refresh-токены |
| file_uploads | Загруженные файлы (S3), лимит 50MB |
| vocabulary_words | Слова словаря |
| user_vocabulary | Личный словарь ученика |
| speaking_rooms | Комнаты speaking rooms |
| speaking_bookings | Брони на speaking rooms |
| speaking_ratings | Оценки speaking sessions |
| live_lessons | Live уроки куратора |
| attendance_logs | Журнал посещаемости |
| attendance_codes | Коды для отметки |
| calendar_events | События в календаре |
| cefr_scores | История CEFR-оценок |
| points_log | Журнал начисления баллов |
| payments | Платежи |
| tariff_plans | Тарифные планы |

## Ключевые поля таблицы marathons

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID PK | gen_random_uuid() |
| title | VARCHAR(255) | Название |
| slug | VARCHAR(255) UNIQUE | URL-идентификатор |
| level_start | VARCHAR(5) | Начальный уровень CEFR |
| level_end | VARCHAR(5) | Финальный уровень CEFR |
| access_mode | VARCHAR(20) | open / sequential / with_review |
| show_rating | BOOLEAN | Показывать рейтинг |
| status | VARCHAR(20) | draft / published / archived |
| created_at / updated_at / deleted_at | TIMESTAMP | Мета-поля |
