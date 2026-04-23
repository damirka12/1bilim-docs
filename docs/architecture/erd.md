---
id: erd
title: ERD — Схема связей
sidebar_label: ERD
---

# Entity Relationship Diagrams

Схемы разбиты по сервисам для читаемости. Связи между сервисами — логические (не FK на уровне БД, так как database per service).

---

## auth-service

```mermaid
erDiagram
    users {
        uuid id PK
        string email
        string email_normalized
        string phone
        string password_hash
        timestamp password_changed_at
        string role
        string status
        string first_name
        string last_name
        string avatar_url
        string timezone
        string lang
        string fcm_token
        string apns_token
        timestamp last_seen_at
        timestamp last_login_at
        int login_count
        int failed_login_count
        timestamp locked_until
        uuid invited_by
        string utm_source
        timestamp created_at
        timestamp deleted_at
    }

    refresh_tokens {
        uuid id PK
        uuid user_id FK
        string token_hash
        string device_name
        string device_platform
        inet ip_address
        timestamp expires_at
        timestamp last_used_at
        timestamp revoked_at
        string revoke_reason
        timestamp created_at
    }

    password_reset_tokens {
        uuid id PK
        uuid user_id FK
        string token_hash
        timestamp expires_at
        timestamp used_at
        inet ip_address
        timestamp created_at
    }

    users ||--o{ refresh_tokens : "имеет сессии"
    users ||--o{ password_reset_tokens : "запрашивает сброс"
```

---

## users-service

```mermaid
erDiagram
    marathon_enrollments {
        uuid id PK
        uuid student_id
        uuid marathon_id
        uuid curator_id
        uuid tariff_plan_id
        string tariff_name
        string status
        timestamp access_from
        timestamp access_until
        int extension_count
        int total_points
        int completed_lessons
        int total_lessons
        numeric completion_percent
        timestamp completed_at
        bool expiry_notified_3d
        bool expiry_notified_1d
        uuid payment_id
        timestamp created_at
        timestamp deleted_at
    }

    curator_marathon_assignments {
        uuid id PK
        uuid curator_id
        uuid marathon_id
        int student_limit
        int current_student_count
        bool is_active
        int avg_response_time_minutes
        int total_homeworks_reviewed
        int total_homeworks_pending
        uuid assigned_by
        timestamp created_at
    }

    marathon_enrollments }o--|| curator_marathon_assignments : "куратор назначен через"
```

---

## courses-service

```mermaid
erDiagram
    marathons {
        uuid id PK
        string title
        string slug
        string short_description
        string cover_url
        string category
        string language
        string level_start
        string level_end
        string access_mode
        bool show_rating
        string rating_scope
        bool is_public
        string status
        int total_lessons_count
        int total_students_count
        uuid created_by
        uuid duplicated_from FK
        timestamp created_at
        timestamp deleted_at
    }

    modules {
        uuid id PK
        uuid marathon_id FK
        string title
        string description
        int position
        bool is_free_preview
        string status
        int total_lessons_count
        timestamp created_at
        timestamp deleted_at
    }

    lessons {
        uuid id PK
        uuid module_id FK
        string title
        string description
        int estimated_duration_minutes
        int completion_points
        int position
        string status
        int total_sections_count
        int total_blocks_count
        timestamp created_at
        timestamp deleted_at
    }

    sections {
        uuid id PK
        uuid lesson_id FK
        string title
        int position
        int deadline_days
        bool has_homework
        string homework_description
        int homework_max_file_size_mb
        int homework_max_audio_seconds
        int total_blocks_count
        timestamp created_at
        timestamp deleted_at
    }

    blocks {
        uuid id PK
        uuid section_id FK
        string type
        int position
        jsonb content
        bool is_gradable
        bool requires_curator_review
        int points
        bool is_visible
        timestamp created_at
    }

    tariff_plans {
        uuid id PK
        uuid marathon_id FK
        string name
        string internal_code
        numeric price
        numeric original_price
        string currency
        string duration_type
        int duration_days
        bool has_lessons
        bool has_homework_review
        bool has_live_lessons
        bool has_speaking_rooms
        bool has_attendance
        bool has_individual_lessons
        int display_order
        bool is_featured
        string status
        timestamp created_at
        timestamp deleted_at
    }

    stories {
        uuid id PK
        uuid marathon_id FK
        string title
        int position
        timestamp active_from
        timestamp active_until
        string link_url
        string status
        int total_views
        int unique_views
        uuid created_by
        timestamp created_at
        timestamp deleted_at
    }

    story_slides {
        uuid id PK
        uuid story_id FK
        int position
        string media_type
        string media_url
        int duration_seconds
        string overlay_text
        timestamp created_at
    }

    story_views {
        uuid id PK
        uuid story_id FK
        uuid student_id
        timestamp viewed_at
        timestamp completed_at
        int last_slide_seen
    }

    marathons ||--o{ modules : "содержит"
    modules ||--o{ lessons : "содержит"
    lessons ||--o{ sections : "делится на"
    sections ||--o{ blocks : "содержит"
    marathons ||--o{ tariff_plans : "имеет тарифы"
    marathons ||--o{ stories : "имеет сторисы"
    stories ||--o{ story_slides : "состоит из слайдов"
    stories ||--o{ story_views : "просматривается"
    marathons }o--o| marathons : "дублирован из"
```

---

## progress-service

```mermaid
erDiagram
    lesson_progress {
        uuid id PK
        uuid student_id
        uuid lesson_id
        uuid marathon_id
        string status
        timestamp started_at
        timestamp completed_at
        timestamp last_activity_at
        int time_spent_seconds
        int sections_total
        int sections_completed
        int points_earned
        timestamp created_at
    }

    section_progress {
        uuid id PK
        uuid student_id
        uuid section_id
        uuid lesson_id
        uuid marathon_id
        string status
        timestamp started_at
        timestamp completed_at
        uuid last_block_id
        int correct_answers
        int total_gradable_blocks
        int points_earned
        timestamp created_at
    }

    homework_submissions {
        uuid id PK
        uuid student_id
        uuid section_id
        uuid lesson_id
        uuid marathon_id
        uuid enrollment_id
        int version
        bool is_latest
        string status
        string content_type
        text text_content
        int word_count
        int audio_duration_seconds
        uuid reviewer_id
        text reviewer_comment
        string reviewer_audio_url
        int bonus_points
        timestamp reviewed_at
        timestamp submitted_at
    }

    homework_files {
        uuid id PK
        uuid submission_id FK
        string file_url
        string file_name
        bigint file_size_bytes
        string mime_type
        string file_type
        string thumbnail_url
        int duration_seconds
        int position
        timestamp created_at
    }

    quiz_attempts {
        uuid id PK
        uuid student_id
        uuid block_id
        uuid section_id
        uuid lesson_id
        uuid marathon_id
        int attempt_number
        bool is_correct
        int score
        int max_score
        int time_spent_seconds
        jsonb selected_option_ids
        text text_answer
        timestamp attempted_at
    }

    points_log {
        uuid id PK
        uuid student_id
        uuid enrollment_id
        uuid marathon_id
        int points
        int balance_before
        int balance_after
        string source
        uuid reference_id
        string reference_type
        text description
        uuid created_by
        timestamp created_at
    }

    streaks {
        uuid id PK
        uuid student_id
        int current_streak
        int longest_streak
        date last_activity_date
        date streak_started_at
        int last_bonus_streak
        int total_bonuses_earned
        timestamp created_at
    }

    lesson_progress ||--o{ section_progress : "детализируется"
    section_progress ||--o{ homework_submissions : "имеет ДЗ"
    homework_submissions ||--o{ homework_files : "содержит файлы"
    lesson_progress ||--o{ quiz_attempts : "включает тесты"
    lesson_progress ||--o{ points_log : "начисляет баллы"
```

---

## chat-service

```mermaid
erDiagram
    chats {
        uuid id PK
        uuid student_id
        uuid curator_id
        uuid enrollment_id
        uuid marathon_id
        bool is_active
        uuid last_message_id
        string last_message_text
        timestamp last_message_at
        int student_unread_count
        int curator_unread_count
        int avg_response_time_minutes
        timestamp created_at
    }

    messages {
        uuid id PK
        uuid chat_id FK
        uuid sender_id
        string type
        text text
        string voice_url
        int voice_duration_seconds
        jsonb voice_waveform
        string file_url
        string file_name
        bigint file_size_bytes
        string image_url
        string image_thumbnail_url
        timestamp delivered_at
        timestamp read_at
        timestamp edited_at
        uuid reply_to_message_id FK
        bool is_deleted
        timestamp deleted_at
        uuid deleted_by
        timestamp created_at
    }

    chats ||--o{ messages : "содержит"
    messages }o--o| messages : "ответ на"
```

---

## payment-service

```mermaid
erDiagram
    payments {
        uuid id PK
        uuid student_id
        uuid tariff_plan_id
        uuid marathon_id
        string tariff_name_snapshot
        numeric tariff_price_snapshot
        string provider
        numeric amount
        numeric amount_paid
        string currency
        string status
        string external_id
        jsonb provider_response
        timestamp initiated_at
        timestamp paid_at
        string utm_source
        string utm_medium
        string utm_campaign
        string referrer_url
        uuid created_by
        timestamp created_at
    }

    payment_refunds {
        uuid id PK
        uuid payment_id FK
        numeric amount
        text reason
        string status
        string external_refund_id
        timestamp processed_at
        uuid created_by
        timestamp created_at
    }

    payments ||--o{ payment_refunds : "может быть возвращён"
```

---

## speaking-service

```mermaid
erDiagram
    speaking_rooms {
        uuid id PK
        uuid host_id
        string host_type
        string title
        string topic
        string level
        string language
        timestamp scheduled_at
        int duration_minutes
        int max_participants
        int current_participants
        string google_event_id
        string meet_link
        string status
        string visibility
        uuid marathon_id
        numeric avg_rating
        int ratings_count
        timestamp created_at
        timestamp deleted_at
    }

    speaking_bookings {
        uuid id PK
        uuid room_id FK
        uuid student_id
        string status
        timestamp cancelled_at
        timestamp reminder_1h_sent_at
        timestamp reminder_15m_sent_at
        timestamp booked_at
        timestamp created_at
    }

    speaking_ratings {
        uuid id PK
        uuid room_id FK
        uuid student_id
        int rating
        text comment
        timestamp created_at
    }

    ai_sessions {
        uuid id PK
        uuid student_id
        uuid enrollment_id
        string topic
        string difficulty_level
        string status
        timestamp started_at
        timestamp ended_at
        int duration_seconds
        int message_count
        numeric fluency_score
        numeric grammar_score
        numeric vocabulary_score
        numeric overall_score
        jsonb errors_summary
        text feedback_text
        int openai_tokens_used
        numeric openai_cost_usd
        timestamp created_at
    }

    ai_session_messages {
        uuid id PK
        uuid session_id FK
        string role
        string audio_url
        text transcription
        numeric transcription_confidence
        text response_text
        string response_audio_url
        jsonb grammar_errors
        jsonb vocabulary_suggestions
        int position
        timestamp created_at
    }

    speaking_rooms ||--o{ speaking_bookings : "бронируется"
    speaking_rooms ||--o{ speaking_ratings : "оценивается"
    ai_sessions ||--o{ ai_session_messages : "содержит диалог"
```

---

## vocab-service

```mermaid
erDiagram
    vocabulary_words {
        uuid id PK
        string word
        string word_normalized
        string language
        string part_of_speech
        string pronunciation_ipa
        string audio_url
        string cefr_level
        int frequency_rank
        text definition_en
        string image_url
        bool is_approved
        string source
        timestamp created_at
        timestamp deleted_at
    }

    word_translations {
        uuid id PK
        uuid word_id FK
        string language
        text translation
        string[] synonyms
        bool is_primary
        timestamp created_at
    }

    word_examples {
        uuid id PK
        uuid word_id FK
        text example_text
        text translation_ru
        text translation_kz
        string audio_url
        string cefr_level
        bool is_primary
        int position
        timestamp created_at
    }

    user_vocabulary {
        uuid id PK
        uuid student_id
        uuid word_id FK
        string custom_word
        string custom_translation
        string source
        uuid source_lesson_id
        string status
        bool is_favourite
        timestamp next_review_at
        int review_count
        numeric ease_factor
        timestamp learned_at
        timestamp created_at
        timestamp deleted_at
    }

    vocabulary_words ||--o{ word_translations : "имеет переводы"
    vocabulary_words ||--o{ word_examples : "имеет примеры"
    vocabulary_words ||--o{ user_vocabulary : "добавляется студентами"
```

---

## cefr-service

```mermaid
erDiagram
    cefr_scores {
        uuid id PK
        uuid student_id
        uuid marathon_id
        string current_level
        numeric level_progress_percent
        numeric quiz_score
        numeric lessons_score
        numeric activity_score
        numeric ai_session_score
        int estimated_lessons_to_next_level
        string previous_level
        timestamp level_upgraded_at
        timestamp last_calculated_at
        int calculation_version
        timestamp created_at
    }

    cefr_history {
        uuid id PK
        uuid student_id
        uuid marathon_id
        string level
        numeric level_progress
        numeric quiz_score
        numeric lessons_score
        numeric activity_score
        string trigger_event
        timestamp recorded_at
    }

    cefr_scores ||--o{ cefr_history : "история изменений"
```

---

## notification-service

```mermaid
erDiagram
    notifications {
        uuid id PK
        uuid recipient_id
        string type
        string title
        text body
        string action_type
        jsonb action_payload
        bool sent_via_push
        bool sent_via_email
        timestamp push_sent_at
        timestamp email_sent_at
        string push_error
        timestamp read_at
        timestamp created_at
    }

    notification_settings {
        uuid id PK
        uuid user_id
        bool lesson_unlocked_push
        bool new_message_push
        bool new_message_email
        bool live_reminder_push
        bool live_reminder_email
        bool speaking_reminder_push
        bool quiet_hours_enabled
        time quiet_hours_start
        time quiet_hours_end
        string quiet_hours_timezone
        timestamp created_at
    }

    device_tokens {
        uuid id PK
        uuid user_id
        string platform
        string token
        string device_name
        string app_version
        bool is_active
        timestamp last_used_at
        timestamp created_at
    }

    notification_settings ||--o{ notifications : "фильтрует"
    device_tokens ||--o{ notifications : "доставляет push"
```

---

## attendance-service

```mermaid
erDiagram
    attendance_codes {
        uuid id PK
        uuid live_lesson_id
        char code
        uuid created_by
        timestamp valid_from
        timestamp expires_at
        bool is_active
        int submissions_count
        timestamp created_at
    }

    attendance_logs {
        uuid id PK
        uuid student_id
        uuid live_lesson_id
        uuid enrollment_id
        uuid marathon_id
        string status
        string method
        uuid attendance_code_id FK
        timestamp code_submitted_at
        uuid marked_by
        timestamp marked_at
        text excused_reason
        text curator_note
        timestamp created_at
    }

    attendance_codes ||--o{ attendance_logs : "подтверждает присутствие"
```

---

## calendar-service

```mermaid
erDiagram
    live_lessons {
        uuid id PK
        uuid curator_id
        uuid marathon_id
        string title
        text description
        timestamp scheduled_at
        int duration_minutes
        string group_name
        int max_participants
        string google_event_id
        string meet_link
        uuid bulk_id
        int bulk_position
        string status
        timestamp started_at
        timestamp completed_at
        bool reminder_1h_sent
        bool reminder_15m_sent
        timestamp created_at
        timestamp deleted_at
    }

    calendar_events {
        uuid id PK
        uuid created_by
        string creator_role
        string title
        text description
        string event_type
        string color
        timestamp starts_at
        timestamp ends_at
        bool is_all_day
        string link_url
        string target_type
        uuid target_marathon_id
        string target_tariff_code
        uuid[] target_user_ids
        string status
        bool send_notification
        timestamp created_at
        timestamp deleted_at
    }

    calendar_personal {
        uuid id PK
        uuid student_id
        string title
        text note
        timestamp starts_at
        timestamp ends_at
        bool is_all_day
        string color
        int reminder_minutes
        timestamp created_at
        timestamp deleted_at
    }

    live_lessons }o--o{ attendance_codes : "отмечается через"
```

---

## files-service

```mermaid
erDiagram
    file_uploads {
        uuid id PK
        uuid uploader_id
        string uploader_role
        string original_name
        string stored_name
        string s3_bucket
        string s3_key
        string cdn_url
        string mime_type
        bigint file_size_bytes
        string file_extension
        string purpose
        uuid reference_id
        int width
        int height
        int duration_seconds
        string processing_status
        string thumbnail_url
        string hls_url
        bool is_public
        string virus_scan_status
        timestamp created_at
        timestamp deleted_at
    }
```

---

## Межсервисные связи (логические)

Физических FK между сервисами нет — только логические связи через ID. Данные другого сервиса получаются через API.

```mermaid
graph LR
    subgraph auth["auth-service"]
        U["users"]
    end
    subgraph users["users-service"]
        ME["marathon_enrollments"]
        CMA["curator_marathon_assignments"]
    end
    subgraph courses["courses-service"]
        M["marathons"]
        TP["tariff_plans"]
    end
    subgraph progress["progress-service"]
        LP["lesson_progress"]
        HS["homework_submissions"]
        PL["points_log"]
    end
    subgraph payment["payment-service"]
        PAY["payments"]
    end

    U -. "student_id / curator_id" .-> ME
    U -. "student_id" .-> LP
    U -. "student_id" .-> PAY
    M -. "marathon_id" .-> ME
    TP -. "tariff_plan_id" .-> ME
    TP -. "tariff_plan_id" .-> PAY
    ME -. "enrollment_id" .-> HS
    ME -. "enrollment_id" .-> PL
    PAY -. "payment_id" .-> ME
```
