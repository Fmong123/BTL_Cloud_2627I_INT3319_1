// Presentation statistics only; all charge amounts come from the backend.
export function summarizeUserCosts(items) {
  const users = items.filter((row) => row.cost_summary || (row.summary && row.present !== false));
  const total = users.reduce((sum, row) => sum + row.storage_vnd, 0);
  return {
    usersCount: users.length,
    chargedCount: users.filter((row) => row.storage_vnd > 0).length,
    enabledCount: users.filter((row) => (row.cost_summary || row.summary).payg_enabled).length,
    average: users.length ? total / users.length : 0,
    total,
    forecast: users.reduce((sum, row) => sum + (row.cost_summary || row.summary).forecast_vnd, 0),
    highest: users
      .filter((row) => row.storage_vnd > 0)
      .sort((a, b) => b.storage_vnd - a.storage_vnd || a.name.localeCompare(b.name, 'vi'))
      .slice(0, 5),
  };
}

export function weeklyUserCosts(items, month) {
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const weeks = Array.from({ length: Math.ceil(lastDay / 7) }, (_, index) => ({
    start: index * 7 + 1,
    end: Math.min(index * 7 + 7, lastDay),
    cost: 0,
  }));
  let throughDay = 0;
  for (const row of items) {
    const view = row.cost_summary || (row.present !== false && row.summary);
    if (!view) continue;
    for (const day of view.daily) {
      if (!day.date.startsWith(`${month}-`)) continue;
      const index = Number(day.date.slice(8, 10));
      if (index < 1 || index > lastDay) continue;
      throughDay = Math.max(throughDay, index);
      weeks[Math.floor((index - 1) / 7)].cost += day.storage_vnd;
    }
  }
  return weeks
    .filter((week) => week.start <= throughDay)
    .map((week) => ({
      ...week,
      end: Math.min(week.end, throughDay),
    }));
}
