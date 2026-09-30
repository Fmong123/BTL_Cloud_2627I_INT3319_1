import { File, FileArchive, FileImage, FileSpreadsheet, FileText, Film, Music } from 'lucide-react';
import { fileCategory } from '../utils/files.js';

export default function FileIcon({ file, large = false }) {
  const category = fileCategory(file);
  let Icon = { image: FileImage, sheet: FileSpreadsheet, document: FileText, other: File }[category];
  if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) Icon = FileArchive;
  if (file.type?.startsWith('video/')) Icon = Film;
  if (file.type?.startsWith('audio/')) Icon = Music;
  return <span className={`file-icon ${large ? 'large' : ''}`}><Icon size={large ? 29 : 21} strokeWidth={1.5} /></span>;
}
