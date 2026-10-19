import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root.jsx';
// Today's stylesheets in the lowest cascade layer, then the new UI stack
// (docs/ARCHITECTURE.md, "UI stack"). Keep this order.
import './styles/legacy.css';
import '@ui/tailwind.css';

// Render immediately — never a blank screen while the startup check runs. Root
// owns boot: Connecting → the app | Can't reach JagHelm | Something went wrong.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
