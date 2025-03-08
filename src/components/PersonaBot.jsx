import React, { useState, useEffect } from 'react';
import InteractionConfigModal from './InteractionConfigModal';

// URL da API
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

function PersonaBot() {
  const [botConfig, setBotConfig] = useState({
    nome: "",
    descricao: "",
    personalidade: "",
    procedimento: "",
    regras: "",
    welcomeMessage: "", // Mensagem de boas-vindas
    unsupportedMediaMessage: "", // Mensagem para mídia não suportada
    menuImage: "", // URL da imagem do cardápio
    menuImageNome: "", // Nome original do arquivo
    menuImageCaption: "", // Legenda da imagem do cardápio
    confirmationImage: "", // URL da imagem de confirmação de pedido
    confirmationImageNome: "", // Nome original do arquivo
    confirmationImageCaption: "", // Legenda da imagem de confirmação
    // Novos campos para o sistema de tags
    systemPrompt: "", // Prompt principal do sistema
    formatInstruction: "" // Instruções de formatação para resposta
  });

  // Novo estado para controlar a abertura do modal
  const [isInteractionModalOpen, setIsInteractionModalOpen] = useState(false);

  // Função para obter o prompt padrão do sistema
  const getDefaultSystemPrompt = () => {
    return `Seu nome é {{BOT_NAME}}, {{BOT_DESCRIPTION}}.

# PERSONALIDADE
{{PERSONALIDADE}}

# HISTÓRIA DA PIZZARIA
{{HISTORIA}}

# RESTRIÇÕES ESSENCIAIS
1. Você é APENAS um atendente de pizzaria. NUNCA responda perguntas gerais não relacionadas à pizzaria.
2. Se alguém perguntar algo fora do contexto da pizzaria, diga educadamente que só pode ajudar com assuntos relacionados à pizzaria.
3. NO ESTADO 4 (endereço), EXIJA SEMPRE o número do endereço e o bairro. Não aceite endereços incompletos.
4. Siga RIGOROSAMENTE o procedimento de pedido conforme o estado atual.
5. OFEREÇA APENAS os sabores listados no cardápio. NUNCA invente sabores não listados.
6. Mantenha o atendimento focado no pedido de pizza dentro do contexto da pizzaria.

# CARDÁPIO
{{CARDAPIO}}

# FORMAS DE PAGAMENTO
{{FORMAS_PAGAMENTO}}

# PROCEDIMENTO DE PEDIDO
{{PROCEDIMENTO}}

# REGRAS
{{REGRAS}}

# ESTADO ATUAL
O pedido está atualmente no estado {{CURRENT_STATE}}.

# FORMATAÇÃO DE RESPOSTA OBRIGATÓRIA
Você DEVE formatar sua resposta usando PELO MENOS UMA das seguintes tags:

1. [TEXT_FORMAT] - Para respostas de texto comuns
2. [VOICE_FORMAT] - Para conteúdo que deve ser convertido em áudio
3. [IMAGE_FORMAT] - Para solicitar o envio de uma imagem
4. [JSON_FORMAT] - Para respostas estruturadas como confirmação de pedido

Encerre cada bloco de formatação com [/END]

Exemplos:
- [TEXT_FORMAT]Olá, como posso ajudar?[/END]
- [VOICE_FORMAT]Este texto será convertido em áudio[/END]
- [IMAGE_FORMAT]cardapio[/END] (para enviar a imagem do cardápio)
- [IMAGE_FORMAT]pizza_margherita[/END] (para enviar a imagem de um item específico)
- [JSON_FORMAT]{"pedido":{"items":[{"nome":"Pizza Margherita","quantidade":1,"preco":45.90}],"total":45.90,"endereco":"Rua Exemplo, 123","pagamento":"Cartão de Crédito"}}[/END]

# INSTRUÇÕES ESPECIAIS
Para criar botões interativos, use a seguinte formatação:
<buttons>{"title": "Título", "buttons": [{"body": "Opção 1"}, {"body": "Opção 2"}], "footer": "Texto opcional de rodapé"}</buttons>`;
  };

  // Função para obter as instruções de formatação padrão
  const getDefaultFormatInstruction = () => {
    return `Você DEVE formatar sua resposta usando PELO MENOS UMA das seguintes tags:

1. [TEXT_FORMAT] - Para respostas de texto comuns
2. [VOICE_FORMAT] - Para conteúdo que deve ser convertido em áudio 
3. [IMAGE_FORMAT] - Para solicitar o envio de uma imagem
4. [JSON_FORMAT] - Para respostas estruturadas como confirmação de pedido

Encerre cada bloco de formatação com [/END]

Exemplos:
- [TEXT_FORMAT]Olá, como posso ajudar?[/END]
- [VOICE_FORMAT]Este texto será convertido em áudio[/END]
- [IMAGE_FORMAT]cardapio[/END] (para enviar a imagem do cardápio)
- [IMAGE_FORMAT]pizza_margherita[/END] (para enviar a imagem de um item específico)
- [JSON_FORMAT]{"pedido":{"items":[{"nome":"Pizza Margherita","quantidade":1,"preco":45.90}],"total":45.90,"endereco":"Rua Exemplo, 123","pagamento":"Cartão de Crédito"}}[/END]`;
  };

  // Carrega dados do backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}/bot-config`);
        
        if (!response.ok) {
          throw new Error('Erro ao buscar configuração');
        }
        
        const data = await response.json();
        console.log("Dados do bot carregados completos:", data);
        
        // Ajuste aqui para mapear campos corretamente
        setBotConfig({
          nome: data.nome || "",
          descricao: data.descricao || "",
          personalidade: data.personalidade || "",
          procedimento: data.procedimento || "",
          regras: data.regras || "",
          welcomeMessage: data.welcomeMessage || "",
          unsupportedMediaMessage: data.unsupportedMediaMessage || "",
          menuImage: data.menuImage || "",
          menuImageCaption: data.menuImageCaption || "",
          confirmationImage: data.confirmationImage || "",
          confirmationImageCaption: data.confirmationImageCaption || "",
          // Novos campos
          systemPrompt: data.systemPrompt || getDefaultSystemPrompt(),
          formatInstruction: data.formatInstruction || getDefaultFormatInstruction()
        });
      } catch (error) {
        console.error('Erro detalhado ao carregar configuração do bot:', error);
      }
    };
    
    fetchData();
  }, []);

  // Manipula upload de imagem
  const handleImageUpload = async (e, imageType) => {
    const file = e.target.files[0];
    if (!file) return;
  
    const reader = new FileReader();
  
    reader.onloadend = async () => {
      const base64Image = reader.result;
      
      // Log de depuração
      console.log('Tipo de imagem:', file.type);
      console.log('Tamanho da imagem:', file.size);
      console.log('Base64 Image (início):', base64Image.substring(0, 100) + '...');
  
      try {
        const response = await fetch(`${API_URL}/upload-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image: base64Image,
            imagemNome: file.name,
          }),
        });
  
        // Log da resposta completa
        const responseText = await response.text();
        console.log('Resposta do servidor (texto completo):', responseText);
  
        // Tentar parsear JSON
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Erro ao parsear resposta JSON:', parseError);
          throw new Error('Resposta inválida do servidor');
        }
  
        console.log('Dados parseados:', data);
  
        if (data.success) {
          setBotConfig((prevConfig) => ({
            ...prevConfig,
            [imageType]: data.url,
            [`${imageType}Nome`]: file.name,
          }));
        } else {
          throw new Error(data.message || 'Erro no upload');
        }
      } catch (error) {
        console.error('Erro detalhado ao fazer upload da imagem:', error);
        alert(`Erro ao fazer upload da imagem: ${error.message}`);
      }
    };
  
    reader.readAsDataURL(file);
  };

  // Salva dados no backend
  const handleSave = async () => {
    try {
      const response = await fetch(`${API_URL}/bot-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: botConfig.nome,
          descricao: botConfig.descricao,
          personalidade: botConfig.personalidade,
          procedimento: botConfig.procedimento,
          regras: botConfig.regras,
          welcomeMessage: botConfig.welcomeMessage,
          unsupportedMediaMessage: botConfig.unsupportedMediaMessage,
          menuImage: botConfig.menuImage,
          menuImageCaption: botConfig.menuImageCaption,
          confirmationImage: botConfig.confirmationImage,
          confirmationImageCaption: botConfig.confirmationImageCaption,
          // Novos campos
          systemPrompt: botConfig.systemPrompt,
          formatInstruction: botConfig.formatInstruction
        }),
      });
  
      if (response.ok) {
        const data = await response.json();
        console.log('Configuração salva:', data);
        alert('Configuração salva com sucesso!');
      } else {
        const errorData = await response.json();
        console.error('Erro ao salvar:', errorData);
        throw new Error(errorData.message || 'Erro ao salvar');
      }
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
      alert(`Erro ao salvar configuração: ${error.message}`);
    }
  };

  return (
    <div className="section">
      <h2>Configuração da Persona do Bot</h2>
      
      {/* Botão para abrir modal de configurações avançadas */}
      <button 
        className="interaction-config-button"
        onClick={() => setIsInteractionModalOpen(true)}
      >
        Configurações Avançadas de Interação
      </button>

      {/* Modal de configurações de interação */}
      <InteractionConfigModal 
        isOpen={isInteractionModalOpen}
        onClose={() => setIsInteractionModalOpen(false)}
      />
      
      <div className="form-group">
        <label>Nome do Bot</label>
        <input
          type="text"
          value={botConfig.nome}
          onChange={(e) => setBotConfig({...botConfig, nome: e.target.value})}
          placeholder="Ex: Luigi"
        />
      </div>
      
      <div className="form-group">
        <label>Descrição</label>
        <input
          type="text"
          value={botConfig.descricao}
          onChange={(e) => setBotConfig({...botConfig, descricao: e.target.value})}
          placeholder="Ex: Pizzaiolo da Sapore di São Paulo"
        />
      </div>
      
      <div className="form-group">
        <label>Personalidade (estilo de fala, manias, atitudes, virtudes)</label>
        <textarea
          rows="6"
          value={botConfig.personalidade}
          onChange={(e) => setBotConfig({...botConfig, personalidade: e.target.value})}
          placeholder="Descreva a personalidade do bot"
        />
      </div>
      
      <div className="form-group">
        <label>Procedimento de Pedido (estados de conversa)</label>
        <textarea
          rows="8"
          value={botConfig.procedimento}
          onChange={(e) => setBotConfig({...botConfig, procedimento: e.target.value})}
          placeholder="Defina os estados do fluxo de pedido"
        />
      </div>
      
      <div className="form-group">
        <label>Regras</label>
        <textarea
          rows="5"
          value={botConfig.regras}
          onChange={(e) => setBotConfig({...botConfig, regras: e.target.value})}
          placeholder="Defina as regras que o bot deve seguir"
        />
      </div>
      
      <h3 className="subsection-title">Mensagens Personalizadas</h3>
      
      <div className="form-group">
        <label>Mensagem de Boas-vindas</label>
        <textarea
          rows="4"
          value={botConfig.welcomeMessage}
          onChange={(e) => setBotConfig({...botConfig, welcomeMessage: e.target.value})}
          placeholder="Mensagem enviada quando um usuário inicia a conversa pela primeira vez"
        />
      </div>
      
      <div className="form-group">
        <label>Mensagem para Mídia Não Suportada</label>
        <textarea
          rows="3"
          value={botConfig.unsupportedMediaMessage}
          onChange={(e) => setBotConfig({...botConfig, unsupportedMediaMessage: e.target.value})}
          placeholder="Mensagem enviada quando o usuário envia um tipo de mídia não suportado (documento, localização, etc.)"
        />
      </div>
      
      <h3 className="subsection-title">Configurações Avançadas de Prompt</h3>
      
      <div className="form-group">
        <label>Prompt do Sistema</label>
        <p className="help-text">
          Este prompt é enviado à OpenAI para definir o comportamento do bot. 
          Você pode usar placeholders como {"{{BOT_NAME}}"}, {"{{PERSONALIDADE}}"}, etc.
        </p>
        <textarea
          rows="12"
          value={botConfig.systemPrompt}
          onChange={(e) => setBotConfig({...botConfig, systemPrompt: e.target.value})}
          placeholder="Prompt principal enviado ao modelo"
          className="code-textarea"
        />
      </div>
      
      <div className="form-group">
        <label>Instruções de Formato de Resposta</label>
        <p className="help-text">
          Estas instruções definem como o bot deve formatar suas respostas usando tags como [TEXT_FORMAT], [VOICE_FORMAT], etc.
        </p>
        <textarea
          rows="8"
          value={botConfig.formatInstruction}
          onChange={(e) => setBotConfig({...botConfig, formatInstruction: e.target.value})}
          placeholder="Instruções de formato de resposta"
          className="code-textarea"
        />
      </div>
      
      <h3 className="subsection-title">Imagens do Bot</h3>
      
      <div className="form-group">
        <label>Imagem do Cardápio</label>
        <div className="image-upload-container">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleImageUpload(e, 'menuImage')}
          />
          {botConfig.menuImage && (
            <div className="image-preview">
              <img src={botConfig.menuImage} alt="Prévia do cardápio" />
              {botConfig.menuImageNome && (
                <p>Nome do arquivo: {botConfig.menuImageNome}</p>
              )}
            </div>
          )}
        </div>
        <input
          type="text"
          value={botConfig.menuImageCaption}
          onChange={(e) => setBotConfig({...botConfig, menuImageCaption: e.target.value})}
          placeholder="Legenda da imagem do cardápio"
          className="caption-input"
        />
      </div>
      
      <div className="form-group">
        <label>Imagem de Confirmação de Pedido</label>
        <div className="image-upload-container">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleImageUpload(e, 'confirmationImage')}
          />
          {botConfig.confirmationImage && (
            <div className="image-preview">
              <img src={botConfig.confirmationImage} alt="Prévia de confirmação" />
              {botConfig.confirmationImageNome && (
                <p>Nome do arquivo: {botConfig.confirmationImageNome}</p>
              )}
            </div>
          )}
        </div>
        <input
          type="text"
          value={botConfig.confirmationImageCaption}
          onChange={(e) => setBotConfig({...botConfig, confirmationImageCaption: e.target.value})}
          placeholder="Legenda da imagem de confirmação"
          className="caption-input"
        />
      </div>
      
      <button className="save-button" onClick={handleSave}>Salvar Configuração</button>
    </div>
  );
}

export default PersonaBot;