-- Migration 004: Add online booking tables

-- === Типы данных ===
DO $$ BEGIN
    CREATE TYPE booking_flow_type AS ENUM (
        'service_first',
        'zone_first',
        'time_first'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE booking_design_type AS ENUM (
        'default',
        'anotherworld_brand'
    );
EXCEPTION
    WHEN duplicate_object THEN 
        -- Если ENUM уже существует, добавляем новое значение если его нет
        BEGIN
            ALTER TYPE booking_design_type ADD VALUE IF NOT EXISTS 'anotherworld_brand';
        EXCEPTION
            WHEN OTHERS THEN null;
        END;
END $$;

DO $$ BEGIN
    CREATE TYPE booking_status AS ENUM (
        'new',
        'confirmed',
        'cancelled',
        'completed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- === Добавляем public_code в branches ===
ALTER TABLE branches 
ADD COLUMN IF NOT EXISTS public_code VARCHAR(100) UNIQUE;

-- === Добавляем slug в networks ===
ALTER TABLE networks 
ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;

-- === Добавляем is_online_available в services ===
ALTER TABLE services 
ADD COLUMN IF NOT EXISTS is_online_available BOOLEAN DEFAULT TRUE;

-- === Добавляем is_booking_available в zones ===
ALTER TABLE zones 
ADD COLUMN IF NOT EXISTS is_booking_available BOOLEAN DEFAULT TRUE;

-- === Настройки онлайн-записи филиала ===
CREATE TABLE IF NOT EXISTS branch_booking_settings (
    branch_id BIGINT PRIMARY KEY
        REFERENCES branches(branch_id)
        ON DELETE CASCADE,

    is_enabled BOOLEAN DEFAULT TRUE,

    flow_type booking_flow_type NOT NULL DEFAULT 'service_first',

    design_type booking_design_type NOT NULL DEFAULT 'default',

    primary_color VARCHAR(10),
    secondary_color VARCHAR(10),

    show_prices BOOLEAN DEFAULT TRUE,
    show_duration BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- === Рабочие дни и часы филиала ===
CREATE TABLE IF NOT EXISTS branch_working_hours (
    id SERIAL PRIMARY KEY,

    branch_id BIGINT NOT NULL
        REFERENCES branches(branch_id)
        ON DELETE CASCADE,

    weekday INT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    -- 1 = Пн ... 7 = Вс

    start_time TIME NOT NULL,
    end_time TIME NOT NULL,

    is_day_off BOOLEAN DEFAULT FALSE,

    UNIQUE (branch_id, weekday)
);

-- === Онлайн-записи клиентов ===
CREATE TABLE IF NOT EXISTS bookings (
    booking_id BIGSERIAL PRIMARY KEY,

    branch_id BIGINT NOT NULL
        REFERENCES branches(branch_id),

    service_id INT
        REFERENCES services(service_id),

    zone_id INT
        REFERENCES zones(zone_id),

    client_name VARCHAR(150),
    client_phone VARCHAR(50),

    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,

    status booking_status DEFAULT 'new',

    created_at TIMESTAMP DEFAULT NOW()
);

-- === Индексы для производительности ===
CREATE INDEX IF NOT EXISTS idx_bookings_branch_id ON bookings(branch_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_branch_working_hours_branch_id ON branch_working_hours(branch_id);
