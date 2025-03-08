# Sapore di São Paulo - Sistema de Pizzaria com Bot

Este projeto foi desenvolvido como parte de um processo seletivo, consistindo em um sistema completo para gerenciar uma pizzaria virtual com um bot de WhatsApp integrado.

## Estrutura do Projeto

O sistema é dividido em três componentes principais:

1. **Frontend (React)**: Painel administrativo para gerenciar o bot, cardápio, e ver histórico
2. **API (Node.js/Express)**: Backend que gerencia os dados e se comunica com o LLM
3. **Bot WhatsApp**: Cliente WhatsApp que interage com os usuários

## Requisitos

- Node.js 14+
- NPM ou Yarn
- Conta na OpenAI (para API key)
- Smartphone com WhatsApp para autenticação

## Instalação e Configuração

### 1. API Backend

```bash
cd api
npm install
# Configure sua API key da OpenAI no arquivo .env
# PORT=3000
# OPENAI_API_KEY=sua-chave-da-openai-aqui
npm start
```

### 2. Bot WhatsApp

```bash
cd bot
npm install
# Configure o arquivo .env se necessário
npm start
# Escaneie o QR code no seu WhatsApp
```

### 3. Frontend Admin

```bash
npm install
# O arquivo .env já está configurado para apontar para localhost:3001/api
npm start
```

## Uso do Sistema

### Painel Administrativo

O painel administrativo (localhost:3000) permite:

1. **Configurar a Persona do Bot**:
   - Defina o nome, personalidade e estilo de comunicação
   - Configure as regras e procedimentos de atendimento

2. **Gerenciar o Cardápio**:
   - Crie categorias (Pizzas, Bebidas, etc.)
   - Adicione itens com imagens, descrições e preços

3. **Configurar Formas de Pagamento**:
   - Adicione métodos de pagamento aceitos
   - Configure quais necessitam de troco

4. **Ver Histórico**:
   - Consulte pedidos realizados
   - Acompanhe conversas entre clientes e o bot

### Bot WhatsApp

O bot responde às mensagens de acordo com a personalidade e regras definidas no painel administrativo. Ele utiliza:

- **LLM (OpenAI)**: Para gerar respostas naturais
- **TTS (Text-to-Speech)**: Para enviar mensagens de voz
- **Imagens**: Para enviar cardápio e confirmar pedidos

## Fluxo de Dados

1. Cliente envia mensagem pelo WhatsApp
2. O bot encaminha a mensagem para a API
3. A API consulta as configurações definidas no painel admin
4. A API gera um prompt completo com todas as regras, cardápio, etc.
5. O LLM processa e retorna uma resposta
6. A API gera áudio e seleciona imagens relevantes
7. O bot envia a resposta de volta ao cliente

## Notas Importantes

- Este é um sistema de demonstração/prova de conceito
- Em um ambiente de produção, seria recomendado:
  - Implementar um banco de dados real (MongoDB, PostgreSQL)
  - Melhorar a segurança com autenticação no painel
  - Utilizar a API oficial do WhatsApp Business

## Licença

Este projeto foi desenvolvido para fins de avaliação e não possui licença específica.