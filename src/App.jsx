import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import './App.css';

// Componentes
import PersonaBot from './components/PersonaBot';
import Cardapio from './components/Cardapio';
import FormasPagamento from './components/FormasPagamento';
import Historico from './components/Historico';
import DeliveryAreaConfig from './components/DeliveryAreaConfig';
import HistoriaPizzaria from './components/HistoriaPizzaria';

function App() {
  return (
    <Router>
      <div className="app">
        <header className="header">
          <h1>Sapore di São Paulo - Painel Administrativo</h1>
          <nav>
            <Link to="/">Persona do Bot</Link>
            <Link to="/historia">História da Pizzaria</Link>
            <Link to="/cardapio">Cardápio</Link>
            <Link to="/pagamento">Formas de Pagamento</Link>
            <Link to="/entrega">Área de Entrega</Link>
            <Link to="/historico">Histórico</Link>
          </nav>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<PersonaBot />} />
            <Route path="/historia" element={<HistoriaPizzaria />} />
            <Route path="/cardapio" element={<Cardapio />} />
            <Route path="/pagamento" element={<FormasPagamento />} />
            <Route path="/entrega" element={<DeliveryAreaConfig />} />
            <Route path="/historico" element={<Historico />} />
          </Routes>
        </main>

        <footer className="footer">
          <p>Sapore di São Paulo © {new Date().getFullYear()}</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;