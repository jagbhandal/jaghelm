import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { bootMobile } from './boot.js';
import '@shared/styles/global.css';
import './styles/fonts.css';

// Boot decides { hasUrl, hasToken }; App routes first-run / re-auth / app from it.
bootMobile().then((initial) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App initial={initial} />
    </React.StrictMode>
  );
});
