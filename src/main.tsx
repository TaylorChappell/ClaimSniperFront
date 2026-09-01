import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { initTabNotifications } from './tab-notifications';

initTabNotifications();

// Keep the push worker current on every normal app load. This does not request
// notification permission or create a push subscription; it only ensures an
// already-enabled device gets the newest realtime notification behavior.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
