import { RotateCcw } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import FileBrowser from '../components/FileBrowser.jsx';

export default function Uploads() {
  const w = useWorkspace();
  return (
    <>
      <FileBrowser activity />
      {w.uploadBatches?.length > 0 && (
        <section className="upload-batches" aria-label="Các đợt tải lên">
          <h2>Các đợt tải lên</h2>
          <p>Các đợt tải được ghi nhớ. Tệp đang tải dở cần chọn lại sau khi đóng trang.</p>
          <div className="batch-list">
            {w.uploadBatches.map((batch, index) => (
              <article className="batch-row" key={batch.id}>
                <div>
                  <h3>
                    Đợt tải {w.uploadBatches.length - index} · {batch.total} tệp
                  </h3>
                  <time dateTime={new Date(batch.createdAt).toISOString()}>
                    <span className="batch-date">
                      {new Date(batch.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                    <span className="batch-clock">
                      {new Date(batch.createdAt).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </time>
                </div>
                <p>
                  {batch.uploaded} đã tải xong · {batch.active} đang tải / chờ · {batch.failed} lỗi
                  · {batch.tracking} chờ kết quả
                  {batch.cancelled > 0 ? ` · ${batch.cancelled} đã hủy` : ''}
                  {batch.uncertain > 0 ? ` · ${batch.uncertain} chưa rõ kết quả` : ''}
                </p>
                <button
                  className="button secondary"
                  disabled={!batch.retryableIds?.length}
                  onClick={() => w.retryBatch(batch.id)}
                >
                  <RotateCcw size={15} />
                  Thử lại {batch.retryableIds?.length || 0} tệp trong đợt
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
