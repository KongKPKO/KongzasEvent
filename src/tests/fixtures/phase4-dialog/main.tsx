import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../../i18n';
import { ConfirmDialog } from '../../../components/ui/Feedback';
import { FilterSelect } from '../../../components/ui/FilterSelect';
import '../../../index.css';

function App() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('a');
  return <><button onClick={() => setOpen(true)}>Open dialog</button><ConfirmDialog open={open} title="Test dialog" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)}><FilterSelect label="Test select" value={value} onChange={setValue} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} /></ConfirmDialog></>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><App /></LanguageProvider>);
