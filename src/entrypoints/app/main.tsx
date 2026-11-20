import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/fonts.css';
import '@/theme/tokens.css';
import '@/theme/base.css';
import { AppShell } from '@/app/AppShell';

const root = document.getElementById('root');
if (!root) throw new Error('В app/index.html нет #root');

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
