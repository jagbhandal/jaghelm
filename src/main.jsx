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
// The entry chunk's URL carries its content hash, which changes whenever any
// lazy chunk's name does, so it names the running build. Read it here, in the
// entry module, so no chunking rule can move it somewhere its hash doesn't change.
installChunkReload({ build: import.meta.url });
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
