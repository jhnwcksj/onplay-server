-- ВНИМАНИЕ: Этот скрипт полностью пересоздает ENUM booking_design_type
-- Используйте только если простое добавление значения не работает
-- Сделайте backup базы данных перед запуском!

-- Шаг 1: Проверяем наличие данных в таблице
SELECT COUNT(*) as records_count FROM branch_booking_settings;

-- Шаг 2: Создаём временный ENUM с новыми значениями
DROP TYPE IF EXISTS booking_design_type_new CASCADE;
CREATE TYPE booking_design_type_new AS ENUM (
    'default',
    'anotherworld_brand'
);

-- Шаг 3: Если таблица НЕ существует, создаём её
CREATE TABLE IF NOT EXISTS branch_booking_settings_backup AS 
SELECT * FROM branch_booking_settings;

-- Шаг 4: Изменяем тип колонки в таблице
ALTER TABLE branch_booking_settings 
    ALTER COLUMN design_type DROP DEFAULT;

ALTER TABLE branch_booking_settings 
    ALTER COLUMN design_type TYPE booking_design_type_new 
    USING (
        CASE 
            WHEN design_type::text = 'default' THEN 'default'::booking_design_type_new
            WHEN design_type::text = 'brand' THEN 'anotherworld_brand'::booking_design_type_new
            WHEN design_type::text = 'custom' THEN 'default'::booking_design_type_new
            WHEN design_type::text = 'anotherworld_brand' THEN 'anotherworld_brand'::booking_design_type_new
            ELSE 'default'::booking_design_type_new
        END
    );

-- Шаг 5: Удаляем старый ENUM
DROP TYPE IF EXISTS booking_design_type CASCADE;

-- Шаг 6: Переименовываем новый ENUM
ALTER TYPE booking_design_type_new RENAME TO booking_design_type;

-- Шаг 7: Восстанавливаем DEFAULT
ALTER TABLE branch_booking_settings 
    ALTER COLUMN design_type SET DEFAULT 'default'::booking_design_type;

-- Проверка результата
SELECT enumlabel as available_values 
FROM pg_enum e 
JOIN pg_type t ON e.enumtypid = t.oid 
WHERE t.typname = 'booking_design_type'
ORDER BY e.enumsortorder;

-- Проверка данных в таблице
SELECT branch_id, design_type 
FROM branch_booking_settings 
LIMIT 10;
