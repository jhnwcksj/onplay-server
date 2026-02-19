-- Таблица для переопределения типов дней недели для конкретных услуг
-- Позволяет услуге работать по своему графику, отличному от branch_week_rules

CREATE TABLE IF NOT EXISTS service_week_overrides (
    id SERIAL PRIMARY KEY,
    
    service_id INT NOT NULL 
        REFERENCES services(service_id) 
        ON DELETE CASCADE,
    
    weekday SMALLINT NOT NULL 
        CHECK (weekday BETWEEN 0 AND 6),
        -- 0 = воскресенье, 1 = понедельник, ..., 6 = суббота
    
    override_day_type day_type_enum NOT NULL,
        -- weekday / weekend / holiday
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Уникальность: одна услуга не может иметь два override для одного дня недели
    UNIQUE (service_id, weekday)
);

-- Индекс для быстрого поиска overrides по service_id
CREATE INDEX IF NOT EXISTS idx_service_week_overrides_service_id 
    ON service_week_overrides(service_id);

COMMENT ON TABLE service_week_overrides IS 
    'Переопределения типов дней недели для конкретных услуг. Приоритет: service_week_overrides > branch_calendar > branch_week_rules';

COMMENT ON COLUMN service_week_overrides.override_day_type IS 
    'Тип дня для этой услуги в указанный день недели, игнорируя branch_week_rules';
