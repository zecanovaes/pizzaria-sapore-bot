import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function InteractionConfigModal({ isOpen, onClose }) {
  const [interactionConfig, setInteractionConfig] = useState({
    visualRequests: {
      keywords: [],
      commandFormat: "SEND_IMAGE(identificador)",
      defaultResponse: "Desculpe, não entendi o pedido de imagem."
    },
    audioRequests: {
      keywords: [],
      commandFormat: "SEND_AUDIO(texto)",
      defaultResponse: "Desculpe, não entendi o pedido de áudio."
    },
    halfHalfPizzaRequests: {
      commandFormat: "SEND_MEIA_META_IMAGE(pizza1,pizza2)",
      defaultResponse: "Desculpe, não entendi o pedido de pizza meio a meio."
    }
  });

  useEffect(() => {
    // Carregar configuração existente
    const fetchInteractionConfig = async () => {
      try {
        const response = await fetch(`${API_URL}/interaction-config`);
        if (response.ok) {
          const data = await response.json();
          setInteractionConfig(data);
        }
      } catch (error) {
        console.error('Erro ao carregar configuração de interação:', error);
      }
    };

    if (isOpen) {
      fetchInteractionConfig();
    }
  }, [isOpen]);

  const handleSave = async () => {
    try {
      const response = await fetch(`${API_URL}/interaction-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(interactionConfig)
      });

      if (response.ok) {
        alert('Configurações de interação salvas com sucesso!');
        onClose();
      } else {
        throw new Error('Erro ao salvar configurações');
      }
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      alert(`Erro: ${error.message}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Configurações Avançadas de Interação</h2>
        
        <div className="form-group">
          <label>Formato de Comando para Imagens</label>
          <input 
            type="text"
            value={interactionConfig.visualRequests.commandFormat}
            onChange={(e) => setInteractionConfig(prev => ({
              ...prev,
              visualRequests: {
                ...prev.visualRequests,
                commandFormat: e.target.value
              }
            }))}
          />
          <label>Resposta Padrão para Imagens</label>
          <textarea 
            value={interactionConfig.visualRequests.defaultResponse}
            onChange={(e) => setInteractionConfig(prev => ({
              ...prev,
              visualRequests: {
                ...prev.visualRequests,
                defaultResponse: e.target.value
              }
            }))}
          />
        </div>

        <div className="form-group">
          <label>Formato de Comando para Áudio</label>
          <input 
            type="text"
            value={interactionConfig.audioRequests.commandFormat}
            onChange={(e) => setInteractionConfig(prev => ({
              ...prev,
              audioRequests: {
                ...prev.audioRequests,
                commandFormat: e.target.value
              }
            }))}
          />
          <label>Resposta Padrão para Áudio</label>
          <textarea 
            value={interactionConfig.audioRequests.defaultResponse}
            onChange={(e) => setInteractionConfig(prev => ({
              ...prev,
              audioRequests: {
                ...prev.audioRequests,
                defaultResponse: e.target.value
              }
            }))}
          />
        </div>

        <div className="form-group">
          <label>Formato de Comando para Pizza Meio a Meio</label>
          <input 
            type="text"
            value={interactionConfig.halfHalfPizzaRequests.commandFormat}
            onChange={(e) => setInteractionConfig(prev => ({
              ...prev,
              halfHalfPizzaRequests: {
                ...prev.halfHalfPizzaRequests,
                commandFormat: e.target.value
              }
            }))}
          />
          <label>Resposta Padrão para Pizza Meio a Meio</label>
          <textarea 
            value={interactionConfig.halfHalfPizzaRequests.defaultResponse}
            onChange={(e) => setInteractionConfig(prev => ({
              ...prev,
              halfHalfPizzaRequests: {
                ...prev.halfHalfPizzaRequests,
                defaultResponse: e.target.value
              }
            }))}
          />
        </div>

        <div className="modal-actions">
          <button onClick={handleSave}>Salvar Configurações</button>
          <button onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export default InteractionConfigModal;