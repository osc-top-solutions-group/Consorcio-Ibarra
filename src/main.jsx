import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App.jsx';
import { AuthProvider } from './shared/context/AuthContext.jsx';
import './index.css';

// La superficie pública del control de visitantes (/visita/*) NO está aquí: es
// un bundle aparte (visita.html → src/publico/main.jsx) que se sirve
// sin IAP. Ver vite.publico.config.js.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
