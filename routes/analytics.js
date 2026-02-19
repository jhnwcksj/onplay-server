const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /analytics - получение данных аналитики
router.get('/', async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;

    if (!branch_id) {
      return res.status(400).json({ error: 'branch_id обязателен' });
    }

    const startDateFilter = start_date || '2020-01-01';
    const endDateFilter = end_date || new Date().toISOString().split('T')[0];

    // Расчет периода для сравнения (предыдущий год)
    const startDateObj = new Date(startDateFilter);
    const endDateObj = new Date(endDateFilter);
    const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));
    
    const prevStartDate = new Date(startDateObj);
    prevStartDate.setDate(prevStartDate.getDate() - daysDiff);
    const prevEndDate = new Date(endDateObj);
    prevEndDate.setDate(prevEndDate.getDate() - daysDiff);

    // 1. Основные метрики
    const currentMetrics = await db.query(`
      SELECT 
        COUNT(*) as total_appointments,
        COALESCE(SUM(price), 0) as total_revenue,
        COUNT(DISTINCT client_id) as active_clients,
        COALESCE(AVG(price), 0) as avg_check
      FROM appointments
      WHERE branch_id = $1 
        AND start_time::date BETWEEN $2 AND $3
        AND status != 'cancelled'
    `, [branch_id, startDateFilter, endDateFilter]);

    const prevMetrics = await db.query(`
      SELECT 
        COUNT(*) as total_appointments,
        COALESCE(SUM(price), 0) as total_revenue,
        COUNT(DISTINCT client_id) as active_clients,
        COALESCE(AVG(price), 0) as avg_check
      FROM appointments
      WHERE branch_id = $1 
        AND start_time::date BETWEEN $2 AND $3
        AND status != 'cancelled'
    `, [branch_id, prevStartDate.toISOString().split('T')[0], prevEndDate.toISOString().split('T')[0]]);

    const current = currentMetrics.rows[0];
    const prev = prevMetrics.rows[0];

    const calculateChange = (current, previous) => {
      if (!previous || parseFloat(previous) === 0) return 0;
      return ((parseFloat(current) - parseFloat(previous)) / parseFloat(previous)) * 100;
    };

    const metrics = {
      total_appointments: parseInt(current.total_appointments) || 0,
      total_revenue: parseFloat(current.total_revenue) || 0,
      active_clients: parseInt(current.active_clients) || 0,
      avg_check: parseFloat(current.avg_check) || 0,
      appointments_change: calculateChange(current.total_appointments, prev.total_appointments),
      revenue_change: calculateChange(current.total_revenue, prev.total_revenue),
      clients_change: calculateChange(current.active_clients, prev.active_clients),
      avg_check_change: calculateChange(current.avg_check, prev.avg_check),
    };

    // 2. Доход по месяцам
    const revenueByMonth = await db.query(`
      SELECT 
        TO_CHAR(start_time, 'Mon') as month,
        COALESCE(SUM(price), 0) as revenue
      FROM appointments
      WHERE branch_id = $1 
        AND start_time::date BETWEEN $2 AND $3
        AND status != 'cancelled'
      GROUP BY TO_CHAR(start_time, 'YYYY-MM'), TO_CHAR(start_time, 'Mon')
      ORDER BY TO_CHAR(start_time, 'YYYY-MM')
    `, [branch_id, startDateFilter, endDateFilter]);

    // 3. Количество записей по месяцам
    const appointmentsByMonth = await db.query(`
      SELECT 
        TO_CHAR(start_time, 'Mon') as month,
        COUNT(*) as count
      FROM appointments
      WHERE branch_id = $1 
        AND start_time::date BETWEEN $2 AND $3
        AND status != 'cancelled'
      GROUP BY TO_CHAR(start_time, 'YYYY-MM'), TO_CHAR(start_time, 'Mon')
      ORDER BY TO_CHAR(start_time, 'YYYY-MM')
    `, [branch_id, startDateFilter, endDateFilter]);

    // 4. Распределение по услугам
    const serviceDistribution = await db.query(`
      SELECT 
        s.name as service_name,
        COUNT(a.id) as count,
        COALESCE(SUM(a.price), 0) as revenue,
        ROUND((COUNT(a.id)::numeric / NULLIF((
          SELECT COUNT(*) 
          FROM appointments 
          WHERE branch_id = $1 
            AND start_time::date BETWEEN $2 AND $3
            AND status != 'cancelled'
        ), 0)) * 100, 1) as percentage
      FROM appointments a
      JOIN services s ON a.service_id = s.service_id
      WHERE a.branch_id = $1 
        AND a.start_time::date BETWEEN $2 AND $3
        AND a.status != 'cancelled'
      GROUP BY s.name
      ORDER BY revenue DESC
      LIMIT 10
    `, [branch_id, startDateFilter, endDateFilter]);

    // Рассчитываем углы для круговой диаграммы
    let cumulativeAngle = 0;
    const servicesWithAngles = serviceDistribution.rows.map(item => {
      const percentage = parseFloat(item.percentage) || 0;
      const startAngle = cumulativeAngle;
      const angleDelta = (percentage / 100) * 360;
      cumulativeAngle += angleDelta;
      return {
        service_name: item.service_name,
        count: parseInt(item.count),
        revenue: parseFloat(item.revenue),
        percentage: percentage,
        startAngle: startAngle,
        endAngle: cumulativeAngle,
      };
    });

    // 5. Доходы (разбивка)
    const incomeBreakdown = await db.query(`
      SELECT 
        'Услуги' as category,
        COALESCE(SUM(price), 0) as amount
      FROM appointments
      WHERE branch_id = $1 
        AND start_time::date BETWEEN $2 AND $3
        AND status != 'cancelled'
    `, [branch_id, startDateFilter, endDateFilter]);

    // 6. Расходы
    const expensesBreakdown = await db.query(`
      SELECT 
        category,
        COALESCE(SUM(amount), 0) as amount
      FROM expenses
      WHERE branch_id = $1 
        AND expense_date BETWEEN $2 AND $3
      GROUP BY category
      ORDER BY amount DESC
    `, [branch_id, startDateFilter, endDateFilter]);

    const totalIncome = incomeBreakdown.rows.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
    const totalExpenses = expensesBreakdown.rows.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
    const netProfit = totalIncome - totalExpenses;
    const profitability = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

    const profitLoss = {
      income: incomeBreakdown.rows.map(item => ({
        category: item.category,
        amount: parseFloat(item.amount) || 0,
      })),
      expenses: expensesBreakdown.rows.map(item => ({
        category: item.category,
        amount: parseFloat(item.amount) || 0,
      })),
      totalIncome,
      totalExpenses,
      netProfit,
      profitability,
    };

    // 7. Детальная статистика по месяцам
    const detailedStats = await db.query(`
      WITH monthly_data AS (
        SELECT 
          TO_CHAR(start_time, 'YYYY-MM') as year_month,
          TO_CHAR(start_time, 'Month YYYY') as period,
          COUNT(id) as appointments,
          COALESCE(SUM(price), 0) as revenue
        FROM appointments
        WHERE branch_id = $1 
          AND start_time::date BETWEEN $2 AND $3
          AND status != 'cancelled'
        GROUP BY TO_CHAR(start_time, 'YYYY-MM'), TO_CHAR(start_time, 'Month YYYY')
      ),
      monthly_expenses AS (
        SELECT 
          TO_CHAR(expense_date, 'YYYY-MM') as year_month,
          COALESCE(SUM(amount), 0) as expenses
        FROM expenses
        WHERE branch_id = $1
          AND expense_date BETWEEN $2 AND $3
        GROUP BY TO_CHAR(expense_date, 'YYYY-MM')
      )
      SELECT 
        md.period,
        md.appointments,
        md.revenue,
        COALESCE(me.expenses, 0) as expenses
      FROM monthly_data md
      LEFT JOIN monthly_expenses me ON md.year_month = me.year_month
      ORDER BY md.year_month
    `, [branch_id, startDateFilter, endDateFilter]);

    const detailedStatsFormatted = detailedStats.rows.map(row => {
      const revenue = parseFloat(row.revenue) || 0;
      const expenses = parseFloat(row.expenses) || 0;
      const profit = revenue - expenses;
      const profitabilityRow = revenue > 0 ? (profit / revenue) * 100 : 0;

      return {
        period: row.period.trim(),
        appointments: parseInt(row.appointments) || 0,
        revenue,
        expenses,
        profit,
        profitability: profitabilityRow,
      };
    });

    res.json({
      metrics,
      revenue_by_month: revenueByMonth.rows.map(row => ({
        month: row.month,
        revenue: parseFloat(row.revenue) || 0,
      })),
      appointments_by_month: appointmentsByMonth.rows.map(row => ({
        month: row.month,
        count: parseInt(row.count) || 0,
      })),
      service_distribution: servicesWithAngles,
      profit_loss: profitLoss,
      detailed_stats: detailedStatsFormatted,
    });

  } catch (error) {
    console.error('Ошибка получения аналитики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
