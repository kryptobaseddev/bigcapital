// @ts-nocheck
import 'regenerator-runtime/runtime';
import './wdyr';
import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { PersistGate } from 'redux-persist/integration/react';

import '@/services/yup';
import App from '@/components/App';
import * as serviceWorker from '@/serviceWorker';
import { store, persistor } from '@/store/create-store';

// Auto-recover from stale build chunks after a deploy. When a cached index.html
// references hashed chunks that were replaced on the server, the dynamic import
// 404s and Vite fires `vite:preloadError`. Reload once (rate-limited) to fetch
// the fresh index.html + chunks instead of crashing into the error boundary.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    const KEY = 'bc:chunkReloadAt';
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10000) return; // never loop on a genuinely broken deploy
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  });
}

ReactDOM.render(
  <Provider store={store}>
    <PersistGate loading={null} persistor={persistor}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistGate>
  </Provider>,
  document.getElementById('root'),
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
