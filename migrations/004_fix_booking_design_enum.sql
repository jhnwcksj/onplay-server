-- Fix для обновления booking_design_type ENUM

-- Если ENUM уже создан с другими значениями, нужно его обновить
DO $$ 
BEGIN
    -- Пытаемся добавить новое значение
    ALTER TYPE booking_design_type ADD VALUE IF NOT EXISTS 'anotherworld_brand';
    
    -- Обновляем существующие записи с устаревшими значениями на 'default'
    UPDATE branch_booking_settings 
    SET design_type = 'default' 
    WHERE design_type NOT IN ('default', 'anotherworld_brand');
    
EXCEPTION
    WHEN undefined_object THEN
        -- ENUM не существует, создаём его
        CREATE TYPE booking_design_type AS ENUM (
            'default',
            'anotherworld_brand'
        );
    WHEN OTHERS THEN
        RAISE NOTICE 'Error updating enum: %', SQLERRM;
END $$;

-- Если нужно полностью пересоздать ENUM (раскомментируйте при необходимости):
/*
-- Шаг 1: Создаём временный ENUM
DROP TYPE IF EXISTS booking_design_type_new CASCADE;
CREATE TYPE booking_design_type_new AS ENUM (
    'default',
    'anotherworld_brand'
);

-- Шаг 2: Обновляем таблицу, используя новый тип
ALTER TABLE branch_booking_settings 
    ALTER COLUMN design_type TYPE booking_design_type_new 
    USING (CASE 
        WHEN design_type::text = 'default' THEN 'default'::booking_design_type_new
        WHEN design_type::text = 'brand' THEN 'anotherworld_brand'::booking_design_type_new
        WHEN design_type::text = 'custom' THEN 'default'::booking_design_type_new
        ELSE 'default'::booking_design_type_new
    END);

-- Шаг 3: Удаляем старый ENUM и переименовываем новый
DROP TYPE IF EXISTS booking_design_type CASCADE;
ALTER TYPE booking_design_type_new RENAME TO booking_design_type;
*/
