import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp.jsx';
import '@shared/styles/global.css';
import './styles/fonts.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
