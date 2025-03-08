import React, { useState, useEffect } from 'react';
import axios from 'axios';

// URL da API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function FormasPagamento() {
  const [formasPagamento, setFormasPagamento] = useState([]);
  const [novaForma, setNovaForma] = useState({
    nome: "",
    requerTroco: false,
    ativo: true
  });

  // Carrega dados do backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`${API_URL}/pagamentos`);
        if (response.data) {
          setFormasPagamento(response.data);
        }
      } catch (error) {
        console.error('Erro ao carregar formas de pagamento:', error);
      }
    };
    
    fetchData();
  }, []);

  // Adiciona nova forma de pagamento
  const handleAddForma = async () => {
    if (!novaForma.nome) {
      alert("O nome da forma de pagamento é obrigatório!");
      return;
    }
    
    try {
      const response = await axios.post(`${API_URL}/pagamentos`, novaForma);
      setFormasPagamento([...formasPagamento, response.data]);
      setNovaForma({
        nome: "",
        requerTroco: false,
        ativo: true
      });
    } catch (error) {
      console.error('Erro ao adicionar forma de pagamento:', error);
      alert('Erro ao adicionar forma de pagamento!');
    }
  };

  // Remove forma de pagamento
  const handleRemoveForma = async (id) => {
    try {
      await axios.delete(`${API_URL}/pagamentos/${id}`);
      setFormasPagamento(formasPagamento.filter(forma => forma.id !== id));
    } catch (error) {
      console.error('Erro ao remover forma de pagamento:', error);
      alert('Erro ao remover forma de pagamento!');
    }
  };

  // Alterna status ativo da forma de pagamento
  const handleToggleAtivo = async (id) => {
    const forma = formasPagamento.find(forma => forma.id === id);
    if (!forma) return;
    
    try {
      await axios.patch(`${API_URL}/pagamentos/${id}`, {
        ativo: !forma.ativo
      });
      
      setFormasPagamento(formasPagamento.map(forma => 
        forma.id === id ? {...forma, ativo: !forma.ativo} : forma
      ));
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      alert('Erro ao atualizar status da forma de pagamento!');
    }
  };

  // Alterna configuração de troco
  const handleToggleTroco = async (id) => {
    const forma = formasPagamento.find(forma => forma.id === id);
    if (!forma) return;
    
    try {
      await axios.patch(`${API_URL}/pagamentos/${id}`, {
        requerTroco: !forma.requerTroco
      });
      
      setFormasPagamento(formasPagamento.map(forma => 
        forma.id === id ? {...forma, requerTroco: !forma.requerTroco} : forma
      ));
    } catch (error) {
      console.error('Erro ao atualizar configuração de troco:', error);
      alert('Erro ao atualizar configuração de troco!');
    }
  };

  return (
    <div className="section">
      <h2>Formas de Pagamento</h2>
      
      <div className="subsection">
        <h3>Nova Forma de Pagamento</h3>
        <div className="form-group">
          <label>Nome*</label>
          <input
            type="text"
            value={novaForma.nome}
            onChange={(e) => setNovaForma({...novaForma, nome: e.target.value})}
            placeholder="Ex: Cartão de Crédito"
          />
        </div>
        
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={novaForma.requerTroco}
              onChange={(e) => setNovaForma({...novaForma, requerTroco: e.target.checked})}
            />
            Requer troco?
          </label>
        </div>
        
        <button className="add-button" onClick={handleAddForma}>Adicionar</button>
      </div>
      
      <div className="subsection">
        <h3>Formas de Pagamento Disponíveis</h3>
        
        <table className="pagamento-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Requer Troco</th>
              <th>Ativo</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {formasPagamento.map(forma => (
              <tr key={forma.id} className={!forma.ativo ? 'inativo' : ''}>
                <td>{forma.nome}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={forma.requerTroco}
                    onChange={() => handleToggleTroco(forma.id)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={forma.ativo}
                    onChange={() => handleToggleAtivo(forma.id)}
                  />
                </td>
                <td>
                  <button 
                    className="remove-button" 
                    onClick={() => handleRemoveForma(forma.id)}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {formasPagamento.length === 0 && (
          <p className="no-data">Nenhuma forma de pagamento cadastrada.</p>
        )}
      </div>
    </div>
  );
}

export default FormasPagamento;