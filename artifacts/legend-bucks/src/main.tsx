import { createRoot } from 'react-dom/client';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { getSessionToken } from './lib/auth-token';
import { IS_TRAINING, TRAINING_API_BASE } from './lib/training';

import './index.css';

// Training portal: every generated /api/... call is rewritten to
// /api/training/api/... and carries only the training sessionStorage token.
if (IS_TRAINING) setBaseUrl(TRAINING_API_BASE);

// Register the bearer-token getter before the app renders so the very first
// request (Shell's /auth/me on load) carries the stored session token.
setAuthTokenGetter(() => getSessionToken());

createRoot(document.getElementById('root')!).render(<App />);
