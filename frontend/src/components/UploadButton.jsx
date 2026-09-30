import { useRef, useState } from 'react';
import { ArrowUpRight, CloudUpload, FileImage, FileSpreadsheet, FileText, Plus } from 'lucide-react';

export default function UploadButton({ onFiles, maxSizeMB, inputRef }) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  return <section className={`upload-zone ${dragging ? 'dragging' : ''}`} aria-label="Khu vực tải tệp lên"
    onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
    onDragLeave={(e) => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
    onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); onFiles(Array.from(e.dataTransfer.files)); }}>
    <input ref={inputRef} type="file" multiple className="visually-hidden" tabIndex={-1} aria-label="Chọn tệp để tải lên" onChange={(e) => { onFiles(Array.from(e.target.files)); e.target.value = ''; }} />
    <div className="upload-copy">
      <span className="eyebrow"><span className="tiny-dot" /> THÊM MỘT CHÚT NGĂN NẮP</span>
      <h2>Mọi tệp của bạn<br />Một nơi để lưu giữ</h2>
      <p>Kéo thả tệp vào đây, để phần còn lại cho Mây4u</p>
      <div className="upload-cta"><button className="button primary" onClick={() => inputRef.current.click()}><Plus size={18} />Chọn tệp tải lên<ArrowUpRight size={16} /></button><span>Tối đa {maxSizeMB} MB / tệp</span></div>
    </div>
    <div className="upload-art" aria-hidden="true">
      <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
      <div className="floating-sheet sheet-back"><span /><span /><span /></div>
      <div className="floating-sheet sheet-front"><span className="sheet-icon"><CloudUpload size={37} strokeWidth={1.4} /></span><span className="sheet-line" /><span className="sheet-line short" /><div className="sheet-dots"><i /><i /><i /></div></div>
      <div className="art-type art-image"><FileImage size={24} strokeWidth={1.6} /></div>
      <div className="art-type art-doc"><FileText size={24} strokeWidth={1.6} /></div>
      <div className="art-type art-sheet"><FileSpreadsheet size={24} strokeWidth={1.6} /></div>
      <span className="art-spark spark-one">+</span><span className="art-spark spark-two">+</span>
    </div>
    {dragging && <div className="drop-overlay"><CloudUpload size={40} /><strong>Thả tệp để bắt đầu tải lên</strong></div>}
  </section>;
}
