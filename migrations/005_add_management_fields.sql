-- Добавление полей для управления филиалами

-- Добавить колонку valid_from в branches, если её нет
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'branches' AND column_name = 'valid_from'
  ) THEN
    ALTER TABLE branches ADD COLUMN valid_from TIMESTAMP;
  END IF;
END $$;

-- Добавить колонку valid_until в branches, если её нет
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'branches' AND column_name = 'valid_until'
  ) THEN
    ALTER TABLE branches ADD COLUMN valid_until TIMESTAMP;
  END IF;
END $$;

-- Добавить колонку license_status в branches, если её нет
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'branches' AND column_name = 'license_status'
  ) THEN
    ALTER TABLE branches ADD COLUMN license_status VARCHAR(20) DEFAULT 'free_trial';
  END IF;
END $$;

-- Добавить комментарии к колонкам
COMMENT ON COLUMN branches.valid_from IS 'Дата начала действия лицензии';
COMMENT ON COLUMN branches.valid_until IS 'Дата окончания действия лицензии';
COMMENT ON COLUMN branches.license_status IS 'Статус лицензии: free_trial (бесплатный период) или paid (платная лицензия)';

-- Создать индексы для ускорения поиска
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_branches_license_status ON branches(license_status);
CREATE INDEX IF NOT EXISTS idx_branches_valid_until ON branches(valid_until);
