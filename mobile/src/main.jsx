import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root.jsx';
import '@shared/styles/global.css';
import './styles/fonts.css';

// Render immediately — never a blank screen while the startup check runs. Root
// owns boot: Connecting → the app | Can't reach JagHelm | Something went wrong.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
