-- Добавление day_type в service_prices если его нет

-- Проверяем существует ли day_type_enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'day_type_enum') THEN
        CREATE TYPE day_type_enum AS ENUM ('weekday', 'weekend', 'holiday');
    END IF;
END$$;

-- Добавляем колонку day_type если её нет
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'service_prices' AND column_name = 'day_type') THEN
        ALTER TABLE service_prices 
        ADD COLUMN day_type day_type_enum DEFAULT 'weekday';
        
        -- Создаем индекс для ускорения запросов
        CREATE INDEX idx_service_prices_day_type ON service_prices(day_type);
    END IF;
END$$;

-- Обновляем существующие записи - устанавливаем weekday для всех
UPDATE service_prices 
SET day_type = 'weekday' 
WHERE day_type IS NULL;
