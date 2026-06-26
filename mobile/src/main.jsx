import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp.jsx';
import Login from './Login.jsx';
import { bootMobile } from './boot.js';
import '@shared/styles/global.css';
import './styles/fonts.css';

function Root({ initialConfigured }) {
  const [configured, setConfigured] = useState(initialConfigured);
  if (!configured) return <Login askUrl onConnected={() => setConfigured(true)} />;
  return <MobileApp />;
}

bootMobile().then(({ configured }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Root initialConfigured={configured} />
    </React.StrictMode>
  );
});
