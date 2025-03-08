import React, { useState, useEffect } from 'react';

// URL da API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function Cardapio() {
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState({
    nome: "",
    descricao: "",
    inspiracao: "",
    categoria: "",
    preco: "",
    imagemGeral: null,
    imagemEsquerda: null,
    imagemDireita: null,
    disponivel: true
  });
  const [categorias, setCategorias] = useState([]);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [editandoItemId, setEditandoItemId] = useState(null);
  const [modoEdicao, setModoEdicao] = useState(false);

  // Carrega dados do backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Carregar dados do cardápio
        const cardapioResponse = await fetch(`${API_URL}/cardapio`);
        const cardapioData = await cardapioResponse.json();
        setItems(cardapioData.items || []);

        // Carregar categorias diretamente do endpoint de categorias
        const categoriasResponse = await fetch(`${API_URL}/categorias`);
        const categoriasData = await categoriasResponse.json();

        // Extrair apenas os nomes das categorias
        const nomesCategorias = categoriasData.map(cat => cat.nome);
        setCategorias(nomesCategorias || []);

        console.log('DIAGNÓSTICO FRONTEND:');
        console.log('Categorias carregadas:', nomesCategorias);
        console.log('Primeiro item:', cardapioData.items[0]);
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
      }
    };

    fetchData();
  }, []);

  // Adiciona nova categoria
  // Adiciona nova categoria
  const handleAddCategoria = async () => {
    if (novaCategoria.trim() === "") return;

    // Verificar localmente primeiro
    if (categorias.includes(novaCategoria)) {
      alert("Esta categoria já existe!");
      return;
    }

    try {
      // Enviar para o backend
      const response = await fetch(`${API_URL}/categorias`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nome: novaCategoria })
      });

      const result = await response.json();

      if (result.success) {
        console.log('Categoria salva com sucesso:', result.categoria);
        // Adicionar ao estado local depois de confirmar que foi salvo no backend
        setCategorias([...categorias, novaCategoria]);
        setNovaCategoria("");
      } else {
        console.error('Erro ao salvar categoria:', result.message);
        alert("Erro ao salvar categoria: " + result.message);
      }
    } catch (error) {
      console.error('Erro ao adicionar categoria:', error);
      alert("Erro ao adicionar categoria. Veja o console para detalhes.");
    }
  };

  const gerarIdentificador = (categoria, nome) => {
    return `${categoria.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-')}_${nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-')}`;
  };

  // Adiciona ou edita item no cardápio
  const handleAddItem = async () => {
    if (!newItem.nome || !newItem.preco || !newItem.categoria) {
      alert("Preencha todos os campos obrigatórios!");
      return;
    }

    // Gera o identificador
    const identificador = gerarIdentificador(newItem.categoria, newItem.nome);

    // Cria o objeto com o identificador
    const itemComIdentificador = {
      ...newItem,
      identificador
    };

    const formData = new FormData();
    formData.append("nome", itemComIdentificador.nome);
    formData.append("descricao", itemComIdentificador.descricao);
    formData.append("inspiracao", itemComIdentificador.inspiracao);
    formData.append("categoria", itemComIdentificador.categoria);
    formData.append("preco", itemComIdentificador.preco);
    formData.append("disponivel", itemComIdentificador.disponivel);
    formData.append("identificador", itemComIdentificador.identificador);

    if (newItem.categoria.toLowerCase().includes('pizza')) {
      if (newItem.imagemEsquerda) formData.append("imagemEsquerda", newItem.imagemEsquerda);
      if (newItem.imagemDireita) formData.append("imagemDireita", newItem.imagemDireita);
      if (newItem.imagemGeral) formData.append("imagemGeral", newItem.imagemGeral);
    } else {
      if (newItem.imagemGeral) formData.append("imagemGeral", newItem.imagemGeral);
    }

    try {
      let response;
      if (modoEdicao) {
        // Se estiver no modo de edição, faz uma requisição PUT
        response = await fetch(`${API_URL}/cardapio/item/${editandoItemId}`, {
          method: 'PUT',
          body: formData
        });
      } else {
        // Caso contrário, faz uma requisição POST
        response = await fetch(`${API_URL}/cardapio/item`, {
          method: 'POST',
          body: formData
        });
      }

      if (!response.ok) {
        throw new Error('Erro ao adicionar/editar item');
      }

      const data = await response.json();
      if (modoEdicao) {
        // Atualiza o item na lista
        setItems(items.map(item => item._id === editandoItemId ? data : item));
      } else {
        // Adiciona o novo item à lista
        setItems([...items, data]);
      }

      // Limpa o formulário e sai do modo de edição
      setNewItem({
        nome: "",
        descricao: "",
        inspiracao: "",
        categoria: "",
        preco: "",
        imagemGeral: null,
        imagemEsquerda: null,
        imagemDireita: null,
        disponivel: true
      });
      setModoEdicao(false);
      setEditandoItemId(null);
    } catch (error) {
      console.error('Erro ao adicionar/editar item:', error);
      alert('Erro ao adicionar/editar item ao cardápio!');
    }
  };

  // Remove item do cardápio
  const handleRemoveItem = async (id) => {
    try {
      const response = await fetch(`${API_URL}/cardapio/item/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Erro ao remover item');
      }

      setItems(items.filter(item => item._id !== id));
    } catch (error) {
      console.error('Erro ao remover item:', error);
      alert('Erro ao remover item do cardápio!');
    }
  };

  // Alterna disponibilidade do item
  const handleToggleDisponivel = async (id) => {
    const item = items.find(item => item._id === id);
    if (!item) return;

    try {
      const response = await fetch(`${API_URL}/cardapio/item/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ disponivel: !item.disponivel })
      });

      if (!response.ok) {
        throw new Error('Erro ao atualizar disponibilidade');
      }

      setItems(items.map(item =>
        item._id === id ? { ...item, disponivel: !item.disponivel } : item
      ));
    } catch (error) {
      console.error('Erro ao atualizar disponibilidade:', error);
      alert('Erro ao atualizar disponibilidade do item!');
    }
  };

  // Carrega os dados de um item para edição
  const handleEditarItem = (item) => {
    setNewItem({
      nome: item.nome,
      descricao: item.descricao,
      inspiracao: item.inspiracao,
      categoria: item.categoria,
      preco: item.preco,
      imagemGeral: item.imagemGeral,
      imagemEsquerda: item.imagemEsquerda,
      imagemDireita: item.imagemDireita,
      disponivel: item.disponivel
    });
    setEditandoItemId(item._id);
    setModoEdicao(true);
  };

  return (
    <div className="section">
      <h2>Gerenciamento de Cardápio</h2>
      <p className="secao-descricao">
        Adicione e edite os itens do cardápio que serão oferecidos pelo bot.
        Para cada item, você pode especificar os ingredientes (descrição) e a história/inspiração do prato.
      </p>

      <div className="subsection">
        <h3>Categorias</h3>
        <div className="categoria-form">
          <input
            type="text"
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
            placeholder="Nova categoria"
          />
          <button onClick={handleAddCategoria}>Adicionar Categoria</button>
        </div>

        <div className="categorias-list">
          {categorias.map(cat => (
            <span key={cat} className="categoria-tag">{cat}</span>
          ))}
        </div>
      </div>

      <div className="subsection">
        <h3>{modoEdicao ? 'Editar Item do Cardápio' : 'Adicionar Item ao Cardápio'}</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Nome*</label>
            <input
              type="text"
              value={newItem.nome}
              onChange={(e) => setNewItem({ ...newItem, nome: e.target.value })}
              placeholder="Ex: Pizza Margherita"
            />
          </div>

          <div className="form-group">
            <label>Descrição (Ingredientes)*</label>
            <input
              type="text"
              value={newItem.descricao}
              onChange={(e) => setNewItem({ ...newItem, descricao: e.target.value })}
              placeholder="Ex: Molho de tomate, queijo e manjericão"
            />
          </div>

          <div className="form-group">
            <label>Inspiração/História do Prato</label>
            <textarea
              rows="3"
              value={newItem.inspiracao}
              onChange={(e) => setNewItem({ ...newItem, inspiracao: e.target.value })}
              placeholder="Ex: Esta pizza é inspirada na tradição napolitana e representa as cores da bandeira italiana..."
            />
          </div>

          <div className="form-group">
            <label>Categoria*</label>
            <select
              value={newItem.categoria}
              onChange={(e) => setNewItem({ ...newItem, categoria: e.target.value })}
            >
              <option value="">Selecione uma categoria</option>
              {categorias.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Preço* (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newItem.preco}
              onChange={(e) => setNewItem({ ...newItem, preco: e.target.value })}
              placeholder="Ex: 45.00"
            />
          </div>

          <div className="form-group">
            <label>Imagens</label>
            {newItem.categoria.toLowerCase().includes('pizza') ? (
              <div className="pizza-image-upload" style={{ display: 'flex', gap: '10px' }}>
                <div>
                  <label>Esquerda</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      setNewItem({ ...newItem, imagemEsquerda: file });
                    }}
                  />
                  {newItem.imagemEsquerda && (
                    <img
                      src={
                        typeof newItem.imagemEsquerda === 'string'
                          ? newItem.imagemEsquerda
                          : newItem.imagemEsquerda instanceof File
                            ? URL.createObjectURL(newItem.imagemEsquerda)
                            : ''
                      }
                      alt="Prévia esquerda"
                      style={{ maxWidth: '100px', maxHeight: '100px' }}
                    />
                  )}
                </div>
                <div>
                  <label>Direita</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      setNewItem({ ...newItem, imagemDireita: file });
                    }}
                  />
                  {newItem.imagemDireita && (
                    <img
                      src={
                        typeof newItem.imagemDireita === 'string'
                          ? newItem.imagemDireita
                          : newItem.imagemDireita instanceof File
                            ? URL.createObjectURL(newItem.imagemDireita)
                            : ''
                      }
                      alt="Prévia direita"
                      style={{ maxWidth: '100px', maxHeight: '100px' }}
                    />
                  )}
                </div>
                <div>
                  <label>Geral</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      setNewItem({ ...newItem, imagemGeral: file });
                    }}
                  />
                  {newItem.imagemGeral && (
                    <img
                      src={
                        typeof newItem.imagemGeral === 'string'
                          ? newItem.imagemGeral
                          : newItem.imagemGeral instanceof File
                            ? URL.createObjectURL(newItem.imagemGeral)
                            : ''
                      }
                      alt="Prévia geral"
                      style={{ maxWidth: '100px', maxHeight: '100px' }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setNewItem({ ...newItem, imagemGeral: file });
                  }}
                />
                {newItem.imagemGeral && (
                  <img
                    src={
                      typeof newItem.imagemGeral === 'string'
                        ? newItem.imagemGeral
                        : newItem.imagemGeral instanceof File
                          ? URL.createObjectURL(newItem.imagemGeral)
                          : ''
                    }
                    alt="Prévia geral"
                    style={{ maxWidth: '200px', maxHeight: '200px' }}
                  />
                )}
              </div>
            )}
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={newItem.disponivel}
                onChange={(e) => setNewItem({ ...newItem, disponivel: e.target.checked })}
              />
              Disponível para venda
            </label>
          </div>
        </div>

        <button className="add-button" onClick={handleAddItem}>
          {modoEdicao ? 'Salvar Edição' : 'Adicionar Item'}
        </button>
        {modoEdicao && (
          <button className="cancel-button" onClick={() => {
            setNewItem({
              nome: "",
              descricao: "",
              inspiracao: "",
              categoria: "",
              preco: "",
              imagemGeral: null,
              imagemEsquerda: null,
              imagemDireita: null,
              disponivel: true
            });
            setModoEdicao(false);
            setEditandoItemId(null);
          }}>
            Cancelar Edição
          </button>
        )}
      </div>

      <div className="subsection">
        <h3>Itens do Cardápio</h3>

        {categorias.map(categoria => (
          <div key={categoria} className="categoria-section">
            <h4>{categoria}</h4>
            <div className="items-grid">
              {items
                .filter(item => {
                  // Buscar correspondência entre o item e a categoria atual
                  if (!item.categoria && !item.categoriaNome) return false;

                  // Verificar o campo categoriaNome primeiro (adicionado pelo backend)
                  if (item.categoriaNome === categoria) return true;

                  // Se não tiver categoriaNome, verificar o campo categoria diretamente
                  if (typeof item.categoria === 'string' && item.categoria === categoria) {
                    return true;
                  }

                  return false;
                })
                .map(item => (
                  <div key={item._id} className={`item-card ${!item.disponivel ? 'indisponivel' : ''}`}>
                    {item.imagemGeral && (
                      <div className="item-image">
                        <img
                          src={item.imagemGeral}
                          alt={item.nome}
                          style={{ maxHeight: '200px' }}
                        />
                      </div>
                    )}
                    <div className="item-info">
                      <h5>{item.nome}</h5>
                      <p><strong>Ingredientes:</strong> {item.descricao}</p>
                      {item.inspiracao && (
                        <p className="inspiracao"><strong>Inspiração:</strong> {item.inspiracao}</p>
                      )}
                      <p className="preco">R$ {parseFloat(item.preco).toFixed(2)}</p>

                      <div className="item-controls">
                        <label className="disponivel-toggle">
                          <input
                            type="checkbox"
                            checked={item.disponivel}
                            onChange={() => handleToggleDisponivel(item._id)}
                          />
                          Disponível
                        </label>
                        <button
                          className="edit-button"
                          onClick={() => handleEditarItem(item)}
                        >
                          ✎
                        </button>
                        <button
                          className="remove-button"
                          onClick={() => handleRemoveItem(item._id)}
                        >
                          X
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Cardapio;