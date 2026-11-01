import { dateBounds, filterFiles, isBusy } from './workspace.js';

export const activityGroups = {
  all: 'Tất cả',
  uploading: 'Đang tải',
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  attention: 'Cần kiểm tra',
};
export const activityDates = {
  '24h': '24 giờ gần đây',
  '7d': '7 ngày gần đây',
  '30d': '30 ngày gần đây',
  all: 'Mọi thời gian',
  custom: 'Khoảng ngày…',
};
const stamp = (value) => {
  const number = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isFinite(number) ? number : 0;
};
export function activityTime(file) {
  return Math.max(
    ...['createdAt', 'updatedAt', 'scannedAt', 'quarantinedAt', 'rescanRequestedAt'].map((key) =>
      stamp(file[key]),
    ),
    file.lifecycleState && file.lifecycleState !== 'active' ? stamp(file.lifecycleUpdatedAt) : 0,
  );
}
export function activityGroup(file) {
  if (file.lifecycleState === 'purged') return 'completed';
  if (isBusy(file)) return 'uploading';
  if (
    ['error', 'cancelled', 'unknown'].includes(file.status) ||
    ['failed', 'unknown'].includes(file.uploadState) ||
    ['error', 'unscanned', 'quarantine_delete_failed'].includes(file.scanStatus) ||
    file.lifecycleState === 'deleting'
  )
    return 'attention';
  if (file.status === 'processing' || ['scanning', 'flagged'].includes(file.scanStatus))
    return 'processing';
  return 'completed';
}
export function activityAction(file) {
  if (file.lifecycleState === 'purged') return 'Xóa vĩnh viễn';
  if (file.lifecycleState === 'deleting') return 'Xóa vĩnh viễn';
  if (file.lifecycleState === 'trashed') return 'Chuyển vào Thùng rác';
  if (
    isBusy(file) ||
    ['failed', 'unknown'].includes(file.uploadState) ||
    ['error', 'cancelled', 'unknown'].includes(file.status)
  )
    return 'Tải lên';
  if (file.scanStatus === 'flagged' || file.scanStatus?.startsWith('quarantine')) return 'Cách ly';
  if (stamp(file.rescanRequestedAt)) return 'Quét lại';
  if (file.scanStatus && file.scanStatus !== 'not_started' && file.mode !== 'demo')
    return 'Quét dữ liệu';
  return 'Tải lên';
}
export function filterActivityFiles(files, filters = {}, now = Date.now()) {
  const {
    date = '7d',
    dateFrom = '',
    dateTo = '',
    includeDeleted = 'false',
    activityGroup: group = 'all',
    sort = 'newest',
  } = filters;
  const bounds =
    date === '24h' ? [now - 86400000, Infinity] : dateBounds(date, dateFrom, dateTo, now);
  const candidates = files.filter(
    (file) =>
      (includeDeleted === 'true' || file.lifecycleState !== 'purged') &&
      (!bounds || (activityTime(file) >= bounds[0] && activityTime(file) < bounds[1])) &&
      (group === 'all' || activityGroup(file) === group),
  );
  return filterFiles(
    candidates,
    { ...filters, date: 'all', section: filters.section === 'recent' ? 'all' : filters.section },
    now,
  ).sort((a, b) => {
    const running = (file) => ['uploading', 'processing'].includes(activityGroup(file));
    if (sort === 'newest' || sort === 'oldest') {
      const priority = Number(running(b)) - Number(running(a));
      return (
        priority ||
        (sort === 'oldest'
          ? activityTime(a) - activityTime(b)
          : activityTime(b) - activityTime(a)) ||
        a.id.localeCompare(b.id)
      );
    }
    return 0;
  });
}
export function activitySummary(files) {
  const counts = { uploading: 0, processing: 0, completed: 0, attention: 0 };
  for (const file of files) counts[activityGroup(file)]++;
  return counts;
}
