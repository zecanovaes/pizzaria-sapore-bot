import React, { useState, useEffect } from 'react';
import axios from 'axios';

// URL da API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function Historico() {
  const [pedidos, setPedidos] = useState([]);
  const [conversas, setConversas] = useState([]);
  const [view, setView] = useState('pedidos'); // 'pedidos' ou 'conversas'
  const [detalhesPedido, setDetalhesPedido] = useState(null);
  const [detalhesConversa, setDetalhesConversa] = useState(null);

  // Carrega dados do backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (view === 'pedidos') {
          const response = await axios.get(`${API_URL}/pedidos`);
          if (response.data) {
            const pedidosComKey = response.data.map(pedido => ({
              ...pedido,
              key: pedido._id || pedido.id || Math.random().toString()
            }));
            setPedidos(pedidosComKey);
          }
        } else {
          const response = await axios.get(`${API_URL}/conversas`);
          if (response.data) {
            const conversasComKey = response.data.map(conversa => ({
              ...conversa,
              key: conversa._id || conversa.id || Math.random().toString()
            }));
            setConversas(conversasComKey);
          }
        }
      } catch (error) {
        console.error(`Erro ao carregar ${view}:`, error);
      }
    };
    
    fetchData();
  }, [view]);

  // Carrega detalhes de um pedido
  const verDetalhesPedido = async (id) => {
    try {
      if (!id) {
        console.error('ID de pedido inválido');
        return;
      }
      const response = await axios.get(`${API_URL}/pedidos/${id}`);
      setDetalhesPedido(response.data);
    } catch (error) {
      console.error('Erro ao carregar detalhes do pedido:', error);
      alert('Erro ao carregar detalhes do pedido!');
    }
  };

  // Carrega detalhes de uma conversa
  const verDetalhesConversa = async (id) => {
    try {
      if (!id) {
        console.error('ID de conversa inválido');
        return;
      }
      const response = await axios.get(`${API_URL}/conversas/${id}`);
      setDetalhesConversa(response.data);
    } catch (error) {
      console.error('Erro ao carregar detalhes da conversa:', error);
      alert('Erro ao carregar detalhes da conversa!');
    }
  };

  // Fecha detalhes
  const fecharDetalhes = () => {
    setDetalhesPedido(null);
    setDetalhesConversa(null);
  };

  // Formata data
  const formatarData = (dataString) => {
    const data = new Date(dataString);
    return data.toLocaleString();
  };

  function formatarTelefone(telefone) {
    // Verificar se o telefone existe
    if (!telefone) return ""; // Retorna string vazia se o telefone for null ou undefined
    
    // Remover caracteres não numéricos e o prefixo do WhatsApp se existir
    const numero = telefone.replace(/\D/g, '').replace(/@c\.us$/, '');
    
    // Formatar como (XX) XXXXX-XXXX para números brasileiros
    if (numero.length === 11) {
      return `(${numero.substring(0, 2)}) ${numero.substring(2, 7)}-${numero.substring(7)}`;
    } else if (numero.length === 10) {
      return `(${numero.substring(0, 2)}) ${numero.substring(2, 6)}-${numero.substring(6)}`;
    }
    
    // Retornar o número como está se não conseguir formatar
    return telefone;
  }

function formatDisplayName(conversa) {
  console.log('Conversa recebida:', conversa);
  
  if (conversa.nomeContato) {
    return conversa.nomeContato;
  }
  
  return formatarTelefone(conversa.telefone);
}

  return (
    <div className="section">
      <h2>Histórico</h2>
      
      <div className="view-selector">
        <button 
          className={view === 'pedidos' ? 'active' : ''} 
          onClick={() => setView('pedidos')}
        >
          Pedidos
        </button>
        <button 
          className={view === 'conversas' ? 'active' : ''} 
          onClick={() => setView('conversas')}
        >
          Conversas
        </button>
      </div>
      
      {view === 'pedidos' ? (
        <div className="pedidos-list">
          <h3>Lista de Pedidos</h3>
          
          <table className="history-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Telefone</th>
                <th>Valor Total</th>
                <th>Status</th>
                <th>Data</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map(pedido => (
                <tr key={pedido.key}>
                  <td>{pedido._id || pedido.id}</td>
                  <td>{formatDisplayName(pedido)}</td>
                  <td>R$ {parseFloat(pedido.valorTotal).toFixed(2)}</td>
                  <td>{pedido.status}</td>
                  <td>{formatarData(pedido.data)}</td>
                  <td>
                    <button onClick={() => verDetalhesPedido(pedido._id || pedido.id)}>
                      Ver Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {pedidos.length === 0 && (
            <p className="no-data">Nenhum pedido registrado.</p>
          )}
        </div>
      ) : (
        <div className="conversas-list">
          <h3>Histórico de Conversas</h3>
          
          <table className="history-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Telefone</th>
                <th>Início</th>
                <th>Duração</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {conversas.map(conversa => (
                <tr key={conversa.key}>
                  <td>{conversa._id || conversa.id}</td>
                  <td>{formatDisplayName(conversa)}</td>
                  <td>{formatarData(conversa.inicio)}</td>
                  <td>{conversa.duracao} min</td>
                  <td>
                    <button onClick={() => verDetalhesConversa(conversa._id || conversa.id)}>
                      Ver Conversa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {conversas.length === 0 && (
            <p className="no-data">Nenhuma conversa registrada.</p>
          )}
        </div>
      )}
      
      {/* Modal de Detalhes do Pedido */}
      {detalhesPedido && (
        <div className="modal">
          <div className="modal-content">
            <span className="close" onClick={fecharDetalhes}>&times;</span>
            <h3>Detalhes do Pedido #{detalhesPedido._id || detalhesPedido.id}</h3>
            
            <div className="order-details">
              <p><strong>Cliente:</strong> {formatDisplayName(detalhesPedido)}</p>
              <p><strong>Data:</strong> {formatarData(detalhesPedido.data)}</p>
              <p><strong>Status:</strong> {detalhesPedido.status}</p>
              <p><strong>Endereço:</strong> {detalhesPedido.endereco}</p>
              <p><strong>Forma de Pagamento:</strong> {detalhesPedido.formaPagamento}</p>
              
              <h4>Itens do Pedido</h4>
              <ul className="order-items">
                {detalhesPedido.itens.map((item, index) => (
                  <li key={index}>
                    {item.quantidade}x {item.nome} - R$ {parseFloat(item.preco).toFixed(2)}
                  </li>
                ))}
              </ul>
              
              <p className="total"><strong>Total:</strong> R$ {parseFloat(detalhesPedido.valorTotal).toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal de Detalhes da Conversa */}
      {detalhesConversa && (
        <div className="modal">
          <div className="modal-content">
            <span className="close" onClick={fecharDetalhes}>&times;</span>
            <h3>Conversa com {formatDisplayName(detalhesConversa)}</h3>
            
            <div className="chat-history">
              {detalhesConversa.mensagens.map((msg, index) => (
                <div 
                  key={index} 
                  className={`message ${msg.tipo === 'user' ? 'user-message' : 'bot-message'}`}
                >
                  <div className="message-header">
                    <span className="message-sender">
                      {msg.tipo === 'user' ? 'Cliente' : 'Bot'}
                    </span>
                    <span className="message-time">
                      {formatarData(msg.data)}
                    </span>
                  </div>
                  <div className="message-content">{msg.conteudo}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Historico;