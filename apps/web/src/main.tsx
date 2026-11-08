import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Cormorant Garamond, self-hosted (no CDN) so the installed PWA renders offline
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import { App } from './app/App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
