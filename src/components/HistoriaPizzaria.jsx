import React, { useState, useEffect } from 'react';
import axios from 'axios';

// URL da API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function HistoriaPizzaria() {
  const [historia, setHistoria] = useState({
    titulo: "",
    conteudo: "",
    imagem: ""
  });

  // Carrega dados do backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(`${API_URL}/historia`);
        if (response.data) {
          setHistoria(response.data);
        }
      } catch (error) {
        console.error('Erro ao carregar história da pizzaria:', error);
      }
    };
    
    fetchData();
  }, []);

  // Manipula upload de imagem
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await axios.post(`${API_URL}/upload-image`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setHistoria({
        ...historia,
        imagem: response.data.url
      });
    } catch (error) {
      console.error('Erro ao fazer upload da imagem:', error);
      alert('Erro ao fazer upload da imagem. Tente novamente.');
    }
  };

  // Salva dados no backend
  const handleSave = async () => {
    try {
      await axios.post(`${API_URL}/historia`, historia);
      alert('História da pizzaria salva com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar história da pizzaria:', error);
      alert('Erro ao salvar história da pizzaria!');
    }
  };

  return (
    <div className="section">
      <h2>História da Pizzaria</h2>
      <p className="secao-descricao">
        Esta seção define a história e origem da pizzaria. Essas informações serão usadas pelo bot para 
        responder perguntas sobre a pizzaria.
      </p>
      
      <div className="form-group">
        <label>Título</label>
        <input
          type="text"
          value={historia.titulo}
          onChange={(e) => setHistoria({...historia, titulo: e.target.value})}
          placeholder="Ex: Sapore di São Paulo - Uma história de tradição italiana"
        />
      </div>
      
      <div className="form-group">
        <label>História da Pizzaria</label>
        <textarea
          rows="10"
          value={historia.conteudo}
          onChange={(e) => setHistoria({...historia, conteudo: e.target.value})}
          placeholder="Conte a história da pizzaria, sua origem, tradição e valores..."
        />
      </div>
      
      <div className="form-group">
        <label>Imagem da Pizzaria</label>
        <div className="image-upload-container">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
          />
          {historia.imagem && (
            <div className="image-preview">
              <img src={historia.imagem} alt="Prévia da pizzaria" />
            </div>
          )}
        </div>
      </div>
      
      <button className="save-button" onClick={handleSave}>Salvar História</button>
    </div>
  );
}

export default HistoriaPizzaria;