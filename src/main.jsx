import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import './App.css';

// Versión web publicada: service worker para abrirla sin conexión (ver vite.config.js). En Android no hace falta.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
