import React, { useState, useEffect } from 'react';
import axios from 'axios';

// URL da API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function DeliveryAreaConfig() {
  const [deliveryConfig, setDeliveryConfig] = useState({
    enabled: true,
    areas: [
      { city: "", state: "", active: true } // Formato inicial
    ],
    restrictions: {
      limitToSpecificAreas: false,
      maxDistance: 0,
      additionalFeePerKm: 0
    },
    messages: {
      outsideAreaMessage: "",
      partialAddressMessage: ""
    }
  });
  
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("");

  // Carregar dados do backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`${API_URL}/delivery-config`);
        if (response.data) {
          setDeliveryConfig(response.data);
        }
        
        // Obter chave da API
        const keyResponse = await axios.get(`${API_URL}/api-keys/google-maps`);
        if (keyResponse.data && keyResponse.data.key) {
          setGoogleMapsApiKey(keyResponse.data.key);
        }
      } catch (error) {
        console.error('Erro ao carregar configurações de entrega:', error);
      }
    };
    
    fetchData();
  }, []);

  // Adicionar nova área
  const handleAddArea = () => {
    setDeliveryConfig({
      ...deliveryConfig,
      areas: [
        ...deliveryConfig.areas,
        { city: "", state: "", active: true }
      ]
    });
  };

  // Remover área
  const handleRemoveArea = (index) => {
    const newAreas = [...deliveryConfig.areas];
    newAreas.splice(index, 1);
    setDeliveryConfig({
      ...deliveryConfig,
      areas: newAreas
    });
  };

  // Atualizar área
  const handleAreaChange = (index, field, value) => {
    const newAreas = [...deliveryConfig.areas];
    newAreas[index] = {
      ...newAreas[index],
      [field]: value
    };
    setDeliveryConfig({
      ...deliveryConfig,
      areas: newAreas
    });
  };

  // Salvar configurações
  const handleSave = async () => {
    try {
      // Salvar configuração de entrega
      await axios.post(`${API_URL}/delivery-config`, deliveryConfig);
      
      // Salvar chave da API, se fornecida
      if (googleMapsApiKey) {
        await axios.post(`${API_URL}/api-keys/google-maps`, { key: googleMapsApiKey });
      }
      
      alert('Configurações de entrega salvas com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar configurações de entrega:', error);
      alert('Erro ao salvar configurações. Tente novamente.');
    }
  };

  return (
    <div className="section">
      <h2>Configuração de Área de Entrega</h2>
      
      <div className="form-group">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={deliveryConfig.enabled}
            onChange={(e) => setDeliveryConfig({...deliveryConfig, enabled: e.target.checked})}
          />
          Ativar validação de endereços
        </label>
        <p className="help-text">
          Quando ativado, o bot validará os endereços informados pelos clientes e verificará se estão dentro da área de entrega.
        </p>
      </div>
      
      <div className="form-group">
        <label>Chave da API do Google Maps</label>
        <input
          type="text"
          value={googleMapsApiKey}
          onChange={(e) => setGoogleMapsApiKey(e.target.value)}
          placeholder="Insira sua chave da API do Google Maps"
        />
        <p className="help-text">
          É necessária uma chave da API do Google Maps para validação de endereços.
          <a href="https://developers.google.com/maps/documentation/javascript/get-api-key" target="_blank" rel="noopener noreferrer">
            Saiba como obter uma chave
          </a>
        </p>
      </div>
      
      <h3>Restrições de Entrega</h3>
      
      <div className="form-group">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={deliveryConfig.restrictions.limitToSpecificAreas}
            onChange={(e) => setDeliveryConfig({
              ...deliveryConfig,
              restrictions: {
                ...deliveryConfig.restrictions,
                limitToSpecificAreas: e.target.checked
              }
            })}
          />
          Limitar entrega apenas às áreas especificadas abaixo
        </label>
      </div>
      
      <div className="form-group">
        <label>Distância máxima de entrega (km)</label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={deliveryConfig.restrictions.maxDistance}
          onChange={(e) => setDeliveryConfig({
            ...deliveryConfig,
            restrictions: {
              ...deliveryConfig.restrictions,
              maxDistance: parseFloat(e.target.value)
            }
          })}
          placeholder="0 = sem limite"
        />
        <p className="help-text">
          0 = sem limite de distância
        </p>
      </div>
      
      <div className="form-group">
        <label>Taxa adicional por km (R$)</label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={deliveryConfig.restrictions.additionalFeePerKm}
          onChange={(e) => setDeliveryConfig({
            ...deliveryConfig,
            restrictions: {
              ...deliveryConfig.restrictions,
              additionalFeePerKm: parseFloat(e.target.value)
            }
          })}
          placeholder="0 = sem taxa adicional"
        />
      </div>
      
      <h3>Áreas de Entrega</h3>
      
      {deliveryConfig.areas.map((area, index) => (
        <div key={index} className="area-form">
          <div className="form-row">
            <div className="form-group">
              <label>Cidade</label>
              <input
                type="text"
                value={area.city}
                onChange={(e) => handleAreaChange(index, 'city', e.target.value)}
                placeholder="Ex: São Paulo"
              />
            </div>
            
            <div className="form-group">
              <label>Estado</label>
              <input
                type="text"
                value={area.state}
                onChange={(e) => handleAreaChange(index, 'state', e.target.value)}
                placeholder="Ex: SP"
              />
            </div>
            
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={area.active}
                  onChange={(e) => handleAreaChange(index, 'active', e.target.checked)}
                />
                Ativo
              </label>
            </div>
            
            <button 
              className="remove-button" 
              onClick={() => handleRemoveArea(index)}
              disabled={deliveryConfig.areas.length === 1}
            >
              Remover
            </button>
          </div>
        </div>
      ))}
      
      <button className="add-button" onClick={handleAddArea}>
        Adicionar Área
      </button>
      
      <h3>Mensagens</h3>
      
      <div className="form-group">
        <label>Mensagem para Endereço Fora da Área</label>
        <textarea
          rows="3"
          value={deliveryConfig.messages.outsideAreaMessage}
          onChange={(e) => setDeliveryConfig({
            ...deliveryConfig,
            messages: {
              ...deliveryConfig.messages,
              outsideAreaMessage: e.target.value
            }
          })}
          placeholder="Ex: Desculpe, não entregamos nesse endereço. Nossa área de entrega é limitada a..."
        />
      </div>
      
      <div className="form-group">
        <label>Mensagem para Endereço Incompleto</label>
        <textarea
          rows="3"
          value={deliveryConfig.messages.partialAddressMessage}
          onChange={(e) => setDeliveryConfig({
            ...deliveryConfig,
            messages: {
              ...deliveryConfig.messages,
              partialAddressMessage: e.target.value
            }
          })}
          placeholder="Ex: Por favor, forneça o endereço completo com número e bairro..."
        />
      </div>
      
      <button className="save-button" onClick={handleSave}>
        Salvar Configurações
      </button>
    </div>
  );
}

export default DeliveryAreaConfig;