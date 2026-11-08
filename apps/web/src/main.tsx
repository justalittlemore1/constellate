import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fraunces (variable: weight + optical size), self-hosted (no CDN) so the installed PWA renders offline
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import { App } from './app/App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
