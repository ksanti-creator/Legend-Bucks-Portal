import { createRoot } from 'react-dom/client';
import { setAuthTokenGetter } from '@workspace/api-client-react';

import App from './App';
import { getSessionToken } from './lib/auth-token';

import './index.css';

// Register the bearer-token getter before the app renders so the very first
// request (Shell's /auth/me on load) carries the stored session token.
setAuthTokenGetter(() => getSessionToken());

createRoot(document.getElementById('root')!).render(<App />);
