-- === Аналитика ===
-- Агрегаты по дням/месяцам
CREATE TABLE IF NOT EXISTS analytics_daily (
    id BIGSERIAL PRIMARY KEY,

    date DATE NOT NULL,
    branch_id BIGINT REFERENCES branches(branch_id),

    total_appointments INT NOT NULL,
    total_revenue NUMERIC(12,2) NOT NULL,
    total_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_profit NUMERIC(12,2) NOT NULL,

    avg_check NUMERIC(10,2),
    active_clients INT,

    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (date, branch_id)
);

-- Аналитика по услугам (круговая диаграмма)
CREATE TABLE IF NOT EXISTS analytics_service_daily (
    id BIGSERIAL PRIMARY KEY,

    date DATE NOT NULL,
    branch_id BIGINT REFERENCES branches(branch_id),

    service_id BIGINT REFERENCES services(service_id),
    category_id INT REFERENCES service_categories(category_id),

    appointments_count INT NOT NULL,
    revenue NUMERIC(12,2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (date, branch_id, service_id)
);

-- Расходы (убытки)
CREATE TABLE IF NOT EXISTS expenses (
    expense_id BIGSERIAL PRIMARY KEY,

    branch_id BIGINT REFERENCES branches(branch_id),

    category VARCHAR(50) NOT NULL, -- зарплата, аренда, материалы, прочие расходы
    amount NUMERIC(12,2) NOT NULL,

    expense_date DATE NOT NULL,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- Добавление индексов для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_analytics_daily_branch_date ON analytics_daily(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_analytics_service_daily_branch_date ON analytics_service_daily(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses(branch_id, expense_date);

-- Добавление тестовых расходов для демонстрации
-- (Только если в таблице нет данных)
DO $$
DECLARE
    v_branch_id BIGINT;
    v_start_date DATE := '2024-01-01';
    v_end_date DATE := '2024-12-31';
    v_current_date DATE;
BEGIN
    -- Получаем первый филиал для тестовых данных
    SELECT branch_id INTO v_branch_id FROM branches LIMIT 1;
    
    IF v_branch_id IS NOT NULL THEN
        -- Проверяем, есть ли уже расходы
        IF NOT EXISTS (SELECT 1 FROM expenses WHERE branch_id = v_branch_id) THEN
            -- Генерируем тестовые расходы для каждого месяца
            v_current_date := v_start_date;
            
            WHILE v_current_date <= v_end_date LOOP
                -- Зарплата (ежемесячно, в начале месяца)
                IF EXTRACT(DAY FROM v_current_date) = 1 THEN
                    INSERT INTO expenses (branch_id, category, amount, expense_date, description)
                    VALUES 
                        (v_branch_id, 'Зарплата', 720000, v_current_date, 'Зарплата сотрудников за месяц');
                END IF;
                
                -- Аренда (ежемесячно, 1-го числа)
                IF EXTRACT(DAY FROM v_current_date) = 1 THEN
                    INSERT INTO expenses (branch_id, category, amount, expense_date, description)
                    VALUES 
                        (v_branch_id, 'Аренда', 250000, v_current_date, 'Аренда помещения');
                END IF;
                
                -- Материалы (каждые 10 дней)
                IF EXTRACT(DAY FROM v_current_date) % 10 = 0 THEN
                    INSERT INTO expenses (branch_id, category, amount, expense_date, description)
                    VALUES 
                        (v_branch_id, 'Материалы', 50000, v_current_date, 'Закупка расходных материалов');
                END IF;
                
                -- Прочие расходы (случайно в течение месяца)
                IF EXTRACT(DAY FROM v_current_date) IN (5, 15, 25) THEN
                    INSERT INTO expenses (branch_id, category, amount, expense_date, description)
                    VALUES 
                        (v_branch_id, 'Прочие расходы', 20000, v_current_date, 'Коммунальные и прочие расходы');
                END IF;
                
                v_current_date := v_current_date + INTERVAL '1 day';
            END LOOP;
            
            RAISE NOTICE 'Тестовые расходы успешно добавлены для филиала %', v_branch_id;
        ELSE
            RAISE NOTICE 'Расходы уже существуют в базе данных';
        END IF;
    ELSE
        RAISE NOTICE 'Не найдено филиалов для добавления тестовых данных';
    END IF;
END $$;
