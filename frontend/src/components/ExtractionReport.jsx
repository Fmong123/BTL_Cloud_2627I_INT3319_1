import { scanExplanation } from '../utils/processing.js';

const formats = { text: 'Văn bản', pdf: 'PDF', png: 'Ảnh PNG', jpeg: 'Ảnh JPEG', tiff: 'Ảnh TIFF', gif: 'Ảnh GIF', webp: 'Ảnh WebP' };
const methods = {
  direct_text: 'Đọc văn bản trực tiếp',
  pdf_text: 'Đọc lớp chữ PDF',
  textract_image: 'OCR ảnh · Amazon Textract',
  textract_pdf: 'OCR PDF · Amazon Textract',
};

export default function ExtractionReport({ report }) {
  const complete = report?.extractionComplete;
  const reason = report?.scanReason || report?.statusReason;
  return (
    <section className="extraction-report" aria-label="Kết quả trích xuất">
      <h3>Kết quả trích xuất</h3>
      <dl className="file-details">
        <div>
          <dt>Định dạng nhận diện</dt>
          <dd>{formats[report?.detectedFormat] || 'Chưa có dữ liệu'}</dd>
        </div>
        <div>
          <dt>Phương pháp</dt>
          <dd>{methods[report?.extractionMethod] || 'Chưa có dữ liệu'}</dd>
        </div>
        <div>
          <dt>Mức độ đọc</dt>
          <dd>
            {complete === true
              ? 'Đã đọc đầy đủ'
              : complete === false
                ? 'Chưa đọc đầy đủ'
                : 'Chưa xác nhận'}
          </dd>
        </div>
        {(report?.totalPages != null || report?.extractedPages != null) && (
          <div>
            <dt>{['gif', 'webp'].includes(report?.detectedFormat) ? 'Khung đọc được / tổng' : 'Trang đọc được / tổng'}</dt>
            <dd>
              {report.extractedPages ?? '—'} / {report.totalPages ?? '—'}
            </dd>
          </div>
        )}
        {report?.extractionDurationMs != null && (
          <div>
            <dt>Thời gian trích xuất</dt>
            <dd>
              {(report.extractionDurationMs / 1000).toLocaleString('vi-VN', {
                maximumFractionDigits: 2,
              })}{' '}
              giây
            </dd>
          </div>
        )}
      </dl>
      {reason && (
        <p className="scan-report-note">{scanExplanation({ ...report, statusReason: reason })}</p>
      )}
      {!report?.detectedFormat && !report?.extractionMethod && (
        <p className="scan-report-note">
          Lượt quét này chưa có thống kê trích xuất. Các lượt quét sau khi cập nhật bộ quét sẽ có
          thêm thông tin.
        </p>
      )}
    </section>
  );
}
