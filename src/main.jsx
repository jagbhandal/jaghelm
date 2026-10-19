import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installChunkReload } from './chunkReload.js';
// Today's stylesheet in the lowest cascade layer, then the new UI stack
// (docs/ARCHITECTURE.md, "UI stack"). Keep this order.
import './styles/legacy.css';
import '@ui/tailwind.css';
// A tab on an older build reloads once when a lazy chunk is gone after a deploy.
installChunkReload();
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
