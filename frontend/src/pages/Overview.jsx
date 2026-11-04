import { Link } from 'react-router-dom';
import { ArrowRight, CircleAlert, CloudUpload, HardDrive, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { isBusy } from '../utils/workspace.js';
import { isAttention, needsTracking } from '../utils/processing.js';
import FileBrowser from '../components/FileBrowser.jsx';

export default function Overview() {
  const w = useWorkspace();
  const active = w.files.filter((file) => isBusy(file) || needsTracking(file));
  const errors = w.files.filter((file) => isAttention(file) || file.status === 'error');
  const quarantined = w.files.filter((file) => file.scanStatus === 'quarantined');
  const sync = w.sync || { phase: 'idle' };
  const partial =
    w.preferences.mode === 'api' && ['idle', 'loading', 'partial'].includes(sync.phase);
  const stats = [
    [
      w.preferences.mode === 'api' && sync.phase !== 'disabled'
        ? 'Tệp trong thư viện'
        : 'Tệp trong phiên',
      w.files.length,
      '/files',
      HardDrive,
      'blue',
    ],
    ['Đang xử lý', active.length, '/files?status=active', CloudUpload, 'purple'],
    ['Cần chú ý', errors.length, '/files?area=attention', CircleAlert, 'pink'],
    [
      'Đã cách ly',
      quarantined.length,
      '/files?area=attention&scan=quarantined',
      ShieldCheck,
      'green',
    ],
  ];
  return (
    <>
      <div className="overview-stats" aria-label="Thống kê thư viện">
        {stats.map(([label, count, to, Icon, color]) => (
          <Link className={`stat ${color} ${partial ? 'partial' : ''}`} key={label} to={to}>
            <span className="stat-label">
              <Icon size={20} />
              {label}
            </span>
            <strong>{count}</strong>
            <span className="stat-link">
              Xem chi tiết <ArrowRight size={16} />
            </span>
          </Link>
        ))}
      </div>
      <FileBrowser overview />
    </>
  );
}
