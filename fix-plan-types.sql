-- Проверка текущих значений plan_type
SELECT plan_id, name, plan_type, price FROM plans ORDER BY plan_id;

-- Обновление plan_type для обычных пользователей (price = 20000) -> 'standard'
UPDATE plans 
SET plan_type = 'standard'
WHERE price = 20000;

-- Обновление plan_type для VIP пользователей (price = 15000) -> 'vip'
UPDATE plans 
SET plan_type = 'vip'
WHERE price = 15000;

-- Проверка после обновления
SELECT plan_id, name, plan_type, price, duration_days, category_id FROM plans ORDER BY price, duration_days;
