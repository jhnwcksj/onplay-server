// Утилита для правильного вычисления timezone offset
// Используется вместо toLocaleString() которая вызывает двойную конверсию

/**
 * Вычисляет timezone offset для указанного IANA timezone
 * @param {string} timezone - IANA timezone идентификатор (например, 'Asia/Almaty', 'Europe/Moscow')
 * @returns {string} - Offset в формате '+05:00' или '-03:00'
 */
/**
 * КРИТИЧЕСКИ ВАЖНАЯ ФУНКЦИЯ для работы с timezone
 * 
 * Возвращает фиксированный offset для известных timezone.
 * Это необходимо, т.к. timezone database в Node.js может быть устаревшей.
 * 
 * Казахстан (Asia/Almaty) с 1 марта 2024 года перешел на постоянное UTC+5
 * Россия (Europe/Moscow) постоянно использует UTC+3
 */
function getTimezoneOffsetString(timezone) {
  // Фиксированные offset для известных timezone
  // Эти значения НЕ меняются от даты и НЕ зависят от DST
  const FIXED_OFFSETS = {
    'Asia/Almaty': '+05:00',      // Казахстан: постоянно UTC+5 (с марта 2024)
    'Europe/Moscow': '+03:00',     // Россия: постоянно UTC+3
    'Asia/Bishkek': '+06:00',      // Кыргызстан: UTC+6
    'Asia/Tashkent': '+05:00',     // Узбекистан: UTC+5
    'Asia/Tbilisi': '+04:00',      // Грузия: UTC+4
    'Asia/Baku': '+04:00',         // Азербайджан: UTC+4
    'Asia/Yerevan': '+04:00',      // Армения: UTC+4
    'Europe/Minsk': '+03:00',      // Беларусь: UTC+3
    'UTC': '+00:00'
  };

  // Если timezone есть в нашем списке, возвращаем фиксированный offset
  if (FIXED_OFFSETS[timezone]) {
    return FIXED_OFFSETS[timezone];
  }

  // Для остальных timezone используем динамический расчет
  try {
    const testDate = new Date();
    
    // Форматируем в UTC и в целевом timezone
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // Парсим компоненты UTC
    const utcParts = utcFormatter.formatToParts(testDate);
    const utcHour = parseInt(utcParts.find(p => p.type === 'hour').value);
    const utcMinute = parseInt(utcParts.find(p => p.type === 'minute').value);
    const utcDay = parseInt(utcParts.find(p => p.type === 'day').value);
    
    // Парсим компоненты timezone
    const tzParts = tzFormatter.formatToParts(testDate);
    const tzHour = parseInt(tzParts.find(p => p.type === 'hour').value);
    const tzMinute = parseInt(tzParts.find(p => p.type === 'minute').value);
    const tzDay = parseInt(tzParts.find(p => p.type === 'day').value);
    
    // Вычисляем разницу в минутах
    let offsetMinutes = (tzHour - utcHour) * 60 + (tzMinute - utcMinute);
    
    // Учитываем смену дня (например, UTC 23:00, timezone 01:00 = +2 часа)
    if (tzDay > utcDay) {
      offsetMinutes += 24 * 60;
    } else if (tzDay < utcDay) {
      offsetMinutes -= 24 * 60;
    }
    
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    
    return `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
  } catch (e) {
    console.error('Error calculating timezone offset for', timezone, ':', e);
    return '+05:00'; // fallback для Asia/Almaty
  }
}

module.exports = { getTimezoneOffsetString };
