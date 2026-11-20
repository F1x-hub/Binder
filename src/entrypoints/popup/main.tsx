import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/fonts.css';
import '@/theme/tokens.css';
import '@/theme/base.css';
import { PopupApp } from '@/popup/PopupApp';

const root = document.getElementById('root');
if (!root) throw new Error('В popup/index.html нет #root');

createRoot(root).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
