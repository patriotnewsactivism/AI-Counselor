import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';

// In production the frontend (Vercel) and backend (Railway) are on different
// origins. VITE_API_URL (e.g. https://therapist-api.up.railway.app) is
// injected at build time. In local dev, Vite proxies /api → localhost:8080
// so no value is needed (all /api calls stay same-origin).
const apiUrl = import.meta.env.VITE_API_URL ?? '';
setBaseUrl(apiUrl || null);

createRoot(document.getElementById('root')!).render(<App />);
