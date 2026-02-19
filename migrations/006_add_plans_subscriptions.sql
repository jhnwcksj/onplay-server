-- === План категории Тарифов ===
CREATE TABLE IF NOT EXISTS plan_categories (
    category_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- === Таблица тарифов ===
CREATE TABLE IF NOT EXISTS plans (
    plan_id SERIAL PRIMARY KEY,

    category_id INT NOT NULL
        REFERENCES plan_categories(category_id)
        ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    description TEXT,

    plan_type VARCHAR(50) DEFAULT 'standard',

    price NUMERIC(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'KZT',

    duration_days INT NOT NULL,
    bonus_days INT DEFAULT 0,

    max_branches INT,
    max_users INT,

    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- === Таблица купленных лицензий (подписки) ===
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id SERIAL PRIMARY KEY,

    network_id INT NOT NULL
        REFERENCES networks(network_id)
        ON DELETE CASCADE,

    plan_id INT NOT NULL
        REFERENCES plans(plan_id)
        ON DELETE CASCADE,

    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,

    status VARCHAR(50) DEFAULT 'active',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- === Вставка начальных категорий ===
INSERT INTO plan_categories (name, description, icon) VALUES
    ('VR', 'Виртуальная реальность, игровые зоны', '🎮'),
    ('Бильярд', 'Бильярдные клубы и столы', '🎱'),
    ('Техосмотр', 'Станции технического осмотра', '🔧')
ON CONFLICT (name) DO NOTHING;

-- === Вставка начальных тарифов ===
-- Для обычных пользователей (user)
INSERT INTO plans (category_id, name, description, plan_type, price, duration_days, bonus_days, max_branches, max_users) VALUES
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 1 месяц (User)', 'Базовый тариф для VR арены', 'user_monthly', 20000, 30, 0, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 3 месяца (User)', 'Тариф на 3 месяца с бонусом', 'user_quarterly', 20000, 90, 30, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 6 месяцев (User)', 'Тариф на 6 месяцев с бонусом', 'user_half_year', 20000, 180, 60, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 1 год (User)', 'Годовой тариф с максимальным бонусом', 'user_yearly', 20000, 365, 150, 3, 10),
    
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 1 месяц (User)', 'Базовый тариф для бильярда', 'user_monthly', 20000, 30, 0, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 3 месяца (User)', 'Тариф на 3 месяца с бонусом', 'user_quarterly', 20000, 90, 30, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 6 месяцев (User)', 'Тариф на 6 месяцев с бонусом', 'user_half_year', 20000, 180, 60, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 1 год (User)', 'Годовой тариф с максимальным бонусом', 'user_yearly', 20000, 365, 150, 3, 10),
    
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 1 месяц (User)', 'Базовый тариф для техосмотра', 'user_monthly', 20000, 30, 0, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 3 месяца (User)', 'Тариф на 3 месяца с бонусом', 'user_quarterly', 20000, 90, 30, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 6 месяцев (User)', 'Тариф на 6 месяцев с бонусом', 'user_half_year', 20000, 180, 60, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 1 год (User)', 'Годовой тариф с максимальным бонусом', 'user_yearly', 20000, 365, 150, 3, 10);

-- Для VIP пользователей (vip-user) - со сниженной ценой
INSERT INTO plans (category_id, name, description, plan_type, price, duration_days, bonus_days, max_branches, max_users) VALUES
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 1 месяц (VIP)', 'VIP тариф для VR арены', 'vip_monthly', 15000, 30, 0, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 3 месяца (VIP)', 'VIP тариф на 3 месяца с бонусом', 'vip_quarterly', 15000, 90, 30, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 6 месяцев (VIP)', 'VIP тариф на 6 месяцев с бонусом', 'vip_half_year', 15000, 180, 60, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'VR'), 'VR - 1 год (VIP)', 'VIP годовой тариф с максимальным бонусом', 'vip_yearly', 15000, 365, 150, 3, 10),
    
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 1 месяц (VIP)', 'VIP тариф для бильярда', 'vip_monthly', 15000, 30, 0, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 3 месяца (VIP)', 'VIP тариф на 3 месяца с бонусом', 'vip_quarterly', 15000, 90, 30, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 6 месяцев (VIP)', 'VIP тариф на 6 месяцев с бонусом', 'vip_half_year', 15000, 180, 60, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Бильярд'), 'Бильярд - 1 год (VIP)', 'VIP годовой тариф с максимальным бонусом', 'vip_yearly', 15000, 365, 150, 3, 10),
    
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 1 месяц (VIP)', 'VIP тариф для техосмотра', 'vip_monthly', 15000, 30, 0, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 3 месяца (VIP)', 'VIP тариф на 3 месяца с бонусом', 'vip_quarterly', 15000, 90, 30, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 6 месяцев (VIP)', 'VIP тариф на 6 месяцев с бонусом', 'vip_half_year', 15000, 180, 60, 3, 10),
    ((SELECT category_id FROM plan_categories WHERE name = 'Техосмотр'), 'Техосмотр - 1 год (VIP)', 'VIP годовой тариф с максимальным бонусом', 'vip_yearly', 15000, 365, 150, 3, 10);

-- === Индексы для оптимизации ===
CREATE INDEX IF NOT EXISTS idx_plans_category ON plans(category_id);
CREATE INDEX IF NOT EXISTS idx_plans_type ON plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_network ON subscriptions(network_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_dates ON subscriptions(start_date, end_date);
