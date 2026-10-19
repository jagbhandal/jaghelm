import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
// Today's stylesheet in the lowest cascade layer, then the new UI stack
// (docs/ARCHITECTURE.md, "UI stack"). Keep this order.
import './styles/legacy.css';
import '@ui/tailwind.css';
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
